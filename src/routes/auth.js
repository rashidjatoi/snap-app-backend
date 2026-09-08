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
    const { provider, idToken, fullName, email: clientEmail } = req.body || {};
    if (!provider || !idToken) {
      return fail(res, 400, 'provider and idToken are required');
    }

    const providerKey = String(provider).toLowerCase();
    if (!['google', 'apple'].includes(providerKey)) {
      return fail(res, 400, 'provider must be google or apple');
    }

    const { initFirebase } = require('../services/firebaseStorage');
    const admin = require('firebase-admin');
    initFirebase();

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(String(idToken));
    } catch (err) {
      console.error('verifyIdToken failed:', err.message);
      return fail(res, 401, 'Invalid Firebase idToken');
    }

    const firebaseUid = decoded.uid;
    if (!firebaseUid) {
      return fail(res, 401, 'Firebase token missing uid');
    }

    const tokenProvider =
      decoded.firebase?.sign_in_provider ||
      (decoded.firebase?.identities &&
        Object.keys(decoded.firebase.identities)[0]) ||
      providerKey;

    // Prefer verified email from Firebase; Apple may omit it after first login.
    const socialEmail = String(
      decoded.email || clientEmail || `${providerKey}_${firebaseUid}@users.snapapp.local`,
    ).toLowerCase();

    const name =
      (fullName && String(fullName).trim()) ||
      decoded.name ||
      [decoded.given_name, decoded.family_name].filter(Boolean).join(' ') ||
      (providerKey === 'apple' ? 'Apple User' : 'Google User');

    let user =
      (await User.findOne({ firebaseUid })) ||
      (await User.findOne({ email: socialEmail }));

    if (!user) {
      const username = usernameFromName(name, socialEmail);
      user = await User.create({
        email: socialEmail,
        firebaseUid,
        passwordHash: await bcrypt.hash(uuid(), 10),
        displayName: name,
        username,
        role: 'user',
        status: 'active',
        verified: !!decoded.email_verified || providerKey === 'apple',
        lastActiveAt: new Date(),
        avatarUrl: decoded.picture || null,
        linkedAccounts: [
          { provider: providerKey, connected: true },
          { provider: 'instagram', connected: false },
          { provider: 'whatsapp', connected: false },
        ],
      });
    } else {
      user.firebaseUid = user.firebaseUid || firebaseUid;
      if (!user.avatarUrl && decoded.picture) {
        user.avatarUrl = decoded.picture;
      }
      if (fullName && String(fullName).trim() && (!user.displayName || user.displayName.endsWith('User'))) {
        user.displayName = String(fullName).trim();
      }
      const linked = Array.isArray(user.linkedAccounts) ? [...user.linkedAccounts] : [];
      if (!linked.some((a) => a.provider === providerKey && a.connected)) {
        linked.push({ provider: providerKey, connected: true });
        user.linkedAccounts = linked;
      }
      user.verified = true;
    }

    user.lastActiveAt = new Date();
    await user.save();

    const token = signToken(user);
    return ok(res, {
      token,
      accessToken: token,
      refreshToken: token,
      user: publicUser(user),
      firebase: {
        uid: firebaseUid,
        signInProvider: tokenProvider,
      },
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
