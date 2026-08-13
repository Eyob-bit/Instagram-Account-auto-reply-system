const dotenv = require('dotenv');
const logger = require('../utils/logger');

// Load environment variables from .env file
dotenv.config();

const requiredEnvVars = ['META_VERIFY_TOKEN'];

function validateEnv() {
  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Please check your .env file or refer to .env.example.');
    process.exit(1);
  }

  if (!process.env.META_INSTAGRAM_ACCESS_TOKEN) {
    logger.warn('META_INSTAGRAM_ACCESS_TOKEN is not set or empty in .env. API calls to Instagram will fail until provided.');
  }
}

validateEnv();

// Clean and sanitize access token to prevent accidental whitespace/quote wrapping
const rawAccessToken = process.env.META_INSTAGRAM_ACCESS_TOKEN || '';
const sanitizedAccessToken = rawAccessToken.trim().replace(/^["']|["']$/g, '');

const config = Object.freeze({
  port: parseInt(process.env.PORT || '3000', 10),
  metaVerifyToken: (process.env.META_VERIFY_TOKEN || '').trim().replace(/^["']|["']$/g, ''),
  metaInstagramAccessToken: sanitizedAccessToken,
  metaGraphApiVersion: (process.env.META_GRAPH_API_VERSION || 'v22.0').trim(),
  adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
  adminPasswordHash: (process.env.ADMIN_PASSWORD_HASH || '').trim(),
  adminJwtSecret: (process.env.ADMIN_JWT_SECRET || 'fallback_jwt_secret_change_in_env').trim(),
  vapidPublicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
  vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
  vapidSubject: (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim(),
  nodeEnv: process.env.NODE_ENV || 'development'
});

logger.info(`Environment loaded. Port: ${config.port}, NodeEnv: ${config.nodeEnv}, Graph API Version: ${config.metaGraphApiVersion}`);
logger.info(`Meta Verify Token configured: ${config.metaVerifyToken ? 'YES' : 'NO'}`);
logger.info(`Meta Access Token configured: ${config.metaInstagramAccessToken ? 'YES ([REDACTED])' : 'NO'}`);
logger.info(`Admin User: ${config.adminUsername}, Auth Protected: ${config.adminPasswordHash ? 'YES' : 'NO'}`);
logger.info(`VAPID Web Push Configured: ${config.vapidPublicKey && config.vapidPrivateKey ? 'YES' : 'NO'}`);

module.exports = config;
