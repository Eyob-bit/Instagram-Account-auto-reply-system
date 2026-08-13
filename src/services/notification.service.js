const webpush = require('web-push');
const config = require('../config/env');
const pushSubscriptionsRepo = require('../repositories/pushSubscriptions.repository');
const logger = require('../utils/logger');

/**
 * Service for sending Phone Push Notifications to the account owner via Web Push (VAPID).
 * Operates safely across Android/iOS/Mobile/Desktop browsers using Service Workers.
 */
class NotificationService {
  constructor() {
    this.initialized = false;
    this.initVapid();
  }

  initVapid() {
    if (config.vapidPublicKey && config.vapidPrivateKey) {
      try {
        webpush.setVapidDetails(
          config.vapidSubject || 'mailto:admin@example.com',
          config.vapidPublicKey,
          config.vapidPrivateKey
        );
        this.initialized = true;
        logger.info('VAPID Web Push notification service initialized successfully.');
      } catch (err) {
        logger.error('Failed to initialize VAPID Web Push:', err.message);
      }
    } else {
      logger.warn('VAPID keys not fully configured in environment. Web Push will fall back to log recording.');
    }
  }

  /**
   * Send phone push notification to all subscribed devices
   * @param {string} title 
   * @param {string} message 
   * @param {object} [metadata] 
   */
  async sendPhoneNotification(title, message, metadata = {}) {
    logger.info(`📱 [PHONE PUSH NOTIFICATION] ${title} - ${message}`, metadata);

    const subscriptions = await pushSubscriptionsRepo.getAllSubscriptions();
    
    if (subscriptions.length === 0) {
      logger.info('No phone push subscriptions registered yet. (Open /admin/notifications on phone to enable push).');
      return { success: true, deliveredCount: 0, note: 'No subscribed devices' };
    }

    if (!this.initialized) {
      this.initVapid();
    }

    const payload = JSON.stringify({
      title: title || 'Customer Alert',
      body: message || '🚨 Hurry up! There is a customer!',
      icon: '/admin/icon.png',
      badge: '/admin/badge.png',
      url: '/admin/messages',
      timestamp: Date.now(),
      data: metadata
    });

    let deliveredCount = 0;
    let failedCount = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys
        }, payload);

        deliveredCount++;
      } catch (err) {
        failedCount++;
        logger.warn(`Push notification delivery failed for device [${sub.id}]: HTTP ${err.statusCode || err.message}`);
        
        // 404 or 410 indicates the push subscription has expired or been revoked by the device browser
        if (err.statusCode === 410 || err.statusCode === 404) {
          logger.info(`Removing expired push subscription [${sub.id}]`);
          await pushSubscriptionsRepo.removeSubscription(sub.endpoint);
        }
      }
    }

    if (deliveredCount > 0) {
      await pushSubscriptionsRepo.recordNotificationSent();
    }

    return {
      success: deliveredCount > 0 || subscriptions.length === 0,
      deliveredCount,
      failedCount,
      totalDevices: subscriptions.length
    };
  }
}

module.exports = new NotificationService();
