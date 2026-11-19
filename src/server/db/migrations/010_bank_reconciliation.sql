CREATE TABLE IF NOT EXISTS bank_settlements (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('CardNET', 'AZUL', 'PORTAL', 'Otro')),
  settlement_ref VARCHAR(100) NOT NULL,
  expected_cents BIGINT NOT NULL CHECK (expected_cents > 0),
  expected_date DATE NOT NULL,
  bank_account VARCHAR(80),
  bank_ref VARCHAR(100),
  bank_date DATE,
  received_cents BIGINT CHECK (received_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, settlement_ref),
  UNIQUE (bank_account, bank_ref)
);
