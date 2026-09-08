const express = require('express');
const { User, Snap } = require('../models');
const { authRequired, publicUser } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

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

router.post('/linked-accounts/:provider', authRequired, async (req, res) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const connected = req.body?.connected !== false;
    const list = req.user.linkedAccounts || [];
    const existing = list.find((a) => a.provider === provider);
    if (existing) existing.connected = connected;
    else list.push({ provider, connected });
    req.user.linkedAccounts = list;
    await req.user.save();
    return ok(res, { provider, connected });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to update linked account');
  }
});

router.delete('/linked-accounts/:provider', authRequired, async (req, res) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const list = req.user.linkedAccounts || [];
    const existing = list.find((a) => a.provider === provider);
    if (existing) existing.connected = false;
    else list.push({ provider, connected: false });
    req.user.linkedAccounts = list;
    await req.user.save();
    return ok(res, { provider, connected: false });
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
