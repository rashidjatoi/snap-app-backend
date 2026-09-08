const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { User } = require('../models');
const { signToken, authRequired, publicUser } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

function usernameFromName(fullName, email) {
  const base = (fullName || email.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 16);
  return `${base || 'user'}${Math.floor(Math.random() * 900 + 100)}`;
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName, fullName, username } = req.body || {};
    const name = displayName || fullName;
    if (!email || !password || !name) {
      return fail(res, 400, 'email, password, and fullName are required');
    }

    const emailExists = await User.findOne({ email: String(email).toLowerCase() });
    if (emailExists) return fail(res, 409, 'Email already registered');

    let finalUsername = username || usernameFromName(name, email);
    // ensure unique
    // eslint-disable-next-line no-constant-condition
    while (await User.findOne({ username: new RegExp(`^${finalUsername}$`, 'i') })) {
      finalUsername = usernameFromName(name, email);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: String(email).toLowerCase(),
      passwordHash,
      displayName: name,
      username: finalUsername,
      role: 'user',
      status: 'active',
      verified: false,
      premium: false,
      bio: '',
      lastActiveAt: new Date(),
    });

    const token = signToken(user);
    return ok(res, {
      token,
      accessToken: token,
      refreshToken: token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Registration failed');
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, 400, 'email and password are required');

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return fail(res, 401, 'Invalid credentials');

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return fail(res, 401, 'Invalid credentials');
    if (user.status === 'banned') return fail(res, 403, 'Account banned');
    if (user.status === 'suspended') return fail(res, 403, 'Account suspended');

    user.lastActiveAt = new Date();
    await user.save();

    const token = signToken(user);
    return ok(res, {
      token,
      accessToken: token,
      refreshToken: token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Login failed');
  }
});

router.post('/guest', async (req, res) => {
  try {
    const guestName = `Guest ${Math.floor(Math.random() * 9000 + 1000)}`;
    const username = `guest${Date.now().toString().slice(-8)}`;
    const passwordHash = await bcrypt.hash(uuid(), 10);
    const user = await User.create({
      email: `${username}@guest.snapapp.local`,
      passwordHash,
      displayName: guestName,
      username,
      role: 'user',
      status: 'active',
      isGuest: true,
      bio: '',
      lastActiveAt: new Date(),
    });
    const token = signToken(user);
    return ok(res, {
      token,
      accessToken: token,
      refreshToken: token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Guest login failed');
  }
});

router.post('/social', async (req, res) => {
  try {
    const { provider, idToken, email, fullName } = req.body || {};
    if (!provider || !idToken) {
      return fail(res, 400, 'provider and idToken are required');
    }
    const socialEmail =
      email || `${provider}_${String(idToken).slice(0, 8)}@social.snapapp.local`;
    let user = await User.findOne({ email: String(socialEmail).toLowerCase() });
    if (!user) {
      const name = fullName || `${provider} user`;
      const username = usernameFromName(name, socialEmail);
      user = await User.create({
        email: String(socialEmail).toLowerCase(),
        passwordHash: await bcrypt.hash(uuid(), 10),
        displayName: name,
        username,
        role: 'user',
        status: 'active',
        verified: true,
        lastActiveAt: new Date(),
        linkedAccounts: [
          { provider: provider.toLowerCase(), connected: true },
          { provider: 'instagram', connected: false },
          { provider: 'whatsapp', connected: false },
        ],
      });
    }
    user.lastActiveAt = new Date();
    await user.save();
    const token = signToken(user);
    return ok(res, {
      token,
      accessToken: token,
      refreshToken: token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Social login failed');
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return fail(res, 400, 'email is required');
    const user = await User.findOne({ email: String(email).toLowerCase() });
    // Always succeed to avoid email enumeration
    let resetToken = null;
    if (user) {
      resetToken = `reset_${uuid().replace(/-/g, '').slice(0, 24)}`;
      user.resetToken = resetToken;
      user.resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
    }
    return ok(res, {
      message: 'If that email exists, a reset link was sent.',
      // Returned for MVP/demo so the app can navigate to reset
      resetToken,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Request failed');
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword, password } = req.body || {};
    const nextPassword = newPassword || password;
    if (!token || !nextPassword) {
      return fail(res, 400, 'token and newPassword are required');
    }
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiresAt: { $gt: new Date() },
    });
    if (!user) return fail(res, 400, 'Invalid or expired reset token');
    user.passwordHash = await bcrypt.hash(nextPassword, 10);
    user.resetToken = null;
    user.resetTokenExpiresAt = null;
    await user.save();
    return ok(res, { message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Reset failed');
  }
});

router.get('/me', authRequired, (req, res) => ok(res, { user: publicUser(req.user) }));

module.exports = router;
