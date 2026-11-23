CREATE TABLE transfers (
  id UUID PRIMARY KEY,
  customer_id TEXT NOT NULL,
  sender_org TEXT NOT NULL,
  recipient_origin TEXT NOT NULL,
  case_type TEXT NOT NULL CHECK (case_type = 'delivery_damage'),
  draft_data JSONB NOT NULL,
  approved_data JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','submitted','accepted','rejected','cancelled','unknown')),
  approved_fields TEXT[] NOT NULL DEFAULT '{}',
  payload_sha256 TEXT,
  consented_at TIMESTAMPTZ,
  consent_expires_at TIMESTAMPTZ,
  receiver_case_id TEXT,
  receiver_receipt_id UUID,
  verified_receipt JSONB,
  signed_receipt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE transfer_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES transfers(id),
  event_type TEXT NOT NULL,
  safe_metadata JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transfer_events_transfer_time_idx ON transfer_events(transfer_id,occurred_at);
