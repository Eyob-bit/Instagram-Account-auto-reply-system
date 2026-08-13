const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.post('/auth/login', authController.login);
router.get('/auth/me', requireAuth, authController.getMe);

module.exports = router;
