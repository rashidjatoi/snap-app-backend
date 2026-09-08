const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

/** Register / refresh FCM device token for push. */
router.post('/', authRequired, async (req, res) => {
  try {
    const token = String(req.body?.token || req.body?.fcmToken || '').trim();
    if (!token) return fail(res, 400, 'token is required');
    const tokens = new Set(req.user.fcmTokens || []);
    tokens.add(token);
    req.user.fcmTokens = [...tokens].slice(-10);
    await req.user.save();
    return ok(res, { registered: true, count: req.user.fcmTokens.length });
  } catch (err) {
    return fail(res, 500, err.message || 'Device register failed');
  }
});

router.delete('/', authRequired, async (req, res) => {
  try {
    const token = String(req.body?.token || req.body?.fcmToken || '').trim();
    req.user.fcmTokens = (req.user.fcmTokens || []).filter((t) => t !== token);
    await req.user.save();
    return ok(res, { removed: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Device unregister failed');
  }
});

module.exports = router;
