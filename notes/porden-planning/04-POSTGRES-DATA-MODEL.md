# 04 | PostgreSQL data model and persistence rules

## Storage decision

Use **PostgreSQL** for the new backend. The current prototype's SQLite tests and data are a migration baseline. PostgreSQL persistence must be verified before retiring the old path. Avoid automatic schema creation at request time; use explicit versioned migrations.

### Recommended local setup

- One PostgreSQL server for local development, with two separate databases: `porden_merchant` and `porden_courier`.
- Independent database users and connection strings for the two Hono deployments.
- For public deployment, separate database credentials and strict role grants; independent managed instances are optional for hackathon, since the trust separation is primarily credentials plus application/database boundary.
- TLS for remote PostgreSQL, secret-managed `DATABASE_URL`, pooling sized to deployment, and health checks.

## Minimum sender-side tables

```sql
CREATE TABLE transfers (
  id UUID PRIMARY KEY,
  sender_org TEXT NOT NULL,
  recipient_origin TEXT NOT NULL,
  case_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('draft', 'approved', 'submitted', 'accepted', 'rejected', 'cancelled', 'unknown')),
  approved_fields TEXT[] NOT NULL DEFAULT '{}',
  payload_sha256 TEXT,
  consented_at TIMESTAMPTZ,
  consent_expires_at TIMESTAMPTZ,
  receiver_case_id TEXT,
  receiver_receipt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transfer_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES transfers(id),
  event_type TEXT NOT NULL,
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transfer_events_transfer_time_idx
  ON transfer_events(transfer_id, occurred_at);
```

`payload_sha256` means a canonicalized, approved payload hash; define a deterministic canonicalization method and test it. A plain hash is for integrity matching, not privacy: avoid placing raw PII in public logs and consider HMAC for low-entropy identifiers. The sender must separately enforce demo user authorization for transfer reads and approvals. Never accept a client's arbitrary status update as proof of receiver acceptance.

## Minimum receiver-side tables

```sql
CREATE TABLE cases (
  id UUID PRIMARY KEY,
  public_case_id TEXT UNIQUE NOT NULL,
  caller_origin TEXT NOT NULL,
  request_id TEXT NOT NULL,
  case_type TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  case_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cases_caller_request_unique UNIQUE (caller_origin, request_id)
);

CREATE TABLE receipts (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL UNIQUE REFERENCES cases(id),
  issuer TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signed_jws TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

These are **draft schemas**. The implementation agent should reconcile with the existing API's actual identifiers and payloads, document deviations, and keep externally observable behavior stable. Add any needed uniqueness/indexing and schema-version columns in reviewed migrations.

## Atomic receiver write

Within one PostgreSQL transaction:

1. Verify the origin, session/CSRF state, transfer approval envelope, authorization of action, request ID, and case-type schema **before** creating records.
2. Attempt a case insert using the unique pair `(caller_origin, request_id)`.
3. Generate the permanent public case ID and sign the receipt with the receiver's key.
4. Insert the receipt and commit. If the transaction fails, the case and receipt both roll back.
5. Return the same stored signed receipt for exact replay. If the request ID exists with different canonical payload hash, reject with a stable conflict error.

**Dropped acknowledgment:** when commit succeeds but the network response disappears, the sender shows `unknown`, performs a read-only query using the original request ID, and verifies the receiver's receipt before marking accepted. The browser must not blindly retry a potentially committed write.

## Schema migration and fixtures

- Use additive numbered SQL migrations, e.g. `0001_initial.sql`, `0002_...sql`.
- Local fixtures create one demo merchant order and one courier-side authorized shipment relationship.
- Temporary DBs or transaction-based test isolation are required. No persistent test residue, and no production credentials in tests.
- Data import from SQLite is **not required** for synthetic demo records. Preserve old test outputs and recreate fixtures in Postgres.
- Remove SQLite dependency and all SQLite-specific runtime/test code only after Postgres acceptance tests pass.

## Secrets and retention

Store private JWS signing material outside the database where practical; put only public `kid` and JWKS data in public endpoints. Never use the frontend to hold signing keys. Retain only enough case data for the demo and document deletion/retention. Make receipt fields non-sensitive so a verifier can inspect them without leaking the complaint content.
