# Dispatch Central — Implementation Plan

Multi-phased roadmap for building the Dispatch Central sync server. Each phase produces a deployable artifact and can be verified independently.

---

## Phase 1: Project Scaffold & Core Server

**Goal:** Bootable Fastify server with configuration, health check, and Docker support.

### Tasks

- [ ] Initialize Node.js project with TypeScript
  - `package.json` with scripts: `dev`, `build`, `start`
  - `tsconfig.json` matching Dispatch's server config
  - ESM module format
- [ ] Fastify server bootstrap (`src/index.ts`)
  - Load config from env vars: `PORT`, `DATA_DIR`, `LOG_LEVEL`, `PASSPHRASE`, `ADMIN_TOKEN`
  - Pino logger integration
  - CORS setup via `@fastify/cors`
  - Graceful shutdown handlers
- [ ] Configuration module (`src/config.ts`)
  - Validate required env vars (`PASSPHRASE`, `ADMIN_TOKEN`) on startup
  - Defaults: `PORT=3001`, `DATA_DIR=/data`, `LOG_LEVEL=info`
- [ ] Health endpoint: `GET /api/health` → `{ status, timestamp, version }`
- [ ] SQLite database setup (`src/db/`)
  - `better-sqlite3` initialization
  - Migration system (versioned SQL files in `src/db/migrations/`)
  - Initial migration: create `instances`, `channels`, `requests`, `activity_log` tables
- [ ] Docker support
  - `Dockerfile` (multi-stage: build TypeScript → run on Node Alpine)
  - `docker-compose.yml` with volume mount for `/data`
  - `.dockerignore`
- [ ] Shared types (`src/types/`)
  - Port relevant types from Dispatch: `RequestDocument`, `CollectionDocument`, `FolderEntry`, `HeaderEntry`, `ParamEntry`, `RequestBody`, `AuthConfig`, `VariableEntry`
  - Add Central-specific types: `InstanceRecord`, `ChannelRecord`, `ChangeEntry`, `ActivityEvent`

### Schema: Initial Migration

```sql
CREATE TABLE instances (
  token         TEXT PRIMARY KEY,          -- UUID v4
  name          TEXT NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE channels (
  id            TEXT PRIMARY KEY,          -- UUID v4 (short form for sharing)
  name          TEXT NOT NULL,
  owner_token   TEXT NOT NULL REFERENCES instances(token),
  mode          TEXT NOT NULL DEFAULT 'readonly',  -- 'readonly' | 'readwrite'
  version       INTEGER NOT NULL DEFAULT 1,
  collection    TEXT NOT NULL,             -- JSON: CollectionDocument (metadata only)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE channel_requests (
  id            TEXT NOT NULL,             -- request UUID (from Dispatch)
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  data          TEXT NOT NULL,             -- JSON: full RequestDocument
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, id)
);

CREATE TABLE subscriptions (
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  instance_token TEXT NOT NULL REFERENCES instances(token) ON DELETE CASCADE,
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_pull_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, instance_token)
);

CREATE TABLE activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,             -- 'register' | 'publish' | 'subscribe' | 'push' | 'pull' | 'unsubscribe'
  instance_token TEXT,
  channel_id    TEXT,
  metadata      TEXT,                      -- JSON: event-specific details
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,          -- 'register:<ip>' | 'subscribe:<ip>'
  attempts      INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL DEFAULT (datetime('now')),
  locked_until  TEXT
);
```

### Verification

- `npm run dev` starts the server, `GET /api/health` returns 200
- `docker compose up` builds and runs the container
- SQLite database file is created at `DATA_DIR/dispatch-central.db`

---

## Phase 2: Instance Registration & Auth Middleware

**Goal:** Instances can register with the passphrase and authenticate subsequent requests via instance tokens.

### Tasks

- [ ] Rate limiting middleware (`src/middleware/rate-limit.ts`)
  - IP-based, backed by `rate_limits` table
  - Configurable per-endpoint: registration = 3/min/IP with lockout after 10, subscribe = 5/min/IP
  - Locked IPs return `429 Too Many Requests`
- [ ] Registration endpoint: `POST /api/instances/register`
  - Requires `X-Passphrase` header matching configured passphrase (constant-time comparison)
  - Request body: `{ name: string }` (instance friendly name)
  - Response: `{ token: string }` (UUID v4)
  - Inserts into `instances` table, logs `register` activity
  - Rate limited
- [ ] Auth middleware (`src/middleware/auth.ts`)
  - Extracts `X-Instance-Token` header
  - Validates token exists in `instances` table
  - Updates `last_seen_at` on valid requests
  - Returns `401 Unauthorized` for missing/invalid tokens
  - Applied to all `/api/*` routes except `/api/health` and `/api/instances/register`
- [ ] Admin auth middleware (`src/middleware/admin-auth.ts`)
  - Extracts `X-Admin-Token` header
  - Constant-time comparison against configured `ADMIN_TOKEN`
  - Applied to all `/api/admin/*` routes
- [ ] Activity logging utility (`src/services/activity.ts`)
  - `logActivity(type, instanceToken?, channelId?, metadata?)` — inserts into `activity_log`

### Verification

- Register with correct passphrase → receive token
- Register with wrong passphrase → `403 Forbidden`
- Use token in `X-Instance-Token` → access protected routes
- Use invalid token → `401 Unauthorized`
- Rapid registration attempts → `429` after threshold

---

## Phase 3: Channel Publishing & Subscription

**Goal:** Instances can publish collections as channels and other instances can subscribe.

### Tasks

- [ ] Publish endpoint: `POST /api/channels`
  - Auth: instance token (publisher becomes owner)
  - Request body: full collection snapshot — `{ collection: CollectionDocument, requests: RequestDocument[] }`
  - Creates channel with UUID v4 ID, stores collection metadata in `channels.collection`, stores each request in `channel_requests`
  - Response: `{ channelId: string, shareUrl: string }`
  - Logs `publish` activity
- [ ] Channel metadata: `GET /api/channels/:id`
  - Auth: instance token (must be owner or subscriber)
  - Response: `{ id, name, owner, mode, subscriberCount, version, createdAt, updatedAt }`
- [ ] Channel settings: `PATCH /api/channels/:id/settings`
  - Auth: instance token (owner only)
  - Body: `{ mode: 'readonly' | 'readwrite' }`
- [ ] Delete channel: `DELETE /api/channels/:id`
  - Auth: instance token (owner only)
  - Cascading delete: channel + all requests + all subscriptions
  - Logs activity
- [ ] Subscribe: `POST /api/channels/:id/subscribe`
  - Auth: instance token
  - Rate limited (5/min/IP)
  - Creates subscription record, logs activity
  - Response: `{ channelId, name, mode, version }`
- [ ] Unsubscribe: `DELETE /api/channels/:id/subscribe`
  - Auth: instance token
  - Removes subscription record
- [ ] List subscriptions: `GET /api/subscriptions`
  - Auth: instance token
  - Returns all channels this instance subscribes to, with current version info
- [ ] Full state pull: `GET /api/channels/:id/state`
  - Auth: instance token (owner or subscriber)
  - Returns complete collection + all non-deleted requests
  - Updates `subscriptions.last_pull_version`

### Verification

- Publish a collection → receive channel ID
- Subscribe to channel → success
- Pull full state → receive complete collection with all requests
- Non-subscriber accessing channel → appropriate error
- Owner deletes channel → subscribers lose access

---

## Phase 4: Push, Pull & Sync

**Goal:** Implement the core sync loop — push changes, check for updates, pull incremental changes.

### Tasks

- [ ] Version check: `GET /api/channels/:id/version`
  - Auth: instance token (owner or subscriber)
  - Response: `{ version: number, updatedAt: string }`
  - Lightweight — single row read
- [ ] Push changes: `POST /api/channels/:id/push`
  - Auth: instance token (owner, or subscriber if readwrite mode)
  - Request body:
    ```typescript
    {
      baseVersion: number,           // version the client last synced from
      changes: {
        collection?: CollectionDocument,  // if metadata changed
        requests: {
          added: RequestDocument[],
          modified: RequestDocument[],
          deleted: string[]          // request IDs
        }
      }
    }
    ```
  - Processing:
    - Upsert added/modified requests into `channel_requests`
    - Mark deleted requests (`deleted = 1`)
    - Update collection metadata if provided
    - Increment `channels.version`
    - Update `channels.updated_at`
  - Response: `{ version: number }` (new version)
  - Logs `push` activity with change summary
- [ ] Incremental pull: `GET /api/channels/:id/changes?since=V`
  - Auth: instance token (owner or subscriber)
  - Returns all requests where `version > V`, plus deleted request IDs
  - Response:
    ```typescript
    {
      currentVersion: number,
      collection: CollectionDocument,
      changes: {
        added: RequestDocument[],
        modified: RequestDocument[],
        deleted: string[]
      }
    }
    ```
  - Updates `subscriptions.last_pull_version`
- [ ] Change summary endpoint (for preview): `GET /api/channels/:id/changes/summary?since=V`
  - Returns counts only: `{ added: number, modified: number, deleted: number, currentVersion: number }`
  - Used by Dispatch to show "2 requests modified, 1 added" without downloading full data

### Verification

- Push changes from instance A → version increments
- Version check from instance B → sees new version
- Pull changes on instance B → receives only what changed
- Push on readonly channel from non-owner → `403`
- Push on readwrite channel from subscriber → succeeds

---

## Phase 5: Admin API & Dashboard

**Goal:** Admin can monitor and manage the server via REST API and web UI.

### Tasks

- [ ] Admin API endpoints (all require `X-Admin-Token`):
  - `GET /api/admin/dashboard` — stats: instance count, channel count, DB size, recent activity
  - `GET /api/admin/instances` — list all instances (name, token prefix, registered, last seen)
  - `DELETE /api/admin/instances/:token` — revoke instance token (cascades: remove subscriptions, orphan owned channels)
  - `GET /api/admin/channels` — list all channels (admin view with full details)
  - `DELETE /api/admin/channels/:id` — force-delete channel
  - `GET /api/admin/activity` — paginated activity log with filters (`?type=push&limit=50&offset=0`)
  - `PATCH /api/admin/settings` — update passphrase, rate limit thresholds
- [ ] Static file serving for admin UI
  - `@fastify/static` serves `admin/dist/` at `/admin`
  - Admin UI is a lightweight SPA (vanilla HTML/CSS/JS — no framework)
- [ ] Admin UI pages:
  - **Dashboard** — instance count, channel count, storage size, last 10 activity events
  - **Instances** — table with revoke action
  - **Channels** — table with delete action, mode toggle
  - **Activity Log** — filterable table with pagination
  - **Settings** — rotate passphrase, view config
- [ ] Admin UI styling
  - Bootstrap 5.3 dark theme (consistent with Dispatch)
  - Minimal JS — fetch API calls, DOM manipulation, no build step
  - Responsive layout

### Verification

- Access `/admin` in browser → see dashboard
- Revoke an instance token → that instance can no longer authenticate
- Force-delete a channel → channel and all data removed
- Activity log shows all registration, push, pull events

---

## Phase 6: Security Hardening & Production Readiness

**Goal:** The server is safe for internet-facing deployment.

### Tasks

- [ ] Input validation on all endpoints
  - Validate UUIDs, string lengths, JSON structure
  - Use a validation library or Fastify's built-in JSON schema validation
  - Reject oversized payloads (configurable max, default 10MB)
- [ ] Rate limiting refinements
  - Ensure rate limit windows reset correctly
  - Add rate limiting to push/pull endpoints (prevent abuse)
  - Log rate limit violations to activity log
- [ ] Security headers
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy` for admin UI
  - `Strict-Transport-Security` (when behind HTTPS proxy)
- [ ] Constant-time comparison for all secret comparisons (passphrase, admin token)
- [ ] Request size limits per endpoint
- [ ] Error handling standardization
  - Consistent error response format: `{ error: string, message: string, statusCode: number }`
  - Never leak internal details (stack traces, SQL errors) in production
- [ ] Logging
  - Structured JSON logging via Pino
  - Log level configurable via `LOG_LEVEL`
  - Request/response logging (excluding sensitive headers)
- [ ] Database maintenance
  - Periodic cleanup of old activity log entries (configurable retention, default 30 days)
  - Periodic cleanup of expired rate limit entries
- [ ] Health check enhancements
  - Include DB connectivity check
  - Include storage usage stats

### Verification

- Malformed requests → proper 400 errors with safe messages
- Oversized payloads → rejected before processing
- Rate limit violations → logged and blocked
- No sensitive data in error responses or logs

---

## Phase 7: Testing & Documentation

**Goal:** Comprehensive test coverage and deployment documentation.

### Tasks

- [ ] Unit tests (`src/**/*.test.ts`)
  - Database operations (CRUD for all tables)
  - Auth middleware (valid/invalid/missing tokens)
  - Rate limiting logic
  - Change detection and version management
- [ ] Integration tests
  - Full registration → publish → subscribe → push → pull flow
  - Conflict scenarios (concurrent pushes)
  - Rate limiting behavior
  - Admin operations
- [ ] Test infrastructure
  - In-memory SQLite for tests (`:memory:`)
  - Test fixtures for collections, requests, channels
  - Fastify's `inject()` for HTTP testing (no real server needed)
- [ ] Documentation
  - `README.md` — project overview, quick start, deployment guide
  - `CLAUDE.md` — AI assistant guidance (architecture, commands, conventions)
  - API reference (generated from route schemas or hand-written)
  - Deployment guide: Docker, reverse proxy (Caddy/nginx examples), env var reference

### Verification

- `npm test` passes all unit and integration tests
- README provides clear 3-step deployment instructions
- New developer can deploy from README alone

---

## Phase 8: Dispatch Client Integration

**Goal:** Define the contract for changes needed in the Dispatch companion app (separate repo).

> This phase documents what Dispatch needs to implement. The actual client-side work happens in the `dispatch` repository.

### Dispatch-Side Changes Required

- [ ] **Settings UI** — Central URL, passphrase input, instance name, registration flow
- [ ] **Data model extension** — `CollectionDocument` gains optional sync fields:
  ```typescript
  channelId?: string;
  centralUrl?: string;
  syncRole?: 'owner' | 'subscriber';
  syncMode?: 'readonly' | 'readwrite';
  lastSyncVersion?: number;
  lastSyncAt?: string;
  ```
- [ ] **Central API client service** — HTTP client for all Dispatch Central endpoints
- [ ] **Publish flow** — collection context menu → publish → receive channel ID → display share link
- [ ] **Subscribe flow** — paste channel ID → preview collection → confirm → pull full state
- [ ] **Push flow** — detect local changes to synced collections → push button → confirm → push delta
- [ ] **Pull flow** — periodic version check → "updates available" indicator → preview → pull
- [ ] **Change tracking** — track which requests changed locally since last sync (for delta push)
- [ ] **Sync status indicators** — per-collection badges: synced, local changes pending, updates available
- [ ] **Change preview modal** — show added/modified/deleted requests before pull

---

## Dependency Graph

```
Phase 1 ─── Phase 2 ─── Phase 3 ─── Phase 4
                │                       │
                └──── Phase 5 ──────────┤
                                        │
                                   Phase 6 ─── Phase 7
                                                  │
                                             Phase 8
```

- **Phases 1→2→3→4** are strictly sequential (each builds on the previous)
- **Phase 5** (Admin) can start after Phase 2 (needs auth) and run parallel to Phases 3-4
- **Phase 6** (Hardening) should follow Phase 4 when the full API surface exists
- **Phase 7** (Testing) follows Phase 6
- **Phase 8** (Client Integration) can begin planning during Phase 4 but implementation depends on Phase 7

---

## Tech Stack Reference

| Component       | Choice                  | Rationale                                    |
|-----------------|-------------------------|----------------------------------------------|
| Runtime         | Node.js + TypeScript    | Same as Dispatch — shared knowledge          |
| Framework       | Fastify 4.x            | Same as Dispatch — familiar patterns         |
| Database        | SQLite (better-sqlite3) | Better concurrency than LokiJS for multi-instance writes |
| Admin UI        | Vanilla HTML/CSS/JS     | No build step, minimal footprint             |
| Styling         | Bootstrap 5.3 dark      | Visual consistency with Dispatch             |
| Distribution    | Docker (Node Alpine)    | Same deployment model as Dispatch            |
| Logging         | Pino                    | Built into Fastify                           |
| Testing         | Node test runner + Fastify inject | Zero-dependency testing            |

## Companion App Reference

Dispatch's data models that Central must be compatible with:

| Type                | Location in Dispatch                     |
|---------------------|------------------------------------------|
| `RequestDocument`   | `server/src/db/types.ts`                 |
| `CollectionDocument`| `server/src/db/types.ts`                 |
| `FolderEntry`       | `server/src/db/types.ts`                 |
| `HeaderEntry`       | `server/src/db/types.ts`                 |
| `ParamEntry`        | `server/src/db/types.ts`                 |
| `RequestBody`       | `server/src/db/types.ts`                 |
| `AuthConfig`        | `server/src/db/types.ts`                 |
| `VariableEntry`     | `server/src/db/types.ts`                 |
