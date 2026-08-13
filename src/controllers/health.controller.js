const config = require('../config/env');

function getHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'Instagram Auto-Reply System API',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: config.nodeEnv,
    webhookConfigured: Boolean(config.metaVerifyToken),
    accessTokenConfigured: Boolean(config.metaInstagramAccessToken)
  });
}

module.exports = {
  getHealth
};
