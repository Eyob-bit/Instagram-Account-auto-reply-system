const express = require('express');
const router = express.Router();
const instagramController = require('../controllers/instagram.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.get('/instagram/token-status', requireAuth, instagramController.getTokenStatus);
router.get('/instagram/debug-send', requireAuth, instagramController.debugSend);

module.exports = router;
