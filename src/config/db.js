const { Pool } = require('pg');
const logger = require('../utils/logger');

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

let pool = null;
let isPostgresAvailable = false;

if (databaseUrl || process.env.PGHOST) {
  try {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    });
    isPostgresAvailable = true;
    logger.info('PostgreSQL database pool initialized.');
  } catch (err) {
    logger.warn('Failed to initialize PostgreSQL pool:', err.message);
  }
} else {
  logger.info('DATABASE_URL not configured. Operating in high-performance memory storage mode.');
}

/**
 * Initialize PostgreSQL tables automatically
 */
async function initSchema() {
  if (!pool) return false;

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      instagram_user_id VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(255) DEFAULT 'Username unavailable',
      display_name VARCHAR(255),
      status VARCHAR(50) DEFAULT 'PENDING',
      active BOOLEAN DEFAULT false,
      first_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER DEFAULT 1,
      latest_message TEXT,
      pending_message_id VARCHAR(255),
      automation_status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      message_id VARCHAR(255) UNIQUE,
      instagram_user_id VARCHAR(255) NOT NULL,
      username VARCHAR(255),
      incoming_message TEXT,
      reply_1 TEXT,
      reply_2 TEXT,
      notification_message TEXT,
      reply_1_sent BOOLEAN DEFAULT false,
      reply_2_sent BOOLEAN DEFAULT false,
      notification_sent BOOLEAN DEFAULT false,
      is_approved BOOLEAN DEFAULT false,
      status VARCHAR(50),
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      mid VARCHAR(255) PRIMARY KEY,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      reply1 TEXT DEFAULT 'Hey 👋',
      reply2 TEXT DEFAULT 'I want to work with you',
      reply_delay_seconds INTEGER DEFAULT 3,
      notification_message TEXT DEFAULT '🚨 Hurry up! There is a customer.',
      automation_enabled BOOLEAN DEFAULT true,
      auto_reply_once_per_conversation BOOLEAN DEFAULT true,
      ai_auto_approve_enabled BOOLEAN DEFAULT true,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_auto_approve_enabled BOOLEAN DEFAULT true;

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      keys_p256dh TEXT,
      keys_auth TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(schemaSql);
    logger.info('PostgreSQL schema auto-migration completed successfully.');
    return true;
  } catch (err) {
    logger.error('Error running PostgreSQL schema auto-migration:', err.message);
    return false;
  }
}

module.exports = {
  pool,
  isPostgresAvailable,
  initSchema,
  query: (text, params) => pool ? pool.query(text, params) : Promise.reject(new Error('No Postgres pool available'))
};
