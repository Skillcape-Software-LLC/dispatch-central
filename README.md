# Dispatch Central

Self-hosted sync server for [Dispatch](https://github.com/Skillcape-Software/dispatch) — a local-first HTTP testing tool. Dispatch Central enables teams and individuals to share, sync, and collaborate on API request collections via a manual push/pull workflow.

## How It Works

1. **Publish** — A Dispatch user publishes a collection as a channel, receiving a shareable channel ID
2. **Subscribe** — Other users subscribe to the channel using that ID
3. **Push/Pull** — Changes are synced manually: push your local changes, pull remote updates. No auto-sync — you control when data moves

### Security Model

Dispatch Central uses a lightweight, token-based security model with no traditional user accounts:

- **Passphrase** — A shared secret that gates instance registration (set via env var)
- **Instance Tokens** — Unique UUID issued to each Dispatch client on registration, used for all API calls
- **Channel IDs** — UUIDs that act as capability tokens (knowing the ID = access)
- **Admin Token** — A separate secret for the admin dashboard (set via env var)
- **Rate Limiting** — IP-based, per-endpoint protection against abuse

## Quick Start

### Docker (recommended)

```bash
# Create a .env file
echo "PASSPHRASE=your-secret-passphrase" > .env
echo "ADMIN_TOKEN=your-admin-token" >> .env

# Pull and start the server
docker compose up -d
```

The image is published to `ghcr.io/skillcape-software-llc/dispatch-central`.

The server runs at `http://localhost:3001`. The admin dashboard is at `http://localhost:3001/admin`.

### From Source

```bash
npm install
npm run build
PASSPHRASE=your-secret-passphrase ADMIN_TOKEN=your-admin-token npm start
```

See [INSTALLATION.md](INSTALLATION.md) for detailed deployment instructions.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PASSPHRASE` | Yes | — | Shared secret for instance registration |
| `ADMIN_TOKEN` | Yes | — | Secret for admin API and dashboard access |
| `PORT` | No | `3001` | Server port |
| `DATA_DIR` | No | `/data` | Directory for SQLite database storage |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`, `silent`) |

## API Overview

All API endpoints are under `/api/`. Instance endpoints require an `X-Instance-Token` header. Admin endpoints require an `X-Admin-Token` header.

### Instance Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/instances/register` | Register with passphrase, receive token |
| `GET` | `/api/instances/me` | Confirm token is valid, return instance info |

### Channels
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/channels` | Publish a collection as a channel |
| `GET` | `/api/channels/:id` | Get channel metadata |
| `PATCH` | `/api/channels/:id/settings` | Update channel mode (owner only) |
| `DELETE` | `/api/channels/:id` | Delete channel (owner only) |

### Subscriptions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/channels/:id/subscribe` | Subscribe to a channel |
| `DELETE` | `/api/channels/:id/subscribe` | Unsubscribe |
| `GET` | `/api/subscriptions` | List your subscriptions |

### Sync
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/channels/:id/state` | Pull full channel state |
| `GET` | `/api/channels/:id/version` | Lightweight version check |
| `POST` | `/api/channels/:id/push` | Push local changes |
| `GET` | `/api/channels/:id/changes?since=V` | Pull incremental changes since version V |
| `GET` | `/api/channels/:id/changes/summary?since=V` | Get change counts without data |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/dashboard` | Server stats and recent activity |
| `GET` | `/api/admin/instances` | List all registered instances |
| `DELETE` | `/api/admin/instances/:token` | Revoke an instance |
| `GET` | `/api/admin/channels` | List all channels |
| `DELETE` | `/api/admin/channels/:id` | Force-delete a channel |
| `GET` | `/api/admin/activity` | Paginated activity log |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check (no auth required) |

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Fastify 4.x
- **Database:** SQLite via better-sqlite3
- **Admin UI:** Vanilla HTML/CSS/JS + Bootstrap 5.3 (no build step)
- **Distribution:** Docker (Node 20 Alpine)
- **Testing:** Node test runner + Fastify inject

## Development

```bash
npm install
npm run dev          # Start with file watching
npm test             # Run all tests (44 tests across 8 suites)
npm run build        # Compile TypeScript
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

Proprietary — Skillcape Software
