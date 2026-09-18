const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { PosePing, User } = require('../models');
const { areFriends } = require('../services/friendsService');
const {
  createPing,
  respondToPing,
  markReady,
  pingDto,
  refreshDelayedReady,
} = require('../services/posePingService');

const router = express.Router();

async function assertCanPing(fromUser, target) {
  const friends = await areFriends(fromUser._id, target._id);
  const who = target.privacy?.whoCanPair || 'friends_only';
  if (who === 'nobody') {
    const err = new Error('This user is not accepting PosePings');
    err.status = 403;
    err.code = 'PAIRING_DENIED';
    throw err;
  }
  if (who === 'friends_only' && !friends) {
    const err = new Error('Add them as a friend before sending a PosePing');
    err.status = 403;
    err.code = 'NOT_FRIENDS';
    throw err;
  }
}

/** Instant PosePing / HoldPose Knock. */
router.post('/', authRequired, async (req, res) => {
  try {
    const { toUserId, kind } = req.body || {};
    if (!toUserId) {
      return fail(res, 400, 'toUserId is required', 'VALIDATION_ERROR');
    }
    if (String(toUserId) === String(req.user._id)) {
      return fail(res, 400, 'Cannot PosePing yourself', 'VALIDATION_ERROR');
    }
    const target = await User.findById(toUserId);
    if (!target) return fail(res, 404, 'User not found', 'USER_NOT_FOUND');
    await assertCanPing(req.user, target);

    const pingKind = kind === 'knock' ? 'knock' : 'instant';
    const data = await createPing({
      fromUser: req.user,
      toUserId: target._id,
      kind: pingKind,
      req,
    });
    return ok(res, { posePing: data });
  } catch (err) {
    console.error(err);
    return fail(res, err.status || 500, err.message || 'PosePing failed', err.code);
  }
});

/** Schedule a Pose for a future moment (time zones / “tonight at 8”). */
router.post('/schedule', authRequired, async (req, res) => {
  try {
    const { toUserId, scheduledAt } = req.body || {};
    if (!toUserId || !scheduledAt) {
      return fail(
        res,
        400,
        'toUserId and scheduledAt are required',
        'VALIDATION_ERROR',
      );
    }
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return fail(res, 400, 'scheduledAt must be a future time', 'VALIDATION_ERROR');
    }
    if (String(toUserId) === String(req.user._id)) {
      return fail(res, 400, 'Cannot schedule with yourself', 'VALIDATION_ERROR');
    }
    const target = await User.findById(toUserId);
    if (!target) return fail(res, 404, 'User not found', 'USER_NOT_FOUND');
    await assertCanPing(req.user, target);

    const data = await createPing({
      fromUser: req.user,
      toUserId: target._id,
      kind: 'schedule',
      scheduledAt: when.toISOString(),
      req,
    });
    return ok(res, { posePing: data });
  } catch (err) {
    console.error(err);
    return fail(res, err.status || 500, err.message || 'Schedule failed', err.code);
  }
});

/** One-tap invite link for someone without HoldPose yet. */
router.post('/invite-link', authRequired, async (req, res) => {
  try {
    const data = await createPing({
      fromUser: req.user,
      toUserId: null,
      kind: 'invite',
      req,
    });
    return ok(res, {
      posePing: data,
      shareMessage: `❤️ ${req.user.displayName} sent you a PosePing!\nPosePing™ — Tap. Join. Pose. Together.\n${data.inviteUrl}`,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, err.message || 'Invite link failed');
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    let ping = await PosePing.findById(req.params.id);
    if (!ping) return fail(res, 404, 'PosePing not found', 'POSE_PING_NOT_FOUND');

    const me = String(req.user._id);
    const isParty =
      String(ping.fromUserId) === me ||
      (ping.toUserId && String(ping.toUserId) === me);
    if (!isParty) {
      return fail(res, 403, 'Not your PosePing', 'FORBIDDEN');
    }

    ping = await refreshDelayedReady(ping);
    return ok(res, { posePing: await pingDto(ping, req) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load PosePing');
  }
});

router.post('/:id/respond', authRequired, async (req, res) => {
  try {
    const { response } = req.body || {};
    if (!['join_now', 'ten_min', 'later'].includes(response)) {
      return fail(
        res,
        400,
        'response must be join_now, ten_min, or later',
        'VALIDATION_ERROR',
      );
    }
    const ping = await PosePing.findById(req.params.id);
    if (!ping) return fail(res, 404, 'PosePing not found', 'POSE_PING_NOT_FOUND');

    const data = await respondToPing({
      ping,
      responder: req.user,
      response,
      req,
    });
    return ok(res, { posePing: data });
  } catch (err) {
    console.error(err);
    return fail(res, err.status || 500, err.message || 'Respond failed', err.code);
  }
});

/** Bilateral "I'm Ready" — no live cameras. */
router.post('/:id/ready', authRequired, async (req, res) => {
  try {
    const ping = await PosePing.findById(req.params.id);
    if (!ping) return fail(res, 404, 'PosePing not found', 'POSE_PING_NOT_FOUND');
    const data = await markReady({ ping, user: req.user, req });
    return ok(res, { posePing: data });
  } catch (err) {
    console.error(err);
    return fail(res, err.status || 500, err.message || 'Ready failed', err.code);
  }
});

router.post('/:id/cancel', authRequired, async (req, res) => {
  try {
    const ping = await PosePing.findById(req.params.id);
    if (!ping) return fail(res, 404, 'PosePing not found', 'POSE_PING_NOT_FOUND');
    if (String(ping.fromUserId) !== String(req.user._id)) {
      return fail(res, 403, 'Only the sender can cancel', 'FORBIDDEN');
    }
    ping.status = 'cancelled';
    await ping.save();
    return ok(res, { posePing: await pingDto(ping, req) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Cancel failed');
  }
});

module.exports = router;
