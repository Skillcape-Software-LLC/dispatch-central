import crypto from 'crypto';
import { getDb } from '../db/database.js';
import type { ChannelRecord, ChannelRequestRecord } from '../types/central.js';
import type { CollectionDocument, RequestDocument } from '../types/dispatch.js';

export function createChannel(
  ownerToken: string,
  name: string,
  collection: CollectionDocument,
  requests: RequestDocument[],
): string {
  const db = getDb();
  const channelId = crypto.randomUUID();

  const insertChannel = db.prepare(
    `INSERT INTO channels (id, name, owner_token, mode, version, collection)
     VALUES (?, ?, ?, 'readonly', 1, ?)`,
  );

  const insertRequest = db.prepare(
    `INSERT INTO channel_requests (id, channel_id, data, version)
     VALUES (?, ?, ?, 1)`,
  );

  const tx = db.transaction(() => {
    insertChannel.run(channelId, name, ownerToken, JSON.stringify(collection));
    for (const req of requests) {
      insertRequest.run(req.id, channelId, JSON.stringify(req));
    }
  });

  tx();
  return channelId;
}

export function getChannel(channelId: string): ChannelRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRecord | undefined;
}

export function updateChannelSettings(channelId: string, settings: { mode: 'readonly' | 'readwrite' }): void {
  const db = getDb();
  db.prepare("UPDATE channels SET mode = ?, updated_at = datetime('now') WHERE id = ?")
    .run(settings.mode, channelId);
}

export function deleteChannel(channelId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
}

export function getChannelFullState(channelId: string): {
  collection: CollectionDocument;
  requests: RequestDocument[];
  version: number;
} {
  const db = getDb();
  const channel = db.prepare('SELECT collection, version FROM channels WHERE id = ?').get(channelId) as
    | { collection: string; version: number }
    | undefined;

  if (!channel) {
    throw new Error('Channel not found');
  }

  const rows = db.prepare(
    'SELECT data FROM channel_requests WHERE channel_id = ? AND deleted = 0',
  ).all(channelId) as { data: string }[];

  return {
    collection: JSON.parse(channel.collection),
    requests: rows.map((r) => JSON.parse(r.data)),
    version: channel.version,
  };
}

export function isOwner(channelId: string, instanceToken: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM channels WHERE id = ? AND owner_token = ?').get(channelId, instanceToken);
  return !!row;
}

export function isOwnerOrSubscriber(channelId: string, instanceToken: string): boolean {
  if (isOwner(channelId, instanceToken)) return true;
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM subscriptions WHERE channel_id = ? AND instance_token = ?',
  ).get(channelId, instanceToken);
  return !!row;
}

export function getChannelVersion(channelId: string): { version: number; updatedAt: string } | undefined {
  const db = getDb();
  const row = db.prepare('SELECT version, updated_at FROM channels WHERE id = ?').get(channelId) as
    | { version: number; updated_at: string }
    | undefined;
  if (!row) return undefined;
  return { version: row.version, updatedAt: row.updated_at };
}

export function pushChanges(
  channelId: string,
  changes: {
    collection?: CollectionDocument;
    requests: { added: RequestDocument[]; modified: RequestDocument[]; deleted: string[] };
  },
): number {
  const db = getDb();
  return db.transaction(() => {
    db.prepare("UPDATE channels SET version = version + 1, updated_at = datetime('now') WHERE id = ?")
      .run(channelId);
    const { version: newVersion } = db.prepare('SELECT version FROM channels WHERE id = ?')
      .get(channelId) as { version: number };

    if (changes.collection) {
      db.prepare('UPDATE channels SET collection = ? WHERE id = ?')
        .run(JSON.stringify(changes.collection), channelId);
    }

    const upsert = db.prepare(
      `INSERT INTO channel_requests (id, channel_id, data, version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(channel_id, id) DO UPDATE SET data = excluded.data, version = excluded.version, deleted = 0, updated_at = datetime('now')`,
    );
    for (const req of [...changes.requests.added, ...changes.requests.modified]) {
      upsert.run(req.id, channelId, JSON.stringify(req), newVersion);
    }

    if (changes.requests.deleted.length > 0) {
      const del = db.prepare(
        `UPDATE channel_requests SET deleted = 1, version = ?, updated_at = datetime('now')
         WHERE channel_id = ? AND id = ?`,
      );
      for (const id of changes.requests.deleted) {
        del.run(newVersion, channelId, id);
      }
    }

    return newVersion;
  })();
}

export function getChannelChanges(
  channelId: string,
  sinceVersion: number,
): {
  currentVersion: number;
  collection: CollectionDocument;
  changes: { requests: RequestDocument[]; deleted: string[] };
} {
  const db = getDb();
  const channel = db.prepare('SELECT collection, version FROM channels WHERE id = ?').get(channelId) as
    | { collection: string; version: number }
    | undefined;

  if (!channel) {
    throw new Error('Channel not found');
  }

  const rows = db.prepare(
    'SELECT id, data, deleted FROM channel_requests WHERE channel_id = ? AND version > ?',
  ).all(channelId, sinceVersion) as { id: string; data: string; deleted: number }[];

  const requests: RequestDocument[] = [];
  const deleted: string[] = [];

  for (const row of rows) {
    if (row.deleted) {
      deleted.push(row.id);
    } else {
      requests.push(JSON.parse(row.data));
    }
  }

  return {
    currentVersion: channel.version,
    collection: JSON.parse(channel.collection),
    changes: { requests, deleted },
  };
}

export function getChangeSummary(
  channelId: string,
  sinceVersion: number,
): { changed: number; deleted: number; currentVersion: number } {
  const db = getDb();
  const channel = db.prepare('SELECT version FROM channels WHERE id = ?').get(channelId) as
    | { version: number }
    | undefined;

  if (!channel) {
    throw new Error('Channel not found');
  }

  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN deleted = 0 THEN 1 ELSE 0 END) AS changed,
       SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deleted
     FROM channel_requests WHERE channel_id = ? AND version > ?`,
  ).get(channelId, sinceVersion) as { changed: number | null; deleted: number | null };

  return {
    changed: counts.changed ?? 0,
    deleted: counts.deleted ?? 0,
    currentVersion: channel.version,
  };
}
