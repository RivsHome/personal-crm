# Personal CRM

An original React life-management workspace with a Fastify API and PostgreSQL persistence.

## Local development

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3636`.

PostgreSQL is optional for local development. When it is unavailable, the API uses JSON files in `data/` so the core workflows remain usable. Production refuses to start without PostgreSQL.

## Verification

```powershell
npm run typecheck
npm run test
npm run build
```

## Docker / Dokploy

The Compose stack contains `web`, `api`, and persistent `postgres` services:

```powershell
# Set POSTGRES_PASSWORD (and optionally POSTGRES_DB, POSTGRES_USER, and CORS_ORIGIN) first.
docker compose up -d --build
```

The web service is exposed on port `8080` and proxies `/api/*` to the API service. In Dokploy, attach the public domain to `web`, configure the PostgreSQL credentials as secrets, and keep both `personal_crm_postgres` and `personal_crm_api_data` as persistent volumes.

The API endpoints are:

- `GET /api/health` for process health
- `GET /api/ready` for PostgreSQL readiness
- `POST /api/auth/register`, `POST /api/auth/login`, and `POST /api/auth/logout`
- `GET /api/export` for an authenticated JSON data export
- `POST /api/restore/validate` for a non-mutating backup check
- `POST /api/restore` for an authenticated restore after validation

The first account is the single workspace owner in this MVP. Tasks, Calendar, and Ideas routes require an authenticated HTTP-only session.
