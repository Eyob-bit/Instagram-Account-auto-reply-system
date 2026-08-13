const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const logger = require('../utils/logger');

async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required.'
      });
    }

    const usernameMatch = String(username).trim() === config.adminUsername;
    let passwordMatch = false;

    if (config.adminPasswordHash) {
      passwordMatch = bcrypt.compareSync(String(password), config.adminPasswordHash);
    } else {
      // Fallback dev check if no hash set
      passwordMatch = String(password) === 'adminpassword123';
    }

    if (!usernameMatch || !passwordMatch) {
      logger.warn(`Failed login attempt for username: ${username}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password.'
      });
    }

    const token = jwt.sign(
      { username: config.adminUsername, role: 'admin' },
      config.adminJwtSecret,
      { expiresIn: '24h' }
    );

    logger.info(`Successful admin login for user: ${username}`);

    res.status(200).json({
      success: true,
      token,
      user: {
        username: config.adminUsername,
        role: 'admin'
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res) {
  res.status(200).json({
    success: true,
    user: {
      username: req.user.username,
      role: req.user.role || 'admin'
    }
  });
}

module.exports = {
  login,
  getMe
};
