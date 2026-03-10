import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { getDb } from '../db/database.js';
import { config } from '../config.js';
import { safeEqual } from '../middleware/auth-utils.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { instanceAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';

const registerSchema = {
  body: {
    type: 'object' as const,
    required: ['name'],
    properties: {
      name: { type: 'string' as const, minLength: 1, maxLength: 100 },
    },
    additionalProperties: false,
  },
};

export async function instanceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/instances/register',
    {
      schema: registerSchema,
      preHandler: rateLimit({ prefix: 'register', maxAttempts: 10, windowMs: 15 * 60 * 1000 }),
    },
    async (request, reply) => {
      const passphrase = request.headers['x-passphrase'] as string | undefined;

      if (!passphrase || !safeEqual(passphrase, config.passphrase)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Invalid passphrase.' });
      }

      const { name } = request.body as { name: string };
      const token = crypto.randomUUID();

      const db = getDb();
      db.prepare('INSERT INTO instances (token, name) VALUES (?, ?)').run(token, name);

      logActivity('register', token, null, { name });

      return reply.code(201).send({ token });
    },
  );

  // GET /api/instances/me — Confirm token is valid, return instance info
  fastify.get(
    '/api/instances/me',
    { preHandler: instanceAuth },
    async (request, reply) => {
      const instance = request.instanceRecord!;
      return reply.send({
        name: instance.name,
        registeredAt: instance.registered_at,
        lastSeenAt: instance.last_seen_at,
      });
    },
  );
}
