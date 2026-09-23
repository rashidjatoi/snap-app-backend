const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { PairRequest, User } = require('../models');
const {
  createSessionForHost,
  joinedPayload,
  assertHostAllowsJoin,
  notifyUser,
} = require('../services/sessionService');

const router = express.Router();

router.post('/:id/accept', authRequired, async (req, res) => {
  try {
    const pr = await PairRequest.findById(req.params.id);
    if (!pr) return fail(res, 404, 'Pair request not found', 'PAIR_REQUEST_NOT_FOUND');
    if (pr.status !== 'pending') {
      return fail(res, 410, 'Pair request expired or already handled', 'PAIR_REQUEST_EXPIRED');
    }
    if (pr.expiresAt < new Date()) {
      pr.status = 'expired';
      await pr.save();
      return fail(res, 410, 'Pair request expired', 'PAIR_REQUEST_EXPIRED');
    }
    if (String(pr.toUserId) !== String(req.user._id)) {
      return fail(res, 403, 'Not your pair request', 'PAIRING_DENIED');
    }

    const fromUser = await User.findById(pr.fromUserId);
    if (!fromUser) return fail(res, 404, 'Requester not found', 'PAIR_REQUEST_NOT_FOUND');

    await assertHostAllowsJoin(req.user, fromUser);

    // Create a fresh paired session with acceptor as host for clarity
    const session = await createSessionForHost(req.user);
    session.guestId = fromUser._id;
    session.status = 'paired';
    await session.save();

    pr.status = 'accepted';
    pr.sessionId = session._id;
    await pr.save();

    try {
      const {
        ensureAcceptedFriends,
        notifyBecameFriends,
      } = require('../services/friendsService');
      const result = await ensureAcceptedFriends(req.user._id, fromUser._id, {
        requestedBy: req.user._id,
      });
      if (result?.created) {
        await notifyBecameFriends(req.user._id, fromUser._id);
      }
    } catch (friendErr) {
      console.warn('Auto-friend on pair accept failed:', friendErr.message);
    }

    await notifyUser({
      userId: fromUser._id,
      type: 'session_started',
      title: `${req.user.displayName} accepted your pair request`,
      body: 'You are ready to sync cameras.',
      actions: ['join_session'],
      payload: { sessionId: session._id.toString() },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, await joinedPayload(session));
  } catch (err) {
    return fail(res, err.status || 500, err.message || 'Accept failed', err.code);
  }
});

router.post('/:id/decline', authRequired, async (req, res) => {
  try {
    const pr = await PairRequest.findById(req.params.id);
    if (!pr) return fail(res, 404, 'Pair request not found', 'PAIR_REQUEST_NOT_FOUND');
    if (String(pr.toUserId) !== String(req.user._id)) {
      return fail(res, 403, 'Not your pair request');
    }
    pr.status = 'declined';
    await pr.save();

    await notifyUser({
      userId: pr.fromUserId,
      type: 'pair_request_declined',
      title: `${req.user.displayName} declined your request`,
      body: 'The pose request was cancelled.',
      actions: [],
      payload: { pairRequestId: pr._id.toString(), status: 'declined' },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, { declined: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Decline failed');
  }
});

/** Sender cancels a pending pair request — clears for both sides. */
router.post('/:id/cancel', authRequired, async (req, res) => {
  try {
    const pr = await PairRequest.findById(req.params.id);
    if (!pr) return fail(res, 404, 'Pair request not found', 'PAIR_REQUEST_NOT_FOUND');
    if (String(pr.fromUserId) !== String(req.user._id)) {
      return fail(res, 403, 'Only the sender can cancel');
    }
    if (!['pending'].includes(pr.status)) {
      return ok(res, { cancelled: true, status: pr.status });
    }
    pr.status = 'cancelled';
    await pr.save();

    await notifyUser({
      userId: pr.toUserId,
      type: 'pair_request_cancelled',
      title: `${req.user.displayName} cancelled the request`,
      body: 'The pose request is no longer active.',
      actions: [],
      payload: { pairRequestId: pr._id.toString(), status: 'cancelled' },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, { cancelled: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Cancel failed');
  }
});

/** Optional helper: send a pair request to another user by id/email */
router.post('/', authRequired, async (req, res) => {
  try {
    const { toUserId, email } = req.body || {};
    let target = null;
    if (toUserId) target = await User.findById(toUserId);
    else if (email) target = await User.findOne({ email: String(email).toLowerCase() });
    if (!target) return fail(res, 404, 'User not found');
    if (String(target._id) === String(req.user._id)) {
      return fail(res, 400, 'Cannot pair with yourself');
    }

    const pr = await PairRequest.create({
      fromUserId: req.user._id,
      toUserId: target._id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await notifyUser({
      userId: target._id,
      type: 'pair_request',
      title: `${req.user.displayName} sent a pose request`,
      body: `${req.user.displayName} wants to HoldPose with you.`,
      actions: ['accept_pair', 'decline_pair'],
      payload: { pairRequestId: pr._id.toString() },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, { pairRequestId: pr._id.toString(), status: 'pending' });
  } catch (err) {
    return fail(res, 500, err.message || 'Pair request failed');
  }
});

module.exports = router;
