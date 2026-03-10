import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import {
  buildApp,
  teardown,
  registerInstance,
  publishChannel,
  TEST_ADMIN_TOKEN,
} from './setup.js';

describe('Admin API', () => {
  let app: FastifyInstance;
  let instanceToken: string;
  let channelId: string;

  before(async () => {
    app = await buildApp();
    instanceToken = await registerInstance(app, 'admin-test-instance');
    channelId = await publishChannel(app, instanceToken);
  });
  after(async () => teardown(app));

  it('rejects requests without admin token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
    });
    assert.equal(res.statusCode, 401);
  });

  it('rejects invalid admin token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: { 'x-admin-token': 'wrong-token' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('returns dashboard stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.instances >= 1);
    assert.ok(body.channels >= 1);
    assert.ok(typeof body.dbSizeBytes === 'number');
    assert.ok(Array.isArray(body.recentActivity));
  });

  it('lists instances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/instances',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.length >= 1);
    const inst = body.find((i: any) => i.token === instanceToken);
    assert.ok(inst);
    assert.equal(inst.name, 'admin-test-instance');
    assert.ok(inst.tokenPrefix);
  });

  it('lists channels', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/channels',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.length >= 1);
    const ch = body.find((c: any) => c.id === channelId);
    assert.ok(ch);
    assert.equal(ch.ownerToken, instanceToken);
  });

  it('returns paginated activity log', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/activity?limit=5&offset=0',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(typeof body.total === 'number');
    assert.ok(Array.isArray(body.events));
    assert.ok(body.events.length <= 5);
  });

  it('filters activity by type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/activity?type=publish',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    for (const e of body.events) {
      assert.equal(e.eventType, 'publish');
    }
  });

  it('reassigns channel ownership', async () => {
    const newOwner = await registerInstance(app, 'new-owner-instance');
    const tempChannel = await publishChannel(app, instanceToken);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/channels/${tempChannel}/owner`,
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
      payload: { ownerToken: newOwner },
    });
    assert.equal(res.statusCode, 200);

    // Verify ownership changed
    const channels = await app.inject({
      method: 'GET',
      url: '/api/admin/channels',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    const body = JSON.parse(channels.payload);
    const ch = body.find((c: any) => c.id === tempChannel);
    assert.equal(ch.ownerToken, newOwner);
  });

  it('rejects reassign to non-existent instance', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/channels/${channelId}/owner`,
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
      payload: { ownerToken: '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.equal(body.message, 'Target instance not found.');
  });

  it('force-deletes a channel', async () => {
    const tempChannel = await publishChannel(app, instanceToken);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/channels/${tempChannel}`,
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 204);

    // Verify it's gone
    const check = await app.inject({
      method: 'GET',
      url: `/api/channels/${tempChannel}`,
      headers: { 'x-instance-token': instanceToken },
    });
    assert.equal(check.statusCode, 404);
  });

  it('revokes an instance', async () => {
    const tempToken = await registerInstance(app, 'temp-instance');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/instances/${tempToken}`,
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    assert.equal(res.statusCode, 204);

    // Verify the instance can no longer auth
    const check = await app.inject({
      method: 'GET',
      url: '/api/subscriptions',
      headers: { 'x-instance-token': tempToken },
    });
    assert.equal(check.statusCode, 401);
  });
});
