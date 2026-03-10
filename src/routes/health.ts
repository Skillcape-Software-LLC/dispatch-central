import fs from 'fs';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { config } from '../config.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/health', async () => {
    // DB connectivity check
    let dbOk = false;
    try {
      const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      dbOk = row?.ok === 1;
    } catch {
      // DB not accessible
    }

    // Storage stats
    const dbPath = path.join(config.dataDir, 'dispatch-central.db');
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(dbPath).size;
    } catch {
      // file may not exist yet
    }

    return {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      db: dbOk,
      dbSizeBytes,
    };
  });
}
