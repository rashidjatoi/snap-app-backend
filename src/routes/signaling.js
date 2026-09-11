const { v4: uuid } = require('uuid');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { Session } = require('../models');

/**
 * Persist a signal without Mongoose optimistic-concurrency (__v) races.
 * Concurrent ICE/offer posts from both peers were throwing VersionError.
 */
async function appendSignal(sessionId, { type, fromUserId, payload }) {
  // Never persist latency probes — they flooded Cloud Run clients and Mongo.
  if (type === 'latency.ping' || type === 'latency.pong') {
    return {
      session: await Session.findById(sessionId),
      signal: {
        signalId: `sig_${uuid().replace(/-/g, '').slice(0, 12)}`,
        type,
        fromUserId,
        payload: payload || {},
        createdAt: new Date(),
      },
    };
  }

  const signal = {
    signalId: `sig_${uuid().replace(/-/g, '').slice(0, 12)}`,
    type,
    fromUserId,
    payload: payload || {},
    createdAt: new Date(),
  };

  const update = {
    $push: {
      signals: {
        $each: [signal],
        $slice: -80,
      },
    },
  };

  if (type === 'peer.ready') {
    update.$addToSet = { readyUserIds: fromUserId };
  }
  if (type === 'peer.left') {
    update.$pull = { readyUserIds: fromUserId };
  }

  let session = await Session.findByIdAndUpdate(sessionId, update, {
    new: true,
  });
  if (
    type === 'peer.ready' &&
    session &&
    ['paired', 'ready_to_pair'].includes(session.status)
  ) {
    session = await Session.findByIdAndUpdate(
      sessionId,
      { $set: { status: 'live' } },
      { new: true },
    );
  }
  return { session, signal };
}

/**
 * WebRTC signaling over REST (works on Vercel serverless).
 * Socket.IO (when available on long-running Node) mirrors the same events.
 */
function attachSignalRoutes(router, { broadcast } = {}) {
  async function loadParticipantSession(req, res) {
    const session = await Session.findById(req.params.sessionId);
    if (!session) {
      fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
      return null;
    }
    const uid = String(req.user._id);
    const isHost = String(session.hostId) === uid;
    const isGuest = session.guestId && String(session.guestId) === uid;
    if (!isHost && !isGuest) {
      fail(res, 403, 'Not a session participant');
      return null;
    }
    return session;
  }

  router.post('/:sessionId/signal', authRequired, async (req, res) => {
    try {
      const existing = await loadParticipantSession(req, res);
      if (!existing) return;

      const type = String(req.body?.type || '').trim();
      if (!type) return fail(res, 400, 'type is required', 'VALIDATION_ERROR');

      const fromUserId = String(req.user._id);
      const { session, signal } = await appendSignal(existing._id, {
        type,
        fromUserId,
        payload: req.body?.payload || {},
      });
      if (!session) {
        return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
      }

      if (typeof broadcast === 'function') {
        broadcast(
          session._id.toString(),
          {
            ...signal,
            sessionId: session._id.toString(),
            createdAt: signal.createdAt.toISOString(),
          },
          fromUserId,
        );
      }

      return ok(res, {
        signalId: signal.signalId,
        readyUserIds: session.readyUserIds,
        status: session.status,
      });
    } catch (err) {
      console.error(err);
      return fail(res, 500, err.message || 'Signal failed');
    }
  });

  router.get('/:sessionId/signals', authRequired, async (req, res) => {
    try {
      const session = await loadParticipantSession(req, res);
      if (!session) return;

      const after = req.query.after ? new Date(String(req.query.after)) : null;
      const uid = String(req.user._id);
      let messages = session.signals || [];
      if (after && !Number.isNaN(after.getTime())) {
        messages = messages.filter((m) => new Date(m.createdAt) > after);
      }
      // Never echo own messages to the same client.
      messages = messages.filter((m) => m.fromUserId !== uid);

      return ok(res, {
        sessionId: session._id.toString(),
        status: session.status,
        readyUserIds: session.readyUserIds || [],
        hostId: session.hostId.toString(),
        guestId: session.guestId ? session.guestId.toString() : null,
        messages: messages.map((m) => ({
          signalId: m.signalId,
          type: m.type,
          fromUserId: m.fromUserId,
          payload: m.payload,
          createdAt: new Date(m.createdAt).toISOString(),
        })),
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      return fail(res, 500, err.message || 'Signals failed');
    }
  });
}

module.exports = { attachSignalRoutes, appendSignal };
