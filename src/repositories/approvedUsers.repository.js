const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Approved & Discovered Customers Repository
 * Dual Storage: PostgreSQL Database with In-Memory fallback.
 */
class ApprovedUsersRepository {
  constructor() {
    this.approvedUsers = new Map(); // Key: instagram_user_id (messaging.sender.id), Value: Customer object
    this.nextId = 1;
  }

  /**
   * Auto-discover or update an incoming customer event from Meta Webhook
   * @param {string} instagramUserId - messaging.sender.id ONLY
   * @param {string} [incomingMessage] 
   * @param {string} [messageId]
   * @param {string} [username] 
   */
  async recordIncomingMessage(instagramUserId, incomingMessage = '', messageId = null, username = '') {
    const igId = String(instagramUserId).trim();
    const now = new Date().toISOString();

    if (db.isPostgresAvailable && db.pool) {
      try {
        const selectRes = await db.query('SELECT * FROM customers WHERE instagram_user_id = $1', [igId]);
        if (selectRes.rows.length > 0) {
          const existing = selectRes.rows[0];
          const updatedMsgCount = (existing.message_count || 1) + 1;
          const updatedUsername = (username && username !== 'Not available' && existing.username === 'Username unavailable') ? username : existing.username;
          const updatedAutomationStatus = existing.status === 'PENDING' ? 'PENDING_APPROVAL' : existing.automation_status;

          const updateRes = await db.query(
            `UPDATE customers SET
              last_message_at = $1,
              message_count = $2,
              latest_message = COALESCE(NULLIF($3, ''), latest_message),
              pending_message_id = COALESCE($4, pending_message_id),
              username = $5,
              automation_status = $6,
              updated_at = $1
             WHERE instagram_user_id = $7 RETURNING *`,
            [now, updatedMsgCount, incomingMessage, messageId, updatedUsername, updatedAutomationStatus, igId]
          );
          const updatedCustomer = updateRes.rows[0];
          this.approvedUsers.set(igId, updatedCustomer);
          return updatedCustomer;
        }

        const insertRes = await db.query(
          `INSERT INTO customers (
            instagram_user_id, username, display_name, status, active,
            first_message_at, last_message_at, message_count, latest_message,
            pending_message_id, automation_status, created_at, updated_at
          ) VALUES ($1, $2, $3, 'PENDING', false, $4, $4, 1, $5, $6, 'PENDING_APPROVAL', $4, $4)
          RETURNING *`,
          [igId, username || 'Username unavailable', username ? `@${username}` : `Customer ${igId}`, now, incomingMessage || '', messageId || null]
        );
        const newCustomer = insertRes.rows[0];
        this.approvedUsers.set(igId, newCustomer);
        return newCustomer;
      } catch (err) {
        logger.error('PostgreSQL error in recordIncomingMessage:', err.message);
      }
    }

    // In-memory fallback
    if (this.approvedUsers.has(igId)) {
      const customer = this.approvedUsers.get(igId);
      customer.last_message_at = now;
      customer.message_count = (customer.message_count || 1) + 1;
      if (incomingMessage) customer.latest_message = incomingMessage;
      if (messageId) customer.pending_message_id = messageId;
      if (username && username !== 'Not available' && customer.username === 'Username unavailable') {
        customer.username = username;
      }
      if (customer.status === 'PENDING') {
        customer.automation_status = 'PENDING_APPROVAL';
      }
      customer.updated_at = now;
      return customer;
    }

    const newCustomer = {
      id: this.nextId++,
      instagram_user_id: igId,
      username: username || 'Username unavailable',
      display_name: username ? `@${username}` : `Customer ${igId}`,
      status: 'PENDING',
      active: false,
      first_message_at: now,
      last_message_at: now,
      message_count: 1,
      latest_message: incomingMessage || '',
      pending_message_id: messageId || null,
      automation_status: 'PENDING_APPROVAL',
      created_at: now,
      updated_at: now
    };

    this.approvedUsers.set(igId, newCustomer);
    return newCustomer;
  }

  /**
   * Explicitly add or approve user
   */
  async addUser(instagramUserId, username = '', displayName = '', active = true) {
    const igId = String(instagramUserId).trim();
    const now = new Date().toISOString();
    const statusVal = active ? 'APPROVED' : 'DISABLED';

    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query(
          `INSERT INTO customers (
            instagram_user_id, username, display_name, status, active,
            first_message_at, last_message_at, message_count, latest_message,
            pending_message_id, automation_status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $6, 0, '', NULL, 'COMPLETED', $6, $6)
          ON CONFLICT (instagram_user_id) DO UPDATE SET
            status = EXCLUDED.status,
            active = EXCLUDED.active,
            username = COALESCE(NULLIF(EXCLUDED.username, ''), customers.username),
            display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), customers.display_name),
            updated_at = EXCLUDED.updated_at
          RETURNING *`,
          [igId, username || 'Username unavailable', displayName || (username ? `@${username}` : `Customer ${igId}`), statusVal, Boolean(active), now]
        );
        const user = res.rows[0];
        this.approvedUsers.set(igId, user);
        return user;
      } catch (err) {
        logger.error('PostgreSQL error in addUser:', err.message);
      }
    }

    if (this.approvedUsers.has(igId)) {
      const existing = this.approvedUsers.get(igId);
      existing.status = statusVal;
      existing.active = Boolean(active);
      if (username) existing.username = username;
      if (displayName) existing.display_name = displayName;
      existing.updated_at = now;
      return existing;
    }

    const newUser = {
      id: this.nextId++,
      instagram_user_id: igId,
      username: username || 'Username unavailable',
      display_name: displayName || (username ? `@${username}` : `Customer ${igId}`),
      status: statusVal,
      active: Boolean(active),
      first_message_at: now,
      last_message_at: now,
      message_count: 0,
      latest_message: '',
      pending_message_id: null,
      automation_status: 'COMPLETED',
      created_at: now,
      updated_at: now
    };

    this.approvedUsers.set(igId, newUser);
    return newUser;
  }

  /**
   * One-click approval helper: PENDING -> APPROVED + active=true
   * Atomic check for DB and memory
   */
  async approveUser(idOrIgId) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return null;

    const wasPending = (customer.status === 'PENDING' && customer.automation_status === 'PENDING_APPROVAL');
    const now = new Date().toISOString();

    if (db.isPostgresAvailable && db.pool) {
      try {
        const updateRes = await db.query(
          `UPDATE customers SET status = 'APPROVED', active = true, automation_status = $1, updated_at = $2
           WHERE instagram_user_id = $3 RETURNING *`,
          [wasPending ? 'PROCESSING' : customer.automation_status, now, customer.instagram_user_id]
        );
        const updatedCustomer = updateRes.rows[0];
        this.approvedUsers.set(customer.instagram_user_id, updatedCustomer);
        return {
          customer: updatedCustomer,
          shouldAutoTriggerPending: wasPending
        };
      } catch (err) {
        logger.error('PostgreSQL error in approveUser:', err.message);
      }
    }

    customer.status = 'APPROVED';
    customer.active = true;
    if (wasPending) {
      customer.automation_status = 'PROCESSING';
    }
    customer.updated_at = now;

    return {
      customer,
      shouldAutoTriggerPending: wasPending
    };
  }

  /**
   * Update automation status for customer
   */
  async setAutomationStatus(idOrIgId, status) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return;

    if (db.isPostgresAvailable && db.pool) {
      try {
        await db.query(
          `UPDATE customers SET automation_status = $1, updated_at = $2 WHERE instagram_user_id = $3`,
          [status, new Date().toISOString(), customer.instagram_user_id]
        );
      } catch (err) {
        logger.error('PostgreSQL error in setAutomationStatus:', err.message);
      }
    }

    customer.automation_status = status;
    customer.updated_at = new Date().toISOString();
  }

  /**
   * Check if an Instagram user ID is approved and active
   */
  async isApproved(instagramUserId) {
    const customer = await this.findById(instagramUserId);
    return Boolean(customer && customer.status === 'APPROVED' && customer.active);
  }

  /**
   * Find customer by Instagram user ID or internal ID
   */
  async findById(idOrIgId) {
    const igId = String(idOrIgId).trim();

    if (db.isPostgresAvailable && db.pool) {
      try {
        const isNumeric = !isNaN(Number(igId));
        const res = isNumeric
          ? await db.query('SELECT * FROM customers WHERE instagram_user_id = $1 OR id = $2', [igId, Number(igId)])
          : await db.query('SELECT * FROM customers WHERE instagram_user_id = $1', [igId]);

        if (res.rows.length > 0) {
          const user = res.rows[0];
          this.approvedUsers.set(user.instagram_user_id, user);
          return user;
        }
      } catch (err) {
        logger.error('PostgreSQL error in findById:', err.message);
      }
    }

    const igUser = this.approvedUsers.get(igId);
    if (igUser) return igUser;

    for (const user of this.approvedUsers.values()) {
      if (user.id === Number(idOrIgId)) return user;
    }
    return null;
  }

  /**
   * Update customer properties
   */
  async updateUser(idOrIgId, updateData) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return null;

    const now = new Date().toISOString();
    const newUsername = updateData.username !== undefined ? updateData.username : customer.username;
    const newDisplayName = updateData.display_name !== undefined ? updateData.display_name : customer.display_name;
    let newStatus = updateData.status !== undefined ? updateData.status : customer.status;
    let newActive = updateData.active !== undefined ? Boolean(updateData.active) : customer.active;

    if (updateData.active !== undefined) {
      if (newActive) newStatus = 'APPROVED';
      else if (newStatus === 'APPROVED') newStatus = 'DISABLED';
    }

    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query(
          `UPDATE customers SET username = $1, display_name = $2, status = $3, active = $4, updated_at = $5
           WHERE instagram_user_id = $6 RETURNING *`,
          [newUsername, newDisplayName, newStatus, newActive, now, customer.instagram_user_id]
        );
        const updated = res.rows[0];
        this.approvedUsers.set(customer.instagram_user_id, updated);
        return updated;
      } catch (err) {
        logger.error('PostgreSQL error in updateUser:', err.message);
      }
    }

    customer.username = newUsername;
    customer.display_name = newDisplayName;
    customer.status = newStatus;
    customer.active = newActive;
    customer.updated_at = now;
    return customer;
  }

  /**
   * Soft disable customer
   */
  async disableUser(idOrIgId) {
    return this.updateUser(idOrIgId, { status: 'DISABLED', active: false });
  }

  /**
   * Enable/Approve customer
   */
  async enableUser(idOrIgId) {
    return this.approveUser(idOrIgId);
  }

  /**
   * Permanently delete customer
   */
  async deleteUser(idOrIgId) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return false;

    if (db.isPostgresAvailable && db.pool) {
      try {
        await db.query('DELETE FROM customers WHERE instagram_user_id = $1', [customer.instagram_user_id]);
      } catch (err) {
        logger.error('PostgreSQL error in deleteUser:', err.message);
      }
    }

    this.approvedUsers.delete(customer.instagram_user_id);
    return true;
  }

  /**
   * List all customers (or filtered by status)
   */
  async getAllUsers(statusFilter = null) {
    if (db.isPostgresAvailable && db.pool) {
      try {
        const queryText = statusFilter
          ? 'SELECT * FROM customers WHERE UPPER(status) = UPPER($1) ORDER BY last_message_at DESC'
          : 'SELECT * FROM customers ORDER BY last_message_at DESC';
        const res = statusFilter ? await db.query(queryText, [statusFilter]) : await db.query(queryText);
        
        for (const row of res.rows) {
          this.approvedUsers.set(row.instagram_user_id, row);
        }
        return res.rows;
      } catch (err) {
        logger.error('PostgreSQL error in getAllUsers:', err.message);
      }
    }

    let list = Array.from(this.approvedUsers.values());
    if (statusFilter) {
      list = list.filter(u => u.status === statusFilter.toUpperCase());
    }
    list.sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));
    return list;
  }

  /**
   * Get pending new customers list
   */
  async getPendingUsers() {
    return this.getAllUsers('PENDING');
  }

  /**
   * Count active approved users
   */
  async getActiveCount() {
    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query("SELECT COUNT(*) FROM customers WHERE status = 'APPROVED' AND active = true");
        return parseInt(res.rows[0].count, 10);
      } catch (err) {
        logger.error('PostgreSQL error in getActiveCount:', err.message);
      }
    }

    let count = 0;
    for (const u of this.approvedUsers.values()) {
      if (u.status === 'APPROVED' && u.active) count++;
    }
    return count;
  }

  /**
   * Count pending new customers
   */
  async getPendingCount() {
    if (db.isPostgresAvailable && db.pool) {
      try {
        const res = await db.query("SELECT COUNT(*) FROM customers WHERE status = 'PENDING'");
        return parseInt(res.rows[0].count, 10);
      } catch (err) {
        logger.error('PostgreSQL error in getPendingCount:', err.message);
      }
    }

    let count = 0;
    for (const u of this.approvedUsers.values()) {
      if (u.status === 'PENDING') count++;
    }
    return count;
  }
}

module.exports = new ApprovedUsersRepository();
