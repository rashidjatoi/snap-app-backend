const express = require('express');
const { Notification, User } = require('../../models');
const { ok, fail } = require('../../utils/response');
const { notifyUser } = require('../../services/pushNotify');

const router = express.Router();

async function resolveAudience(audience) {
  const filter = {
    role: 'user',
    status: { $nin: ['banned', 'suspended'] },
  };
  if (audience === 'premium') filter.premium = true;
  return User.find(filter).select('_id');
}

async function fanOut({ title, body, audience, type }) {
  const users = await resolveAudience(audience || 'all');
  let delivered = 0;
  for (const u of users) {
    try {
      await notifyUser({
        userId: u._id,
        type,
        title,
        body,
        actions: [],
        payload: {},
        actor: { initial: 'H', name: 'HoldPose' },
      });
      delivered += 1;
    } catch (err) {
      console.warn('notifyUser failed', u._id.toString(), err.message);
    }
  }
  return { recipientCount: users.length, delivered };
}

router.get('/', async (req, res) => {
  const items = await Notification.find().sort({ sentAt: -1, createdAt: -1 });
  return ok(res, { notifications: items.map((n) => n.toJSONSafe()) });
});

router.post('/push', async (req, res) => {
  try {
    const { title, body, audience, type } = req.body || {};
    if (!title || !body) return fail(res, 400, 'title and body are required');
    const notifType = type || 'admin_push';
    const delivery = await fanOut({
      title,
      body,
      audience: audience || 'all',
      type: notifType === 'push' ? 'admin_push' : notifType,
    });
    const notification = await Notification.create({
      title,
      body,
      audience: audience || 'all',
      type: type || 'push',
      status: 'sent',
      sentAt: new Date(),
      deliveredCount: delivery.delivered,
      recipientCount: delivery.recipientCount,
    });
    return ok(res, {
      notification: notification.toJSONSafe(),
      ...delivery,
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
    const delivery = await fanOut({
      title,
      body,
      audience: 'all',
      type: 'announcement',
    });
    const notification = await Notification.create({
      title,
      body,
      audience: 'all',
      type: 'announcement',
      status: 'sent',
      sentAt: new Date(),
      deliveredCount: delivery.delivered,
      recipientCount: delivery.recipientCount,
    });
    return ok(res, { announcement: notification.toJSONSafe(), ...delivery });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to send announcement');
  }
});

router.post('/event', async (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || !body) return fail(res, 400, 'title and body are required');
    const delivery = await fanOut({
      title,
      body,
      audience: 'all',
      type: 'event',
    });
    const notification = await Notification.create({
      title,
      body,
      audience: 'all',
      type: 'event',
      status: 'sent',
      sentAt: new Date(),
      deliveredCount: delivery.delivered,
      recipientCount: delivery.recipientCount,
    });
    return ok(res, { event: notification.toJSONSafe(), ...delivery });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to send event');
  }
});

module.exports = router;
