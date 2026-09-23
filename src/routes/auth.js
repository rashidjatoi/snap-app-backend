const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { User } = require('../models');
const { signToken, authRequired, publicUser } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const {
  generateOtp,
  sendOtpEmail,
  otpExpirySeconds,
  otpResendCooldownSeconds,
} = require('../services/mailService');

const router = express.Router();

function usernameFromName(fullName, email) {
  const base = (fullName || email.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 16);
  return `${base || 'user'}${Math.floor(Math.random() * 900 + 100)}`;
}

async function assignOtp(user, purpose) {
  const otp = generateOtp();
  const expiresIn = otpExpirySeconds();
  const cooldown = otpResendCooldownSeconds();
  user.emailOtp = otp;
  user.emailOtpPurpose = purpose;
  user.emailOtpExpiresAt = new Date(Date.now() + expiresIn * 1000);
  user.emailOtpResendAt = new Date(Date.now() + cooldown * 1000);
  await user.save();
  const sent = await sendOtpEmail(user.email, otp, purpose);
  return { sent, expiresIn, cooldown };
}

function clearOtp(user) {
  user.emailOtp = null;
  user.emailOtpExpiresAt = null;
  user.emailOtpPurpose = null;
  user.emailOtpResendAt = null;
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName, fullName, username } = req.body || {};
    const name = displayName || fullName;
    if (!email || !password || !name) {
      return fail(res, 400, 'email, password, and fullName are required');
    }

    const emailNorm = String(email).toLowerCase().trim();
    const emailExists = await User.findOne({ email: emailNorm });
    if (emailExists) {
      if (!emailExists.verified && !emailExists.isGuest) {
        const { sent, expiresIn, cooldown } = await assignOtp(
          emailExists,
          'verify',
        );
        if (!sent.success) {
          return fail(res, 502, sent.error || 'Failed to send verification email');
        }
        return ok(res, {
          requiresVerification: true,
          email: emailExists.email,
          message: 'Account exists but is not verified. A new code was sent.',
          otpExpiresIn: expiresIn,
          resendAvailableIn: cooldown,
        });
      }
      return fail(res, 409, 'Email already registered');
    }

    let finalUsername = username || usernameFromName(name, emailNorm);
    // eslint-disable-next-line no-constant-condition
    while (await User.findOne({ username: new RegExp(`^${finalUsername}$`, 'i') })) {
      finalUsername = usernameFromName(name, emailNorm);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: emailNorm,
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

    const { sent, expiresIn, cooldown } = await assignOtp(user, 'verify');
    if (!sent.success) {
      await User.deleteOne({ _id: user._id });
      return fail(res, 502, sent.error || 'Failed to send verification email');
    }

    return ok(res, {
      requiresVerification: true,
      email: user.email,
      message: 'Verification code sent to your email.',
      otpExpiresIn: expiresIn,
      resendAvailableIn: cooldown,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, err.message || 'Registration failed');
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
    if (user.status === 'banned') return fail(res, 403, 'Account banned', 'ACCOUNT_BANNED');
    if (user.status === 'suspended') {
      return fail(res, 403, 'Account suspended', 'ACCOUNT_SUSPENDED');
    }

    if (!user.verified && !user.isGuest) {
      return fail(
        res,
        403,
        'Please verify your email with the OTP we sent.',
        'EMAIL_NOT_VERIFIED',
      );
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
    return fail(res, 500, 'Login failed');
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, purpose } = req.body || {};
    const purposeKey = purpose === 'reset' ? 'reset' : 'verify';
    if (!email || !otp) return fail(res, 400, 'email and otp are required');

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return fail(res, 400, 'Invalid or expired code');

    if (
      !user.emailOtp ||
      user.emailOtpPurpose !== purposeKey ||
      !user.emailOtpExpiresAt ||
      user.emailOtpExpiresAt.getTime() < Date.now()
    ) {
      return fail(res, 400, 'Invalid or expired code', 'OTP_EXPIRED');
    }

    if (String(otp).trim() !== String(user.emailOtp)) {
      return fail(res, 400, 'Invalid or expired code', 'OTP_INVALID');
    }

    if (purposeKey === 'verify') {
      user.verified = true;
      clearOtp(user);
      user.lastActiveAt = new Date();
      await user.save();
      const token = signToken(user);
      return ok(res, {
        message: 'Email verified',
        token,
        accessToken: token,
        refreshToken: token,
        user: publicUser(user),
      });
    }

    // Password reset: issue short-lived reset token after OTP check
    const resetToken = `reset_${uuid().replace(/-/g, '').slice(0, 24)}`;
    user.resetToken = resetToken;
    user.resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    clearOtp(user);
    await user.save();
    return ok(res, {
      message: 'Code verified. Set a new password.',
      resetToken,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Verification failed');
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { email, purpose } = req.body || {};
    const purposeKey = purpose === 'reset' ? 'reset' : 'verify';
    if (!email) return fail(res, 400, 'email is required');

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    // Avoid enumeration
    if (!user) {
      return ok(res, {
        message: 'If that email exists, a new code was sent.',
        otpExpiresIn: otpExpirySeconds(),
        resendAvailableIn: otpResendCooldownSeconds(),
      });
    }

    if (purposeKey === 'verify' && user.verified) {
      return fail(res, 400, 'Email is already verified');
    }

    if (user.emailOtpResendAt && user.emailOtpResendAt.getTime() > Date.now()) {
      const wait = Math.ceil(
        (user.emailOtpResendAt.getTime() - Date.now()) / 1000,
      );
      return fail(
        res,
        429,
        `Please wait ${wait}s before requesting another code`,
        'OTP_RESEND_COOLDOWN',
      );
    }

    const { sent, expiresIn, cooldown } = await assignOtp(user, purposeKey);
    if (!sent.success) {
      return fail(res, 502, sent.error || 'Failed to send email');
    }

    return ok(res, {
      message: 'A new verification code was sent.',
      otpExpiresIn: expiresIn,
      resendAvailableIn: cooldown,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Resend failed');
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
      verified: true,
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
      if (user.status === 'banned') return fail(res, 403, 'Account banned', 'ACCOUNT_BANNED');
      if (user.status === 'suspended') {
        return fail(res, 403, 'Account suspended', 'ACCOUNT_SUSPENDED');
      }
      user.firebaseUid = user.firebaseUid || firebaseUid;
      if (!user.avatarUrl && decoded.picture) {
        user.avatarUrl = decoded.picture;
      }
      if (
        fullName &&
        String(fullName).trim() &&
        (!user.displayName || user.displayName.endsWith('User'))
      ) {
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
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    const expiresIn = otpExpirySeconds();
    const cooldown = otpResendCooldownSeconds();

    if (user && !user.isGuest) {
      if (user.emailOtpResendAt && user.emailOtpResendAt.getTime() > Date.now()) {
        const wait = Math.ceil(
          (user.emailOtpResendAt.getTime() - Date.now()) / 1000,
        );
        return fail(
          res,
          429,
          `Please wait ${wait}s before requesting another code`,
          'OTP_RESEND_COOLDOWN',
        );
      }
      const { sent } = await assignOtp(user, 'reset');
      if (!sent.success) {
        return fail(res, 502, sent.error || 'Failed to send email');
      }
    }

    return ok(res, {
      message: 'If that email exists, a reset code was sent.',
      requiresOtp: true,
      email: String(email).toLowerCase().trim(),
      otpExpiresIn: expiresIn,
      resendAvailableIn: cooldown,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Request failed');
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword, password, email, otp } = req.body || {};
    const nextPassword = newPassword || password;

    // Path A: email + OTP + new password (one step)
    if (email && otp && nextPassword) {
      const user = await User.findOne({
        email: String(email).toLowerCase().trim(),
      });
      if (
        !user ||
        !user.emailOtp ||
        user.emailOtpPurpose !== 'reset' ||
        !user.emailOtpExpiresAt ||
        user.emailOtpExpiresAt.getTime() < Date.now() ||
        String(otp).trim() !== String(user.emailOtp)
      ) {
        return fail(res, 400, 'Invalid or expired code', 'OTP_INVALID');
      }
      user.passwordHash = await bcrypt.hash(nextPassword, 10);
      clearOtp(user);
      user.resetToken = null;
      user.resetTokenExpiresAt = null;
      await user.save();
      return ok(res, { message: 'Password updated successfully' });
    }

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
    clearOtp(user);
    await user.save();
    return ok(res, { message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Reset failed');
  }
});

router.get('/me', authRequired, (req, res) => ok(res, { user: publicUser(req.user) }));

module.exports = router;
