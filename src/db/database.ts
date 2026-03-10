import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function initDatabase(): void {
  // Ensure data directory exists
  fs.mkdirSync(config.dataDir, { recursive: true });

  const dbPath = path.join(config.dataDir, 'dispatch-central.db');
  db = new Database(dbPath);

  // Set pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Run migrations
  runMigrations(db);
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized — call initDatabase() first');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Read migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all()
      .map((row: any) => row.name as string)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });

    migrate();
  }
}
