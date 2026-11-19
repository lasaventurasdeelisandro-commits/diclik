CREATE TABLE IF NOT EXISTS sponsor_requests (
  user_id VARCHAR(64) NOT NULL REFERENCES professional_profiles(user_id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('plomeria', 'pediatria', 'tecnico', 'profesional')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category)
);
