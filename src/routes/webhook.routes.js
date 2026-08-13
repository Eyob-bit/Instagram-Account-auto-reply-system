const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Meta Webhook Verification Endpoint (GET)
router.get('/instagram', webhookController.verifyWebhook);

// Meta Webhook Event Ingestion Endpoint (POST)
router.post('/instagram', webhookController.handleWebhookEvent);

module.exports = router;
