const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { Friendship, User } = require('../models');
const {
  listFriends,
  listPendingFor,
  getFriendship,
  friendDto,
} = require('../services/friendsService');
const { notifyUser } = require('../services/pushNotify');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const items = await listFriends(req.user._id);
    return ok(res, { items, count: items.length });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load friends');
  }
});

router.get('/requests', authRequired, async (req, res) => {
  try {
    const data = await listPendingFor(req.user._id);
    return ok(res, data);
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load friend requests');
  }
});

router.post('/request', authRequired, async (req, res) => {
  try {
    const { toUserId, username } = req.body || {};
    let target = null;
    if (toUserId) target = await User.findById(toUserId);
    else if (username) {
      target = await User.findOne({
        username: String(username).trim().replace(/^@/, ''),
      });
    }
    if (!target) return fail(res, 404, 'User not found', 'USER_NOT_FOUND');
    if (String(target._id) === String(req.user._id)) {
      return fail(res, 400, 'Cannot add yourself', 'VALIDATION_ERROR');
    }

    const pair = Friendship.orderedPair(req.user._id, target._id);
    let row = await Friendship.findOne({
      userA: pair.userA,
      userB: pair.userB,
    });

    if (row?.status === 'accepted') {
      return fail(res, 409, 'Already friends', 'ALREADY_FRIENDS');
    }
    if (row?.status === 'pending') {
      return ok(res, {
        friendshipId: row._id.toString(),
        status: 'pending',
        user: friendDto(target),
      });
    }

    if (row) {
      row.status = 'pending';
      row.requestedBy = req.user._id;
      await row.save();
    } else {
      row = await Friendship.create({
        ...pair,
        requestedBy: req.user._id,
        status: 'pending',
      });
    }

    await notifyUser({
      userId: target._id,
      type: 'friend_request',
      title: `${req.user.displayName} sent a friend request`,
      body: 'Add them to PosePing together.',
      actions: ['accept_friend', 'decline_friend'],
      payload: { friendshipId: row._id.toString() },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, {
      friendshipId: row._id.toString(),
      status: 'pending',
      user: friendDto(target),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, err.message || 'Friend request failed');
  }
});

router.post('/requests/:id/accept', authRequired, async (req, res) => {
  try {
    const row = await Friendship.findById(req.params.id);
    if (!row) return fail(res, 404, 'Request not found', 'FRIEND_REQUEST_NOT_FOUND');
    if (row.status !== 'pending') {
      return fail(res, 409, 'Request already handled', 'FRIEND_REQUEST_HANDLED');
    }

    const me = String(req.user._id);
    const isParticipant =
      String(row.userA) === me || String(row.userB) === me;
    if (!isParticipant) {
      return fail(res, 403, 'Not your friend request', 'FORBIDDEN');
    }
    if (String(row.requestedBy) === me) {
      return fail(res, 400, 'Cannot accept your own request', 'VALIDATION_ERROR');
    }

    row.status = 'accepted';
    await row.save();

    const otherId =
      String(row.userA) === me ? row.userB : row.userA;
    const other = await User.findById(otherId);

    await notifyUser({
      userId: otherId,
      type: 'friend_request',
      title: `${req.user.displayName} accepted your friend request`,
      body: 'You are friends — try PosePing™.',
      actions: [],
      payload: { friendshipId: row._id.toString() },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, {
      friendshipId: row._id.toString(),
      status: 'accepted',
      user: friendDto(other),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Accept failed');
  }
});

router.post('/requests/:id/decline', authRequired, async (req, res) => {
  try {
    const row = await Friendship.findById(req.params.id);
    if (!row) return fail(res, 404, 'Request not found', 'FRIEND_REQUEST_NOT_FOUND');

    const me = String(req.user._id);
    const isParticipant =
      String(row.userA) === me || String(row.userB) === me;
    if (!isParticipant) {
      return fail(res, 403, 'Not your friend request', 'FORBIDDEN');
    }

    row.status = 'declined';
    await row.save();
    return ok(res, { declined: true });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Decline failed');
  }
});

router.delete('/:userId', authRequired, async (req, res) => {
  try {
    const otherId = req.params.userId;
    if (String(otherId) === String(req.user._id)) {
      return fail(res, 400, 'Cannot remove yourself', 'VALIDATION_ERROR');
    }
    const pair = Friendship.orderedPair(req.user._id, otherId);
    const result = await Friendship.deleteOne({
      userA: pair.userA,
      userB: pair.userB,
    });
    if (!result.deletedCount) {
      return fail(res, 404, 'Friendship not found', 'NOT_FRIENDS');
    }
    return ok(res, { removed: true });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Remove failed');
  }
});

/** Relationship helper for profile screens. */
router.get('/status/:userId', authRequired, async (req, res) => {
  try {
    const otherId = req.params.userId;
    if (String(otherId) === String(req.user._id)) {
      return ok(res, { status: 'self' });
    }
    const row = await getFriendship(req.user._id, otherId);
    if (!row) return ok(res, { status: 'none' });
    if (row.status === 'accepted') {
      return ok(res, { status: 'friends', friendshipId: row._id.toString() });
    }
    if (row.status === 'pending') {
      const direction =
        String(row.requestedBy) === String(req.user._id)
          ? 'outgoing'
          : 'incoming';
      return ok(res, {
        status: 'pending',
        direction,
        friendshipId: row._id.toString(),
      });
    }
    return ok(res, { status: 'none' });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Status failed');
  }
});

module.exports = router;
