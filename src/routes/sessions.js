const express = require('express');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { Session, User } = require('../models');
const { uploadBuffer } = require('../services/firebaseStorage');
const {
  createSessionForHost,
  joinedPayload,
  assertHostAllowsJoin,
  signalingFor,
  notifyUser,
  ensureStitchJobForSession,
  stitchJobDto,
  advanceStitchJob,
} = require('../services/sessionService');
const { attachSignalRoutes } = require('./signaling');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
});

let _broadcast = null;
function setSignalBroadcast(fn) {
  _broadcast = fn;
}

attachSignalRoutes(router, {
  broadcast: (...args) => {
    if (typeof _broadcast === 'function') _broadcast(...args);
  },
});

router.post('/', authRequired, async (req, res) => {
  try {
    const session = await createSessionForHost(req.user, {
      privacy: req.body?.privacy || 'private',
    });
    return ok(res, {
      sessionId: session._id.toString(),
      syncCode: session.syncCode,
      qrPayload: session.qrPayload,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      signaling: signalingFor(session),
    });
  } catch (err) {
    return fail(res, err.status || 500, err.message || 'Failed to create session', err.code);
  }
});

router.post('/join', authRequired, async (req, res) => {
  try {
    const syncCode = String(req.body?.syncCode || '')
      .trim()
      .toUpperCase();
    if (!syncCode) return fail(res, 400, 'syncCode is required', 'VALIDATION_ERROR');

    const session = await Session.findOne({ syncCode });
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    const { isSessionExpired } = require('../services/sessionExpiry');
    if (isSessionExpired(session)) {
      session.status = 'ended';
      session.endedAt = new Date();
      await session.save();
      return fail(res, 410, 'Session expired', 'SESSION_EXPIRED');
    }
    if (session.guestId && String(session.guestId) !== String(req.user._id)) {
      return fail(res, 409, 'Session already has two peers', 'SESSION_FULL');
    }
    if (String(session.hostId) === String(req.user._id)) {
      return fail(res, 400, 'Cannot join your own session', 'VALIDATION_ERROR');
    }

    const host = await User.findById(session.hostId);
    if (!host) return fail(res, 404, 'Host not found', 'SESSION_NOT_FOUND');
    await assertHostAllowsJoin(host);

    session.guestId = req.user._id;
    session.status = 'paired';
    await session.save();

    await notifyUser({
      userId: session.hostId,
      type: 'session_started',
      title: `${req.user.displayName} joined your session`,
      body: 'Your partner is ready to sync cameras.',
      actions: [],
      payload: { sessionId: session._id.toString() },
      actor: {
        initial: (req.user.displayName || '?')[0].toUpperCase(),
        name: req.user.displayName,
      },
    });

    return ok(res, await joinedPayload(session));
  } catch (err) {
    return fail(res, err.status || 500, err.message || 'Join failed', err.code);
  }
});

router.post('/:sessionId/join-invite', authRequired, async (req, res) => {
  try {
    const {
      expireStaleSessions,
      isSessionExpired,
    } = require('../services/sessionExpiry');
    await expireStaleSessions({ userId: req.user._id });

    const session = await Session.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    if (isSessionExpired(session)) {
      session.status = 'ended';
      session.endedAt = new Date();
      await session.save();
      return fail(res, 410, 'Session expired', 'SESSION_EXPIRED');
    }

    const host = await User.findById(session.hostId);
    await assertHostAllowsJoin(host);

    if (String(session.hostId) === String(req.user._id)) {
      return ok(res, await joinedPayload(session));
    }

    if (session.guestId && String(session.guestId) !== String(req.user._id)) {
      return fail(res, 409, 'Session already has two peers', 'SESSION_FULL');
    }

    session.guestId = req.user._id;
    session.status = session.status === 'ready_to_pair' ? 'paired' : session.status;
    await session.save();
    return ok(res, await joinedPayload(session));
  } catch (err) {
    return fail(res, err.status || 500, err.message || 'Join invite failed', err.code);
  }
});

router.get('/:sessionId', authRequired, async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    const uid = String(req.user._id);
    if (
      String(session.hostId) !== uid &&
      (!session.guestId || String(session.guestId) !== uid)
    ) {
      return fail(res, 403, 'Not a session participant');
    }
    return ok(res, {
      ...(await joinedPayload(session)),
      syncCode: session.syncCode,
      status: session.status,
      expiresAt: session.expiresAt?.toISOString?.(),
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to load session');
  }
});

router.post('/:sessionId/end', authRequired, async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    session.status = 'ended';
    session.endedAt = new Date();
    await session.save();
    return ok(res, { ended: true, reason: req.body?.reason || 'user_exit' });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to end session');
  }
});

router.post('/:sessionId/retake', authRequired, async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    const uid = String(req.user._id);
    if (
      String(session.hostId) !== uid &&
      (!session.guestId || String(session.guestId) !== uid)
    ) {
      return fail(res, 403, 'Not a session participant');
    }

    // Cancel in-flight stitch job so both peers leave the stitch UI.
    if (session.activeStitchJobId) {
      try {
        const { StitchJob } = require('../models');
        await StitchJob.updateOne(
          { jobId: session.activeStitchJobId },
          {
            $set: {
              status: 'failed',
              message: 'Retake requested',
              errorCode: 'RETAKE',
            },
          },
        );
      } catch (_) {
        /* ignore */
      }
    }

    session.captures = [];
    session.activeStitchJobId = null;
    session.status = 'live';
    await session.save();

    const { appendSignal } = require('./signaling');
    const { session: updated, signal } = await appendSignal(session._id, {
      type: 'capture.retake',
      fromUserId: uid,
      payload: {
        requestedAt: new Date().toISOString(),
        byUserId: uid,
      },
    });
    if (typeof _broadcast === 'function') {
      _broadcast(
        session._id.toString(),
        {
          type: signal.type,
          fromUserId: signal.fromUserId,
          payload: signal.payload,
          signalId: signal.signalId,
          createdAt: signal.createdAt,
        },
        uid,
      );
    }

    return ok(res, {
      retake: true,
      status: updated?.status || session.status,
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Retake failed');
  }
});

router.get('/:sessionId/realtime-token', authRequired, async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    return ok(res, signalingFor(session));
  } catch (err) {
    return fail(res, 500, err.message || 'Token failed');
  }
});

router.get('/:sessionId/stitch-job', authRequired, async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    if (!session.activeStitchJobId) {
      return fail(res, 404, 'No stitch job yet', 'STITCH_JOB_NOT_FOUND');
    }
    const { StitchJob } = require('../models');
    let job = await StitchJob.findOne({ jobId: session.activeStitchJobId });
    if (!job) return fail(res, 404, 'Stitch job not found', 'STITCH_JOB_NOT_FOUND');
    job = await advanceStitchJob(job);
    return ok(res, stitchJobDto(job));
  } catch (err) {
    return fail(res, 500, err.message || 'Stitch job failed');
  }
});

router.post(
  '/:sessionId/captures',
  authRequired,
  upload.single('media'),
  async (req, res) => {
    try {
      const session = await Session.findById(req.params.sessionId);
      if (!session) return fail(res, 404, 'Session not found', 'SESSION_NOT_FOUND');

      const mediaType = req.body?.mediaType || 'photo';
      if (!['photo', 'video'].includes(mediaType)) {
        return fail(res, 400, 'mediaType must be photo or video', 'VALIDATION_ERROR');
      }

      let mediaUrl = req.body?.mediaUrl;
      if (req.file) {
        let buffer = req.file.buffer;
        let contentType = req.file.mimetype;
        let filename = req.file.originalname || `capture_${Date.now()}`;
        if (mediaType === 'video') {
          try {
            const { normalizeToMp4 } = require('../services/mediaStitch');
            buffer = await normalizeToMp4(buffer);
            contentType = 'video/mp4';
            filename = `capture_${Date.now()}.mp4`;
            console.log('Normalized capture video to H.264 mp4', {
              bytes: buffer.length,
              userId: String(req.user._id),
            });
          } catch (normErr) {
            console.error('Video normalize failed, uploading raw:', normErr.message);
          }
        }
        const uploaded = await uploadBuffer(buffer, {
          folder: 'captures',
          filename,
          contentType,
          userId: req.user._id.toString(),
        });
        mediaUrl = uploaded.url;
      }
      if (!mediaUrl) return fail(res, 400, 'media file or mediaUrl required', 'VALIDATION_ERROR');

      const durationMs =
        mediaType === 'video'
          ? Math.min(Number(req.body?.durationMs) || 30000, 30000)
          : null;

      const clientCaptureId = req.body?.clientCaptureId || null;
      if (clientCaptureId) {
        const existing = session.captures.find((c) => c.clientCaptureId === clientCaptureId);
        if (existing) {
          return ok(res, {
            captureId: existing.captureId,
            sessionId: session._id.toString(),
            mediaType: existing.mediaType,
            uploaded: true,
            waitingForPeer: session.captures.length < 2,
            stitchJobId: session.activeStitchJobId,
          });
        }
      }

      // Replace previous capture from same user
      session.captures = session.captures.filter(
        (c) => String(c.userId) !== String(req.user._id),
      );
      const captureId = `cap_${uuid().replace(/-/g, '').slice(0, 10)}`;
      session.captures.push({
        captureId,
        userId: req.user._id,
        mediaUrl,
        mediaType,
        durationMs,
        capturedAt: req.body?.capturedAt ? new Date(req.body.capturedAt) : new Date(),
        clientCaptureId,
      });
      session.status = 'uploading';
      await session.save();

      // If a waiting stitch job exists and both peers uploaded, allow it to progress.
      if (session.activeStitchJobId && session.captures.length >= 2) {
        const { StitchJob } = require('../models');
        const waiting = await StitchJob.findOne({ jobId: session.activeStitchJobId });
        if (waiting && waiting.status === 'pending') {
          waiting.startedAt = new Date();
          waiting.message = 'Uploading captures…';
          waiting.progress = 25;
          await waiting.save();
          session.status = 'stitching';
          await session.save();
        }
      }

      // MVP: start stitch when at least one capture exists (supports single-device).
      // When both peers upload, stitch uses available media.
      const job = await ensureStitchJobForSession(session);

      return ok(res, {
        captureId,
        sessionId: session._id.toString(),
        mediaType,
        uploaded: true,
        waitingForPeer: session.captures.length < 2 && !!session.guestId,
        stitchJobId: job?.jobId || null,
      });
    } catch (err) {
      console.error(err);
      return fail(res, 500, err.message || 'Capture upload failed');
    }
  },
);

router.setSignalBroadcast = setSignalBroadcast;
module.exports = router;
