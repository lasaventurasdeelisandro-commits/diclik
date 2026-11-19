CREATE TABLE IF NOT EXISTS specialist_accreditations (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES professional_profiles(user_id) ON DELETE CASCADE,
  revision UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('titulo', 'diploma', 'carta')),
  photo_mime TEXT NOT NULL CHECK (photo_mime IN ('image/jpeg', 'image/png')),
  photo_data TEXT NOT NULL,
  document_mime TEXT NOT NULL CHECK (document_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  document_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
