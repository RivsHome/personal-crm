# LifeForge Module Parity Plan

Status: in progress

## Purpose

Bring Personal CRM's modules to the same practical workflows as the LifeForge modules that inspired it, while keeping this application self-hosted, React-based, and usable without third-party API keys.

## Upstream Analysis

Analysis source: `Lifeforge-app/lifeforge` at commit `6294dc4` and its separately shipped module repositories. LifeForge's core repository provides the shell, module manager, localization, dashboards, backups, and personalization. The actual utilities are independent modules, so this plan treats each module as a user workflow rather than copying its federation architecture.

| Upstream module | Observable workflow | Personal CRM status | Planned parity |
| --- | --- | --- | --- |
| Todo List | Lists, priorities, tags, due dates, task details, nested subtasks, filtering | Basic task creation, completion, deletion, notes, nested subtasks | Add task metadata and filters, then preserve nested task behavior |
| Calendar | Calendars, categories, month/week/agenda views, event details, recurring events, ICS subscription | Dated event list only | Add a month view, event details, categories, and edit/delete; defer ICS and AI capture |
| Idea Box | Folders, tags, containers, rich idea entries, link previews | Basic title/body capture | Add tags and folders, filtering, and edit/delete |
| Wallet | Assets/accounts, ledgers, categories, transactions, analytics, statements | Accounts and simple transactions | Add transaction categories, filters, balance summary, and category spending analytics; defer receipt OCR and AI capture |
| Achievements | Categories, difficulty, achievement records | Not present; goals are a different workflow | Add a dedicated achievements module |
| Moment Vault | Text, photo, audio entries, attachments, playback/transcription | Text memories with file attachments | Add attachment listing/download and entry editing; defer transcription and audio waveform support |
| Movies Library | Watch list/history, metadata, rating, notes, search | Basic title/year creation, unused watched/rating/notes fields | Add watched/rating/notes controls and filtering; defer TMDB lookup and cinema integrations |
| Music | Library, playback, metadata, local/Youtube acquisition | Metadata-only track list | Add listened state and editing; defer media download/playback unless local file storage is introduced |
| Code Time | Coding activity and time analytics | Not present | Add manual time sessions and dashboard totals in a later phase; do not scrape editor data |
| Wishlist | Lists, priced wish items, progress | Not present | Add wishlists after core data-management modules |
| Pomodoro Timer | Configurable work/break sessions and history | Not present | Add a client timer with persisted session history after core productivity parity |

## Scope Rules

- Keep Personal CRM's single React application and PostgreSQL API; do not introduce LifeForge's module federation or PocketBase architecture.
- Ship workflows that work without external credentials first.
- Treat LLM parsing, receipt OCR, map/location, TMDB, YouTube downloading, cinema accounts, and ICS sync as optional integrations. They require explicit provider keys or user account consent and are not prerequisites for a working personal organizer.
- Each feature must include API validation, persistent storage, usable empty/loading/error states, and an interaction test before deployment.

## Execution Order

### Phase 1: Productivity Foundation

- [x] Nested tasks with a collapsible child list.
- [x] Extend tasks with due dates, priorities, tags, list names, notes editing, and active/completed filters.
- [x] Replace the calendar's simple list with month navigation and event placement.
- [x] Add calendar event categories, notes, edit/delete, and an agenda list.
- [x] Add a dashboard view of upcoming events and active-task counts.

### Phase 2: Knowledge and Finance

- [ ] Add idea folders, tags, filtering, edit/delete, and a clearer capture workflow.
- [ ] Add Wallet transaction categories, account kinds, filters, balance totals, and category spending summary.
- [ ] Add a dedicated achievements module with category, difficulty, and completion date.
- [ ] Expand memory entries with attachment management and edit/delete.

### Phase 3: Media and Remaining LifeForge Equivalents

- [ ] Complete Movies with watched state, rating, notes, filters, edit/delete, and a watchlist/history split.
- [ ] Complete Music with listened state, edit/delete, and album/artist filtering.
- [ ] Add manual Code Time sessions and activity summaries.
- [ ] Add wishlist lists and entries.
- [ ] Add Pomodoro settings, timer, completed-session history, and dashboard summary.

### Phase 4: Optional Integrations

- [ ] Import/export ICS calendar files and subscribed calendars.
- [ ] Provider-backed movie lookup, receipt scanning, natural-language capture, memory transcription, and media playback/download only after the required API credentials and consent flow are available.

## Current Implementation Slice

This execution pass begins with Phase 1's task and calendar foundation. The next deployed version must retain current data and add only backward-compatible columns/endpoints.

## Verification and Release Checklist

- [ ] Run `npm run typecheck`, `npm run test`, and `npm run build`.
- [ ] Run the production Docker stack and exercise create, edit, filter, complete, and delete paths against PostgreSQL.
- [ ] Smoke test the deployed URL after Dokploy finishes.
- [ ] Commit the completed slice and deploy the `main` branch to `life.rivsconsole.shop`.
