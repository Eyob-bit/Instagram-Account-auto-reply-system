const approvedUsersRepo = require('../repositories/approvedUsers.repository');
const settingsRepo = require('../repositories/settings.repository');
const conversationsRepo = require('../repositories/conversations.repository');
const instagramService = require('./instagram.service');
const notificationService = require('./notification.service');
const logger = require('../utils/logger');

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
        `✅ APPROVED INSTAGRAM CUSTOMER\n` +
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

    // 🤖 AI AUTO-APPROVE CHECK:
    // If customer is PENDING and AI Auto-Approve mode is enabled in settings,
    // automatically approve the customer immediately without waiting for browser dashboard!
    if (!isApproved && customer.status === 'PENDING' && settings.aiAutoApproveEnabled) {
      logger.info(`🤖 [AI AUTO-APPROVE ACTIVE] New customer [${senderId}] detected! Auto-approving immediately 24/7...`);
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

    // 4. Check conversation state
    const convState = await conversationsRepo.getConversationState(senderId);
    if (settings.autoReplyOncePerConversation && convState.hasReplied) {
      logger.info(`Auto-reply already executed for approved user [${senderId}] in this conversation state. Skipping.`);
      return;
    }

    logger.info(`Approved user [${senderId}] (${username}) sent message: "${text}". Starting automated reply workflow.`);

    // Update state to prevent parallel duplicate execution
    await conversationsRepo.updateConversationState(senderId, {
      hasReplied: true,
      lastMessageAt: new Date().toISOString(),
      messageCount: convState.messageCount + 1
    });

    // Execute sequence asynchronously
    this.executeAutomationSequence(senderId, text, messageId, settings, customer).catch(err => {
      logger.error(`Error during automated reply workflow for [${senderId}]:`, err.message);
    });
  }

  /**
   * Execute the 2-message reply + delay + push notification workflow
   * @param {string} senderId 
   * @param {string} incomingText 
   * @param {string} messageId 
   * @param {object} settings 
   * @param {object} customer 
   */
  async executeAutomationSequence(senderId, incomingText, messageId, settings, customer) {
    const username = (customer?.username && customer.username !== 'Username unavailable')
      ? `@${customer.username}`
      : `User ${senderId}`;
    let reply1Sent = false;
    let reply2Sent = false;
    let notificationSent = false;
    let errorMessage = null;

    try {
      // Step 1: Send Automatic Reply #1
      logger.info(`[Step 1/3] Sending Reply #1 to customer [${senderId}]: "${settings.reply1}"`);
      const res1 = await instagramService.sendMessage(senderId, settings.reply1);
      if (res1.success) {
        reply1Sent = true;
      } else {
        errorMessage = `Reply #1 failed: ${JSON.stringify(res1.error || res1.reason)}`;
        logger.error(`[Step 1/3 FAILED] Reply #1 to customer [${senderId}] failed. Stopping sequence.`);
      }

      // Proceed to Step 2 & 3 ONLY if Reply #1 succeeded
      if (reply1Sent) {
        // Step 2: Wait for configured delay (validated 0-60 seconds)
        const rawDelay = Number(settings.replyDelaySeconds);
        const delaySeconds = isNaN(rawDelay) ? 3 : Math.max(0, Math.min(60, rawDelay));
        const delayMs = delaySeconds * 1000;

        logger.info(`[Step 2/3] Waiting configured delay of ${delaySeconds}s (${delayMs}ms)...`);
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // Send Automatic Reply #2
        logger.info(`[Step 2/3] Sending Reply #2 to customer [${senderId}]: "${settings.reply2}"`);
        const res2 = await instagramService.sendMessage(senderId, settings.reply2);
        if (res2.success) {
          reply2Sent = true;
        } else {
          const errStr = `Reply #2 failed: ${JSON.stringify(res2.error || res2.reason)}`;
          errorMessage = errorMessage ? `${errorMessage}; ${errStr}` : errStr;
          logger.error(`[Step 2/3 FAILED] Reply #2 to customer [${senderId}] failed.`);
        }

        // Step 3: Trigger Phone Push Notification
        const notifText = settings.notificationMessage.includes('@username') 
          ? settings.notificationMessage.replace('@username', username)
          : `${settings.notificationMessage} (${username} contacted you)`;

        logger.info(`[Step 3/3] Triggering phone push notification: "${notifText}"`);
        const notifRes = await notificationService.sendPhoneNotification(
          'New Customer Alert!',
          notifText,
          { senderId, username }
        );

        if (notifRes.success) {
          notificationSent = true;
        }
      }

    } catch (err) {
      logger.error(`Exception in executeAutomationSequence for customer [${senderId}]:`, err.message);
      errorMessage = err.message;
    }

    // Determine final status accurately
    let status = 'COMPLETED';
    if (!reply1Sent && !reply2Sent) {
      status = 'FAILED';
    } else if (!reply1Sent || !reply2Sent) {
      status = 'PARTIAL_SUCCESS';
    }

    // Update customer automation status in repository
    await approvedUsersRepo.setAutomationStatus(senderId, status);

    // Record complete conversation audit log accurately
    await conversationsRepo.createRecord({
      message_id: messageId,
      instagram_user_id: senderId,
      username: customer?.username || `user_${senderId}`,
      incoming_message: incomingText,
      reply_1: settings.reply1,
      reply_2: settings.reply2,
      notification_message: settings.notificationMessage,
      reply_1_sent: reply1Sent,
      reply_2_sent: reply2Sent,
      notification_sent: notificationSent,
      is_approved: true,
      status: status,
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    });

    if (reply1Sent || reply2Sent) {
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

    logger.info(`⚡ [ONE-CLICK APPROVAL AUTO-TRIGGER] Admin approved customer [${senderId}]. Immediately processing original message: "${text}"`);

    const settings = await settingsRepo.getSettings();
    if (!settings.automationEnabled) {
      logger.info('Auto-reply automation is currently globally disabled in settings.');
      return;
    }

    // Execute sequence immediately!
    this.executeAutomationSequence(senderId, text, messageId, settings, customer).catch(err => {
      logger.error(`Error during immediate approval reply workflow for [${senderId}]:`, err.message);
    });
  }
}

module.exports = new AutoReplyService();
