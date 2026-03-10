import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp, teardown } from './setup.js';

describe('Health endpoint', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildApp(); });
  after(async () => teardown(app));

  it('returns health status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.status, 'ok');
    assert.ok(body.timestamp);
    assert.equal(body.version, '0.1.0');
    assert.equal(body.db, true);
    assert.ok(typeof body.dbSizeBytes === 'number');
  });

  it('does not require authentication', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    assert.equal(res.statusCode, 200);
  });
});

describe('Validation', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildApp(); });
  after(async () => teardown(app));

  it('rejects invalid JSON body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: {
        'x-passphrase': 'test-passphrase',
        'content-type': 'application/json',
      },
      payload: 'not json{',
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects push with missing required fields', async () => {
    // Need a valid token first
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: { 'x-passphrase': 'test-passphrase' },
      payload: { name: 'validator-test' },
    });
    const token = JSON.parse(regRes.payload).token;

    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/00000000-0000-0000-0000-000000000000/push',
      headers: { 'x-instance-token': token },
      payload: { baseVersion: 1 },
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects changes query without since param', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/instances/register',
      headers: { 'x-passphrase': 'test-passphrase' },
      payload: { name: 'validator-test-2' },
    });
    const token = JSON.parse(regRes.payload).token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/channels/00000000-0000-0000-0000-000000000000/changes',
      headers: { 'x-instance-token': token },
    });
    assert.equal(res.statusCode, 400);
  });
});
