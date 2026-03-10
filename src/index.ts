import path from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { initDatabase, closeDatabase, getDb } from './db/database.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { channelRoutes } from './routes/channels.js';
import { adminRoutes } from './routes/admin.js';
import { startMaintenanceTimer, stopMaintenanceTimer } from './services/maintenance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true } },
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB max payload
  });

  // Initialize database before routes (routes may use db at registration time)
  initDatabase();
  fastify.log.info('Database initialized');

  // Security headers
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // Standardized error handler — never leak internals in production
  fastify.setErrorHandler((error, request, reply) => {
    // Schema validation errors from Fastify
    if (error.validation) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: error.message,
      });
    }

    // Known HTTP errors (thrown by routes with statusCode)
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: error.name || 'Error',
        message: error.message,
      });
    }

    // Unexpected errors — log full detail, return safe message
    request.log.error(error, 'Unhandled error');
    return reply.code(500).send({
      error: 'InternalServerError',
      message: 'An unexpected error occurred.',
    });
  });

  // CORS — Central is a multi-client API server, allow all origins
  await fastify.register(import('@fastify/cors'), { origin: true });

  // API routes
  await fastify.register(healthRoutes);
  await fastify.register(instanceRoutes);
  await fastify.register(channelRoutes);
  await fastify.register(adminRoutes);

  // Serve admin UI static files
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'admin', 'dist'),
    prefix: '/admin/',
    decorateReply: false,
  });

  // Redirect /admin to /admin/
  fastify.get('/admin', async (_request, reply) => {
    return reply.redirect('/admin/');
  });

  // Start DB maintenance timer (cleanup old activity log + rate limit entries)
  startMaintenanceTimer(getDb());

  // Start listening
  await fastify.listen({ port: config.port, host: '0.0.0.0' });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info(`Received ${signal} — shutting down gracefully`);
    stopMaintenanceTimer();
    await fastify.close();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
