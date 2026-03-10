CREATE TABLE instances (
  token         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE channels (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_token   TEXT NOT NULL REFERENCES instances(token),
  mode          TEXT NOT NULL DEFAULT 'readonly',
  version       INTEGER NOT NULL DEFAULT 1,
  collection    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE channel_requests (
  id            TEXT NOT NULL,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  data          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, id)
);

CREATE TABLE subscriptions (
  channel_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  instance_token TEXT NOT NULL REFERENCES instances(token) ON DELETE CASCADE,
  subscribed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_pull_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, instance_token)
);

CREATE TABLE activity_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type     TEXT NOT NULL,
  instance_token TEXT,
  channel_id     TEXT,
  metadata       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL DEFAULT (datetime('now')),
  locked_until  TEXT
);
