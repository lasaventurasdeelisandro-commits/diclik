CREATE TABLE IF NOT EXISTS sponsored_specialists (
  user_id VARCHAR(64) NOT NULL REFERENCES professional_profiles(user_id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('plomeria', 'pediatria', 'tecnico', 'profesional')),
  expires_at TIMESTAMPTZ NOT NULL,
  payment_reference VARCHAR(120) NOT NULL,
  PRIMARY KEY (user_id, category)
);

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS preferred_professional_id VARCHAR(64) REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_requests_preferred_professional ON service_requests(preferred_professional_id);

CREATE OR REPLACE VIEW active_sponsored_specialists AS
SELECT s.user_id, s.category, s.expires_at, u.full_name, u.avatar_url, u.role,
       p.trade, p.rating, p.review_count, p.bio
FROM sponsored_specialists s
JOIN users u ON u.id = s.user_id
JOIN professional_profiles p ON p.user_id = s.user_id
WHERE s.expires_at > NOW() AND u.status = 'active' AND p.verified
  AND ((s.category = 'tecnico' AND u.role = 'tecnico')
    OR (s.category = 'plomeria' AND u.role = 'tecnico' AND LOWER(p.trade) LIKE '%plomer%')
    OR (s.category = 'profesional' AND u.role = 'profesional')
    OR (s.category = 'pediatria' AND u.role = 'profesional' AND LOWER(p.trade) LIKE '%pediatr%'));
