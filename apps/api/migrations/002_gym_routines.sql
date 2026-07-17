CREATE TABLE IF NOT EXISTS gym_routines (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  calendar_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  training_days JSONB NOT NULL DEFAULT '["monday","wednesday","friday"]',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  workouts JSONB NOT NULL DEFAULT '{"A":[],"B":[]}',
  progression JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gym_routines ADD COLUMN IF NOT EXISTS calendar_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS gym_routines_user_updated_idx ON gym_routines (user_id, updated_at DESC);
