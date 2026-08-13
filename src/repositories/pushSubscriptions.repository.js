/**
 * Push Subscriptions Repository
 * Stores VAPID Web Push subscriptions for mobile/browser phone notifications.
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

    const record = {
      id: Buffer.from(subscription.endpoint).toString('base64').substring(0, 16),
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      userAgent: userAgent || 'Mobile Device',
      created_at: new Date().toISOString()
    };

    this.subscriptions.set(subscription.endpoint, record);
    return record;
  }

  /**
   * Remove subscription (e.g. when subscription expires or user opts out)
   * @param {string} endpoint 
   */
  async removeSubscription(endpoint) {
    if (!endpoint) return false;
    return this.subscriptions.delete(endpoint);
  }

  /**
   * Get all active push subscriptions
   */
  async getAllSubscriptions() {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Get total registered devices count
   */
  async getDeviceCount() {
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
    return {
      devicesCount: this.subscriptions.size,
      lastNotificationSentAt: this.lastNotificationSentAt,
      totalNotificationsSent: this.notificationsSentCount
    };
  }
}

module.exports = new PushSubscriptionsRepository();
