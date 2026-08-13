/**
 * Conversation State & Audit History Repository
 * Tracks idempotency message IDs (mid), conversation state, and complete audit records.
 */

class ConversationsRepository {
  constructor() {
    this.processedMessageIds = new Set();
    this.conversationStates = new Map(); // Key: sender_instagram_id
    this.records = []; // Full audit records of incoming/automated message cycles
    this.nextRecordId = 1;
  }

  /**
   * Check if a message event ID was already processed
   * @param {string} mid 
   */
  async isMessageProcessed(mid) {
    if (!mid) return false;
    return this.processedMessageIds.has(mid);
  }

  /**
   * Mark a message event ID as processed
   * @param {string} mid 
   */
  async markMessageProcessed(mid) {
    if (!mid) return;
    this.processedMessageIds.add(mid);

    if (this.processedMessageIds.size > 10000) {
      const firstEntry = this.processedMessageIds.values().next().value;
      this.processedMessageIds.delete(firstEntry);
    }
  }

  /**
   * Get state for an Instagram sender
   * @param {string} senderId 
   */
  async getConversationState(senderId) {
    return this.conversationStates.get(String(senderId)) || {
      senderId: String(senderId),
      hasReplied: false,
      lastMessageAt: null,
      lastRepliedAt: null,
      messageCount: 0
    };
  }

  /**
   * Update state for an Instagram sender
   * @param {string} senderId 
   * @param {object} stateUpdate 
   */
  async updateConversationState(senderId, stateUpdate) {
    const currentState = await this.getConversationState(senderId);
    const updatedState = {
      ...currentState,
      ...stateUpdate,
      updatedAt: new Date().toISOString()
    };
    this.conversationStates.set(String(senderId), updatedState);
    return updatedState;
  }

  /**
   * Create a rich conversation automation record
   */
  async createRecord(data) {
    const record = {
      id: this.nextRecordId++,
      message_id: data.message_id || null,
      instagram_user_id: String(data.instagram_user_id),
      username: data.username || `user_${data.instagram_user_id}`,
      incoming_message: data.incoming_message || '',
      reply_1: data.reply_1 || '',
      reply_2: data.reply_2 || '',
      notification_message: data.notification_message || '',
      reply_1_sent: Boolean(data.reply_1_sent),
      reply_2_sent: Boolean(data.reply_2_sent),
      notification_sent: Boolean(data.notification_sent),
      is_approved: Boolean(data.is_approved),
      status: data.status || 'COMPLETED', // COMPLETED | FAILED | IGNORED_UNAPPROVED | AUTOMATION_DISABLED
      error_message: data.error_message || null,
      created_at: new Date().toISOString(),
      completed_at: data.completed_at || new Date().toISOString()
    };

    this.records.unshift(record);

    if (this.records.length > 500) {
      this.records.pop();
    }

    return record;
  }

  /**
   * Get list of conversations with optional filtering
   * @param {object} [filter] - { status, isApproved, timeRange }
   */
  async getRecords(filter = {}) {
    let result = [...this.records];

    if (filter.status) {
      result = result.filter(r => r.status.toLowerCase() === filter.status.toLowerCase());
    }

    if (filter.isApproved !== undefined) {
      result = result.filter(r => r.is_approved === Boolean(filter.isApproved));
    }

    if (filter.timeRange === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0,0,0,0);
      result = result.filter(r => new Date(r.created_at) >= startOfDay);
    } else if (filter.timeRange === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      result = result.filter(r => new Date(r.created_at) >= startOfWeek);
    }

    return result;
  }

  /**
   * Get dashboard summary statistics
   */
  async getDashboardStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);

    let messagesToday = 0;
    let automationsTriggered = 0;
    let notificationsSent = 0;

    for (const r of this.records) {
      const recordDate = new Date(r.created_at);
      if (recordDate >= startOfDay) {
        messagesToday++;
      }
      if (r.status === 'COMPLETED' || r.reply_1_sent) {
        automationsTriggered++;
      }
      if (r.notification_sent) {
        notificationsSent++;
      }
    }

    return {
      messagesToday,
      automationsTriggered,
      notificationsSent,
      recentActivity: this.records.slice(0, 10)
    };
  }
}

module.exports = new ConversationsRepository();
