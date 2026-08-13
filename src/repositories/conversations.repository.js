const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Conversation State & Audit History Repository
 * Dual Storage: PostgreSQL Database with In-Memory fallback.
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

    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query('SELECT mid FROM processed_messages WHERE mid = $1', [mid]);
        if (res.rows.length > 0) return true;
      } catch (err) {
        logger.error('PostgreSQL error in isMessageProcessed:', err.message);
      }
    }

    return this.processedMessageIds.has(mid);
  }

  /**
   * Mark a message event ID as processed
   * @param {string} mid 
   */
  async markMessageProcessed(mid) {
    if (!mid) return;

    if (db.isPostgresAvailable && db.pool) {
      try {
        await db.query('INSERT INTO processed_messages (mid) VALUES ($1) ON CONFLICT (mid) DO NOTHING', [mid]);
      } catch (err) {
        logger.error('PostgreSQL error in markMessageProcessed:', err.message);
      }
    }

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
    const sId = String(senderId);
    return this.conversationStates.get(sId) || {
      senderId: sId,
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
    const now = new Date().toISOString();
    const record = {
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
      status: data.status || 'COMPLETED',
      error_message: data.error_message || null,
      created_at: now,
      completed_at: data.completed_at || now
    };

    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query(
          `INSERT INTO conversations (
            message_id, instagram_user_id, username, incoming_message,
            reply_1, reply_2, notification_message, reply_1_sent,
            reply_2_sent, notification_sent, is_approved, status,
            error_message, created_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (message_id) DO NOTHING RETURNING *`,
          [
            record.message_id, record.instagram_user_id, record.username, record.incoming_message,
            record.reply_1, record.reply_2, record.notification_message, record.reply_1_sent,
            record.reply_2_sent, record.notification_sent, record.is_approved, record.status,
            record.error_message, record.created_at, record.completed_at
          ]
        );
        if (res.rows.length > 0) {
          const inserted = res.rows[0];
          this.records.unshift(inserted);
          return inserted;
        }
      } catch (err) {
        logger.error('PostgreSQL error in createRecord:', err.message);
      }
    }

    record.id = this.nextRecordId++;
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
    if (db.isPostgresAvailable && db.pool) {
      try {
        let sql = 'SELECT * FROM conversations WHERE 1=1';
        const params = [];

        if (filter.status) {
          params.push(filter.status.toLowerCase());
          sql += ` AND LOWER(status) = $${params.length}`;
        }

        if (filter.isApproved !== undefined) {
          params.push(Boolean(filter.isApproved));
          sql += ` AND is_approved = $${params.length}`;
        }

        if (filter.timeRange === 'today') {
          const startOfDay = new Date();
          startOfDay.setHours(0,0,0,0);
          params.push(startOfDay.toISOString());
          sql += ` AND created_at >= $${params.length}`;
        } else if (filter.timeRange === 'week') {
          const startOfWeek = new Date();
          startOfWeek.setDate(startOfWeek.getDate() - 7);
          params.push(startOfWeek.toISOString());
          sql += ` AND created_at >= $${params.length}`;
        }

        sql += ' ORDER BY created_at DESC LIMIT 500';
        const res = await db.query(sql, params);
        return res.rows;
      } catch (err) {
        logger.error('PostgreSQL error in getRecords:', err.message);
      }
    }

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

    if (db.isPostgresAvailable && db.pool) {
      try {
        const todayRes = await db.query('SELECT COUNT(*) FROM conversations WHERE created_at >= $1', [startOfDay.toISOString()]);
        const autoRes = await db.query("SELECT COUNT(*) FROM conversations WHERE status = 'COMPLETED' OR reply_1_sent = true");
        const notifRes = await db.query('SELECT COUNT(*) FROM conversations WHERE notification_sent = true');
        const recentRes = await db.query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 10');

        return {
          messagesToday: parseInt(todayRes.rows[0].count, 10),
          automationsTriggered: parseInt(autoRes.rows[0].count, 10),
          notificationsSent: parseInt(notifRes.rows[0].count, 10),
          recentActivity: recentRes.rows
        };
      } catch (err) {
        logger.error('PostgreSQL error in getDashboardStats:', err.message);
      }
    }

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
