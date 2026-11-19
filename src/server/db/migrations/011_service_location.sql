ALTER TABLE service_requests ALTER COLUMN lat DROP DEFAULT;
ALTER TABLE service_requests ALTER COLUMN lng DROP DEFAULT;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS location_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- Older clients sent no location and the server supplied this exact pair.
UPDATE service_requests
SET location_confirmed = TRUE
WHERE lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
  AND (lat <> 18.4861 OR lng <> -69.9312);
