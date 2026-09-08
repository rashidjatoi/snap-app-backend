const express = require('express');
const multer = require('multer');
const { User, Snap } = require('../models');
const { authRequired, publicUser } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { uploadBuffer } = require('../services/firebaseStorage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function buildProfile(user) {
  const snaps = await Snap.find({
    $or: [{ ownerId: user._id }, { partnerId: user._id }],
    status: { $ne: 'removed' },
  });
  const partnerIds = new Set();
  snaps.forEach((s) => {
    const owner = s.ownerId.toString();
    const partner = s.partnerId.toString();
    const me = user._id.toString();
    if (owner !== me) partnerIds.add(owner);
    if (partner !== me) partnerIds.add(partner);
  });

  const base = publicUser(user);
  return {
    ...base,
    fullName: user.displayName,
    stats: {
      poses: snaps.length,
      partners: partnerIds.size,
      sessions: snaps.length,
    },
  };
}

router.get('/profile', authRequired, async (req, res) => {
  try {
    const profile = await buildProfile(req.user);
    return ok(res, { user: profile, profile });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load profile');
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const profile = await buildProfile(req.user);
    return ok(res, profile);
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load profile');
  }
});

async function updateProfileHandler(req, res) {
  try {
    const {
      displayName,
      fullName,
      bio,
      avatarUrl,
      username,
      avatarColor,
    } = req.body || {};
    const user = req.user;
    const name = displayName || fullName;

    if (username && username !== user.username) {
      const taken = await User.findOne({
        username: new RegExp(`^${username}$`, 'i'),
        _id: { $ne: user._id },
      });
      if (taken) return fail(res, 409, 'Username already taken');
      user.username = username;
    }
    if (name !== undefined) user.displayName = name;
    if (bio !== undefined) user.bio = bio;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    if (avatarColor !== undefined) user.avatarColor = avatarColor;
    user.lastActiveAt = new Date();
    await user.save();
    const profile = await buildProfile(user);
    return ok(res, { user: profile, profile });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Update failed');
  }
}

async function updatePreferencesHandler(req, res) {
  try {
    const { darkMode, notificationsEnabled } = req.body || {};
    if (!req.user.preferences) req.user.preferences = {};
    if (darkMode !== undefined) req.user.preferences.darkMode = !!darkMode;
    if (notificationsEnabled !== undefined) {
      req.user.preferences.notificationsEnabled = !!notificationsEnabled;
    }
    await req.user.save();
    return ok(res, {
      preferences: {
        darkMode: req.user.preferences.darkMode,
        notificationsEnabled: req.user.preferences.notificationsEnabled,
      },
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to update preferences');
  }
}

router.patch('/profile', authRequired, updateProfileHandler);
router.patch('/me', authRequired, updateProfileHandler);
router.patch('/preferences', authRequired, updatePreferencesHandler);
router.patch('/me/preferences', authRequired, updatePreferencesHandler);

router.post('/avatar', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'file is required');
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: 'avatars',
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      userId: req.user._id.toString(),
    });
    req.user.avatarUrl = uploaded.url;
    req.user.lastActiveAt = new Date();
    await req.user.save();
    const profile = await buildProfile(req.user);
    return ok(res, {
      url: uploaded.url,
      user: profile,
      profile,
    });
  } catch (err) {
    console.error('Avatar upload failed', err);
    return fail(res, 500, err.message || 'Avatar upload failed');
  }
});

router.post('/linked-accounts/:provider', authRequired, async (req, res) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    if (!['instagram', 'whatsapp'].includes(provider)) {
      return fail(res, 400, 'provider must be instagram or whatsapp');
    }
    const connected = req.body?.connected !== false;
    let handle = String(req.body?.handle || req.body?.username || req.body?.phone || '')
      .trim();
    if (provider === 'instagram') {
      handle = handle.replace(/^@/, '');
      if (connected && !handle) {
        return fail(res, 400, 'Instagram username (handle) is required');
      }
    }
    if (provider === 'whatsapp') {
      handle = handle.replace(/[^\d]/g, '');
      if (connected && (handle.length < 8 || handle.length > 15)) {
        return fail(res, 400, 'WhatsApp number with country code is required');
      }
    }

    const list = Array.isArray(req.user.linkedAccounts)
      ? [...req.user.linkedAccounts]
      : [];
    const existing = list.find((a) => a.provider === provider);
    if (existing) {
      existing.connected = connected;
      existing.handle = connected ? handle : null;
    } else {
      list.push({
        provider,
        connected,
        handle: connected ? handle : null,
      });
    }
    // Ensure both providers always present in profile.
    for (const p of ['instagram', 'whatsapp']) {
      if (!list.some((a) => a.provider === p)) {
        list.push({ provider: p, connected: false, handle: null });
      }
    }
    req.user.linkedAccounts = list;
    await req.user.save();
    const saved = list.find((a) => a.provider === provider);
    return ok(res, {
      provider,
      connected: !!saved?.connected,
      handle: saved?.handle || null,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to update linked account');
  }
});

router.delete('/linked-accounts/:provider', authRequired, async (req, res) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const list = Array.isArray(req.user.linkedAccounts)
      ? [...req.user.linkedAccounts]
      : [];
    const existing = list.find((a) => a.provider === provider);
    if (existing) {
      existing.connected = false;
      existing.handle = null;
    } else {
      list.push({ provider, connected: false, handle: null });
    }
    req.user.linkedAccounts = list;
    await req.user.save();
    return ok(res, { provider, connected: false, handle: null });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to unlink account');
  }
});

router.get('/privacy', authRequired, (req, res) => {
  return ok(res, { privacy: publicUser(req.user).privacy });
});

router.patch('/privacy', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const keys = [
      'cameraAccess',
      'microphoneAccess',
      'locationAccess',
      'showOnlineStatus',
      'readReceipts',
      'whoCanPair',
      'whoCanSeePoses',
      'analyticsAndCrashReports',
    ];
    keys.forEach((k) => {
      if (body[k] !== undefined) req.user.privacy[k] = body[k];
    });
    if (body.showOnlineStatus !== undefined) {
      req.user.onlineStatus = !!body.showOnlineStatus;
    }
    await req.user.save();
    return ok(res, { privacy: publicUser(req.user).privacy });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to update privacy');
  }
});

router.get('/search', authRequired, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { role: 'user', status: 'active' };
    if (q) {
      filter.$or = [
        { username: new RegExp(q, 'i') },
        { displayName: new RegExp(q, 'i') },
      ];
    }
    const users = await User.find(filter).limit(20).sort({ displayName: 1 });
    return ok(res, { users: users.map(publicUser) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Search failed');
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return fail(res, 404, 'User not found');
    return ok(res, { user: publicUser(user) });
  } catch {
    return fail(res, 404, 'User not found');
  }
});

module.exports = router;
