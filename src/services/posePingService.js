const { PosePing, User } = require('../models');
const { publicShareBase } = require('../utils/publicUrl');
const { notifyUser } = require('./pushNotify');
const { friendDto } = require('./friendsService');

const PING_TTL_MS = 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const SCHEDULE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function actorFrom(user) {
  return {
    initial: (user.displayName || '?')[0].toUpperCase(),
    name: user.displayName,
  };
}

async function refreshDelayedReady(ping) {
  if (
    ping.status === 'delayed' &&
    ping.readyAt &&
    new Date(ping.readyAt) <= new Date()
  ) {
    ping.status = 'waiting_ready';
    ping.toReady = true;
    await ping.save();
    await notifyUser({
      userId: ping.fromUserId,
      type: 'pose_ping',
      title: '🟢 Partner Ready',
      body: 'They said 10 minutes — time to HoldPose. Tap I’m Ready when set.',
      actions: [],
      payload: { posePingId: ping._id.toString() },
    });
  }

  if (
    ping.status === 'scheduled' &&
    ping.scheduledAt &&
    !ping.scheduleNotified &&
    new Date(ping.scheduledAt) <= new Date()
  ) {
    ping.scheduleNotified = true;
    ping.status = 'waiting_ready';
    await ping.save();
    const from = await User.findById(ping.fromUserId);
    const targets = [ping.fromUserId, ping.toUserId].filter(Boolean);
    for (const uid of targets) {
      await notifyUser({
        userId: uid,
        type: 'pose_ping',
        title: '📸 Scheduled Pose time!',
        body: 'It’s time for your HoldPose moment. Tap I’m Ready when set.',
        actions: [],
        payload: { posePingId: ping._id.toString() },
        actor: from ? actorFrom(from) : null,
      });
    }
  }

  return ping;
}

async function pingDto(ping, req) {
  await refreshDelayedReady(ping);
  const [from, to] = await Promise.all([
    User.findById(ping.fromUserId),
    ping.toUserId ? User.findById(ping.toUserId) : null,
  ]);
  const base = publicShareBase(req);
  return {
    id: ping._id.toString(),
    kind: ping.kind || 'instant',
    status: ping.status,
    response: ping.response,
    fromReady: !!ping.fromReady,
    toReady: !!ping.toReady,
    readyAt: ping.readyAt,
    scheduledAt: ping.scheduledAt,
    expiresAt: ping.expiresAt,
    createdAt: ping.createdAt,
    updatedAt: ping.updatedAt,
    inviteToken: ping.inviteToken,
    inviteUrl: `${base}/invite/${ping.inviteToken}`,
    from: friendDto(from),
    to: friendDto(to),
  };
}

async function createPing({
  fromUser,
  toUserId = null,
  req,
  kind = 'instant',
  scheduledAt = null,
}) {
  const token = PosePing.newInviteToken();
  const isSchedule = kind === 'schedule' && scheduledAt;
  const ping = await PosePing.create({
    fromUserId: fromUser._id,
    toUserId: toUserId || null,
    inviteToken: token,
    kind,
    status: isSchedule ? 'scheduled' : 'pending',
    scheduledAt: isSchedule ? new Date(scheduledAt) : null,
    expiresAt: new Date(
      Date.now() + (isSchedule ? SCHEDULE_TTL_MS : PING_TTL_MS),
    ),
  });

  if (toUserId) {
    const target = await User.findById(toUserId);
    if (target) {
      if (isSchedule) {
        const when = new Date(scheduledAt).toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        await notifyUser({
          userId: target._id,
          type: 'pose_ping',
          title: `📅 ${fromUser.displayName} scheduled a Pose`,
          body: `HoldPose together at ${when}.`,
          actions: ['pose_ping_join', 'pose_ping_later'],
          payload: {
            posePingId: ping._id.toString(),
            readyAt: new Date(scheduledAt).toISOString(),
          },
          actor: actorFrom(fromUser),
        });
      } else if (kind === 'knock') {
        await notifyUser({
          userId: target._id,
          type: 'pose_ping',
          title: `Knock Knock 📸`,
          body: `${fromUser.displayName} wants a HoldPose with you!`,
          actions: ['pose_ping_join', 'pose_ping_ten_min', 'pose_ping_later'],
          payload: { posePingId: ping._id.toString() },
          actor: actorFrom(fromUser),
        });
      } else {
        await notifyUser({
          userId: target._id,
          type: 'pose_ping',
          title: `📸 ${fromUser.displayName} sent you a pose request`,
          body: `❤️ PosePing™ — They're ready to HoldPose. Tap. Join. Pose. Together.`,
          actions: ['pose_ping_join', 'pose_ping_ten_min', 'pose_ping_later'],
          payload: { posePingId: ping._id.toString() },
          actor: actorFrom(fromUser),
        });
      }
    }
  }

  return pingDto(ping, req);
}

async function respondToPing({ ping, responder, response, req }) {
  if (
    ping.expiresAt < new Date() &&
    ['pending', 'scheduled'].includes(ping.status)
  ) {
    ping.status = 'expired';
    await ping.save();
    const err = new Error('PosePing expired');
    err.status = 410;
    err.code = 'POSE_PING_EXPIRED';
    throw err;
  }

  if (!['pending', 'delayed', 'scheduled'].includes(ping.status)) {
    const err = new Error('PosePing already handled');
    err.status = 409;
    err.code = 'POSE_PING_HANDLED';
    throw err;
  }

  if (ping.toUserId && String(ping.toUserId) !== String(responder._id)) {
    const err = new Error('Not your PosePing');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (!ping.toUserId) {
    ping.toUserId = responder._id;
  }

  ping.response = response;

  if (response === 'join_now') {
    ping.status = 'joining';
    await ping.save();

    await notifyUser({
      userId: ping.fromUserId,
      type: 'pose_ping',
      title: '🟢 Partner is joining…',
      body: `${responder.displayName} tapped JOIN NOW.`,
      actions: [],
      payload: { posePingId: ping._id.toString() },
      actor: actorFrom(responder),
    });

    // Enter readiness handshake — no live cameras.
    ping.status = 'waiting_ready';
    ping.toReady = true;
    await ping.save();

    await notifyUser({
      userId: ping.fromUserId,
      type: 'pose_ping',
      title: '🟢 Partner Ready',
      body: `${responder.displayName} is ready. Tap I’m Ready when you are.`,
      actions: [],
      payload: { posePingId: ping._id.toString() },
      actor: actorFrom(responder),
    });
  } else if (response === 'ten_min') {
    ping.status = 'delayed';
    ping.readyAt = new Date(Date.now() + TEN_MIN_MS);
    await ping.save();

    await notifyUser({
      userId: ping.fromUserId,
      type: 'pose_ping',
      title: '⏱️ Partner will be ready in 10 minutes',
      body: `${responder.displayName} needs a few minutes. HoldPose will alert you when they're ready.`,
      actions: [],
      payload: {
        posePingId: ping._id.toString(),
        readyAt: ping.readyAt.toISOString(),
      },
      actor: actorFrom(responder),
    });
  } else if (response === 'later') {
    ping.status = 'later';
    await ping.save();

    await notifyUser({
      userId: ping.fromUserId,
      type: 'pose_ping',
      title: 'PosePing declined for now',
      body: `${responder.displayName} tapped LATER.`,
      actions: [],
      payload: { posePingId: ping._id.toString() },
      actor: actorFrom(responder),
    });
  } else {
    const err = new Error('Invalid response');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  return pingDto(ping, req);
}

async function markReady({ ping, user, req }) {
  await refreshDelayedReady(ping);

  if (!['waiting_ready', 'joining', 'ready'].includes(ping.status)) {
    const err = new Error('PosePing is not waiting for ready');
    err.status = 409;
    err.code = 'POSE_PING_NOT_READY';
    throw err;
  }

  const me = String(user._id);
  const isFrom = String(ping.fromUserId) === me;
  const isTo = ping.toUserId && String(ping.toUserId) === me;
  if (!isFrom && !isTo) {
    const err = new Error('Not your PosePing');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (isFrom) ping.fromReady = true;
  if (isTo) ping.toReady = true;

  ping.status = 'waiting_ready';

  if (ping.fromReady && ping.toReady) {
    ping.status = 'both_ready';
    await ping.save();

    const otherId = isFrom ? ping.toUserId : ping.fromUserId;
    if (otherId) {
      await notifyUser({
        userId: otherId,
        type: 'pose_ping',
        title: '🟢 BOTH READY',
        body: 'You’re both set for a HoldPose moment.',
        actions: [],
        payload: { posePingId: ping._id.toString() },
        actor: actorFrom(user),
      });
    }
  } else {
    await ping.save();
    const otherId = isFrom ? ping.toUserId : ping.fromUserId;
    if (otherId) {
      await notifyUser({
        userId: otherId,
        type: 'pose_ping',
        title: `🟢 ${user.displayName} is Ready`,
        body: 'Waiting for you — tap I’m Ready when set.',
        actions: [],
        payload: { posePingId: ping._id.toString() },
        actor: actorFrom(user),
      });
    }
  }

  return pingDto(ping, req);
}

module.exports = {
  pingDto,
  createPing,
  respondToPing,
  markReady,
  refreshDelayedReady,
  TEN_MIN_MS,
};
