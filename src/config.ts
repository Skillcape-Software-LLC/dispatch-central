interface Config {
  port: number;
  dataDir: string;
  logLevel: string;
  passphrase: string;
  adminToken: string;
  isProduction: boolean;
}

function loadConfig(): Config {
  const passphrase = process.env.PASSPHRASE;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!passphrase) {
    console.error('FATAL: PASSPHRASE environment variable is required');
    process.exit(1);
  }

  if (!adminToken) {
    console.error('FATAL: ADMIN_TOKEN environment variable is required');
    process.exit(1);
  }

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    dataDir: process.env.DATA_DIR || '/data',
    logLevel: process.env.LOG_LEVEL || 'info',
    passphrase,
    adminToken,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

export const config = loadConfig();
