const config = require('../config/env');
const instagramService = require('../services/instagram.service');
const autoReplyService = require('../services/autoReply.service');
const logger = require('../utils/logger');

/**
 * Handle GET /webhooks/instagram (Meta Webhook Verification)
 * Meta sends query parameters:
 * - hub.mode: "subscribe"
 * - hub.verify_token: your configured META_VERIFY_TOKEN
 * - hub.challenge: token to echo back
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info(`Received Meta Webhook Verification request: mode=${mode}`);

  if (mode === 'subscribe' && token === config.metaVerifyToken) {
    logger.info('Meta Webhook verification SUCCESSFUL. Responding with challenge.');
    return res.status(200).send(challenge);
  } else {
    logger.warn(`Meta Webhook verification FAILED. Received verify_token did not match META_VERIFY_TOKEN.`);
    return res.status(403).json({
      error: 'Verification failed. Invalid verify_token.'
    });
  }
}

/**
 * Handle POST /webhooks/instagram (Meta Webhook Ingestion)
 * Immediately acknowledges valid events with HTTP 200, then handles processing asynchronously.
 */
function handleWebhookEvent(req, res) {
  const body = req.body;

  // Validate basic Meta webhook payload format
  if (!body || body.object !== 'instagram') {
    logger.warn('Received Webhook POST event with unexpected object format:', body?.object);
    return res.status(404).send('Not Found');
  }

  // 1. Immediately acknowledge event to Meta to prevent timeout
  res.status(200).send('EVENT_RECEIVED');

  // 2. Parse messaging events safely
  const events = instagramService.parseMessagingEvents(body);
  logger.info(`Received Meta webhook POST containing ${events.length} messaging event(s).`);

  // 3. Process events asynchronously
  for (const event of events) {
    logger.info(`Processing incoming DM event from senderId [${event.senderId}], text preview: "${event.text.substring(0, 30)}"`);
    autoReplyService.processIncomingMessage(event).catch(err => {
      logger.error('Error during async webhook event processing:', err.message);
    });
  }
}

module.exports = {
  verifyWebhook,
  handleWebhookEvent
};
