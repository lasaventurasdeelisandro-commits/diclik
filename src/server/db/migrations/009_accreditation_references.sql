ALTER TABLE specialist_accreditations ADD COLUMN IF NOT EXISTS extra_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE specialist_accreditations DROP CONSTRAINT IF EXISTS specialist_accreditations_kind_check;
ALTER TABLE specialist_accreditations ADD CONSTRAINT specialist_accreditations_kind_check
  CHECK (kind IN ('titulo', 'diploma', 'carta', 'referencias'));
