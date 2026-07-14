CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  summary VARCHAR(240) NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_user_created_idx ON tasks (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  event_date DATE NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ideas (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  body TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY, theme TEXT NOT NULL DEFAULT 'dark', accent TEXT NOT NULL DEFAULT '#c9f253',
  timezone TEXT NOT NULL DEFAULT 'America/New_York', week_start TEXT NOT NULL DEFAULT 'sunday',
  modules JSONB NOT NULL DEFAULT '{"calendar":true,"tasks":true,"ideas":true}',
  widgets JSONB NOT NULL DEFAULT '{"tasks":true,"calendar":true,"ideas":true}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
