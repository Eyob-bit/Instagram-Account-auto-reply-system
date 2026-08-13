const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config/env');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');

const webhookRoutes = require('./routes/webhook.routes');
const apiRoutes = require('./routes/index');

const app = express();

// Security and utility middleware
app.use(helmet({
  contentSecurityPolicy: false // Allows inline styles & scripts in admin dashboard & privacy page
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Admin Dashboard UI Route (Explicit redirect/serve before static middleware)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

// Privacy Policy Page Endpoint
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});

// Serve static files from public/ (PWA manifest, service worker, icons, etc.)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount Meta Webhook Routes
app.use('/webhooks', webhookRoutes);

// Mount Admin & General API Routes
app.use('/api', apiRoutes);

// Root Status Info Endpoint
app.get('/', (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Instagram Auto-Reply System API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2rem 3rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 520px; border: 1px solid #334155; }
          h1 { color: #38bdf8; margin-bottom: 0.5rem; }
          p { color: #94a3b8; font-size: 1.05rem; }
          .status { display: inline-block; padding: 0.4rem 1rem; border-radius: 9999px; background: #059669; color: #ecfdf5; font-weight: 600; margin-top: 1rem; }
          .btn { display: inline-block; padding: 0.6rem 1.2rem; background: #0284c7; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 1.2rem; }
          .code { font-family: monospace; background: #0f172a; padding: 0.5rem; border-radius: 6px; color: #a5f3fc; margin-top: 1rem; word-break: break-all; font-size: 0.88rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>⚡ Instagram Auto-Reply API</h1>
          <p>Meta Webhook Receiver & Professional Account Automation Engine is online.</p>
          <div class="status">● Server Online & Webhook Ready</div>
          <div><a href="/admin" class="btn">Open Admin Dashboard</a></div>
          <div class="code">Webhook Callback: /webhooks/instagram</div>
        </div>
      </body>
    </html>
  `);
});

// 404 Handler for Unknown Routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      status: 404
    }
  });
});

// Centralized Error Handling Middleware
app.use(errorHandler);

// Start HTTP Server
const server = app.listen(config.port, () => {
  logger.info(`🚀 Instagram Auto-Reply System server running on port ${config.port} (${config.nodeEnv})`);
  logger.info(`GET  /api/health            - Health Status Check`);
  logger.info(`GET  /admin                 - Admin Dashboard`);
  logger.info(`GET  /privacy               - Privacy Policy Page`);
  logger.info(`GET  /webhooks/instagram    - Meta Webhook Verification`);
  logger.info(`POST /webhooks/instagram    - Meta Webhook Event Receiver`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

module.exports = server;
