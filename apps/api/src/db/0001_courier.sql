CREATE TABLE shipments (order_reference TEXT PRIMARY KEY, customer_id TEXT NOT NULL);
INSERT INTO shipments VALUES ('DEMO-1042','demo-user');
CREATE TABLE cases (
  id UUID PRIMARY KEY,
  public_case_id TEXT UNIQUE NOT NULL,
  customer_id TEXT NOT NULL,
  caller_origin TEXT NOT NULL,
  request_id TEXT NOT NULL,
  transfer_id UUID NOT NULL,
  case_type TEXT NOT NULL CHECK (case_type = 'delivery_damage'),
  request_sha256 TEXT NOT NULL,
  case_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status = 'accepted'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (caller_origin,request_id),
  UNIQUE (caller_origin,transfer_id)
);
CREATE TABLE receipts (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL UNIQUE REFERENCES cases(id),
  issuer TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signed_jws TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
