const approvedUsersRepo = require('../repositories/approvedUsers.repository');
const settingsRepo = require('../repositories/settings.repository');
const conversationsRepo = require('../repositories/conversations.repository');
const instagramService = require('./instagram.service');
const notificationService = require('./notification.service');
const config = require('../config/env');
const logger = require('../utils/logger');

// ───────── Gemini AI Configuration ─────────
const GEMINI_API_KEY = config.geminiApiKey || process.env.GEMINI_API_KEY || '';
// Using gemini-3.6-flash which is verified active & supported for generateContent
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Generate a conversational AI response using Gemini AI, maintaining full thread context.
 * @param {string} senderId - Customer Instagram User ID
 * @param {string} incomingText - Latest incoming DM text
 * @param {string} username - Customer username
 * @returns {Promise<string>} - Gemini AI generated response
 */
async function generateConversationalAiReply(senderId, incomingText, username) {
  try {
    const rawText = (incomingText || '').trim();
    const cleanText = rawText.toLowerCase().replace(/[^\w\s]/gi, '').trim();
    const simpleGreetings = ['hi', 'hey', 'hello', 'hey there', 'hi there', 'hola', 'yo'];

    // If message is a simple greeting like "Hey" or "Hi", respond with a clean, short polite human greeting!
    // No username tag, no long essay.
    if (simpleGreetings.includes(cleanText)) {
      const quickReplies = ['Hey! 👋', 'Hi! 👋', 'Hello! 👋', 'Hey there! 👋'];
      const chosen = quickReplies[Math.floor(Math.random() * quickReplies.length)];
      logger.info(`Simple greeting detected ("${rawText}"). Replying directly with: "${chosen}"`);
      return chosen;
    }

    // 1. Fetch dynamic settings to get user's custom AI Persona & Training instructions
    const settings = await settingsRepo.getSettings();
    const personaInstructions = settings.aiPersonaInstruction || 
      'You are a very polite, warm, respectful, and friendly assistant replying on Instagram DMs. Always be super polite, helpful, and welcoming. Talk naturally like a normal human person.';

    // 2. Fetch recent conversation history to provide thread context to Gemini
    const allRecords = await conversationsRepo.getRecords();
    const historyRecords = allRecords
      .filter(r => String(r.instagram_user_id) === String(senderId) && r.status === 'COMPLETED')
      .reverse() // Oldest first
      .slice(-6); // Keep last 6 exchanges for context

    // 3. Build multi-turn conversational contents array for Gemini
    const contents = [];

    // Human Persona & Training Rules
    const systemPrompt = `You are replying on Instagram DMs on behalf of the account owner.

CUSTOM PERSONA & TRAINING INSTRUCTIONS FROM ACCOUNT OWNER:
${personaInstructions}

STRICT BEHAVIOR RULES:
1. ALWAYS BE POLITELY MANNERED: Be extremely polite, respectful, warm, and helpful at all times. NEVER be rude, blunt, sarcastic, or cold.
2. NATURAL CHAT STYLE: Talk naturally like a friendly, normal person chatting on Instagram. Keep responses concise (1-2 sentences max).
3. NO FORMAL LABELS OR TAGS: Do NOT use usernames like "@username", "Dear Customer", or corporate robot templates.
4. ANSWER DIRECTLY: Answer questions politely, offer assistance warmly, and keep the dialogue pleasant.`;

    // Format historical conversation turns
    historyRecords.forEach(rec => {
      if (rec.incoming_message) {
        contents.push({
          role: 'user',
          parts: [{ text: rec.incoming_message }]
        });
      }
      if (rec.reply_1) {
        contents.push({
          role: 'model',
          parts: [{ text: rec.reply_1 }]
        });
      }
    });

    // Add current incoming message turn
    contents.push({
      role: 'user',
      parts: [{ text: rawText || 'Hello' }]
    });

    // Call Gemini 3.6 Flash API
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 150
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`Gemini API error (HTTP ${response.status}): ${errText}`);
      return `Hey! 👋 How can I help you today?`;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) {
      logger.warn('Gemini returned empty text response, using simple fallback.');
      return `Hey! How can I help you today?`;
    }

    return text;

  } catch (err) {
    logger.error(`Gemini AI generateConversationalAiReply error: ${err.message}`);
    return `Hey! How can I help you today?`;
  }
}

class AutoReplyService {
  /**
   * Log clear terminal banner for incoming Instagram customers
   * PRIVACY RULE: Contains ONLY Customer info (sender.id). Never logs recipient.id or API tokens.
   */
  logCustomerBanner(senderId, text, customer, isApproved) {
    const usernameDisplay = (customer?.username && customer.username !== 'Username unavailable')
      ? `@${customer.username}`
      : 'Username unavailable';
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (isApproved) {
      logger.info(
        `\n============================================================\n` +
        `✅ APPROVED INSTAGRAM CUSTOMER (AI CHAT)\n` +
        `============================================================\n` +
        `👤 Username: ${usernameDisplay}\n` +
        `🆔 Instagram User ID: ${senderId}\n` +
        `💬 Message: "${text || ''}"\n` +
        `⏰ Time: ${nowStr}\n` +
        `============================================================`
      );
    } else {
      const statusLabel = customer?.status || 'NOT APPROVED';
      logger.info(
        `\n============================================================\n` +
        `🆕 UNKNOWN INSTAGRAM CUSTOMER\n` +
        `============================================================\n` +
        `👤 Username: ${usernameDisplay}\n` +
        `🆔 Instagram User ID: ${senderId}\n` +
        `💬 Message: "${text || ''}"\n` +
        `⚠️ Status: ${statusLabel}\n` +
        `⏰ Time: ${nowStr}\n` +
        `============================================================`
      );
    }
  }

  /**
   * Process incoming Instagram messaging event
   * @param {object} event - { senderId, recipientId, messageId, text, timestamp }
   */
  async processIncomingMessage(event) {
    // PRIVACY RULE: Only senderId (customer ID) is used for customer identity. recipientId is NEVER saved or logged.
    const { senderId, messageId, text } = event;

    if (!senderId) {
      logger.warn('Received DM event with missing senderId. Skipping.');
      return;
    }

    // 1. Webhook Event Idempotency Check (Prevent duplicate processing)
    if (messageId && await conversationsRepo.isMessageProcessed(messageId)) {
      logger.info(`Message [${messageId}] already processed. Ignoring duplicate webhook delivery.`);
      return;
    }
    if (messageId) {
      await conversationsRepo.markMessageProcessed(messageId);
    }

    // 2. Auto-discover & record customer in repository using senderId (CUSTOMER ID)
    let customer = await approvedUsersRepo.recordIncomingMessage(senderId, text, messageId);
    let isApproved = Boolean(customer && customer.status === 'APPROVED' && customer.active);

    // 3. Load dynamic settings
    const settings = await settingsRepo.getSettings();

    // 🤖 AI AUTO-APPROVE (AUTO-ADD CUSTOMERS) CHECK:
    // If customer is not approved yet and AI Auto-Approve mode is enabled in settings,
    // automatically add & approve customer immediately 24/7!
    if (!isApproved && customer.status !== 'DISABLED' && settings.aiAutoApproveEnabled) {
      logger.info(`🤖 [AI AUTO-APPROVE ACTIVE] New customer [${senderId}] detected! Auto-approving customer immediately 24/7...`);
      const approveResult = await approvedUsersRepo.approveUser(senderId);
      if (approveResult && approveResult.customer) {
        customer = approveResult.customer;
        isApproved = true;
      }
    }

    // Display formatted customer banner in terminal (Privacy compliant)
    this.logCustomerBanner(senderId, text, customer, isApproved);

    const username = (customer?.username && customer.username !== 'Username unavailable')
      ? `@${customer.username}`
      : `Customer ${senderId}`;

    if (!isApproved) {
      logger.info(`Sender [${senderId}] status is ${customer.status} (active: ${customer.active}). DOING ABSOLUTELY NOTHING.`);
      
      // Store record for conversation history audit
      await conversationsRepo.createRecord({
        message_id: messageId,
        instagram_user_id: senderId,
        username: customer?.username || `user_${senderId}`,
        incoming_message: text || '',
        is_approved: false,
        status: `IGNORED_${customer.status}`
      });
      return;
    }

    if (!settings.automationEnabled) {
      logger.info('Auto-reply automation is currently globally disabled in settings.');
      
      await conversationsRepo.createRecord({
        message_id: messageId,
        instagram_user_id: senderId,
        username: customer?.username || `user_${senderId}`,
        incoming_message: text || '',
        is_approved: true,
        status: 'AUTOMATION_DISABLED'
      });
      return;
    }

    logger.info(`Approved user [${senderId}] (${username}) sent DM: "${text}". Triggering Gemini Conversational AI...`);

    // Update conversation state for tracking
    const convState = await conversationsRepo.getConversationState(senderId);
    await conversationsRepo.updateConversationState(senderId, {
      hasReplied: true,
      lastMessageAt: new Date().toISOString(),
      messageCount: convState.messageCount + 1
    });

    // Execute natural AI conversation response
    this.executeConversationalAiResponse(senderId, text, messageId, settings, customer).catch(err => {
      logger.error(`Error during conversational AI reply workflow for [${senderId}]:`, err.message);
    });
  }

  /**
   * Execute human-like Gemini AI conversation response workflow
   * @param {string} senderId 
   * @param {string} incomingText 
   * @param {string} messageId 
   * @param {object} settings 
   * @param {object} customer 
   */
  async executeConversationalAiResponse(senderId, incomingText, messageId, settings, customer) {
    const username = (customer?.username && customer.username !== 'Username unavailable')
      ? `@${customer.username}`
      : `User ${senderId}`;

    let replySent = false;
    let notificationSent = false;
    let errorMessage = null;
    let aiResponse = '';

    try {
      // Step 1: Wait configured typing delay to sound like a normal human typing
      const rawDelay = Number(settings.replyDelaySeconds);
      const delaySeconds = isNaN(rawDelay) ? 3 : Math.max(0, Math.min(60, rawDelay));
      const delayMs = delaySeconds * 1000;

      if (delayMs > 0) {
        logger.info(`[Human Typing Delay] Waiting ${delaySeconds}s before responding...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Step 2: Generate natural human-like Gemini AI response with full conversation context
      logger.info(`[Gemini AI] Generating response for customer [${senderId}]...`);
      aiResponse = await generateConversationalAiReply(senderId, incomingText, username);

      // Step 3: Send AI reply to Instagram DM
      logger.info(`[Instagram DM] Sending AI response to customer [${senderId}]: "${aiResponse}"`);
      const res = await instagramService.sendMessage(senderId, aiResponse);

      if (res.success) {
        replySent = true;
      } else {
        errorMessage = `Failed to send Instagram DM: ${JSON.stringify(res.error || res.reason)}`;
        logger.error(`[Instagram DM Error] ${errorMessage}`);
      }

      // Step 4: Trigger Phone Push Notification for admin
      const notifText = settings.notificationMessage.includes('@username') 
        ? settings.notificationMessage.replace('@username', username)
        : `${settings.notificationMessage} (${username} sent: "${incomingText}")`;

      logger.info(`[Push Alert] Sending phone notification: "${notifText}"`);
      const notifRes = await notificationService.sendPhoneNotification(
        `💬 DM from ${username}`,
        notifText,
        { senderId, username, message: incomingText }
      );

      if (notifRes.success) {
        notificationSent = true;
      }

    } catch (err) {
      logger.error(`Exception in executeConversationalAiResponse for customer [${senderId}]:`, err.message);
      errorMessage = err.message;
    }

    const status = replySent ? 'COMPLETED' : 'FAILED';

    // Update customer automation status in repository
    await approvedUsersRepo.setAutomationStatus(senderId, status);

    // Record complete conversation audit log
    await conversationsRepo.createRecord({
      message_id: messageId,
      instagram_user_id: senderId,
      username: customer?.username || `user_${senderId}`,
      incoming_message: incomingText,
      reply_1: aiResponse,
      reply_2: '',
      notification_message: settings.notificationMessage,
      reply_1_sent: replySent,
      reply_2_sent: false,
      notification_sent: notificationSent,
      is_approved: true,
      status: status,
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    });

    if (replySent) {
      await conversationsRepo.updateConversationState(senderId, {
        lastRepliedAt: new Date().toISOString()
      });
    }
  }

  /**
   * Immediately trigger auto-reply sequence for original pending DM when admin clicks ADD CUSTOMER
   * @param {object} customer 
   */
  async triggerPendingApprovalSequence(customer) {
    if (!customer || !customer.instagram_user_id) return;
    const senderId = customer.instagram_user_id;
    const text = customer.latest_message || 'Hey';
    const messageId = customer.pending_message_id || `mid.approved_pending_${Date.now()}`;

    logger.info(`⚡ [ONE-CLICK APPROVAL AUTO-TRIGGER] Admin approved customer [${senderId}]. Immediately starting AI conversation for message: "${text}"`);

    const settings = await settingsRepo.getSettings();
    if (!settings.automationEnabled) {
      logger.info('Auto-reply automation is currently globally disabled in settings.');
      return;
    }

    // Execute conversational response immediately!
    this.executeConversationalAiResponse(senderId, text, messageId, settings, customer).catch(err => {
      logger.error(`Error during immediate approval conversational workflow for [${senderId}]:`, err.message);
    });
  }
}

module.exports = new AutoReplyService();
