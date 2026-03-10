export interface InstanceRecord {
  token: string;
  name: string;
  registered_at: string;
  last_seen_at: string;
}

export interface ChannelRecord {
  id: string;
  name: string;
  owner_token: string;
  mode: 'readonly' | 'readwrite';
  version: number;
  collection: string; // JSON: CollectionDocument
  created_at: string;
  updated_at: string;
}

export interface ChannelRequestRecord {
  id: string;
  channel_id: string;
  data: string; // JSON: RequestDocument
  version: number;
  updated_at: string;
  deleted: number; // 0 | 1
}

export interface SubscriptionRecord {
  channel_id: string;
  instance_token: string;
  subscribed_at: string;
  last_pull_version: number;
}

export interface ActivityEvent {
  id: number;
  event_type: 'register' | 'publish' | 'subscribe' | 'push' | 'pull' | 'unsubscribe';
  instance_token: string | null;
  channel_id: string | null;
  metadata: string | null; // JSON
  created_at: string;
}

export interface RateLimitRecord {
  key: string;
  attempts: number;
  window_start: string;
  locked_until: string | null;
}

export interface ChangeEntry {
  added: import('./dispatch.js').RequestDocument[];
  modified: import('./dispatch.js').RequestDocument[];
  deleted: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    instanceRecord?: InstanceRecord;
  }
}
