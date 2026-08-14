const approvedUsersRepo = require('../repositories/approvedUsers.repository');
const conversationsRepo = require('../repositories/conversations.repository');
const autoReplyService = require('../services/autoReply.service');

async function getApprovedUsers(req, res, next) {
  try {
    const { status } = req.query;
    const users = await approvedUsersRepo.getAllUsers(status || null);
    res.status(200).json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

async function getPendingUsers(req, res, next) {
  try {
    const users = await approvedUsersRepo.getPendingUsers();
    res.status(200).json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

async function addApprovedUser(req, res, next) {
  try {
    const { instagram_user_id, username, display_name, active } = req.body;
    if (!instagram_user_id) {
      return res.status(400).json({ success: false, error: 'instagram_user_id is required' });
    }
    const user = await approvedUsersRepo.addUser(
      String(instagram_user_id),
      username || '',
      display_name || '',
      active !== undefined ? Boolean(active) : true
    );
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * One-click customer approval handler
 * Changes status: PENDING -> APPROVED + active=true
 * Immediately processes original pending message so customer does NOT need to send a second message!
 */
async function approveUser(req, res, next) {
  try {
    const { id } = req.params;
    const result = await approvedUsersRepo.approveUser(id);

    if (!result || !result.customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const { customer, shouldAutoTriggerPending } = result;

    // Immediately trigger auto-reply for original pending DM
    if (shouldAutoTriggerPending) {
      autoReplyService.triggerPendingApprovalSequence(customer);
    }

    res.status(200).json({
      success: true,
      message: `${customer.username !== 'Username unavailable' ? '@' + customer.username : 'Customer ' + customer.instagram_user_id} has been approved. Auto-reply sequence started for original message.`,
      data: customer,
      autoTriggered: shouldAutoTriggerPending
    });
  } catch (err) {
    next(err);
  }
}

async function updateApprovedUser(req, res, next) {
  try {
    const { id } = req.params;
    const { username, display_name, status, active } = req.body;

    const user = await approvedUsersRepo.updateUser(id, {
      username,
      display_name,
      status,
      active
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function deleteApprovedUser(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await approvedUsersRepo.deleteUser(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    res.status(200).json({ success: true, message: 'Customer removed from active customer list' });
  } catch (err) {
    next(err);
  }
}

async function getCustomerDetails(req, res, next) {
  try {
    const { id } = req.params;
    const customer = await approvedUsersRepo.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const allRecords = await conversationsRepo.getRecords();
    const history = allRecords.filter(r => String(r.instagram_user_id) === String(customer.instagram_user_id));

    res.status(200).json({
      success: true,
      data: {
        customer,
        history
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Ignore a pending customer — sets status to DISABLED, removes from pending queue
 */
async function ignoreUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await approvedUsersRepo.updateUser(id, { status: 'DISABLED', active: false });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    res.status(200).json({ success: true, message: 'Customer has been ignored and removed from pending queue.', data: user });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getApprovedUsers,
  getPendingUsers,
  addApprovedUser,
  approveUser,
  ignoreUser,
  updateApprovedUser,
  deleteApprovedUser,
  getCustomerDetails
};
