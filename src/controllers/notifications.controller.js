const config = require('../config/env');
const pushSubscriptionsRepo = require('../repositories/pushSubscriptions.repository');
const notificationService = require('../services/notification.service');

async function getVapidPublicKey(req, res) {
  res.status(200).json({
    success: true,
    publicKey: config.vapidPublicKey || null
  });
}

async function subscribe(req, res, next) {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: 'Valid push subscription object required' });
    }

    const userAgent = req.headers['user-agent'] || 'Browser Device';
    const record = await pushSubscriptionsRepo.addSubscription(subscription, userAgent);

    res.status(201).json({
      success: true,
      message: 'Phone push notification subscription saved successfully',
      data: record
    });
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'endpoint is required' });
    }

    await pushSubscriptionsRepo.removeSubscription(endpoint);
    res.status(200).json({ success: true, message: 'Subscription removed' });
  } catch (err) {
    next(err);
  }
}

async function sendTestNotification(req, res, next) {
  try {
    const result = await notificationService.sendPhoneNotification(
      '🔔 Test Notification',
      'Test notification from Customer Auto Reply!',
      { type: 'test', timestamp: Date.now() }
    );

    res.status(200).json({
      success: true,
      message: 'Test notification triggered successfully',
      result
    });
  } catch (err) {
    next(err);
  }
}

async function getStatus(req, res, next) {
  try {
    const stats = await pushSubscriptionsRepo.getStats();
    res.status(200).json({
      success: true,
      data: {
        configured: Boolean(config.vapidPublicKey && config.vapidPrivateKey),
        devicesCount: stats.devicesCount,
        lastNotificationSentAt: stats.lastNotificationSentAt,
        totalNotificationsSent: stats.totalNotificationsSent
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  sendTestNotification,
  getStatus
};
