/**
 * Approved & Discovered Customers Repository
 * Manages Instagram customers through discovery, pending status, atomic one-click approval, and active status.
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

    // New unknown customer discovered!
    const newCustomer = {
      id: this.nextId++,
      instagram_user_id: igId,
      username: username || 'Username unavailable',
      display_name: username ? `@${username}` : `Customer ${igId}`,
      status: 'PENDING', // PENDING | APPROVED | DISABLED
      active: false,    // Only APPROVED + active=true triggers auto-reply
      first_message_at: now,
      last_message_at: now,
      message_count: 1,
      latest_message: incomingMessage || '',
      pending_message_id: messageId || null,
      automation_status: 'PENDING_APPROVAL', // PENDING_APPROVAL | PROCESSING | COMPLETED | FAILED
      created_at: now,
      updated_at: now
    };

    this.approvedUsers.set(igId, newCustomer);
    return newCustomer;
  }

  /**
   * Explicitly add/create user
   */
  async addUser(instagramUserId, username = '', displayName = '', active = true) {
    const igId = String(instagramUserId).trim();
    const now = new Date().toISOString();

    if (this.approvedUsers.has(igId)) {
      const existing = this.approvedUsers.get(igId);
      existing.status = active ? 'APPROVED' : 'DISABLED';
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
      status: active ? 'APPROVED' : 'DISABLED',
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
   * Returns atomic lock flag shouldAutoTriggerPending if customer was PENDING
   * @param {string|number} idOrIgId 
   */
  async approveUser(idOrIgId) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return null;

    const wasPending = (customer.status === 'PENDING' && customer.automation_status === 'PENDING_APPROVAL');

    customer.status = 'APPROVED';
    customer.active = true;
    if (wasPending) {
      customer.automation_status = 'PROCESSING';
    }
    customer.updated_at = new Date().toISOString();

    return {
      customer,
      shouldAutoTriggerPending: wasPending
    };
  }

  /**
   * Mark automation status for customer's pending message
   */
  async setAutomationStatus(idOrIgId, status) {
    const customer = await this.findById(idOrIgId);
    if (customer) {
      customer.automation_status = status;
      customer.updated_at = new Date().toISOString();
    }
  }

  /**
   * Check if an Instagram user ID is approved and active
   * @param {string} instagramUserId 
   * @returns {Promise<boolean>}
   */
  async isApproved(instagramUserId) {
    const customer = this.approvedUsers.get(String(instagramUserId).trim());
    return Boolean(customer && customer.status === 'APPROVED' && customer.active);
  }

  /**
   * Find customer by Instagram user ID or internal ID
   * @param {string|number} idOrIgId 
   */
  async findById(idOrIgId) {
    const igUser = this.approvedUsers.get(String(idOrIgId).trim());
    if (igUser) return igUser;

    for (const user of this.approvedUsers.values()) {
      if (user.id === Number(idOrIgId)) return user;
    }
    return null;
  }

  /**
   * Update customer properties
   * @param {string|number} idOrIgId 
   * @param {object} updateData 
   */
  async updateUser(idOrIgId, updateData) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return null;

    if (updateData.username !== undefined) customer.username = updateData.username;
    if (updateData.display_name !== undefined) customer.display_name = updateData.display_name;
    if (updateData.status !== undefined) {
      customer.status = updateData.status;
      customer.active = updateData.status === 'APPROVED';
    }
    if (updateData.active !== undefined) {
      customer.active = Boolean(updateData.active);
      if (customer.active) customer.status = 'APPROVED';
      else if (customer.status === 'APPROVED') customer.status = 'DISABLED';
    }
    customer.updated_at = new Date().toISOString();

    return customer;
  }

  /**
   * Soft disable customer
   * @param {string|number} idOrIgId 
   */
  async disableUser(idOrIgId) {
    return this.updateUser(idOrIgId, { status: 'DISABLED', active: false });
  }

  /**
   * Enable/Approve customer
   * @param {string|number} idOrIgId 
   */
  async enableUser(idOrIgId) {
    return this.approveUser(idOrIgId);
  }

  /**
   * Permanently delete customer from customer list
   * @param {string|number} idOrIgId 
   */
  async deleteUser(idOrIgId) {
    const customer = await this.findById(idOrIgId);
    if (!customer) return false;

    this.approvedUsers.delete(customer.instagram_user_id);
    return true;
  }

  /**
   * List all customers (or filtered by status)
   * @param {string} [statusFilter] - PENDING | APPROVED | DISABLED
   */
  async getAllUsers(statusFilter = null) {
    let list = Array.from(this.approvedUsers.values());

    if (statusFilter) {
      list = list.filter(u => u.status === statusFilter.toUpperCase());
    }

    // Sort newest last_message_at first
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
    let count = 0;
    for (const u of this.approvedUsers.values()) {
      if (u.status === 'PENDING') count++;
    }
    return count;
  }
}

module.exports = new ApprovedUsersRepository();
