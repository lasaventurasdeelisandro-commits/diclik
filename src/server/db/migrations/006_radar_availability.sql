ALTER TABLE professional_profiles ALTER COLUMN lat DROP DEFAULT;
ALTER TABLE professional_profiles ALTER COLUMN lng DROP DEFAULT;
ALTER TABLE professional_profiles ALTER COLUMN is_available SET DEFAULT FALSE;

UPDATE professional_profiles
SET lat = NULL, lng = NULL, is_available = FALSE
WHERE lat = 18.4861 AND lng = -69.9312
AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '006_radar_availability');
