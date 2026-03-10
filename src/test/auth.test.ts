import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import {
  buildApp,
  teardown,
  registerInstance,
  publishChannel,
  TEST_PASSPHRASE,
} from './setup.js';

describe('Instance registration', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildApp(); });
  after(async () => teardown(app));

  it('registers with correct passphrase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: { 'x-passphrase': TEST_PASSPHRASE },
      payload: { name: 'My Instance' },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.ok(body.token);
    assert.match(body.token, /^[0-9a-f-]{36}$/);
  });

  it('rejects wrong passphrase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: { 'x-passphrase': 'wrong' },
      payload: { name: 'Bad Instance' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('rejects missing passphrase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      payload: { name: 'No Pass Instance' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('rejects empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: { 'x-passphrase': TEST_PASSPHRASE },
      payload: { name: '' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects missing body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: { 'x-passphrase': TEST_PASSPHRASE },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('Instance auth middleware', () => {
  let app: FastifyInstance;
  let token: string;

  before(async () => {
    app = await buildApp();
    token = await registerInstance(app);
  });
  after(async () => teardown(app));

  it('allows valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscriptions',
      headers: { 'x-instance-token': token },
    });
    assert.equal(res.statusCode, 200);
  });

  it('rejects missing token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscriptions',
    });
    assert.equal(res.statusCode, 401);
  });

  it('rejects invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscriptions',
      headers: { 'x-instance-token': '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('Channel access control', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let outsiderToken: string;
  let channelId: string;

  before(async () => {
    app = await buildApp();
    ownerToken = await registerInstance(app, 'owner');
    outsiderToken = await registerInstance(app, 'outsider');
    channelId = await publishChannel(app, ownerToken);
  });
  after(async () => teardown(app));

  it('owner can access channel metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}`,
      headers: { 'x-instance-token': ownerToken },
    });
    assert.equal(res.statusCode, 200);
  });

  it('non-subscriber cannot access channel metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}`,
      headers: { 'x-instance-token': outsiderToken },
    });
    assert.equal(res.statusCode, 403);
  });

  it('non-subscriber cannot pull state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/state`,
      headers: { 'x-instance-token': outsiderToken },
    });
    assert.equal(res.statusCode, 403);
  });

  it('non-owner cannot delete channel', async () => {
    const subToken = await registerInstance(app, 'sub');
    await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/subscribe`,
      headers: { 'x-instance-token': subToken },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/channels/${channelId}`,
      headers: { 'x-instance-token': subToken },
    });
    assert.equal(res.statusCode, 403);
  });

  it('non-owner cannot change settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/channels/${channelId}/settings`,
      headers: { 'x-instance-token': outsiderToken },
      payload: { mode: 'readwrite' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('rejects invalid UUID in path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/channels/not-a-uuid',
      headers: { 'x-instance-token': ownerToken },
    });
    assert.equal(res.statusCode, 400);
  });

  it('returns 404 for non-existent channel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/channels/00000000-0000-0000-0000-000000000000',
      headers: { 'x-instance-token': ownerToken },
    });
    assert.equal(res.statusCode, 404);
  });
});
