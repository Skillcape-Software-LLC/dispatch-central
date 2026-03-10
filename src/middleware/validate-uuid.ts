import { FastifyReply, FastifyRequest } from 'fastify';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateIdParam(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const { id } = request.params as { id?: string };
  if (id && !UUID_RE.test(id)) {
    reply.code(400).send({ error: 'BadRequest', message: 'Invalid channel ID format.' });
    return;
  }
  done();
}

export function validateTokenParam(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const { token } = request.params as { token?: string };
  if (token && !UUID_RE.test(token)) {
    reply.code(400).send({ error: 'BadRequest', message: 'Invalid token format.' });
    return;
  }
  done();
}
