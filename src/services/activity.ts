import { getDb } from '../db/database.js';

export function logActivity(
  type: string,
  instanceToken?: string | null,
  channelId?: string | null,
  metadata?: Record<string, unknown> | null,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO activity_log (event_type, instance_token, channel_id, metadata)
     VALUES (?, ?, ?, ?)`,
  ).run(
    type,
    instanceToken ?? null,
    channelId ?? null,
    metadata ? JSON.stringify(metadata) : null,
  );
}
