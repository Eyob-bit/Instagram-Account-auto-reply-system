const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    logger.info(`${method} ${originalUrl} ${statusCode} - ${duration}ms [${ip}]`);
  });

  next();
}

module.exports = requestLogger;
