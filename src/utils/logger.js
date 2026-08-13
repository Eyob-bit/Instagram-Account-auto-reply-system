/**
 * Logging Utility with Automatic Secret Masking
 * Ensures sensitive data such as access tokens are never logged to console or stdout.
 */

const sensitiveKeys = ['token', 'access_token', 'authorization', 'secret', 'meta_instagram_access_token'];

/**
 * Recursively sanitize objects or string inputs to replace access tokens with [REDACTED].
 * @param {any} data 
 * @returns {any}
 */
function sanitize(data) {
  if (!data) return data;

  if (typeof data === 'string') {
    // Redact long Meta tokens starting with IG or EA
    let cleaned = data.replace(/(IG|EA)[A-Za-z0-9_-]{20,}/g, '[REDACTED_ACCESS_TOKEN]');
    return cleaned;
  }

  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      return data.map(item => sanitize(item));
    }
    const sanitizedObj = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sKey => lowerKey.includes(sKey))) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitize(value);
      }
    }
    return sanitizedObj;
  }

  return data;
}

const logger = {
  info: (message, ...meta) => {
    const timestamp = new Date().toISOString();
    const cleanMeta = meta.map(m => sanitize(m));
    console.log(`[${timestamp}] [INFO] ${sanitize(message)}`, ...cleanMeta);
  },
  warn: (message, ...meta) => {
    const timestamp = new Date().toISOString();
    const cleanMeta = meta.map(m => sanitize(m));
    console.warn(`[${timestamp}] [WARN] ${sanitize(message)}`, ...cleanMeta);
  },
  error: (message, ...meta) => {
    const timestamp = new Date().toISOString();
    const cleanMeta = meta.map(m => sanitize(m));
    console.error(`[${timestamp}] [ERROR] ${sanitize(message)}`, ...cleanMeta);
  },
  debug: (message, ...meta) => {
    if (process.env.NODE_ENV !== 'production') {
      const timestamp = new Date().toISOString();
      const cleanMeta = meta.map(m => sanitize(m));
      console.log(`[${timestamp}] [DEBUG] ${sanitize(message)}`, ...cleanMeta);
    }
  }
};

module.exports = logger;
