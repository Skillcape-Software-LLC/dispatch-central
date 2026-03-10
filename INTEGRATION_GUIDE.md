# Dispatch Client Integration Guide

This guide defines the contract between Dispatch (the local-first HTTP testing app) and Dispatch Central (the sync server). It covers every API interaction, the data model changes needed in Dispatch, and step-by-step integration flows.

---

## Table of Contents

1. [Overview](#overview)
2. [Data Model Extensions](#data-model-extensions)
3. [API Client Service](#api-client-service)
4. [Authentication Header](#authentication-header)
5. [API Reference with Examples](#api-reference-with-examples)
6. [Integration Flows](#integration-flows)
7. [Change Tracking](#change-tracking)
8. [UI Components](#ui-components)
9. [Error Handling](#error-handling)
10. [Implementation Checklist](#implementation-checklist)

---

## Overview

Dispatch Central uses a manual push/pull sync model (like git, not like Google Docs). The client decides when to push and pull — there is no auto-sync or WebSocket connection. The sync lifecycle is:

```
Register → Publish → Share Channel ID → Subscribe → Push/Pull
```

All communication is standard HTTP with JSON bodies. Authentication uses two custom headers:

- `X-Passphrase` — only for initial registration
- `X-Instance-Token` — for all subsequent API calls

---

## Data Model Extensions

### CollectionDocument — New Optional Fields

Add these fields to `CollectionDocument` in `server/src/db/types.ts`. All are optional — a collection with no sync fields is a normal local collection.

```typescript
interface CollectionDocument {
  // ... existing fields ...

  // Sync fields (optional — only present for synced collections)
  channelId?: string;          // UUID of the Central channel
  centralUrl?: string;         // Base URL of the Central server (e.g., "https://central.example.com")
  syncRole?: 'owner' | 'subscriber';
  syncMode?: 'readonly' | 'readwrite';
  lastSyncVersion?: number;    // Last version pulled from or pushed to Central
  lastSyncAt?: string;         // ISO timestamp of last sync operation
}
```

### Instance Config — New Settings

Store these in Dispatch's app settings (not per-collection):

```typescript
interface CentralConfig {
  url: string;           // Central server URL
  instanceToken: string; // Received on registration
  instanceName: string;  // Friendly name sent during registration
}
```

---

## API Client Service

Create a Central API client service in Dispatch. All methods should:

- Prepend the configured `centralUrl` to paths
- Set `Content-Type: application/json` on all requests
- Set `X-Instance-Token` on all requests (except registration)
- Handle errors consistently (see [Error Handling](#error-handling))

```typescript
class CentralClient {
  constructor(
    private baseUrl: string,
    private instanceToken: string,
  ) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      'X-Instance-Token': this.instanceToken,
    };
  }

  // Methods below correspond to each API endpoint
}
```

---

## Authentication Header

Every request except registration and health must include:

```
X-Instance-Token: <uuid>
```

Registration requires:

```
X-Passphrase: <passphrase>
```

---

## API Reference with Examples

### Register Instance

One-time setup. Call this when the user configures Central for the first time.

```
POST /api/instances/register
```

**Headers:**
```
X-Passphrase: the-server-passphrase
Content-Type: application/json
```

**Request:**
```json
{
  "name": "Chad's MacBook"
}
```

**Response (201):**
```json
{
  "token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Store this token persistently. It is the instance's identity for all future requests.

**Errors:**
- `403` — Wrong passphrase
- `429` — Rate limited (10 attempts per 15 minutes per IP)

---

### Publish Collection

Creates a channel from a local collection. The publisher becomes the channel owner.

```
POST /api/channels
```

**Request:**
```json
{
  "collection": {
    "id": "col-uuid",
    "name": "My API",
    "description": "User-facing API endpoints",
    "folders": [
      { "id": "folder-1", "name": "Auth", "parentId": null, "sortOrder": 0 }
    ],
    "auth": { "type": "none" },
    "variables": [
      { "key": "baseUrl", "value": "https://api.example.com" }
    ],
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-03-10T14:30:00.000Z"
  },
  "requests": [
    {
      "id": "req-1",
      "name": "Login",
      "method": "POST",
      "url": "{{baseUrl}}/auth/login",
      "headers": [{ "key": "Content-Type", "value": "application/json", "enabled": true }],
      "params": [],
      "body": { "mode": "json", "content": "{\"email\":\"test@example.com\"}" },
      "auth": { "type": "none" },
      "collectionId": "col-uuid",
      "folderId": "folder-1",
      "sortOrder": 0,
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-03-10T14:30:00.000Z"
    }
  ]
}
```

**Response (201):**
```json
{
  "channelId": "b2c3d4e5-f6a7-8901-bcde-f12345678901"
}
```

After publishing, update the local collection:
```typescript
collection.channelId = response.channelId;
collection.syncRole = 'owner';
collection.syncMode = 'readonly';  // default
collection.lastSyncVersion = 1;    // initial publish is version 1
collection.lastSyncAt = new Date().toISOString();
```

The owner is automatically subscribed to the channel.

---

### Subscribe to Channel

Called when a user pastes a channel ID to join.

```
POST /api/channels/:id/subscribe
```

**Response (200):**
```json
{
  "channelId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "name": "My API",
  "mode": "readonly",
  "version": 3
}
```

After subscribing, immediately pull the full state (see below) to get the collection data.

---

### Pull Full State

Used on first sync after subscribing, or to reset to the server's state.

```
GET /api/channels/:id/state
```

**Response (200):**
```json
{
  "version": 3,
  "collection": { /* full CollectionDocument */ },
  "requests": [ /* full RequestDocument[] */ ]
}
```

After pulling, create the collection locally and set sync fields:
```typescript
collection.channelId = channelId;
collection.centralUrl = centralUrl;
collection.syncRole = 'subscriber';
collection.syncMode = response.collection.mode;  // from channel metadata
collection.lastSyncVersion = response.version;
collection.lastSyncAt = new Date().toISOString();
```

---

### Check Version (Lightweight)

Use this to poll for updates without downloading data. Call periodically or on app focus.

```
GET /api/channels/:id/version
```

**Response (200):**
```json
{
  "version": 5,
  "updatedAt": "2026-03-10T16:45:00.000Z"
}
```

If `response.version > collection.lastSyncVersion`, updates are available. Show an indicator in the UI.

---

### Get Change Summary (Preview)

Before pulling, show the user what changed. This is a count-only endpoint — no data transferred.

```
GET /api/channels/:id/changes/summary?since=3
```

**Response (200):**
```json
{
  "currentVersion": 5,
  "changed": 4,
  "deleted": 1
}
```

Display this as: "4 requests changed, 1 deleted" in a confirmation dialog.

---

### Pull Incremental Changes (Delta Sync)

Pull only what changed since the client's last sync version.

```
GET /api/channels/:id/changes?since=3
```

**Response (200):**
```json
{
  "currentVersion": 5,
  "collection": { /* current CollectionDocument */ },
  "changes": {
    "requests": [
      { /* full RequestDocument for each changed/added request */ }
    ],
    "deleted": ["req-uuid-1", "req-uuid-2"]
  }
}
```

**Client-side merge logic:**
1. For each request in `changes.requests`: upsert into local DB (insert if new, update if exists)
2. For each ID in `changes.deleted`: delete from local DB
3. Replace local collection metadata with `response.collection`
4. Update `collection.lastSyncVersion = response.currentVersion`
5. Update `collection.lastSyncAt = new Date().toISOString()`

The server returns all non-deleted changed requests as a flat list. The client determines whether each is "added" or "modified" based on whether it exists locally.

---

### Push Changes

Send local changes to the server.

```
POST /api/channels/:id/push
```

**Request:**
```json
{
  "baseVersion": 3,
  "changes": {
    "collection": { /* full CollectionDocument if metadata changed, omit if unchanged */ },
    "requests": {
      "added": [
        { /* full RequestDocument for new requests */ }
      ],
      "modified": [
        { /* full RequestDocument for changed requests */ }
      ],
      "deleted": ["req-uuid-to-delete"]
    }
  }
}
```

**Response (200):**
```json
{
  "version": 4
}
```

After pushing:
```typescript
collection.lastSyncVersion = response.version;
collection.lastSyncAt = new Date().toISOString();
// Clear local change tracking for this collection
```

**Authorization rules:**
- `readonly` channels: only the owner can push
- `readwrite` channels: owner and all subscribers can push

**Errors:**
- `403` — Not authorized to push (non-owner on readonly, or not a subscriber)

---

### Channel Metadata

```
GET /api/channels/:id
```

**Response (200):**
```json
{
  "id": "b2c3d4e5-...",
  "name": "My API",
  "owner": true,
  "mode": "readonly",
  "subscriberCount": 3,
  "version": 5,
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-03-10T16:45:00.000Z"
}
```

The `owner` field is relative to the requesting instance — `true` if you own this channel.

---

### Update Channel Settings (Owner Only)

```
PATCH /api/channels/:id/settings
```

**Request:**
```json
{
  "mode": "readwrite"
}
```

**Response (200):**
```json
{
  "ok": true
}
```

---

### Unsubscribe

```
DELETE /api/channels/:id/subscribe
```

**Response:** `204 No Content`

After unsubscribing, clear the sync fields from the local collection (or keep the data as a local-only copy — user's choice).

---

### List Subscriptions

```
GET /api/subscriptions
```

**Response (200):**
```json
[
  {
    "channelId": "b2c3d4e5-...",
    "name": "My API",
    "mode": "readonly",
    "version": 5,
    "subscribedAt": "2026-02-01T12:00:00.000Z",
    "lastPullVersion": 3
  }
]
```

Useful for a "Synced Collections" view. Compare `version` vs `lastPullVersion` to show which channels have pending updates.

---

## Integration Flows

### Flow 1: First-Time Setup

```
User enters Central URL + passphrase + instance name
  → POST /api/instances/register
  → Store token in app settings
  → Show "Connected to Central" confirmation
```

### Flow 2: Publish a Collection

```
User right-clicks collection → "Publish to Central"
  → POST /api/channels (full collection + all requests)
  → Store channelId, syncRole='owner', lastSyncVersion=1
  → Display channel ID for sharing
  → Show sync badge on collection
```

### Flow 3: Subscribe to a Channel

```
User clicks "Join Channel" → pastes channel ID
  → POST /api/channels/:id/subscribe
  → GET /api/channels/:id/state (full pull)
  → Create local collection from response
  → Store channelId, syncRole='subscriber', lastSyncVersion
  → Show sync badge on collection
```

### Flow 4: Push Local Changes

```
User modifies requests in a synced collection
  → Local change tracker records added/modified/deleted request IDs
  → User clicks "Push" button (or context menu)
  → Show confirmation: "Push 2 modified, 1 added, 0 deleted?"
  → POST /api/channels/:id/push
  → Update lastSyncVersion, clear change tracker
  → Update sync badge: "Synced"
```

### Flow 5: Pull Remote Changes

```
App checks for updates (on focus, or periodic timer)
  → GET /api/channels/:id/version
  → If version > lastSyncVersion:
    → Show "Updates available" badge
    → User clicks "Pull"
    → GET /api/channels/:id/changes/summary?since=V (optional preview)
    → Show confirmation: "4 changed, 1 deleted — pull?"
    → GET /api/channels/:id/changes?since=V
    → Merge changes into local DB
    → Update lastSyncVersion
    → Update sync badge: "Synced"
```

### Flow 6: Push-Then-Pull (Bidirectional Sync on Readwrite Channels)

When a user has local changes AND the server has remote changes:

```
1. Push local changes first → POST /api/channels/:id/push
2. Then pull remote changes → GET /api/channels/:id/changes?since=oldVersion
3. Merge pulled changes into local DB
4. Update lastSyncVersion to currentVersion from pull response
```

Conflict resolution is last-write-wins at the request level. If both sides modified the same request, the push overwrites the server, then the pull brings back anything else that changed remotely.

---

## Change Tracking

Dispatch needs to track local changes to synced collections since the last push. This determines what goes into the `changes` payload when pushing.

### Approach: Snapshot Comparison

The simplest approach — compare local state against what was last pulled:

1. When pulling, store the pulled request data as a "sync snapshot" (separate from the working copy)
2. On push, diff current local state against the snapshot:
   - Requests in local but not in snapshot → `added`
   - Requests in both but with different `updatedAt` or content → `modified`
   - Requests in snapshot but not in local → `deleted`
3. After push, update the snapshot to match current local state

### Approach: Event Log (Alternative)

Track mutations as they happen:

1. Intercept all request create/update/delete operations on synced collections
2. Record the request ID and operation type in a `sync_pending_changes` table
3. On push, read the pending changes, build the payload, then clear the table

The snapshot approach is simpler to implement. The event log approach is more efficient for large collections.

---

## UI Components

### Settings Panel

- Central URL input
- Passphrase input (only shown during registration)
- Instance name input
- "Connect" button → triggers registration
- Connection status indicator
- "Disconnect" option (clears token, does not revoke server-side)

### Collection Sync Badge

Per-collection indicator showing sync state:

| State | Badge | Condition |
|-------|-------|-----------|
| Synced | Green checkmark | `lastSyncVersion === remoteVersion` and no local changes |
| Local Changes | Orange dot | Local changes tracked since last push |
| Updates Available | Blue arrow | `remoteVersion > lastSyncVersion` |
| Unsynced | Grey dash | Collection has no `channelId` |

### Collection Context Menu (Synced)

- **Push** — enabled when local changes exist
- **Pull** — enabled when updates available
- **Channel Info** — shows channel ID, mode, subscriber count
- **Change Mode** — owner only, toggle readonly/readwrite
- **Unsubscribe** / **Unpublish** — remove sync association

### Change Preview Modal

Shown before pull:

```
┌─────────────────────────────────┐
│  Pull Changes from Central      │
│                                 │
│  4 requests changed             │
│  1 request deleted              │
│  Server version: 5 (you: 3)    │
│                                 │
│  [Cancel]           [Pull Now]  │
└─────────────────────────────────┘
```

### Publish Dialog

```
┌─────────────────────────────────┐
│  Publish to Central             │
│                                 │
│  Collection: My API             │
│  Requests: 12                   │
│  Mode: ○ Readonly  ○ Readwrite  │
│                                 │
│  [Cancel]         [Publish]     │
└─────────────────────────────────┘
```

After publish, show the channel ID with a copy button.

### Subscribe Dialog

```
┌─────────────────────────────────┐
│  Join a Channel                 │
│                                 │
│  Channel ID: [________________] │
│                                 │
│  [Cancel]        [Subscribe]    │
└─────────────────────────────────┘
```

After subscribing, auto-pull full state and open the new collection.

---

## Error Handling

All Central API errors return:

```json
{
  "error": "ErrorType",
  "message": "Human-readable description."
}
```

### Error Types to Handle

| Status | Error | Client Action |
|--------|-------|---------------|
| `400` | `BadRequest` | Show validation message to user |
| `401` | `Unauthorized` | Token invalid — prompt to re-register |
| `403` | `Forbidden` | Show permission error (wrong passphrase, not authorized to push, etc.) |
| `404` | `NotFound` | Channel deleted or never existed — offer to unlink |
| `429` | `RateLimited` | Show "too many requests" with `Retry-After` countdown |
| `500` | `InternalServerError` | Show generic "server error, try again later" |
| Network error | — | Show "cannot reach Central server" with retry option |

### Resilience

- All sync operations should be non-blocking — never prevent the user from working locally
- Network failures should degrade gracefully (badge shows "offline", sync retries later)
- If a channel returns 404, offer to convert the collection to local-only

---

## Implementation Checklist

### Phase A: Settings & Registration
- [ ] Add Central settings panel (URL, passphrase, instance name)
- [ ] Implement `POST /api/instances/register` call
- [ ] Persist instance token in app settings
- [ ] Connection status indicator

### Phase B: Publish & Subscribe
- [ ] Extend `CollectionDocument` with sync fields
- [ ] Publish flow: collection → `POST /api/channels` → store channel ID
- [ ] Subscribe flow: channel ID → `POST /subscribe` → `GET /state` → create local collection
- [ ] Unsubscribe flow: `DELETE /subscribe` → clear sync fields

### Phase C: Push & Pull
- [ ] Implement change tracking (snapshot or event log)
- [ ] Push flow: diff local changes → `POST /push` → update version
- [ ] Pull flow: `GET /changes?since=V` → merge into local DB → update version
- [ ] Version polling: `GET /version` on app focus or timer

### Phase D: UI Polish
- [ ] Sync badge on synced collections
- [ ] Change preview modal before pull (`GET /changes/summary`)
- [ ] Push confirmation dialog
- [ ] Channel info panel (metadata, mode, subscriber count)
- [ ] Owner controls: change mode (`PATCH /settings`), delete channel

### Phase E: Edge Cases
- [ ] Handle 404 channels (server deleted) — offer to unlink
- [ ] Handle 401 (token revoked) — prompt re-registration
- [ ] Handle network failures gracefully
- [ ] Handle rate limiting with `Retry-After` backoff
- [ ] Offline mode — queue pushes for retry when back online
