# React Life Management App Plan

Status: implementation in progress. The React/API foundation, authenticated shell, Tasks, Calendar, Ideas, Finance, Goals, Movies, Music, Memories, preferences, module/widget controls, export/restore, and Docker deployment configuration are implemented and container-smoke-tested in this workspace. Attachments, advanced drag-and-drop dashboard editing, stronger production security, and production VPS rollout remain follow-up work.

## Current Implementation Checkpoint

- Workspace: `apps/web` React/Vite frontend and `apps/api` Fastify/TypeScript API.
- Persistence: PostgreSQL schema initialization for production, with JSON fallback for local development when PostgreSQL is unavailable.
- Authentication: single-owner registration/login/logout with HTTP-only sessions and persistent local development credentials.
- Working modules: dashboard shell, Tasks, Calendar, Ideas, and JSON export.
- Working modules: dashboard shell, Tasks, Calendar, Ideas, Wallet accounts/transactions, Goals, Movies, Music, Memories, and JSON export.
- MVP controls: durable preferences, light/dark theme, accent color, timezone, module enable/disable, widget visibility, and validated JSON restore.
- Deployment assets: API and web Dockerfiles, Nginx API proxy, Docker Compose PostgreSQL volume, API data volume, health endpoint, and readiness endpoint.
- Verification: type checking, API tests, production builds, live authentication, authenticated export/restore smoke tests, Compose image builds, healthy PostgreSQL/API/web containers, Nginx routing, and post-API-restart persistence all pass locally.
- Latest verification: authenticated browser smoke covers login, Wallet account/transaction creation, and Goal creation.
- Latest verification: authenticated browser smoke covers Movies, Music, and Memories creation.

## 1. Objective

Build an original, self-hosted life-management application inspired by the useful parts of LifeForge while owning the complete codebase and deployment path.

The product will provide:

- A customizable dashboard with movable and resizable widgets
- Calendar and events
- To-do lists, priorities, tags, and due dates
- Notes and idea capture
- Personal finance tracking
- Achievements and goals
- Media libraries for movies and music
- Personal file and memory storage
- API keys, backups, account settings, and personalization

The initial production target is Dokploy on the existing VPS. A proposed hostname is:

```text
life.rivsconsole.shop
```

Keep `lifeforge.rivsconsole.shop` on the current app until the replacement passes acceptance testing.

## 2. Product Principles

1. The application must remain useful when optional integrations are unavailable.
2. Every feature ships from this repository; production does not download executable modules.
3. Modules share typed contracts but cannot reach directly into each other's database tables.
4. Core workflows must work on desktop and mobile.
5. User data must be exportable, restorable, and backed up.
6. Empty states must lead directly to the relevant create action.
7. Errors must show a useful message and correlation ID instead of a generic failure screen.
8. Accessibility, keyboard navigation, and responsive layout are release requirements.

## 3. Recommended Architecture

Use a TypeScript monorepo with a modular-monolith backend.

```text
life-app/
  apps/
    web/                  React frontend
    api/                  Node API and background jobs
  packages/
    contracts/            Shared request/response schemas and types
    database/             Database schema, migrations, and test fixtures
    ui/                   Shared design-system components
    config/               Shared TypeScript, lint, and build configuration
    modules/
      dashboard/
      calendar/
      tasks/
      ideas/
      wallet/
      achievements/
      movies/
      music/
      memories/
  docker/
    web/
    api/
  docker-compose.yml
  .env.example
```

### Frontend

- React with TypeScript and Vite
- React Router for application routing
- TanStack Query for server state and cache invalidation
- React Hook Form plus shared schema validation for forms
- Tailwind CSS with a small first-party component library
- Lucide icons
- `dnd-kit` and a proven resizable-grid library for dashboard layout
- IndexedDB only for drafts and temporary offline state, not as the source of truth

### Backend

- Node.js with TypeScript
- Fastify HTTP API
- PostgreSQL as the system of record
- Drizzle ORM and committed SQL migrations
- Schema validation shared through `packages/contracts`
- Server-managed cookie sessions with secure password hashing
- A database-backed job table for imports, exports, reminders, and media processing
- S3-compatible object storage for uploads; use the existing MinIO service or a dedicated Dokploy volume for the MVP

### Deployment

- `web`: static React build served by Nginx
- `api`: Node application with health and readiness endpoints
- `postgres`: persistent PostgreSQL volume
- `worker`: optional second API image process for background jobs
- `minio`: reuse an existing isolated bucket or deploy a dedicated instance
- Dokploy/Traefik terminates TLS and routes the public hostname to `web`
- Nginx proxies `/api/*` to the internal API service

Do not use runtime module federation. Feature modules are normal workspace packages compiled with the application.

## 4. Module Contract

Each module exports a static manifest consumed at build time:

```ts
export interface AppModule {
  id: string
  title: string
  category: 'productivity' | 'lifestyle' | 'finance' | 'media'
  icon: string
  routes: ModuleRoute[]
  widgets: DashboardWidgetDefinition[]
  navigation: NavigationItem[]
}
```

Rules:

- A module owns its routes, API handlers, migrations, permissions, and tests.
- Cross-module behavior uses services or domain events with typed payloads.
- Module availability is controlled by a database setting, not filesystem installation.
- Disabling a module hides its UI but does not delete its data.
- English copy ships with every module in the same package.
- Additional languages can be added later as ordinary JSON resources committed to the repository.

## 5. Core Data Model

All user-owned rows include `id`, `user_id`, `created_at`, and `updated_at`. Use UUIDs and UTC timestamps.

### Core

- `users`: identity, display name, email, password hash, status
- `sessions`: hashed session token, user, expiration, device metadata
- `user_preferences`: theme, accent color, locale, timezone, start-of-week
- `enabled_modules`: user, module ID, enabled state, navigation order
- `dashboard_layouts`: user, breakpoint, serialized validated layout
- `dashboard_widgets`: user, widget type, settings, position
- `api_credentials`: user, provider, encrypted value, metadata
- `audit_events`: actor, action, resource, result, correlation ID

### Tasks

- `task_lists`
- `task_priorities`
- `task_tags`
- `tasks`
- `task_tag_links`
- `task_recurrences`

Task fields include summary, notes, status, due time, completion time, list, priority, and recurrence rule.

### Calendar

- `calendars`
- `event_categories`
- `events`
- `event_recurrences`
- `calendar_subscriptions`

### Ideas and Notes

- `idea_containers`
- `ideas`
- `idea_tags`
- `idea_tag_links`
- `attachments`

### Finance

- `financial_accounts`
- `transaction_categories`
- `transactions`
- `transaction_splits`
- `budgets`

Store money as integer minor units plus ISO currency code. Never use floating point for balances.

### Goals and Achievements

- `goals`
- `goal_milestones`
- `achievements`

### Media and Memories

- `movies`
- `music_tracks`
- `memory_entries`
- `attachments`

Uploads reference object-storage keys. Database rows never store large binary files.

## 6. Security Requirements

- Secure, HTTP-only, same-site session cookies
- CSRF protection for state-changing browser requests
- Login throttling and account lockout controls
- Password reset tokens stored only as hashes
- Argon2id password hashing
- Per-user authorization enforced in every repository query
- API credential encryption using a key supplied through Dokploy secrets
- Upload size, extension, and MIME validation
- Content Security Policy and restrictive CORS configuration
- Structured audit records for login, exports, restores, and credential changes
- No secrets in frontend bundles, logs, Git, or database exports

## 7. User Experience Scope

### Application Shell

- Persistent desktop sidebar and mobile navigation drawer
- Search across enabled modules
- Module categories and user-controlled ordering
- Account menu, theme, timezone, and logout
- Route-level loading, empty, forbidden, and error states
- Error screen with retry action and correlation ID

### Dashboard

- Responsive grid with saved layouts per breakpoint
- Widget catalog with add/remove controls
- Drag, resize, reset, and edit widget settings
- Initial widgets: date, mini calendar, today's events, tasks, balances, goals, and recent ideas

### Forms

- Create actions open reliably from page headers, widgets, and empty states
- Inline validation appears before submission
- Submission buttons show progress and prevent duplicate requests
- Success closes the form and updates affected lists immediately
- Failure preserves entered data and displays the API error

## 8. Delivery Phases

### Phase 0: Product and Technical Decisions

Deliverables:

- Final product name and domain
- Confirm single-user versus multi-user launch
- Confirm MinIO reuse versus a dedicated storage service
- Confirm email provider for password reset and reminders
- Low-fidelity shell and dashboard wireframes
- Architecture decision records for authentication, storage, and recurring events

Exit criteria:

- Decisions are documented and no MVP requirement depends on an undecided provider.

### Phase 1: Repository and Platform Foundation

Tasks:

1. Create the monorepo and workspace configuration.
2. Add strict TypeScript, linting, formatting, and import boundaries.
3. Create `web`, `api`, shared contracts, database, UI, and module packages.
4. Add PostgreSQL migration tooling and a local Docker Compose stack.
5. Add environment validation at API startup.
6. Add `/health` and `/ready` endpoints.
7. Add CI for type checking, unit tests, builds, and migration validation.

Exit criteria:

- A clean clone starts locally with one command.
- CI builds the web and API applications.
- API readiness fails when PostgreSQL is unavailable.

### Phase 2: Authentication and Application Shell

Tasks:

1. Implement registration policy, login, logout, and session refresh.
2. Implement password reset and session revocation.
3. Build the responsive navigation shell.
4. Add preferences for theme, accent color, timezone, and week start.
5. Add module manifests and enabled-module settings.
6. Add global error handling and structured API errors.

Exit criteria:

- Authentication survives browser restarts and expires correctly.
- A user cannot access another user's resources.
- Navigation works at desktop and mobile widths.

### Phase 3: Dashboard and Tasks MVP

Tasks:

1. Build the dashboard layout editor and widget registry.
2. Implement task lists, priorities, tags, due dates, and completion.
3. Implement create, edit, delete, filter, and search flows.
4. Add the task dashboard widget and deep links into task forms.
5. Add optimistic updates with rollback on API failure.

Exit criteria:

- Creating a task works from the page header, empty state, and dashboard widget.
- Refreshing the page preserves all task data and dashboard positions.
- Failed task creation preserves user input and displays a useful error.

### Phase 4: Calendar and Ideas MVP

Tasks:

1. Implement calendar and category management.
2. Implement single and recurring events.
3. Add month, week, agenda, and today's-events views.
4. Implement idea containers, notes, tags, links, and attachments.
5. Add calendar and idea dashboard widgets.

Exit criteria:

- Recurring events render correctly across timezone and daylight-saving changes.
- Attachments upload, download, and delete with authorization checks.

### Phase 5: Finance and Goals

Tasks:

1. Implement accounts, categories, and transactions.
2. Add reconciliation-safe balance calculations.
3. Add monthly spending summaries and budgets.
4. Implement goals, milestones, and achievements.
5. Add balance and progress widgets.

Exit criteria:

- Balance calculations have automated tests for credits, debits, transfers, and split transactions.
- Financial exports reconcile with displayed balances.

### Phase 6: Media, Memories, and Integrations

Tasks:

1. Add movie and music libraries without requiring external API keys.
2. Add optional metadata lookup providers.
3. Add memory entries with image, audio, and document attachments.
4. Add provider credential management.
5. Add background jobs for metadata, thumbnails, and reminders.

Exit criteria:

- Core media CRUD works when every external provider is disabled.
- Failed background jobs are visible and retryable.

### Phase 7: Backup, Import, and Production Readiness

Tasks:

1. Add full JSON export plus attachment archive.
2. Add validated restore with dry-run reporting.
3. Add scheduled PostgreSQL and object-storage backups.
4. Add an importer for useful data from the existing LifeForge instance.
5. Add observability, retention limits, and operational runbooks.
6. Perform security, accessibility, responsive, and performance reviews.

Exit criteria:

- A backup is restored into a clean test environment successfully.
- Recovery steps are documented and timed.
- The production smoke suite passes through the public hostname.

## 9. Testing Strategy

### Unit Tests

- Domain calculations and recurrence logic
- Contract validation
- Authorization scopes
- Finance arithmetic
- Dashboard layout normalization

### Integration Tests

- API against disposable PostgreSQL
- Session lifecycle and CSRF handling
- Every module's create/update/delete flow
- Upload authorization and object cleanup
- Migration from an empty and previous schema version

### Browser Tests

Use Playwright for:

- Login and logout
- Dashboard customization
- Task creation from all three entry points
- Calendar event creation and recurrence
- Finance transaction creation
- File upload and download
- Mobile navigation
- Error and retry states

Run smoke tests at desktop and mobile viewport sizes after every production deployment.

## 10. Dokploy Deployment Plan

Create a separate Dokploy project or application during development. Do not overwrite the existing LifeForge deployment.

Required services:

```text
web
api
worker
postgres
```

Required secrets:

```env
APP_DOMAIN=
DATABASE_URL=
SESSION_SECRET=
ENCRYPTION_KEY=
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Deployment order:

1. Build immutable `web` and `api` images from one commit.
2. Start PostgreSQL and verify health.
3. Run database migrations as a one-shot release command.
4. Start the API and wait for readiness.
5. Start the worker.
6. Start the web container and attach the Traefik hostname.
7. Run public smoke tests.
8. Record deployed commit and migration version.

Rollback rules:

- Never automatically roll back a destructive migration.
- Keep the previous application images available.
- Take a database backup before every production migration.
- Roll back application containers only when the database schema remains compatible.

## 11. Observability and Operations

- JSON logs with request and correlation IDs
- Health, readiness, and build-version endpoints
- Error tracking for frontend and backend exceptions
- Metrics for API latency, error rate, job failures, database connections, disk, and backup age
- Redaction of cookies, authorization headers, passwords, API keys, and uploaded content
- Uptime checks against the public web page and API readiness endpoint
- Monthly restore drill during early production

## 12. MVP Definition

The first usable release includes:

- Authentication
- Responsive application shell
- Module enable/disable settings
- Customizable dashboard
- Tasks
- Calendar
- Ideas/notes
- Preferences
- Export and backup
- Dokploy production deployment

Finance, achievements, movies, music, and memories follow after the MVP is stable.

## 13. Initial Backlog

1. Choose the product name and temporary development hostname.
2. Decide single-user or multi-user registration policy.
3. Create wireframes for shell, dashboard, tasks, and calendar.
4. Scaffold the monorepo.
5. Implement PostgreSQL and migration foundation.
6. Implement authentication and authorization tests.
7. Build the shell and design system.
8. Build dashboard layout persistence.
9. Build the Tasks module end to end.
10. Deploy a private staging environment through Dokploy.

## 14. Decisions Needed Before Implementation

- Product name and final domain
- Single-user household app or multi-user platform
- Whether users can self-register
- Whether accounts share selected calendars, tasks, and finance data
- MinIO reuse or dedicated object storage
- Email provider
- Required import scope from the current LifeForge database
- Which modules belong in the MVP after Tasks and Calendar

## 15. Definition of Done

The replacement is ready to take over the current domain only when:

- Every MVP workflow passes browser automation.
- No page displays a generic error without a correlation ID.
- Backups and a full restore have been verified.
- Mobile and desktop layouts pass visual review.
- The application runs for seven days in staging without an unresolved critical error.
- The existing LifeForge data has been imported or intentionally archived.
- A rollback and domain-switch procedure is documented.
