import fs from 'fs';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { validateIdParam, validateTokenParam } from '../middleware/validate-uuid.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/admin/dashboard — Overview stats
  fastify.get(
    '/api/admin/dashboard',
    { preHandler: adminAuth },
    async (_request, reply) => {
      const db = getDb();

      const instances = db.prepare('SELECT COUNT(*) AS count FROM instances').get() as { count: number };
      const channels = db.prepare('SELECT COUNT(*) AS count FROM channels').get() as { count: number };
      const subscriptions = db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get() as { count: number };

      // DB file size
      const dbPath = path.join(config.dataDir, 'dispatch-central.db');
      let dbSizeBytes = 0;
      try {
        const stat = fs.statSync(dbPath);
        dbSizeBytes = stat.size;
      } catch {
        // file may not exist in edge cases
      }

      // Recent activity (last 10)
      const recentActivity = db.prepare(
        `SELECT id, event_type, instance_token, channel_id, metadata, created_at
         FROM activity_log ORDER BY id DESC LIMIT 10`,
      ).all() as {
        id: number;
        event_type: string;
        instance_token: string | null;
        channel_id: string | null;
        metadata: string | null;
        created_at: string;
      }[];

      return reply.send({
        instances: instances.count,
        channels: channels.count,
        subscriptions: subscriptions.count,
        dbSizeBytes,
        recentActivity: recentActivity.map((a) => ({
          id: a.id,
          eventType: a.event_type,
          instanceToken: a.instance_token,
          channelId: a.channel_id,
          metadata: a.metadata ? JSON.parse(a.metadata) : null,
          createdAt: a.created_at,
        })),
      });
    },
  );

  // GET /api/admin/instances — List all instances
  fastify.get(
    '/api/admin/instances',
    { preHandler: adminAuth },
    async (_request, reply) => {
      const db = getDb();
      const rows = db.prepare(
        `SELECT i.token, i.name, i.registered_at, i.last_seen_at,
                (SELECT COUNT(*) FROM channels WHERE owner_token = i.token) AS owned_channels,
                (SELECT COUNT(*) FROM subscriptions WHERE instance_token = i.token) AS subscriptions
         FROM instances i
         ORDER BY i.registered_at DESC`,
      ).all() as {
        token: string;
        name: string;
        registered_at: string;
        last_seen_at: string;
        owned_channels: number;
        subscriptions: number;
      }[];

      return reply.send(
        rows.map((r) => ({
          token: r.token,
          tokenPrefix: r.token.substring(0, 8),
          name: r.name,
          registeredAt: r.registered_at,
          lastSeenAt: r.last_seen_at,
          ownedChannels: r.owned_channels,
          subscriptions: r.subscriptions,
        })),
      );
    },
  );

  // DELETE /api/admin/instances/:token — Revoke an instance
  fastify.delete(
    '/api/admin/instances/:token',
    { preHandler: [validateTokenParam, adminAuth] },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const db = getDb();

      const instance = db.prepare('SELECT 1 FROM instances WHERE token = ?').get(token);
      if (!instance) {
        return reply.code(404).send({ error: 'NotFound', message: 'Instance not found.' });
      }

      // Remove subscriptions, then the instance. Owned channels become orphaned (not deleted).
      db.transaction(() => {
        db.prepare('DELETE FROM subscriptions WHERE instance_token = ?').run(token);
        db.prepare('DELETE FROM instances WHERE token = ?').run(token);
      })();

      return reply.code(204).send();
    },
  );

  // GET /api/admin/channels — List all channels (admin view)
  fastify.get(
    '/api/admin/channels',
    { preHandler: adminAuth },
    async (_request, reply) => {
      const db = getDb();
      const rows = db.prepare(
        `SELECT c.id, c.name, c.owner_token, c.mode, c.version, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM subscriptions WHERE channel_id = c.id) AS subscriber_count,
                (SELECT COUNT(*) FROM channel_requests WHERE channel_id = c.id AND deleted = 0) AS request_count,
                i.name AS owner_name
         FROM channels c
         LEFT JOIN instances i ON i.token = c.owner_token
         ORDER BY c.created_at DESC`,
      ).all() as {
        id: string;
        name: string;
        owner_token: string;
        mode: string;
        version: number;
        created_at: string;
        updated_at: string;
        subscriber_count: number;
        request_count: number;
        owner_name: string | null;
      }[];

      return reply.send(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          ownerToken: r.owner_token,
          ownerTokenPrefix: r.owner_token.substring(0, 8),
          ownerName: r.owner_name,
          mode: r.mode,
          version: r.version,
          subscriberCount: r.subscriber_count,
          requestCount: r.request_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      );
    },
  );

  // PATCH /api/admin/channels/:id/owner — Reassign channel ownership
  fastify.patch(
    '/api/admin/channels/:id/owner',
    { preHandler: [validateIdParam, adminAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { ownerToken } = request.body as { ownerToken?: string };

      if (!ownerToken || typeof ownerToken !== 'string') {
        return reply.code(400).send({ error: 'BadRequest', message: 'ownerToken is required.' });
      }

      const db = getDb();

      const channel = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      const instance = db.prepare('SELECT 1 FROM instances WHERE token = ?').get(ownerToken);
      if (!instance) {
        return reply.code(404).send({ error: 'NotFound', message: 'Target instance not found.' });
      }

      db.prepare('UPDATE channels SET owner_token = ? WHERE id = ?').run(ownerToken, id);

      return reply.code(200).send({ message: 'Ownership reassigned.' });
    },
  );

  // DELETE /api/admin/channels/:id — Force-delete a channel
  fastify.delete(
    '/api/admin/channels/:id',
    { preHandler: [validateIdParam, adminAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const channel = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id);
      if (!channel) {
        return reply.code(404).send({ error: 'NotFound', message: 'Channel not found.' });
      }

      // CASCADE handles channel_requests and subscriptions
      db.prepare('DELETE FROM channels WHERE id = ?').run(id);

      return reply.code(204).send();
    },
  );

  // GET /api/admin/activity — Paginated activity log
  fastify.get(
    '/api/admin/activity',
    { preHandler: adminAuth },
    async (request, reply) => {
      const query = request.query as {
        type?: string;
        limit?: string;
        offset?: string;
        channelId?: string;
        instanceToken?: string;
      };

      const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
      const offset = parseInt(query.offset || '0', 10) || 0;

      const db = getDb();

      // Build dynamic WHERE clauses
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.type) {
        conditions.push('event_type = ?');
        params.push(query.type);
      }
      if (query.channelId) {
        conditions.push('channel_id = ?');
        params.push(query.channelId);
      }
      if (query.instanceToken) {
        conditions.push('instance_token = ?');
        params.push(query.instanceToken);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const rows = db.prepare(
        `SELECT id, event_type, instance_token, channel_id, metadata, created_at
         FROM activity_log ${where}
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      ).all(...params, limit, offset) as {
        id: number;
        event_type: string;
        instance_token: string | null;
        channel_id: string | null;
        metadata: string | null;
        created_at: string;
      }[];

      const totalRow = db.prepare(
        `SELECT COUNT(*) AS count FROM activity_log ${where}`,
      ).get(...params) as { count: number };

      return reply.send({
        total: totalRow.count,
        limit,
        offset,
        events: rows.map((a) => ({
          id: a.id,
          eventType: a.event_type,
          instanceToken: a.instance_token,
          channelId: a.channel_id,
          metadata: a.metadata ? JSON.parse(a.metadata) : null,
          createdAt: a.created_at,
        })),
      });
    },
  );
}
