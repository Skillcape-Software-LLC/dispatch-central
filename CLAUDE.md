# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dispatch Central is a self-hosted sync server — the companion to Dispatch (a local-first HTTP testing tool). It enables teams and individuals to share, sync, and collaborate on API request collections via a manual push/pull workflow (git-like, not auto-sync).

Key design docs: `APPLICATION_SUMMARY.md` (business requirements) and `IMPLEMENTATION_PLAN.md` (detailed task breakdown with SQL schema and API specs).

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Fastify 4.x
- **Database:** SQLite via better-sqlite3
- **Admin UI:** Vanilla HTML/CSS/JS + Bootstrap 5.3 (no build step)
- **Distribution:** Docker (Node Alpine)
- **Logging:** Pino (built into Fastify)
- **Testing:** Node test runner + Fastify inject (zero-dependency)

## Common Commands

```bash
# Development
npm run dev          # Start dev server with watch mode
npm run build        # Compile TypeScript
npm start            # Run compiled server

# Testing
npm test             # Run all tests
node --test src/**/*.test.ts   # Run a single test file

# Docker
docker compose up -d           # Start containerized server
docker compose down            # Stop
```

## Architecture

### Security Model (5 layers, no traditional auth)

1. **Passphrase** — one-time gate for instance registration
2. **Instance Tokens** — UUID v4 issued on registration, used via `X-Instance-Token` header
3. **Channel IDs** — UUID v4 per collection (knowing ID = access)
4. **Rate Limiting** — IP-based, per endpoint
5. **HTTPS** — via reverse proxy (Caddy/nginx), server runs HTTP internally

### Core Concepts

- **Instances** — registered Dispatch clients, identified by token
- **Channels** — published collections, can be `readonly` or `readwrite`
- **Subscriptions** — link instances to channels they follow
- Changes tracked at **request level** (delta sync, not full collection)
- Conflict resolution: **last-write-wins** at request level (MVP)

### Project Structure

```
src/
├── index.ts           # Fastify server bootstrap
├── config.ts          # Env var validation
├── types/             # TypeScript type definitions
├── db/                # Database init + migrations
├── middleware/         # rate-limit, auth, admin-auth
├── services/          # Business logic (channels, instances, sync, activity)
├── routes/            # API route handlers
└── admin/dist/        # Static admin UI files
```

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ADMIN_TOKEN` | Yes | — | Gates admin UI + API |
| `PASSPHRASE` | Yes | — | Gates instance registration |
| `PORT` | No | 3001 | Server port |
| `DATA_DIR` | No | /data | SQLite storage location |
| `LOG_LEVEL` | No | info | Pino log level |

### API Surface

Core endpoints under `/api/`:
- `POST /instances/register` — register (requires passphrase)
- `POST /channels` — publish collection
- `GET /channels/:id/state` — pull full collection
- `GET /channels/:id/changes?since=V` — pull incremental changes
- `POST /channels/:id/push` — push local changes
- `GET /channels/:id/version` — lightweight version check
- Admin endpoints under `/api/admin/` (require `ADMIN_TOKEN`)

### Related: Dispatch Data Types

Channel data mirrors Dispatch's collection types (`RequestDocument`, `CollectionDocument`, `FolderEntry`, etc.) defined in the Dispatch repo at `server/src/db/types.ts`.
