import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import {
  buildApp,
  teardown,
  registerInstance,
  publishChannel,
  makeRequest,
  makeCollection,
  TEST_PASSPHRASE,
} from './setup.js';

describe('Full sync flow', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let subscriberToken: string;
  let channelId: string;
  const requests = [
    makeRequest({ id: 'req-1', name: 'Get Users' }),
    makeRequest({ id: 'req-2', name: 'Create User' }),
  ];

  before(async () => {
    app = await buildApp();
  });
  after(async () => teardown(app));

  it('registers instances', async () => {
    ownerToken = await registerInstance(app, 'Owner Instance');
    subscriberToken = await registerInstance(app, 'Subscriber Instance');
    assert.ok(ownerToken);
    assert.ok(subscriberToken);
    assert.notEqual(ownerToken, subscriberToken);
  });

  it('publishes a channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { 'x-instance-token': ownerToken },
      payload: { collection: makeCollection({ name: 'My API' }), requests },
    });
    assert.equal(res.statusCode, 201);
    channelId = JSON.parse(res.payload).channelId;
    assert.ok(channelId);
  });

  it('subscriber subscribes to the channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/subscribe`,
      headers: { 'x-instance-token': subscriberToken },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.name, 'My API');
    assert.equal(body.version, 1);
  });

  it('subscriber pulls full state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/state`,
      headers: { 'x-instance-token': subscriberToken },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.version, 1);
    assert.equal(body.requests.length, 2);
    assert.equal(body.collection.name, 'My API');
  });

  it('owner checks version', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/version`,
      headers: { 'x-instance-token': ownerToken },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.version, 1);
    assert.ok(body.updatedAt);
  });

  it('owner pushes changes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/push`,
      headers: { 'x-instance-token': ownerToken },
      payload: {
        baseVersion: 1,
        changes: {
          requests: {
            added: [makeRequest({ id: 'req-3', name: 'Delete User' })],
            modified: [makeRequest({ id: 'req-1', name: 'Get Users V2', url: 'https://example.com/v2/users' })],
            deleted: ['req-2'],
          },
        },
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.version, 2);
  });

  it('subscriber sees new version', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/version`,
      headers: { 'x-instance-token': subscriberToken },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.payload).version, 2);
  });

  it('subscriber pulls incremental changes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/changes?since=1`,
      headers: { 'x-instance-token': subscriberToken },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.currentVersion, 2);
    // req-1 modified + req-3 added = 2 non-deleted requests
    assert.equal(body.changes.requests.length, 2);
    // req-2 deleted
    assert.deepEqual(body.changes.deleted, ['req-2']);
  });

  it('subscriber gets change summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/changes/summary?since=1`,
      headers: { 'x-instance-token': subscriberToken },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.currentVersion, 2);
    assert.equal(body.changed, 2);
    assert.equal(body.deleted, 1);
  });

  it('full state reflects pushed changes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/state`,
      headers: { 'x-instance-token': ownerToken },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.version, 2);
    // req-1 (modified) + req-3 (added) — req-2 deleted
    assert.equal(body.requests.length, 2);
    const names = body.requests.map((r: any) => r.name).sort();
    assert.deepEqual(names, ['Delete User', 'Get Users V2']);
  });

  it('owner can push collection metadata update', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/push`,
      headers: { 'x-instance-token': ownerToken },
      payload: {
        baseVersion: 2,
        changes: {
          collection: makeCollection({ name: 'My API v2' }),
          requests: { added: [], modified: [], deleted: [] },
        },
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.payload).version, 3);

    // Verify collection was updated
    const state = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/state`,
      headers: { 'x-instance-token': ownerToken },
    });
    assert.equal(JSON.parse(state.payload).collection.name, 'My API v2');
  });
});

describe('Push authorization', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let subscriberToken: string;
  let readonlyChannelId: string;
  let readwriteChannelId: string;

  before(async () => {
    app = await buildApp();
    ownerToken = await registerInstance(app, 'owner');
    subscriberToken = await registerInstance(app, 'subscriber');

    readonlyChannelId = await publishChannel(app, ownerToken);
    readwriteChannelId = await publishChannel(app, ownerToken);

    // Make one channel readwrite
    await app.inject({
      method: 'PATCH',
      url: `/api/channels/${readwriteChannelId}/settings`,
      headers: { 'x-instance-token': ownerToken },
      payload: { mode: 'readwrite' },
    });

    // Subscribe the subscriber to both
    await app.inject({
      method: 'POST',
      url: `/api/channels/${readonlyChannelId}/subscribe`,
      headers: { 'x-instance-token': subscriberToken },
    });
    await app.inject({
      method: 'POST',
      url: `/api/channels/${readwriteChannelId}/subscribe`,
      headers: { 'x-instance-token': subscriberToken },
    });
  });

  after(async () => teardown(app));

  it('rejects subscriber push on readonly channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${readonlyChannelId}/push`,
      headers: { 'x-instance-token': subscriberToken },
      payload: {
        baseVersion: 1,
        changes: { requests: { added: [makeRequest()], modified: [], deleted: [] } },
      },
    });
    assert.equal(res.statusCode, 403);
  });

  it('allows subscriber push on readwrite channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${readwriteChannelId}/push`,
      headers: { 'x-instance-token': subscriberToken },
      payload: {
        baseVersion: 1,
        changes: { requests: { added: [makeRequest()], modified: [], deleted: [] } },
      },
    });
    assert.equal(res.statusCode, 200);
  });

  it('allows owner push on readonly channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${readonlyChannelId}/push`,
      headers: { 'x-instance-token': ownerToken },
      payload: {
        baseVersion: 1,
        changes: { requests: { added: [makeRequest()], modified: [], deleted: [] } },
      },
    });
    assert.equal(res.statusCode, 200);
  });

  it('rejects push from non-subscriber', async () => {
    const outsiderToken = await registerInstance(app, 'outsider');
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${readwriteChannelId}/push`,
      headers: { 'x-instance-token': outsiderToken },
      payload: {
        baseVersion: 1,
        changes: { requests: { added: [makeRequest()], modified: [], deleted: [] } },
      },
    });
    assert.equal(res.statusCode, 403);
  });
});
