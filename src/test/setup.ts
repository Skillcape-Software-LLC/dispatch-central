import Fastify, { FastifyInstance } from 'fastify';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Each test file gets a unique DATA_DIR on first buildApp() call.
// This avoids DB conflicts between test suites.

import { initDatabase, closeDatabase } from '../db/database.js';
import { healthRoutes } from '../routes/health.js';
import { instanceRoutes } from '../routes/instances.js';
import { channelRoutes } from '../routes/channels.js';
import { adminRoutes } from '../routes/admin.js';
import type { CollectionDocument, RequestDocument } from '../types/dispatch.js';

export const TEST_PASSPHRASE = process.env.PASSPHRASE!;
export const TEST_ADMIN_TOKEN = process.env.ADMIN_TOKEN!;

let currentTestDir: string | null = null;

export async function buildApp(): Promise<FastifyInstance> {
  // Create a fresh temp dir + DB for each app instance
  currentTestDir = path.join(os.tmpdir(), `dc-test-${crypto.randomUUID()}`);
  fs.mkdirSync(currentTestDir, { recursive: true });
  process.env.DATA_DIR = currentTestDir;

  // Re-import config to pick up new DATA_DIR — but config is cached.
  // Instead, we directly set the data dir and re-init the database.
  // The config module already evaluated, so we patch it:
  const { config } = await import('../config.js');
  (config as any).dataDir = currentTestDir;

  initDatabase();

  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  await app.register(instanceRoutes);
  await app.register(channelRoutes);
  await app.register(adminRoutes);

  return app;
}

export async function teardown(app: FastifyInstance): Promise<void> {
  await app.close();
  closeDatabase();
  if (currentTestDir) {
    try {
      fs.rmSync(currentTestDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
    currentTestDir = null;
  }
}

/** Register an instance and return its token. */
export async function registerInstance(app: FastifyInstance, name = 'test-instance'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/instances/register',
    headers: { 'x-passphrase': TEST_PASSPHRASE },
    payload: { name },
  });
  return JSON.parse(res.payload).token;
}

/** Publish a channel and return its ID. */
export async function publishChannel(
  app: FastifyInstance,
  token: string,
  opts?: { collection?: Partial<CollectionDocument>; requests?: Partial<RequestDocument>[] },
): Promise<string> {
  const collection = makeCollection(opts?.collection);
  const requests = opts?.requests?.map((r) => makeRequest(r)) ?? [makeRequest()];

  const res = await app.inject({
    method: 'POST',
    url: '/api/channels',
    headers: { 'x-instance-token': token },
    payload: { collection, requests },
  });
  return JSON.parse(res.payload).channelId;
}

export function makeCollection(overrides?: Partial<CollectionDocument>): CollectionDocument {
  return {
    id: crypto.randomUUID(),
    name: 'Test Collection',
    description: 'A test collection',
    folders: [],
    auth: { type: 'none' },
    variables: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeRequest(overrides?: Partial<RequestDocument>): RequestDocument {
  return {
    id: crypto.randomUUID(),
    name: 'Test Request',
    method: 'GET',
    url: 'https://example.com/api',
    headers: [],
    params: [],
    body: { mode: 'none', content: '' },
    auth: { type: 'none' },
    collectionId: 'col-1',
    folderId: null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
