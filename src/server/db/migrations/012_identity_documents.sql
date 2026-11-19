CREATE TABLE IF NOT EXISTS identity_documents (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime VARCHAR(32) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  document_data TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
