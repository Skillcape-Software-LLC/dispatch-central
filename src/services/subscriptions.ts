import { getDb } from '../db/database.js';

export function subscribe(channelId: string, instanceToken: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO subscriptions (channel_id, instance_token) VALUES (?, ?)',
  ).run(channelId, instanceToken);
}

export function unsubscribe(channelId: string, instanceToken: string): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM subscriptions WHERE channel_id = ? AND instance_token = ?',
  ).run(channelId, instanceToken);
}

export function isSubscribed(channelId: string, instanceToken: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM subscriptions WHERE channel_id = ? AND instance_token = ?',
  ).get(channelId, instanceToken);
  return !!row;
}

export function listSubscriptions(instanceToken: string): {
  channelId: string;
  name: string;
  mode: string;
  version: number;
  subscribedAt: string;
  lastPullVersion: number;
}[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.id AS channelId, c.name, c.mode, c.version,
            s.subscribed_at AS subscribedAt, s.last_pull_version AS lastPullVersion
     FROM subscriptions s
     JOIN channels c ON c.id = s.channel_id
     WHERE s.instance_token = ?`,
  ).all(instanceToken) as any[];
  return rows;
}

export function updateLastPullVersion(channelId: string, instanceToken: string, version: number): void {
  const db = getDb();
  db.prepare(
    'UPDATE subscriptions SET last_pull_version = ? WHERE channel_id = ? AND instance_token = ?',
  ).run(version, channelId, instanceToken);
}
