import { FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/database.js';

interface RateLimitOptions {
  prefix: string;
  maxAttempts: number;
  windowMs: number;
}

export function rateLimit(opts: RateLimitOptions) {
  return function rateLimitHandler(
    request: FastifyRequest,
    reply: FastifyReply,
    done: () => void,
  ): void {
    const db = getDb();
    const key = `${opts.prefix}:${request.ip}`;
    const now = new Date().toISOString();

    const row = db.prepare('SELECT * FROM rate_limits WHERE key = ?').get(key) as
      | { key: string; attempts: number; window_start: string; locked_until: string | null }
      | undefined;

    if (row) {
      // Check if currently locked
      if (row.locked_until && row.locked_until > now) {
        const retryAfterMs = new Date(row.locked_until).getTime() - Date.now();
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        reply
          .code(429)
          .header('Retry-After', String(retryAfterSec))
          .send({ error: 'RateLimited', message: 'Too many attempts. Try again later.' });
        return;
      }

      const windowStart = new Date(row.window_start).getTime();
      const windowExpired = Date.now() - windowStart > opts.windowMs;

      if (windowExpired) {
        // Reset window
        db.prepare('UPDATE rate_limits SET attempts = 1, window_start = ?, locked_until = NULL WHERE key = ?')
          .run(now, key);
      } else if (row.attempts + 1 > opts.maxAttempts) {
        // At limit — lock
        const lockedUntil = new Date(Date.now() + opts.windowMs).toISOString();
        db.prepare('UPDATE rate_limits SET locked_until = ? WHERE key = ?')
          .run(lockedUntil, key);
        const retryAfterSec = Math.ceil(opts.windowMs / 1000);
        reply
          .code(429)
          .header('Retry-After', String(retryAfterSec))
          .send({ error: 'RateLimited', message: 'Too many attempts. Try again later.' });
        return;
      } else {
        // Increment
        db.prepare('UPDATE rate_limits SET attempts = attempts + 1 WHERE key = ?')
          .run(key);
      }
    } else {
      // First attempt
      db.prepare('INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, 1, ?)')
        .run(key, now);
    }

    done();
  };
}
