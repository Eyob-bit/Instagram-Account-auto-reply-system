const express = require('express');
const router = express.Router();
const conversationsRepo = require('../repositories/conversations.repository');
const approvedUsersRepo = require('../repositories/approvedUsers.repository');
const pushSubscriptionsRepo = require('../repositories/pushSubscriptions.repository');
const settingsRepo = require('../repositories/settings.repository');
const { requireAuth } = require('../middleware/auth.middleware');

// GET /api/conversations (with status/approved/timeRange filtering)
router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const { status, isApproved, timeRange } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (isApproved !== undefined) filter.isApproved = isApproved === 'true';
    if (timeRange) filter.timeRange = timeRange;

    const records = await conversationsRepo.getRecords(filter);
    res.status(200).json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/stats (Summary cards for home page)
router.get('/dashboard/stats', requireAuth, async (req, res, next) => {
  try {
    const convStats = await conversationsRepo.getDashboardStats();
    const approvedUsersCount = (await approvedUsersRepo.getAllUsers('APPROVED')).length;
    const activeUsersCount = await approvedUsersRepo.getActiveCount();
    const pendingCustomersCount = await approvedUsersRepo.getPendingCount();
    const settings = await settingsRepo.getSettings();
    const pushStats = await pushSubscriptionsRepo.getStats();

    res.status(200).json({
      success: true,
      data: {
        approvedCustomersCount: approvedUsersCount,
        activeCustomersCount: activeUsersCount,
        pendingCustomersCount: pendingCustomersCount,
        messagesTodayCount: convStats.messagesToday,
        automationsTriggeredCount: convStats.automationsTriggered,
        notificationsSentCount: convStats.notificationsSent,
        automationEnabled: Boolean(settings.automationEnabled),
        registeredDevicesCount: pushStats.devicesCount,
        recentActivity: convStats.recentActivity
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
