-- Re-runnable, additive migration. Decimal values are never stored as floating point.
CREATE TABLE IF NOT EXISTS trading_bots (
 id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
 display_name text NOT NULL, platform text NOT NULL,
 key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
 key_prefix text NOT NULL DEFAULT '' CHECK (length(key_prefix) <= 8),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz, last_report_at timestamptz
);
CREATE TABLE IF NOT EXISTS trading_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_id text NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
 report_id text NOT NULL, reported_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 platform text, account_label text, currency text,
 equity numeric(30,12), balance numeric(30,12), cash numeric(30,12), buying_power numeric(30,12),
 day_pnl numeric(30,12), unrealized_pnl numeric(30,12), realized_pnl_total numeric(30,12),
 strategy_notes text, risk_flags jsonb NOT NULL DEFAULT '[]', raw jsonb NOT NULL, payload_bytes integer NOT NULL,
 UNIQUE(bot_id, report_id)
);
CREATE INDEX IF NOT EXISTS trading_reports_bot_time ON trading_reports(bot_id, reported_at DESC, received_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS trading_positions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES trading_reports(id) ON DELETE CASCADE,
 symbol text, market text, outcome text, side text, size numeric(30,12), entry_price numeric(30,12),
 mark_price numeric(30,12), market_value numeric(30,12), unrealized_pnl numeric(30,12), leverage numeric(30,12), liquidation_price numeric(30,12)
);
CREATE INDEX IF NOT EXISTS trading_positions_report ON trading_positions(report_id);
CREATE TABLE IF NOT EXISTS trading_trades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_id text NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
 report_id uuid NOT NULL REFERENCES trading_reports(id) ON DELETE CASCADE, external_id text,
 symbol text, market text, side text, qty numeric(30,12), price numeric(30,12), fee numeric(30,12), realized_pnl numeric(30,12), executed_at timestamptz,
 UNIQUE(bot_id, external_id)
);
CREATE INDEX IF NOT EXISTS trading_trades_bot_time ON trading_trades(bot_id, executed_at DESC);
CREATE TABLE IF NOT EXISTS trading_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES trading_reports(id) ON DELETE CASCADE,
 external_id text, symbol text, market text, outcome text, side text, type text, qty numeric(30,12), price numeric(30,12), status text
);
CREATE INDEX IF NOT EXISTS trading_orders_report ON trading_orders(report_id);
CREATE TABLE IF NOT EXISTS trading_cash_flows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_id text NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
 report_id uuid NOT NULL REFERENCES trading_reports(id) ON DELETE CASCADE, external_id text,
 type text CHECK (type IN ('deposit','withdrawal')), amount numeric(30,12), currency text, occurred_at timestamptz, note text,
 UNIQUE(bot_id, external_id)
);
CREATE INDEX IF NOT EXISTS trading_cash_flows_bot_time ON trading_cash_flows(bot_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS trading_ingest_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bot_id text NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE, attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trading_ingest_attempts_bot_time ON trading_ingest_attempts(bot_id,attempted_at DESC);
