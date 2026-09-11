const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../../models');
const { publicUser } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = req.query.status;
    const filter = { role: 'user' };
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { email: new RegExp(q, 'i') },
        { username: new RegExp(q, 'i') },
        { displayName: new RegExp(q, 'i') },
      ];
    }
    const users = await User.find(filter).sort({ createdAt: -1 });
    return ok(res, { users: users.map(publicUser) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to list users');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return fail(res, 404, 'User not found');
    return ok(res, { user: publicUser(user) });
  } catch {
    return fail(res, 404, 'User not found');
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'suspended', 'banned'].includes(status)) {
      return fail(res, 400, 'status must be active, suspended, or banned');
    }
    const user = await User.findOne({ _id: req.params.id, role: 'user' });
    if (!user) return fail(res, 404, 'User not found');
    user.status = status;
    await user.save();
    const { notifyUser } = require('../../services/pushNotify');
    await notifyUser({
      userId: user._id,
      type: 'account_status',
      title: status === 'active' ? 'Account restored' : `Account ${status}`,
      body:
        status === 'banned'
          ? 'Your account has been banned by an admin.'
          : status === 'suspended'
            ? 'Your account has been suspended by an admin.'
            : 'Your account is active again.',
      payload: { status },
    });
    return ok(res, { user: publicUser(user) });
  } catch {
    return fail(res, 404, 'User not found');
  }
});

router.patch('/:id/verify', async (req, res) => {
  try {
    const verified = req.body?.verified !== false;
    const user = await User.findOne({ _id: req.params.id, role: 'user' });
    if (!user) return fail(res, 404, 'User not found');
    user.verified = !!verified;
    await user.save();
    const { notifyUser } = require('../../services/pushNotify');
    await notifyUser({
      userId: user._id,
      type: 'account_verified',
      title: verified ? 'Verified' : 'Verification removed',
      body: verified
        ? 'Your HoldPose profile is now verified.'
        : 'Your verified badge was removed.',
      payload: { verified },
    });
    return ok(res, { user: publicUser(user) });
  } catch {
    return fail(res, 404, 'User not found');
  }
});

router.patch('/:id/capture', async (req, res) => {
  try {
    const enabled = req.body?.enabled !== false;
    const user = await User.findOne({ _id: req.params.id, role: 'user' });
    if (!user) return fail(res, 404, 'User not found');
    if (!user.privacy) user.privacy = {};
    user.privacy.adminMediaLock = !enabled;
    user.privacy.cameraAccess = enabled;
    user.privacy.microphoneAccess = enabled;
    await user.save();
    const { notifyUser } = require('../../services/pushNotify');
    await notifyUser({
      userId: user._id,
      type: 'capture_access',
      title: enabled ? 'Camera unlocked' : 'Camera disabled',
      body: enabled
        ? 'An admin restored your camera and microphone access.'
        : 'An admin disabled camera capture on your account.',
      payload: { enabled },
    });
    return ok(res, { user: publicUser(user) });
  } catch {
    return fail(res, 404, 'User not found');
  }
});

router.post('/:id/reset', async (req, res) => {
  try {
    const tempPassword = req.body?.password || 'Reset@123';
    const user = await User.findOne({ _id: req.params.id, role: 'user' });
    if (!user) return fail(res, 404, 'User not found');
    user.passwordHash = await bcrypt.hash(tempPassword, 10);
    user.status = 'active';
    await user.save();
    return ok(res, { user: publicUser(user), temporaryPassword: tempPassword });
  } catch {
    return fail(res, 404, 'User not found');
  }
});

module.exports = router;
