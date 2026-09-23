const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const { connectDb } = require('./db/connect');
const { authRequired, adminRequired } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const snapRoutes = require('./routes/snaps');
const subscriptionRoutes = require('./routes/subscriptions');
const supportRoutes = require('./routes/support');
const uploadRoutes = require('./routes/uploads');
const { initFirebase } = require('./services/firebaseStorage');

const adminUsers = require('./routes/admin/users');
const adminModeration = require('./routes/admin/moderation');
const adminAnalytics = require('./routes/admin/analytics');
const adminSubscriptions = require('./routes/admin/subscriptions');
const adminNotifications = require('./routes/admin/notifications');
const adminSupport = require('./routes/admin/support');

let appPromise;

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: 'snap-app-api',
        status: 'ok',
        db: 'mongodb',
        time: new Date().toISOString(),
      },
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: 'snap-app-api',
        status: 'ok',
        db: 'mongodb',
        time: new Date().toISOString(),
      },
    });
  });

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: 'snap-app-api',
        status: 'ok',
        db: 'mongodb',
        time: new Date().toISOString(),
      },
    });
  });

  // Also support health without /api prefix
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: 'snap-app-api',
        status: 'ok',
        db: 'mongodb',
        time: new Date().toISOString(),
      },
    });
  });

  // WebRTC ICE config (STUN always; TURN when TURN_HOST is set on the host).
  const iceHandler = (_req, res) => {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    const turnHost = String(process.env.TURN_HOST || '').trim();
    if (turnHost) {
      iceServers.push({
        urls: [
          `turn:${turnHost}:3478?transport=tcp`,
          `turn:${turnHost}:3478?transport=udp`,
        ],
        username: process.env.TURN_USER || 'snap',
        credential: process.env.TURN_PASS || 'snapturn',
      });
    }
    res.json({ success: true, data: { iceServers } });
  };
  app.get('/api/webrtc/ice', iceHandler);
  app.get('/api/v1/webrtc/ice', iceHandler);

  const sessionRoutes = require('./routes/sessions');
  const stitchJobRoutes = require('./routes/stitchJobs');
  const poseRoutes = require('./routes/poses');
  const homeRoutes = require('./routes/home');
  const userNotificationRoutes = require('./routes/userNotifications');
  const pairRequestRoutes = require('./routes/pairRequests');
  const friendsRoutes = require('./routes/friends');
  const posePingRoutes = require('./routes/posePings');
  const publicShareRoutes = require('./routes/publicShare');
  const publicInviteRoutes = require('./routes/publicInvite');

  // Public share pages (no auth) — WhatsApp / Copy Link open these.
  app.use('/p', publicShareRoutes);
  // Public PosePing invite landing — WhatsApp / SMS one-tap links.
  app.use('/invite', publicInviteRoutes);

  function mountApi(base) {
    app.use(`${base}/auth`, authRoutes);
    app.use(`${base}/users`, userRoutes);
    app.use(`${base}/snaps`, snapRoutes);
    app.use(`${base}/subscriptions`, subscriptionRoutes);
    app.use(`${base}/support`, supportRoutes);
    app.use(`${base}/uploads`, uploadRoutes);
    app.use(`${base}/sessions`, sessionRoutes);
    app.use(`${base}/stitch-jobs`, stitchJobRoutes);
    app.use(`${base}/poses`, poseRoutes);
    app.use(`${base}/home`, homeRoutes);
    app.use(`${base}/notifications`, userNotificationRoutes);
    app.use(`${base}/pair-requests`, pairRequestRoutes);
    app.use(`${base}/friends`, friendsRoutes);
    app.use(`${base}/pose-pings`, posePingRoutes);
    app.use(`${base}/devices`, require('./routes/devices'));
  }

  // Mobile contract uses /api/v1/*; existing clients use /api/*
  mountApi('/api');
  mountApi('/api/v1');

  const admin = express.Router();
  admin.use(authRequired, adminRequired);
  admin.use('/users', adminUsers);
  admin.use('/moderation', adminModeration);
  admin.use('/analytics', adminAnalytics);
  admin.use('/billing', adminSubscriptions);
  admin.use('/notifications', adminNotifications);
  admin.use('/support', adminSupport);
  app.use('/api/admin', admin);
  app.use('/api/v1/admin', admin);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  return app;
}

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await connectDb();
      try {
        initFirebase();
      } catch (err) {
        console.warn('Firebase Storage not initialized:', err.message);
      }
      return createApp();
    })();
  }
  return appPromise;
}

module.exports = { createApp, getApp };
