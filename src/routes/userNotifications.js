const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { UserNotification } = require('../models');

const router = express.Router();

function toDto(n) {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    body: n.body,
    createdAt: (n.createdAt || new Date()).toISOString(),
    read: !!n.read,
    actions: n.actions || [],
    payload: {
      sessionId: n.payload?.sessionId || null,
      pairRequestId: n.payload?.pairRequestId || null,
      poseId: n.payload?.poseId || null,
      reaction: n.payload?.reaction || null,
    },
    actor: n.actor || null,
  };
}

router.get('/', authRequired, async (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    const query = { userId: req.user._id };
    if (filter === 'unread') query.read = false;
    const items = await UserNotification.find(query).sort({ createdAt: -1 }).limit(100);
    const unreadCount = await UserNotification.countDocuments({
      userId: req.user._id,
      read: false,
    });
    return ok(res, {
      unreadCount,
      items: items.map(toDto),
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Notifications failed');
  }
});

router.post('/read-all', authRequired, async (req, res) => {
  try {
    await UserNotification.updateMany(
      { userId: req.user._id, read: false },
      { $set: { read: true } },
    );
    return ok(res, { readAll: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Mark all read failed');
  }
});

router.post('/:id/read', authRequired, async (req, res) => {
  try {
    const n = await UserNotification.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!n) return fail(res, 404, 'Notification not found');
    n.read = true;
    await n.save();
    return ok(res, { read: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Mark read failed');
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await UserNotification.deleteOne({ _id: req.params.id, userId: req.user._id });
    return ok(res, { deleted: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Delete failed');
  }
});

module.exports = router;
