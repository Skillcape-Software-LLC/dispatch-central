Context
Dispatch is a local-first, single-user HTTP testing tool. Users need a way to share collections across teams and workstations without authentication or invitation flows. The solution is a companion Dispatch Central application — a self-hosted sync server that collections can be published to and subscribed from.
Business Cases

Freelancer shares different collections with different teams
Team collaborates on a shared collection with bidirectional edits
Single user backs up / restores collections across workstations

Design Decisions (Confirmed)

No environment sync — collections only. Subscribers configure their own environments locally.
Manual push/pull — no auto-sync. Users push when ready, pull when they choose to. Dispatch Central notifies subscribers that updates are available.
No version history (MVP) — Dispatch Central stores only the current state. Local copies serve as implicit backups.
Internet-facing — must be secure enough for public internet exposure, with simple onboarding (< 4 steps).


Core Concepts
Security: Passphrase + Instance Tokens
Dispatch Central is designed to be internet-facing without traditional user accounts. Security is layered:
Layer 1 — Passphrase (gates registration)

Admin sets a passphrase on deployment (env var or config)
To register a new instance, you must provide the passphrase
This is a one-time gate: register once, then use your instance token for all future requests
Prevents unauthorized registration from random internet traffic

Layer 2 — Instance Tokens (ongoing identity)

On successful registration, Dispatch Central issues a cryptographically random instance token (UUID v4, 122 bits)
All subsequent API requests use X-Instance-Token header
Token is stored locally in Dispatch's settings
Admin can revoke compromised tokens via the admin dashboard

Layer 3 — Channel IDs (per-collection access)

Channel IDs are UUID v4 (122 bits) — infeasible to brute-force
Knowing a channel ID = access to that collection
Channels are isolated: subscribing to one reveals nothing about others

Layer 4 — Rate Limiting

Registration endpoint: 3 attempts/min/IP, lockout after 10 failures
Subscribe endpoint: 5 attempts/min/IP
Prevents brute-force enumeration of passphrases or channel IDs

Layer 5 — HTTPS (required for internet-facing)

TLS terminates at reverse proxy (nginx, Caddy, etc.)
Dispatch Central runs HTTP internally, proxy handles certificates

Onboarding Flow (3 steps):

Enter Dispatch Central URL + passphrase in Dispatch settings → instance registers, gets token (one-time)
Paste channel ID → preview collection → subscribe
Done

Sharing Unit: Channels
When a collection is published to Dispatch Central, a channel is created:

Channel gets a short shareable ID (e.g., dispatch://central.example.com/ch/a3f-b92-c17)
Anyone with the channel ID can subscribe — no invitation needed
The publisher (original instance) is the owner
Owner can set channel as read-write (collaborative) or read-only (broadcast)
Owner can revoke access by deleting the channel

Dispatch Central as Source of Truth
Dispatch Central stores the canonical version of each shared collection:

Dispatch instances manually push local changes → Dispatch Central accepts and stores
Does not auto-push — instead it tracks a version number so subscribers can check for updates
Subscribers manually pull when they're ready, with a preview of what changed
Dispatch Central is the single authority on "what's current"


Sync Architecture
Manual Push/Pull with Notifications
This is not auto-sync. The workflow is git-like: you push when ready, others pull when ready.
  Dispatch A (owner)       Central                  Dispatch B (subscriber)
       |                       |                           |
       |-- PUBLISH collection->|                           |
       |<-- channel ID --------|                           |
       |                       |                           |
       |     (share channel ID out-of-band)                |
       |                       |                           |
       |                       |<--- SUBSCRIBE (channel) --|
       |                       |--- full collection ------>|
       |                       |                           |
       |  (owner edits locally, then manually pushes)      |
       |-- PUSH changes ------>|                           |
       |                       |  (hub increments version) |
       |                       |                           |
       |               (subscriber checks for updates)     |
       |                       |<-- CHECK updates? --------|
       |                       |--- "v3 available, 2 req   |
       |                       |    modified, 1 added" --->|
       |                       |                           |
       |              (subscriber previews, then pulls)    |
       |                       |<-- PULL changes ----------|
       |                       |--- changed requests ----->|
       |                       |                           |
       |  (on read-write channels, subscriber can push too)|
       |                       |<-- PUSH changes ----------|
       |                       |  (hub increments version) |
       |                       |                           |
       |  (owner checks for updates)                       |
       |-- CHECK updates? ---->|                           |
       |<- "v4 available" -----|                           |
       |-- PULL changes ------>|                           |
       |<- changed requests ---|                           |
How Update Notifications Work
Dispatch periodically does a lightweight version check (not a full sync):

GET /api/channels/:id/version → returns { version: 4, updatedAt: "..." }
Compare against local lastSyncVersion
If remote version > local version → show indicator: "Updates available for Collection A"
User clicks → sees a change preview (what was added/modified/deleted)
User confirms → pull applies changes to local copy

This is cheap (single integer comparison), non-intrusive, and keeps the user in control.
Change Preview Before Pull
When updates are available, the user sees a summary before accepting:
Updates available for "API Tests" (v3 → v5)

  + Added: POST /users/register
  ~ Modified: GET /users (headers changed)
  ~ Modified: DELETE /users/:id (URL updated)
  - Removed: GET /legacy/users

  [Preview Changes]  [Pull Now]  [Dismiss]
Push Workflow
When the user has local changes to a synced collection:

Indicator shows "Local changes not pushed" on the collection
User clicks "Push to Central" → sees summary of what will be pushed
Confirms → changes pushed, version increments on Dispatch Central
Other subscribers will see "updates available" on their next version check

Granularity: Request-Level
Changes are tracked at the request level:

Each request carries a version (incrementing integer) and updatedAt timestamp
Pushes contain only changed/added/deleted requests (not the entire collection)
Folder structure and collection metadata changes are separate change types

Conflict Resolution
For the MVP: last-write-wins at request level.

If two people push edits to the same request, the last push wins
Dispatch Central timestamps all incoming changes — latest timestamp takes precedence
Acceptable because request-level conflicts are narrow (two people editing the exact same request simultaneously is rare)
When pulling, if a request was modified both locally and remotely, show a warning in the preview


Dispatch Central API Surface
POST   /api/instances/register             — Register instance (requires passphrase, returns instance token)

POST   /api/channels                       — Publish collection → create channel
GET    /api/channels/:id                   — Channel metadata (name, owner, mode, subscriber count)
DELETE /api/channels/:id                   — Revoke/delete channel (owner only)
PATCH  /api/channels/:id/settings          — Update channel settings (read-only ↔ read-write)

GET    /api/channels/:id/version           — Lightweight version check (just version + timestamp)
GET    /api/channels/:id/state             — Pull full collection state (initial subscribe)
GET    /api/channels/:id/changes?since=V   — Pull incremental changes since version V
POST   /api/channels/:id/push              — Push local changes

POST   /api/channels/:id/subscribe         — Subscribe instance to channel
DELETE /api/channels/:id/subscribe         — Unsubscribe
GET    /api/subscriptions                  — List all channels this instance subscribes to
All requests (except /register) require X-Instance-Token header. Registration requires X-Passphrase header instead.

How Each Case Works
Case 1: Freelancer with Multiple Teams

Freelancer publishes Collection 1 → channel ch-abc (read-only)
Freelancer publishes Collection 2 → channel ch-def (read-only)
Shares channel links with respective teams
Team members subscribe → pull full collection
Freelancer edits locally → pushes when ready → teams see "updates available"
Teams pull at their convenience, previewing changes first
Teams use requests locally but cannot push modifications

Case 2: Team Collaboration

Team lead publishes "apitests" → channel ch-xyz (read-write)
Shares channel link with team
All members subscribe → pull full collection
Any member edits locally → pushes changes → version increments
Other members see "updates available" → preview → pull
Conflicts (same request edited by two people): last push wins, pull preview warns about overwritten local changes

Case 3: Backup & Restore

User runs their own Dispatch Central instance (or uses a shared one)
Publishes collections → channels created (only they know the IDs)
On new workstation: subscribes to their channels → pulls full state
Ongoing: push from primary workstation, pull on secondary when needed


Dispatch-Side Changes
Settings

Dispatch Central URL configuration (e.g., https://central.mycompany.com)
Passphrase (entered once during registration, not stored after token is received)
Instance name (friendly name for identification)
Instance token (received from Dispatch Central on registration, stored locally)

UI Additions

Collection context menu: "Publish to Central" / "Push Changes" / "Pull Updates"
Sync status indicator per collection (synced / local changes pending / updates available)
"Subscribe to Channel" action: paste channel ID → preview collection → confirm
Change preview modal (shown before pull)
Central management panel: view subscriptions, published channels, connection status

Data Model Changes

CollectionDocument gains optional: channelId, centralUrl, syncRole ("owner" | "subscriber"), syncMode ("readonly" | "readwrite"), lastSyncVersion, lastSyncAt


Admin Dashboard
Dispatch Central ships with a lightweight web UI for administration, served from the same container.
Access: https://central.example.com/admin — gated by an admin token (ADMIN_TOKEN env var, set at deployment). No accounts — single token = admin access.
Pages
Dashboard — at-a-glance overview:

Registered instance count, active channel count
Storage usage (SQLite DB size)
Recent activity feed (last 50 events: registrations, pushes, pulls)

Instances — manage connected Dispatch installations:

Table: instance name, token prefix (first 8 chars), registered date, last seen
Actions: revoke token (immediately invalidates all access for that instance)

Channels — manage shared collections:

Table: channel name, owner instance, mode (read-only/read-write), subscriber count, current version, last push timestamp
Actions: force-delete channel (removes channel + all synced data), change mode

Activity Log — audit trail:

Filterable log of registrations, subscriptions, pushes, pulls
Rate limit violations and blocked IPs
Useful for debugging sync issues and detecting abuse

Settings:

Rotate passphrase (existing instances unaffected — they already have tokens)
Adjust rate limit thresholds
View/export configuration

Admin API
All admin operations are also available via REST API (same admin token in X-Admin-Token header), enabling CLI scripting:
GET    /api/admin/dashboard               — Stats overview
GET    /api/admin/instances                — List all instances
DELETE /api/admin/instances/:token         — Revoke instance token
GET    /api/admin/channels                 — List all channels (admin view)
DELETE /api/admin/channels/:id             — Force-delete channel
GET    /api/admin/activity                 — Activity log (paginated)
PATCH  /api/admin/settings                 — Update hub settings
Deployment Configuration
ADMIN_TOKEN=<random-string>     # Required — gates admin UI + API
PASSPHRASE=<team-password>      # Required — gates instance registration
PORT=3001                       # Default port
DATA_DIR=/data                  # SQLite storage location
LOG_LEVEL=info                  # Pino log level

Dispatch Central Tech Stack

Runtime: Node.js + Fastify + TypeScript (same as Dispatch — shared knowledge, potential code reuse)
Storage: SQLite via better-sqlite3 (better concurrent multi-instance writes than LokiJS)
Admin UI: Lightweight SPA (could be vanilla HTML/JS or minimal Angular — served as static files by Fastify)
Distribution: Docker container, self-hosted
No external dependencies — stays aligned with Dispatch's zero-dependency philosophy


Verification
Since this is a high-level architecture plan (no code), verification will happen during implementation:

Stand up a Dispatch Central instance, register two Dispatch instances
Publish a collection from instance A, subscribe from instance B
Edit requests on A, push, verify B sees "updates available"
Pull on B, verify changes match
Test read-write mode: edit on B, push, verify A sees updates
Test conflict scenario: edit same request on both, push both, verify last-write-wins
Test backup/restore: publish, subscribe on fresh instance, verify full state