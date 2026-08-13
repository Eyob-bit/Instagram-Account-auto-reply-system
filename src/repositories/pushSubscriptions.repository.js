const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Push Subscriptions Repository
 * Dual Storage: PostgreSQL Database with In-Memory fallback.
 */
class PushSubscriptionsRepository {
  constructor() {
    this.subscriptions = new Map(); // Key: endpoint URL, Value: Subscription object
    this.lastNotificationSentAt = null;
    this.notificationsSentCount = 0;
  }

  /**
   * Save or update push subscription
   * @param {object} subscription - { endpoint, keys: { p256dh, auth } }
   * @param {string} [userAgent]
   */
  async addSubscription(subscription, userAgent = '') {
    if (!subscription || !subscription.endpoint) return null;

    const endpoint = subscription.endpoint;
    const p256dh = subscription.keys?.p256dh || '';
    const auth = subscription.keys?.auth || '';
    const now = new Date().toISOString();

    if (db.isPostgresAvailable && db.pool) {
      try {
        await db.query(
          `INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (endpoint) DO UPDATE SET keys_p256dh = $2, keys_auth = $3`,
          [endpoint, p256dh, auth, now]
        );
      } catch (err) {
        logger.error('PostgreSQL error in addSubscription:', err.message);
      }
    }

    const record = {
      id: Buffer.from(endpoint).toString('base64').substring(0, 16),
      endpoint: endpoint,
      keys: { p256dh, auth },
      userAgent: userAgent || 'Mobile Device',
      created_at: now
    };

    this.subscriptions.set(endpoint, record);
    return record;
  }

  /**
   * Remove subscription
   * @param {string} endpoint 
   */
  async removeSubscription(endpoint) {
    if (!endpoint) return false;

    if (db.isPostgresAvailable && db.pool) {
      try {
        await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      } catch (err) {
        logger.error('PostgreSQL error in removeSubscription:', err.message);
      }
    }

    return this.subscriptions.delete(endpoint);
  }

  /**
   * Get all active push subscriptions
   */
  async getAllSubscriptions() {
    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query('SELECT * FROM push_subscriptions');
        const list = res.rows.map(row => ({
          id: Buffer.from(row.endpoint).toString('base64').substring(0, 16),
          endpoint: row.endpoint,
          keys: { p256dh: row.keys_p256dh, auth: row.keys_auth },
          userAgent: 'Mobile Device',
          created_at: row.created_at
        }));

        for (const sub of list) {
          this.subscriptions.set(sub.endpoint, sub);
        }
        return list;
      } catch (err) {
        logger.error('PostgreSQL error in getAllSubscriptions:', err.message);
      }
    }

    return Array.from(this.subscriptions.values());
  }

  /**
   * Get total registered devices count
   */
  async getDeviceCount() {
    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query('SELECT COUNT(*) FROM push_subscriptions');
        return parseInt(res.rows[0].count, 10);
      } catch (err) {
        logger.error('PostgreSQL error in getDeviceCount:', err.message);
      }
    }

    return this.subscriptions.size;
  }

  /**
   * Record notification sent timestamp and increment count
   */
  async recordNotificationSent() {
    this.lastNotificationSentAt = new Date().toISOString();
    this.notificationsSentCount++;
  }

  /**
   * Get notification stats
   */
  async getStats() {
    const devicesCount = await this.getDeviceCount();
    return {
      devicesCount,
      lastNotificationSentAt: this.lastNotificationSentAt,
      totalNotificationsSent: this.notificationsSentCount
    };
  }
}

module.exports = new PushSubscriptionsRepository();
