const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (user.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Account banned',
        error: { code: 'ACCOUNT_BANNED' },
      });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account suspended',
        error: { code: 'ACCOUNT_SUSPENDED' },
      });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}

function publicUser(user) {
  if (!user) return null;
  if (typeof user.toPublic === 'function') return user.toPublic();
  return user;
}

module.exports = { signToken, authRequired, adminRequired, publicUser };
