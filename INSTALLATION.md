# Installation Guide

## Docker Deployment (Recommended)

### Prerequisites

- Docker and Docker Compose installed
- A domain name (optional, for HTTPS)

### 1. Clone and Configure

```bash
git clone <repo-url> dispatch-central
cd dispatch-central
```

Create a `.env` file with your secrets:

```env
PASSPHRASE=choose-a-strong-passphrase
ADMIN_TOKEN=choose-a-strong-admin-token
```

### 2. Start the Server

```bash
docker compose up -d
```

The server will be available at `http://localhost:3001`.

### 3. Verify

```bash
curl http://localhost:3001/api/health
```

You should see:

```json
{ "status": "ok", "timestamp": "...", "version": "0.1.0", "db": true, "dbSizeBytes": ... }
```

### 4. Access the Admin Dashboard

Open `http://localhost:3001/admin` in your browser and enter your `ADMIN_TOKEN`.

---

## Reverse Proxy Setup (HTTPS)

Dispatch Central runs HTTP internally. For production, place it behind a reverse proxy that handles TLS.

### Caddy (simplest)

```
dispatch.example.com {
    reverse_proxy localhost:3001
}
```

Caddy automatically provisions and renews HTTPS certificates via Let's Encrypt.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name dispatch.example.com;

    ssl_certificate     /etc/letsencrypt/live/dispatch.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dispatch.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For push payloads with large collections
        client_max_body_size 10M;
    }
}
```

---

## From Source

### Prerequisites

- Node.js 20+
- npm

### 1. Install Dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run

```bash
PASSPHRASE=your-passphrase ADMIN_TOKEN=your-admin-token npm start
```

Or with all options:

```bash
PASSPHRASE=your-passphrase \
ADMIN_TOKEN=your-admin-token \
PORT=3001 \
DATA_DIR=./data \
LOG_LEVEL=info \
node dist/index.js
```

On Windows, use `cross-env` or set variables in a `.env` loader.

---

## Data Management

### Database Location

The SQLite database is stored at `DATA_DIR/dispatch-central.db`. In Docker, `DATA_DIR` defaults to `/data`, which is mounted as a named volume (`central-data`).

### Backups

```bash
# Docker — copy the DB file from the volume
docker compose cp dispatch-central:/data/dispatch-central.db ./backup.db

# Or stop the container first for a guaranteed-consistent copy
docker compose stop
cp /var/lib/docker/volumes/<project>_central-data/_data/dispatch-central.db ./backup.db
docker compose start
```

### Rotating Secrets

To change the passphrase or admin token, update your `.env` file and restart:

```bash
docker compose down
# Edit .env
docker compose up -d
```

Existing instance tokens remain valid — only new registrations use the updated passphrase.

---

## Troubleshooting

### Server won't start

- Ensure `PASSPHRASE` and `ADMIN_TOKEN` environment variables are set. The server exits immediately without them.
- Check that `DATA_DIR` is writable.

### Health check returns `"status": "degraded"`

The database is not responding. Check disk space and that the data directory is accessible.

### Rate limited (429)

IP-based rate limits protect registration (10 attempts/15 min), subscribe (5/min), push (30/min), and pull (60/min). Wait for the `Retry-After` header duration, or restart the server to clear rate limit state.

### Large payloads rejected

The server enforces a 10MB body limit. If your collections exceed this, consider splitting them into smaller channels.
