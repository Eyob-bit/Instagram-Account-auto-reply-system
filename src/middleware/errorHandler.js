const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled Server Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });

  res.status(err.status || 500).json({
    success: false,
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
}

module.exports = errorHandler;
