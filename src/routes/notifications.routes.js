const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// Public VAPID key route (needed by browser to subscribe)
router.get('/notifications/vapid-key', notificationsController.getVapidPublicKey);

// Subscribe & Unsubscribe (Protected by auth)
router.post('/notifications/subscribe', requireAuth, notificationsController.subscribe);
router.delete('/notifications/subscribe', requireAuth, notificationsController.unsubscribe);

// Test notification & Status (Protected by auth)
router.post('/notifications/test', requireAuth, notificationsController.sendTestNotification);
router.get('/notifications/status', requireAuth, notificationsController.getStatus);

module.exports = router;
