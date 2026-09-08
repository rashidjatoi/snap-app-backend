const express = require('express');
const { Notification } = require('../../models');
const { ok, fail } = require('../../utils/response');

const router = express.Router();

router.get('/', async (req, res) => {
  const items = await Notification.find().sort({ sentAt: -1, createdAt: -1 });
  return ok(res, { notifications: items.map((n) => n.toJSONSafe()) });
});

router.post('/push', async (req, res) => {
  try {
    const { title, body, audience, type } = req.body || {};
    if (!title || !body) return fail(res, 400, 'title and body are required');
    const notification = await Notification.create({
      title,
      body,
      audience: audience || 'all',
      type: type || 'push',
      status: 'sent',
      sentAt: new Date(),
    });
    return ok(res, {
      notification: notification.toJSONSafe(),
      deliveredEstimate: audience === 'premium' ? 3 : 6,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to send push');
  }
});

router.post('/announcement', async (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || !body) return fail(res, 400, 'title and body are required');
    const notification = await Notification.create({
      title,
      body,
      audience: 'all',
      type: 'announcement',
      status: 'sent',
      sentAt: new Date(),
    });
    return ok(res, { announcement: notification.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to send announcement');
  }
});

router.post('/event', async (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || !body) return fail(res, 400, 'title and body are required');
    const notification = await Notification.create({
      title,
      body,
      audience: 'all',
      type: 'event',
      status: 'sent',
      sentAt: new Date(),
    });
    return ok(res, { event: notification.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to send event');
  }
});

module.exports = router;
