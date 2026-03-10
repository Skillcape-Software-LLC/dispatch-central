import { FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/database.js';
import type { InstanceRecord } from '../types/central.js';

export function instanceAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const token = request.headers['x-instance-token'] as string | undefined;

  if (!token) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Missing X-Instance-Token header.' });
    return;
  }

  const db = getDb();
  const instance = db.prepare('SELECT * FROM instances WHERE token = ?').get(token) as
    | InstanceRecord
    | undefined;

  if (!instance) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid instance token.' });
    return;
  }

  db.prepare('UPDATE instances SET last_seen_at = datetime(\'now\') WHERE token = ?').run(token);

  request.instanceRecord = instance;
  done();
}
