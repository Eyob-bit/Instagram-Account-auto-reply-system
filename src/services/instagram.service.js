const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Service for interacting with Meta's Official Instagram Graph API & Webhooks
 */
class InstagramService {
  /**
   * Safe diagnostic helper for token status (never reveals full token)
   */
  getTokenDiagnostics() {
    const rawToken = config.metaInstagramAccessToken || '';
    const token = rawToken.trim();
    const configured = token.length > 0;
    const tokenLength = token.length;
    const tokenPrefix = configured ? token.substring(0, 4) : '';
    const tokenSuffix = configured ? token.substring(Math.max(0, token.length - 4)) : '';
    const containsWhitespace = /\s/.test(rawToken);
    const version = config.metaGraphApiVersion || 'v22.0';

    return {
      tokenConfigured: configured,
      tokenLength,
      tokenPrefix,
      tokenSuffix,
      containsWhitespace,
      graphApiVersion: version,
      messageEndpoint: `https://graph.instagram.com/${version}/me/messages`
    };
  }

  /**
   * Validate current Instagram Access Token directly with Meta Graph API
   * Never exposes full token to callers or response objects
   */
  async validateToken() {
    const diagnostics = this.getTokenDiagnostics();

    if (!diagnostics.tokenConfigured) {
      return {
        ...diagnostics,
        metaValidation: 'invalid',
        metaError: 'META_INSTAGRAM_ACCESS_TOKEN is missing or empty'
      };
    }

    const version = config.metaGraphApiVersion || 'v22.0';
    const url = `https://graph.instagram.com/${version}/me?fields=id,username`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.metaInstagramAccessToken}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          ...diagnostics,
          metaValidation: 'invalid',
          metaError: data.error || { message: `HTTP ${response.status}` }
        };
      }

      return {
        ...diagnostics,
        metaValidation: 'valid',
        accountInfo: {
          id: data.id,
          username: data.username
        }
      };
    } catch (err) {
      return {
        ...diagnostics,
        metaValidation: 'invalid',
        metaError: { message: err.message }
      };
    }
  }

  /**
   * Debug identity/authentication test for ADMIN endpoint GET /api/instagram/debug-send
   * Does NOT send a real message, performs safe auth test against Meta API
   */
  async debugSend() {
    const diagnostics = this.getTokenDiagnostics();

    if (!diagnostics.tokenConfigured) {
      return {
        ...diagnostics,
        authenticationMethod: 'Bearer',
        metaRequestSuccessful: false,
        metaErrorCode: 'MISSING_TOKEN',
        metaErrorMessage: 'META_INSTAGRAM_ACCESS_TOKEN is not configured in .env'
      };
    }

    const version = config.metaGraphApiVersion || 'v22.0';
    const url = `https://graph.instagram.com/${version}/me?fields=id,username`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.metaInstagramAccessToken}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          ...diagnostics,
          authenticationMethod: 'Bearer',
          metaRequestSuccessful: false,
          metaErrorCode: data.error?.code || response.status,
          metaErrorMessage: data.error?.message || 'Authentication test failed'
        };
      }

      return {
        ...diagnostics,
        authenticationMethod: 'Bearer',
        metaRequestSuccessful: true,
        metaErrorCode: null,
        metaErrorMessage: null,
        accountInfo: {
          id: data.id,
          username: data.username
        }
      };
    } catch (err) {
      return {
        ...diagnostics,
        authenticationMethod: 'Bearer',
        metaRequestSuccessful: false,
        metaErrorCode: 'NETWORK_ERROR',
        metaErrorMessage: err.message
      };
    }
  }

  /**
   * Parse incoming Webhook payload from Meta
   * Meta Instagram webhook payload format:
   * {
   *   "object": "instagram",
   *   "entry": [{
   *     "id": "178414...",
   *     "time": 1670000000,
   *     "messaging": [{
   *       "sender": { "id": "SENDER_IG_USER_ID" },
   *       "recipient": { "id": "RECIPIENT_IG_USER_ID" },
   *       "timestamp": 1670000000,
   *       "message": { "mid": "mid.12345", "text": "Hello world" }
   *     }]
   *   }]
   * }
   * 
   * @param {object} body 
   * @returns {Array<{ senderId: string, recipientId: string, messageId: string, text: string, timestamp: number }>}
   */
  parseMessagingEvents(body) {
    const events = [];

    if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) {
      return events;
    }

    for (const entry of body.entry) {
      if (!Array.isArray(entry.messaging)) continue;

      // entry.id is the Professional Instagram account's IGSID.
      // When the bot sends a DM, Instagram echoes it back as a webhook with
      // sender.id = the Professional account. We must skip these echo events
      // so the Professional account is NEVER treated as a customer.
      const professionalAccountId = entry.id ? String(entry.id) : null;

      for (const messagingEvent of entry.messaging) {
        if (!messagingEvent.message) continue;

        const senderId = messagingEvent.sender?.id ? String(messagingEvent.sender.id) : null;

        // Skip echo: sender is the Professional account (bot's own sent message echoed back)
        if (senderId && professionalAccountId && senderId === professionalAccountId) {
          logger.info(`Skipping echo webhook event — sender is the Professional account. Not a customer message.`);
          continue;
        }

        if (!senderId) continue;

        events.push({
          senderId,
          recipientId: messagingEvent.recipient?.id ? String(messagingEvent.recipient.id) : null,
          messageId: messagingEvent.message?.mid || null,
          text: messagingEvent.message?.text || '',
          timestamp: messagingEvent.timestamp || Date.now()
        });
      }
    }

    return events;
  }

  /**
   * Send a direct message to an Instagram user using official Instagram Graph API
   * Endpoint: POST https://graph.instagram.com/v22.0/me/messages
   * 
   * @param {string} recipientId - Sender's Instagram User ID
   * @param {string} text - Message content to send
   */
  async sendMessage(recipientId, text) {
    if (!config.metaInstagramAccessToken) {
      logger.warn(`Cannot send Instagram DM to ${recipientId}: META_INSTAGRAM_ACCESS_TOKEN is missing.`);
      return { success: false, reason: 'MISSING_ACCESS_TOKEN' };
    }

    const version = config.metaGraphApiVersion || 'v22.0';
    const url = `https://graph.instagram.com/${version}/me/messages`;
    const payload = {
      recipient: { id: recipientId },
      message: { text: text }
    };

    logger.info(`Sending Instagram message to user [${recipientId}] (Length: ${text.length})`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.metaInstagramAccessToken}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error(`Failed to send Instagram DM to ${recipientId}: HTTP ${response.status}`, data);
        return { success: false, error: data };
      }

      logger.info(`Successfully delivered DM to Instagram user [${recipientId}] (Message ID: ${data.message_id || 'OK'})`);
      return { success: true, data };
    } catch (err) {
      logger.error(`Network error while sending DM to Instagram user [${recipientId}]:`, err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new InstagramService();
