# Contributing

## Project Structure

```
src/
├── index.ts              # Server bootstrap, middleware, static files
├── config.ts             # Environment variable validation
├── types/
│   ├── central.ts        # Server types (InstanceRecord, ChannelRecord, etc.)
│   └── dispatch.ts       # Dispatch app types (RequestDocument, CollectionDocument)
├── db/
│   ├── database.ts       # SQLite init, migrations, connection
│   └── migrations/       # Versioned SQL migration files
├── middleware/
│   ├── auth.ts           # Instance token authentication
│   ├── admin-auth.ts     # Admin token authentication
│   ├── auth-utils.ts     # Constant-time comparison
│   ├── rate-limit.ts     # IP-based rate limiting
│   └── validate-uuid.ts  # UUID path parameter validation
├── services/
│   ├── channels.ts       # Channel CRUD, push, pull, version queries
│   ├── subscriptions.ts  # Subscribe/unsubscribe, list, pull tracking
│   ├── activity.ts       # Activity logging
│   └── maintenance.ts    # Periodic DB cleanup
├── routes/
│   ├── health.ts         # GET /api/health
│   ├── instances.ts      # POST /api/instances/register
│   ├── channels.ts       # Channel, subscription, and sync endpoints
│   └── admin.ts          # Admin API endpoints
├── admin/dist/
│   ├── index.html        # Admin dashboard SPA
│   └── admin.js          # Admin UI logic
└── test/
    ├── setup.ts           # Test harness (buildApp, helpers, fixtures)
    ├── auth.test.ts       # Registration, auth, access control tests
    ├── admin.test.ts      # Admin API tests
    ├── health.test.ts     # Health and validation tests
    └── integration.test.ts # Full sync flow and push authorization tests
```

## Development Workflow

```bash
npm install              # Install dependencies
npm run dev              # Start with file watching (tsx)
npm test                 # Run all tests
npm run build            # Compile TypeScript to dist/
```

## Architecture Conventions

### Layers

- **Routes** handle HTTP concerns: parse params, validate schemas, call services, format responses
- **Services** contain business logic and database queries. They are synchronous (better-sqlite3 is sync)
- **Middleware** runs as Fastify `preHandler` hooks for auth, rate limiting, and validation

### Database

- SQLite via `better-sqlite3` (synchronous API)
- Migrations are versioned SQL files in `src/db/migrations/` (e.g., `001-initial.sql`)
- Add new migrations with the next sequential number. They run automatically on startup.
- Foreign keys are enforced (`PRAGMA foreign_keys = ON`)
- Write operations that touch multiple tables should use transactions

### Error Responses

All errors follow a consistent format:

```json
{ "error": "ErrorType", "message": "Human-readable description." }
```

Common error types: `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `RateLimited`, `InternalServerError`.

### Auth Flow

1. Requests hit `preHandler` middleware in order: UUID validation, instance/admin auth, rate limiting
2. Instance auth reads `X-Instance-Token`, validates against `instances` table, attaches `request.instanceRecord`
3. Route handlers check ownership/subscription via service functions (`isOwner`, `isOwnerOrSubscriber`)

## Writing Tests

Tests use Node's built-in test runner with Fastify's `inject()` method (no real HTTP server needed).

### Test Setup

Each test file imports from `src/test/setup.ts` which provides:

- `buildApp()` — creates a Fastify instance with a fresh SQLite DB in a temp directory
- `teardown(app)` — closes the app and cleans up
- `registerInstance(app, name)` — shorthand to register and return a token
- `publishChannel(app, token)` — shorthand to publish and return a channel ID
- `makeRequest()` / `makeCollection()` — fixture factories

### Running Tests

```bash
npm test                                          # All tests
npx cross-env PASSPHRASE=x ADMIN_TOKEN=x node --import tsx/esm --test src/test/auth.test.ts  # Single file
```

### Adding Tests

1. Create `src/test/your-feature.test.ts`
2. Import `buildApp`, `teardown`, and helpers from `./setup.js`
3. Use `before`/`after` hooks to manage the app lifecycle
4. Each `describe` block should call `buildApp()` in `before` and `teardown()` in `after` for isolation

## Admin UI

The admin UI is vanilla HTML/CSS/JS with Bootstrap 5.3 (dark theme). No build step — edit files directly in `src/admin/dist/`. They're copied to `dist/admin/dist/` by the postbuild script.

## Adding a New Endpoint

1. Add the service function to the appropriate file in `src/services/`
2. Add the route handler in `src/routes/`, including schema validation and middleware
3. Add tests in `src/test/`
4. Run `npm test` and `npm run build` to verify
