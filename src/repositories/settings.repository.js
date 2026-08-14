const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Settings Repository
 * Dual Storage: PostgreSQL Database with In-Memory fallback.
 */
class SettingsRepository {
  constructor() {
    this.settings = {
      reply1: "Hey 👋",
      reply2: "I want to work with you",
      replyDelaySeconds: 3,
      notificationMessage: "🚨 Hurry up! There is a customer.",
      automationEnabled: true,
      autoReplyOncePerConversation: true,
      aiAutoApproveEnabled: true,
      aiPersonaInstruction: "You are a very polite, warm, respectful, and friendly assistant replying on Instagram DMs. Always be super polite, helpful, and welcoming. Talk naturally like a normal human person. and my name is Eyob"
    };
  }

  async getSettings() {
    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query('SELECT * FROM settings WHERE id = 1');
        if (res.rows.length > 0) {
          const row = res.rows[0];
          this.settings = {
            reply1: row.reply1,
            reply2: row.reply2,
            replyDelaySeconds: row.reply_delay_seconds,
            notificationMessage: row.notification_message,
            automationEnabled: row.automation_enabled,
            autoReplyOncePerConversation: row.auto_reply_once_per_conversation,
            aiAutoApproveEnabled: row.ai_auto_approve_enabled !== false,
            aiPersonaInstruction: row.ai_persona_instruction || this.settings.aiPersonaInstruction
          };
          return { ...this.settings };
        }
      } catch (err) {
        logger.error('PostgreSQL error in getSettings:', err.message);
      }
    }

    return { ...this.settings };
  }

  async updateSettings(newSettings) {
    this.settings = {
      ...this.settings,
      ...newSettings,
      replyDelaySeconds: newSettings.replyDelaySeconds !== undefined
        ? Number(newSettings.replyDelaySeconds)
        : this.settings.replyDelaySeconds,
      aiAutoApproveEnabled: newSettings.aiAutoApproveEnabled !== undefined
        ? Boolean(newSettings.aiAutoApproveEnabled)
        : this.settings.aiAutoApproveEnabled,
      aiPersonaInstruction: newSettings.aiPersonaInstruction !== undefined
        ? String(newSettings.aiPersonaInstruction)
        : this.settings.aiPersonaInstruction
    };

    if (db.isPostgresAvailable && db.pool) {
      try {
        await db.query(
          `INSERT INTO settings (
            id, reply1, reply2, reply_delay_seconds, notification_message,
            automation_enabled, auto_reply_once_per_conversation, ai_auto_approve_enabled,
            ai_persona_instruction, updated_at
          ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (id) DO UPDATE SET
            reply1 = EXCLUDED.reply1,
            reply2 = EXCLUDED.reply2,
            reply_delay_seconds = EXCLUDED.reply_delay_seconds,
            notification_message = EXCLUDED.notification_message,
            automation_enabled = EXCLUDED.automation_enabled,
            auto_reply_once_per_conversation = EXCLUDED.auto_reply_once_per_conversation,
            ai_auto_approve_enabled = EXCLUDED.ai_auto_approve_enabled,
            ai_persona_instruction = EXCLUDED.ai_persona_instruction,
            updated_at = NOW()`,
          [
            this.settings.reply1,
            this.settings.reply2,
            this.settings.replyDelaySeconds,
            this.settings.notificationMessage,
            this.settings.automationEnabled,
            this.settings.autoReplyOncePerConversation,
            this.settings.aiAutoApproveEnabled,
            this.settings.aiPersonaInstruction
          ]
        );
      } catch (err) {
        logger.error('PostgreSQL error in updateSettings:', err.message);
      }
    }

    return { ...this.settings };
  }
}

module.exports = new SettingsRepository();
