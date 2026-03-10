import { FastifyInstance } from 'fastify';
import { instanceAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateIdParam } from '../middleware/validate-uuid.js';
import { logActivity } from '../services/activity.js';
import {
  createChannel,
  getChannel,
  updateChannelSettings,
  deleteChannel,
  getChannelFullState,
  getChannelVersion,
  pushChanges,
  getChannelChanges,
  getChangeSummary,
  isOwner,
  isOwnerOrSubscriber,
} from '../services/channels.js';
import {
  subscribe,
  unsubscribe,
  listSubscriptions,
  updateLastPullVersion,
} from '../services/subscriptions.js';
import { getDb } from '../db/database.js';
import type { CollectionDocument, RequestDocument } from '../types/dispatch.js';

const publishSchema = {
  body: {
    type: 'object' as const,
    required: ['collection', 'requests'],
    properties: {
      collection: { type: 'object' as const },
      requests: { type: 'array' as const, items: { type: 'object' as const } },
    },
    additionalProperties: false,
  },
};

const settingsSchema = {
  body: {
    type: 'object' as const,
    required: ['mode'],
    properties: {
      mode: { type: 'string' as const, enum: ['readonly', 'readwrite'] },
    },
    additionalProperties: false,
  },
};

export async function channelRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/channels — Publish a collection as a channel
  fastify.post(
    '/api/channels',
    { schema: publishSchema, preHandler: instanceAuth },
    async (request, reply) => {
      const { collection, requests } = request.body as {
        collection: CollectionDocument;
        requests: RequestDocument[];
      };
      const token = request.instanceRecord!.token;

      const channelId = createChannel(token, collection.name, collection, requests);

      // Auto-subscribe the owner
      subscribe(channelId, token);

      logActivity('publish', token, channelId, { name: collection.name, requestCount: requests.length });

      return reply.code(201).send({ channelId });
    },
  );

  // GET /api/channels/:id — Channel metadata
  fastify.get(
    '/api/channels/:id',
    { preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwnerOrSubscriber(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not an owner or subscriber of this channel.' });
      }

      const db = getDb();
      const countRow = db.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE channel_id = ?').get(id) as { count: number };

      return reply.send({
        id: channel.id,
        name: channel.name,
        owner: channel.owner_token === token,
        mode: channel.mode,
        subscriberCount: countRow.count,
        version: channel.version,
        createdAt: channel.created_at,
        updatedAt: channel.updated_at,
      });
    },
  );

  // PATCH /api/channels/:id/settings — Update channel settings
  fastify.patch(
    '/api/channels/:id/settings',
    { schema: settingsSchema, preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwner(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the channel owner can change settings.' });
      }

      const { mode } = request.body as { mode: 'readonly' | 'readwrite' };
      updateChannelSettings(id, { mode });

      return reply.send({ ok: true });
    },
  );

  // DELETE /api/channels/:id — Delete channel
  fastify.delete(
    '/api/channels/:id',
    { preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwner(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the channel owner can delete this channel.' });
      }

      deleteChannel(id);
      logActivity('delete', token, id);

      return reply.code(204).send();
    },
  );

  // POST /api/channels/:id/subscribe — Subscribe to a channel
  fastify.post(
    '/api/channels/:id/subscribe',
    {
      preHandler: [
        validateIdParam,
        instanceAuth,
        rateLimit({ prefix: 'subscribe', maxAttempts: 5, windowMs: 60_000 }),
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      subscribe(id, token);
      logActivity('subscribe', token, id);

      return reply.send({
        channelId: channel.id,
        name: channel.name,
        mode: channel.mode,
        version: channel.version,
      });
    },
  );

  // DELETE /api/channels/:id/subscribe — Unsubscribe
  fastify.delete(
    '/api/channels/:id/subscribe',
    { preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      unsubscribe(id, token);
      logActivity('unsubscribe', token, id);

      return reply.code(204).send();
    },
  );

  // GET /api/subscriptions — List subscriptions for the authenticated instance
  fastify.get(
    '/api/subscriptions',
    { preHandler: instanceAuth },
    async (request, reply) => {
      const token = request.instanceRecord!.token;
      const subs = listSubscriptions(token);
      return reply.send(subs);
    },
  );

  // GET /api/channels/:id/state — Full state pull
  fastify.get(
    '/api/channels/:id/state',
    { preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwnerOrSubscriber(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not an owner or subscriber of this channel.' });
      }

      const state = getChannelFullState(id);

      updateLastPullVersion(id, token, state.version);
      logActivity('pull', token, id, { version: state.version });

      return reply.send(state);
    },
  );

  // GET /api/channels/:id/version — Lightweight version check
  fastify.get(
    '/api/channels/:id/version',
    { preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwnerOrSubscriber(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not an owner or subscriber of this channel.' });
      }

      const versionInfo = getChannelVersion(id);
      return reply.send(versionInfo);
    },
  );

  // POST /api/channels/:id/push — Push changes
  fastify.post(
    '/api/channels/:id/push',
    {
      schema: {
        body: {
          type: 'object' as const,
          required: ['baseVersion', 'changes'],
          properties: {
            baseVersion: { type: 'integer' as const },
            changes: {
              type: 'object' as const,
              required: ['requests'],
              properties: {
                collection: { type: 'object' as const },
                requests: {
                  type: 'object' as const,
                  required: ['added', 'modified', 'deleted'],
                  properties: {
                    added: { type: 'array' as const, items: { type: 'object' as const } },
                    modified: { type: 'array' as const, items: { type: 'object' as const } },
                    deleted: { type: 'array' as const, items: { type: 'string' as const } },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      preHandler: [
        validateIdParam,
        instanceAuth,
        rateLimit({ prefix: 'push', maxAttempts: 30, windowMs: 60_000 }),
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (channel.mode === 'readonly' && !isOwner(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the owner can push to a readonly channel.' });
      }

      if (!isOwnerOrSubscriber(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not an owner or subscriber of this channel.' });
      }

      const { changes } = request.body as {
        baseVersion: number;
        changes: {
          collection?: CollectionDocument;
          requests: { added: RequestDocument[]; modified: RequestDocument[]; deleted: string[] };
        };
      };

      const newVersion = pushChanges(id, changes);

      logActivity('push', token, id, {
        added: changes.requests.added.length,
        modified: changes.requests.modified.length,
        deleted: changes.requests.deleted.length,
        version: newVersion,
      });

      return reply.send({ version: newVersion });
    },
  );

  // GET /api/channels/:id/changes — Incremental pull
  fastify.get(
    '/api/channels/:id/changes',
    { preHandler: [validateIdParam, instanceAuth, rateLimit({ prefix: 'pull', maxAttempts: 60, windowMs: 60_000 })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;
      const { since } = request.query as { since?: string };

      if (since === undefined || since === '') {
        return reply.code(400).send({ error: 'BadRequest', message: 'Query parameter "since" is required.' });
      }

      const sinceVersion = parseInt(since, 10);
      if (isNaN(sinceVersion) || sinceVersion < 0) {
        return reply.code(400).send({ error: 'BadRequest', message: '"since" must be a non-negative integer.' });
      }

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwnerOrSubscriber(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not an owner or subscriber of this channel.' });
      }

      const result = getChannelChanges(id, sinceVersion);

      updateLastPullVersion(id, token, result.currentVersion);
      logActivity('pull', token, id, { sinceVersion, currentVersion: result.currentVersion });

      return reply.send(result);
    },
  );

  // GET /api/channels/:id/changes/summary — Change summary
  fastify.get(
    '/api/channels/:id/changes/summary',
    { preHandler: [validateIdParam, instanceAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const token = request.instanceRecord!.token;
      const { since } = request.query as { since?: string };

      if (since === undefined || since === '') {
        return reply.code(400).send({ error: 'BadRequest', message: 'Query parameter "since" is required.' });
      }

      const sinceVersion = parseInt(since, 10);
      if (isNaN(sinceVersion) || sinceVersion < 0) {
        return reply.code(400).send({ error: 'BadRequest', message: '"since" must be a non-negative integer.' });
      }

      const channel = getChannel(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      if (!isOwnerOrSubscriber(id, token)) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not an owner or subscriber of this channel.' });
      }

      const summary = getChangeSummary(id, sinceVersion);
      return reply.send(summary);
    },
  );
}
