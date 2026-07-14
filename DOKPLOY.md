# Dokploy Deployment Runbook

This stack is designed to deploy as a Compose application without replacing the existing LifeForge service.

## 1. Create the application

1. Create a new Dokploy project/application from this repository.
2. Use `docker-compose.yml` as the Compose file.
3. Attach the public hostname to the `web` service on its internal port `80`.
4. Keep the existing `lifeforge.rivsconsole.shop` deployment untouched until acceptance testing is complete.

## 2. Required environment variables

Set these as Dokploy secrets or environment variables before deploying:

```env
POSTGRES_PASSWORD=<long-random-password>
POSTGRES_DB=personal_crm
POSTGRES_USER=personal_crm
CORS_ORIGIN=
```

`DATABASE_URL` is generated inside Compose from the PostgreSQL variables. Do not commit a production `.env` file.

## 3. Persistent storage

Keep these named volumes across redeployments:

- `personal_crm_postgres`: PostgreSQL data and migrations
- `personal_crm_api_data`: single-owner auth/session data and local application fallback data

Take a PostgreSQL backup before the first production migration and before any restore operation.

## 4. Deployment and acceptance

Deploy the Compose application, then wait for all three services to report healthy. Verify:

```text
GET https://<host>/api/health -> 200
GET https://<host>/api/ready  -> 200
GET https://<host>/           -> 200
```

Register the workspace owner through the web UI, create a task, change a preference, download an export, and validate a restore. Confirm the task remains after an API redeploy.

## 5. Rollback

Keep the previous application version available in Dokploy. Roll back the web/API images only when the database schema remains compatible. Do not delete either persistent volume during rollback.
