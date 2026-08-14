const express = require('express');
const router = express.Router();
const approvedUsersController = require('../controllers/approvedUsers.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.get('/approved-users', requireAuth, approvedUsersController.getApprovedUsers);
router.get('/customers/pending', requireAuth, approvedUsersController.getPendingUsers);
router.get('/approved-users/:id/details', requireAuth, approvedUsersController.getCustomerDetails);
router.post('/approved-users', requireAuth, approvedUsersController.addApprovedUser);
router.post('/approved-users/:id/approve', requireAuth, approvedUsersController.approveUser);
router.post('/approved-users/:id/ignore', requireAuth, approvedUsersController.ignoreUser);
router.patch('/approved-users/:id', requireAuth, approvedUsersController.updateApprovedUser);
router.delete('/approved-users/:id', requireAuth, approvedUsersController.deleteApprovedUser);

module.exports = router;
