CREATE TABLE IF NOT EXISTS diet_plans (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  name VARCHAR(160) NOT NULL,
  portion_guide JSONB NOT NULL DEFAULT '[]',
  guidance JSONB NOT NULL DEFAULT '[]',
  weeks JSONB NOT NULL DEFAULT '[]',
  groceries JSONB NOT NULL DEFAULT '[]',
  shopping_amounts JSONB NOT NULL DEFAULT '[]',
  prep_steps JSONB NOT NULL DEFAULT '[]',
  repeat_rules JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
