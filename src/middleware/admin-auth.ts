import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { safeEqual } from './auth-utils.js';

export function adminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const token = request.headers['x-admin-token'] as string | undefined;

  if (!token) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Missing X-Admin-Token header.' });
    return;
  }

  if (!safeEqual(token, config.adminToken)) {
    reply.code(403).send({ error: 'Forbidden', message: 'Invalid admin token.' });
    return;
  }

  done();
}
