/**
 * Settings Repository
 * Manages configurable auto-reply messages, delays, and notification templates.
 */

class SettingsRepository {
  constructor() {
    this.settings = {
      reply1: "Hey 👋",
      reply2: "I want to work with you",
      replyDelaySeconds: 3,
      notificationMessage: "🚨 Hurry up! There is a customer.",
      automationEnabled: true,
      autoReplyOncePerConversation: true
    };
  }

  async getSettings() {
    return { ...this.settings };
  }

  async updateSettings(newSettings) {
    this.settings = {
      ...this.settings,
      ...newSettings,
      replyDelaySeconds: newSettings.replyDelaySeconds !== undefined
        ? Number(newSettings.replyDelaySeconds)
        : this.settings.replyDelaySeconds
    };
    return { ...this.settings };
  }
}

module.exports = new SettingsRepository();
