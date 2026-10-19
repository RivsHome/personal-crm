# Trading reports v1

## Authentication and privacy

POST /api/trading/reports accepts Content-Type: application/json and Authorization: Bearer <bot-key>. Use HTTPS. Never place keys in URLs, report JSON, logs or source control. Only the exact POST URL without a query string bypasses browser session and CSRF requirements. Query-string requests require both session and CSRF plus the bot key. Bot identity comes from an active, non-revoked SHA-256 digest lookup; optional bot must equal its registered slug. Neither sessions nor bot keys substitute for one another.

All trading responses use Cache-Control: no-store, including GETs, ingest errors and authorization failures. Browser GETs need Cookie: session=<session>. POST /api/trading/bots/:id/revoke also needs Cookie: csrf=<token> and X-CSRF-Token: <same-token>. The global prefix guard and plugin-local matched-route session guard both protect trading routes. Forwarded IP headers are not trusted (no trustProxy).

## Full ingest schema

Objects are strict: unknown properties are rejected at every schema-defined level. Only extra supports arbitrary JSON. Null is not an optional value except inside extra. Only reportId and reportedAt are required. Every field below not explicitly required is optional.

Root fields:
- schemaVersion: literal number 1; defaults to 1.
- reportId: nonempty string, maximum 100 characters; unique per bot.
- reportedAt: required ISO-8601 datetime with Z or explicit UTC offset. reportedAt must be within the last 7 days and not more than 10 minutes in the future. Both endpoints are inclusive.
- bot: registered slug string, maximum 2000 characters; if supplied must match the authenticated bot. botId is not accepted.
- account: object with platform, label, currency (strings, each maximum 2000 characters).
- balances: object with equity, balance, cash, buyingPower, dayPnl, unrealizedPnl, realizedPnlTotal (decimal fields).
- strategyNotes: string, maximum 10000 characters.
- riskFlags: maximum 50 objects, each requiring level (info, warn, critical) and message (string, maximum 2000 characters).
- positions: maximum 500 objects, fields symbol, market, outcome (strings); side (long, short, yes, no); size, entryPrice, markPrice, marketValue, unrealizedPnl, leverage, liquidationPrice (decimals).
- trades: maximum 1000 objects, fields externalId (nonempty string), symbol, market (strings); side (buy, sell); qty, price, fee, realizedPnl (decimals); executedAt (offset datetime).
- orders: maximum 500 objects, fields externalId, symbol, market, outcome, side, type, status (strings); qty, price (decimals). Order side/type/status are not enum-constrained.
- cashFlows: maximum 200 objects, fields externalId (nonempty string), currency (strings); type (deposit, withdrawal); amount (decimal); occurredAt (offset datetime); note (string, maximum 10000 characters).
- extra: JSON object, maximum 20 nested container levels including the root extra container, and 10000 total object keys plus array elements across its tree. This bound is checked iteratively before recursive JSON validation. No nested extra field is accepted in positions/trades/orders/cashFlows/account/balances/riskFlags.

All unqualified strings above have a maximum of 2000 characters. Decimals accept finite JSON numbers or decimal strings matching ^-?\d{1,18}(\.\d{1,12})?$. Prefer strings for precision; no exponent notation in strings, leading plus, or more than 12 fractional digits. Numbers are normalized before validation; JavaScript number precision already lost by a sender cannot be recovered. PostgreSQL NUMERIC values are returned as strings, not floats.

Maximum request body: 262144 UTF-8 bytes (256 KiB), including whitespace. Original full JSON is stored privately with its wire-byte count; it is not returned by read endpoints. External trade/cash-flow IDs deduplicate per bot. A new report may correct an existing externalId: supplied fields are updated in place, omitted fields and the original report link are retained, and committed corrections log internal identifiers and changed field names (not payload values or external IDs). Equivalent decimal/timestamp values do not cause updates or correction logs. Report IDs deduplicate per bot: replaying an existing report ID remains a no-op, so send corrections in a new report. Ingest is transactional. Latest snapshots use reportedAt, not receipt order; lastReportAt never moves backward.

Minimal synthetic JSON: {"schemaVersion":1,"reportId":"example-report","reportedAt":"<current ISO datetime with offset>","account":{"platform":"example","currency":"USD"},"balances":{"equity":"100.00"},"positions":[{"symbol":"EXAMPLE","side":"long","size":"2"}]}. Replace the timestamp placeholder before sending; no example contains a usable credential.

## Responses and limits

201: {"duplicate":false}. 200: {"duplicate":true} for report replay.
400: {"error":"Invalid trading report.","issues":[{"path":"positions.3.size","code":"invalid_format"}]}. issues contains at most 20 entries, each with path and code only, never values or validator messages. Paths are dot-separated; array indexes are zero-based. Only reported-time window violations add the constant top-level message, returning {"error":"Invalid trading report.","message":"reportedAt must be within the last 7 days and not more than 10 minutes in the future","issues":[{"path":"reportedAt","code":"custom"}]}. This message never includes submitted values; other validation errors omit the top-level message. Oversized/deep extra uses path extra and code custom. Other schema issue codes include invalid_type, too_big, unrecognized_keys, invalid_value. Malformed JSON is rejected by the parser using a generic trading error, not the schema issue envelope.
401: {"error":"Unauthorized."} for failed key authentication, or {"error":"Sign in required."} for missing browser session.
403: {"error":"Bot identity mismatch."} or {"error":"Invalid CSRF token."}.
413: {"error":"Report too large."}.
429: {"error":"Unauthorized."} after 30 failed authentications per IP in a 10-minute window, otherwise failed authentication is 401. Every well-formed candidate key still gets its SHA-256 database lookup: even after 40 bad requests a valid key is accepted. Missing/malformed/overlong bearer credentials fail before lookup. The failed-IP map is process-local and bounded to 10000 entries. Authenticated bots have a separate database-enforced 60 attempts per 10 minutes; excess returns {"error":"Report rate limit exceeded."}. Invalid reports consume authenticated attempts too.
500: {"error":"Trading operation failed."}; no internal details are exposed.

## Browser read endpoints

GET /api/trading/overview returns {bots,totals,staleAfterMinutes}; totals are separated by currency and use latest reports only. Each bot includes id, displayName, platform, keyPrefix, active, lastReportAt, positionsCount, freshness, report. The report includes id, reportedAt, receivedAt, platform, accountLabel, currency, equity, totalPnl, todayPnl, unrealizedPnl, realizedPnl, netDeposits, pnlBasis, strategyNotes, riskFlags. Legacy dayPnl and realizedPnlTotal aliases contain the resolved todayPnl and realizedPnl values. No key digest or raw report is exposed.
GET /api/trading/bots returns safe metadata (id, displayName, platform, keyPrefix, active, createdAt, revokedAt, lastReportAt).
GET /api/trading/history returns historical botId, platform, reportedAt, receivedAt, currency and the same resolved metric fields and pnlBasis.
GET /api/trading/positions and /api/trading/orders return current latest-report rows.
GET /api/trading/trades and /api/trading/cash-flows return historical rows. Detail rows include camelCase stored fields plus botId, platform, currency, reportedAt; cash-flow currency overrides report currency if set.
POST /api/trading/bots/:id/revoke returns {revoked:true}; 400 Invalid bot identifier., 404 Bot not found. for invalid or absent slugs.

Read query fields: bot and platform (nonempty strings, maximum 2000); range (7d, 30d, 90d, all); from and to (offset datetimes, inclusive, from <= to). Unknown query fields are rejected with 400 {error: Invalid trading query.}. Range applies only to history, default 30d. from/to filter overview reports, history and positions/orders by reportedAt, trades by executedAt, cash flows by occurredAt; bots ignores dates. Freshness uses receivedAt, not reportedAt: never without a report, fresh until configured stale threshold, stale after threshold, critical strictly after 24 hours. TRADING_STALE_AFTER_MINUTES defaults to 120 (valid range 1..525600).

## Operator CLI

Run from repository root with DATABASE_URL supplied securely by the operator. No key registration is needed to build/test. Never point isolated tests at production.

node --import tsx apps/api/src/scripts/trading-keys.ts register <slug> <display-name> <platform> [--prefix <up-to-8-word-or-hyphen-characters>]
Provide exactly a 64-hex SHA-256 digest on stdin, not the plaintext key or a command-line key. Generate/store the plaintext key using the operator secret manager and feed only its digest through a private stdin pipeline. No real key is shown here. Slugs match ^[a-z0-9][a-z0-9_-]{0,99}$. Display name/platform must be nonempty, maximum 2000 characters. Registering an existing slug rotates its digest and reactivates it; provision the new plaintext to the bot separately and securely.

node --import tsx apps/api/src/scripts/trading-keys.ts list
Returns slug, prefix, active, last_report_at only.
node --import tsx apps/api/src/scripts/trading-keys.ts revoke <slug>
Disables the key without deleting reports.
node --import tsx apps/api/src/scripts/trading-keys.ts delete <slug> --with-data
Irreversibly deletes the bot and its dependent data. Requires explicit operator authorization; no automatic cleanup of real data. CLI failures emit generic diagnostics and close database pools without printing digest/key input.

## P&L accounting and presentation

All server-side calculations use PostgreSQL NUMERIC and return decimal strings. Missing P&L inputs resolve to zero, never null; no JavaScript floating-point financial arithmetic is used. A bot without any report has report:null and is excluded from combined totals. Unknown/blank currency reports remain on individual bot cards and are not combined, even with other unknown denominations. No currency conversion is implied.

For each latest snapshot, unrealizedPnl uses reported balances.unrealizedPnl, otherwise the sum of that snapshot’s position unrealizedPnl, otherwise zero. realizedPnl uses reported balances.realizedPnlTotal, otherwise the sum of that bot’s deduplicated trades’ realizedPnl, otherwise zero. Reported zero takes precedence over a computed nonzero value.

netDeposits is deposits minus withdrawals across that bot’s cash-flow ledger. totalPnl is equity minus netDeposits when the bot has any cash-flow rows, otherwise realizedPnl plus unrealizedPnl. History uses cumulative flows effective no later than each snapshot, and uses realized plus unrealized P&L when no flows are effective yet. Historical trade fallback likewise excludes trades effective after the snapshot. An absent occurredAt/executedAt uses the containing report’s reportedAt for accounting cutoffs. The ledger is assumed to be denominated in the bot account currency; there is no FX conversion of separately labelled flows.

todayPnl uses reported balances.dayPnl when present. Otherwise its baseline is the latest snapshot strictly before today’s midnight in America/New_York, or the first snapshot today if none exists before midnight. It is latest equity minus baseline equity minus net cash flows strictly after the baseline and up to the latest snapshot. One snapshot alone yields zero. pnlBasis identifies each resolved metric as reported or computed. equity is zero when absent. Combined metrics sum resolved per-bot equity, totalPnl, todayPnl, unrealizedPnl, realizedPnl and netDeposits separately per known currency, including bots with computed zeros.

The read-only dashboard defaults to P&L, with an equity toggle, individual bot lines and a same-currency combined line carrying the most recent known snapshot forward. Charts alone use approximate numeric coordinates, retain single-point markers, and sample each line to at most 500 points while retaining endpoints and bucket extrema. Hover/focus exposes exact amounts. Money is rounded to two decimals using exact fixed-point presentation, signed P&L carries color plus a textual sign, quantities/prices retain significant decimals, and timestamps are America/New_York. Bot freshness badges include the receipt-based age in minutes; data-as-of is shown separately when reportedAt and receivedAt differ by more than ten minutes. Percentage return uses totalPnl divided by positive netDeposits; no positive basis is labelled N/A.

## Read-only operator snapshot CLI

After building, run one of the following with DATABASE_URL supplied privately by the operator:

node apps/api/dist/scripts/trading-snapshot.js overview
node apps/api/dist/scripts/trading-snapshot.js history
node apps/api/dist/scripts/trading-snapshot.js positions
node apps/api/dist/scripts/trading-snapshot.js trades
node apps/api/dist/scripts/trading-snapshot.js orders
node apps/api/dist/scripts/trading-snapshot.js cash-flows

The default command is overview. Each prints the exact JSON contract from the shared endpoint reader; history explicitly uses range=all. This CLI neither starts a listener nor registers/revokes keys or writes records. It closes its database pool on success and failure. Its output is private account information: do not attach production snapshots to issues, tests, or commits. Validation uses synthetic isolated PostgreSQL schemas only; the production CLI was not run for this change.
