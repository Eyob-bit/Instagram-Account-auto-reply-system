const express = require('express');
const router = express.Router();

const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const settingsRoutes = require('./settings.routes');
const approvedUsersRoutes = require('./approvedUsers.routes');
const conversationsRoutes = require('./conversations.routes');
const notificationsRoutes = require('./notifications.routes');
const instagramRoutes = require('./instagram.routes');

router.use('/', healthRoutes);
router.use('/', authRoutes);
router.use('/', settingsRoutes);
router.use('/', approvedUsersRoutes);
router.use('/', conversationsRoutes);
router.use('/', notificationsRoutes);
router.use('/', instagramRoutes);

module.exports = router;
