import type Database from 'better-sqlite3';

const INTERVAL_MS = 60 * 60 * 1000; // Run every hour
const ACTIVITY_RETENTION_DAYS = 30;

let timer: ReturnType<typeof setInterval> | null = null;

export function runMaintenance(db: Database.Database): void {
  // Delete activity log entries older than retention period
  db.prepare(
    `DELETE FROM activity_log WHERE created_at < datetime('now', ?)`,
  ).run(`-${ACTIVITY_RETENTION_DAYS} days`);

  // Delete expired rate limit entries (window expired and not locked, or lock expired)
  db.prepare(
    `DELETE FROM rate_limits
     WHERE (locked_until IS NOT NULL AND locked_until < datetime('now'))
        OR (locked_until IS NULL AND window_start < datetime('now', '-1 hour'))`,
  ).run();
}

export function startMaintenanceTimer(db: Database.Database): void {
  // Run once on startup
  runMaintenance(db);
  // Then periodically
  timer = setInterval(() => runMaintenance(db), INTERVAL_MS);
}

export function stopMaintenanceTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
