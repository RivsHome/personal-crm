CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  summary VARCHAR(240) NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_user_created_idx ON tasks (user_id, created_at DESC);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(12) NOT NULL DEFAULT 'normal';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS list_name VARCHAR(80) NOT NULL DEFAULT 'Inbox';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  event_date DATE NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS category VARCHAR(80) NOT NULL DEFAULT 'General';
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
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS dashboard_order JSONB NOT NULL DEFAULT '["tasks","calendar","ideas"]';

CREATE TABLE IF NOT EXISTS financial_accounts (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', name VARCHAR(120) NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'cash', currency CHAR(3) NOT NULL DEFAULT 'USD',
  opening_balance_minor BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS financial_accounts_user_idx ON financial_accounts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', account_id UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  description VARCHAR(240) NOT NULL, amount_minor BIGINT NOT NULL, transaction_date DATE NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'General', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS financial_transactions_account_idx ON financial_transactions (account_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  target_minor BIGINT, current_minor BIGINT NOT NULL DEFAULT 0, due_date DATE, completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS goals_user_idx ON goals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  year SMALLINT, watched BOOLEAN NOT NULL DEFAULT FALSE, rating SMALLINT, notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS music_tracks (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  artist VARCHAR(160) NOT NULL DEFAULT '', album VARCHAR(160) NOT NULL DEFAULT '', listened BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS memory_entries (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', title VARCHAR(240) NOT NULL,
  body TEXT NOT NULL DEFAULT '', occurred_on DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local', memory_id UUID NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  filename VARCHAR(240) NOT NULL, mime_type VARCHAR(160) NOT NULL, storage_key VARCHAR(240) NOT NULL UNIQUE,
  byte_size BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
