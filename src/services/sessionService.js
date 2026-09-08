const { customAlphabet } = require('nanoid');
const { v4: uuid } = require('uuid');
const {
  Session,
  StitchJob,
  Pose,
  User,
} = require('../models');

const codeAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

function generateSyncCode() {
  return `SN-${codeAlphabet()}`;
}

function signalingFor(session) {
  return {
    channel: `session:${session._id.toString()}`,
    token: session.signalingToken,
  };
}

function participantDto(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    fullName: user.displayName || 'User',
    avatarUrl: user.avatarUrl || null,
  };
}

async function assertCanCreateSession(user) {
  const who = user.privacy?.whoCanPair || 'friends_only';
  if (who === 'nobody') {
    const err = new Error('Pairing is disabled in your privacy settings');
    err.status = 403;
    err.code = 'PAIRING_DISABLED';
    throw err;
  }
}

async function assertHostAllowsJoin(host) {
  const who = host.privacy?.whoCanPair || 'friends_only';
  if (who === 'nobody') {
    const err = new Error('This user is not accepting pair requests');
    err.status = 403;
    err.code = 'PAIRING_DENIED';
    throw err;
  }
  // friends_only: allow until friends graph exists (documented temporary exception)
}

async function createSessionForHost(host, { privacy = 'private' } = {}) {
  await assertCanCreateSession(host);
  const syncCode = generateSyncCode();
  const session = await Session.create({
    syncCode,
    qrPayload: `holdpose://pair/${syncCode}`,
    hostId: host._id,
    status: 'ready_to_pair',
    privacy,
    signalingToken: `rt_${uuid().replace(/-/g, '')}`,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  return session;
}

async function joinedPayload(session) {
  const [host, guest] = await Promise.all([
    User.findById(session.hostId),
    session.guestId ? User.findById(session.guestId) : null,
  ]);
  return {
    sessionId: session._id.toString(),
    status: session.status,
    host: participantDto(host),
    guest: participantDto(guest) || {
      id: 'pending',
      fullName: 'Partner',
      avatarUrl: null,
    },
    signaling: signalingFor(session),
  };
}

const { notifyUser } = require('./pushNotify');

function greetingForNow(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function dayGroup(date) {
  const d = new Date(date);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startThat) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function createdAtLabel(date) {
  return dayGroup(date);
}

async function advanceStitchJob(job) {
  if (!job || job.status === 'completed' || job.status === 'failed') return job;

  const session = await Session.findById(job.sessionId);
  if (!session) {
    job.status = 'failed';
    job.errorCode = 'SESSION_NOT_FOUND';
    job.message = 'Session missing';
    await job.save();
    return job;
  }

  const captures = session.captures || [];
  const needsBoth = !!session.guestId;
  if (needsBoth && captures.length < 2) {
    job.status = 'pending';
    job.progress = Math.min(40, 10 + captures.length * 15);
    job.message = 'Waiting for both cameras…';
    await job.save();
    return job;
  }
  if (!captures.length) {
    job.status = 'failed';
    job.errorCode = 'PEER_MEDIA_MISSING';
    job.message = 'No capture media available';
    await job.save();
    return job;
  }

  const elapsed = Date.now() - new Date(job.startedAt || job.createdAt).getTime();

  if (elapsed < 800) {
    job.status = 'pending';
    job.progress = Math.min(35, 12 + Math.floor(elapsed / 30));
    job.message = 'Uploading captures…';
    await job.save();
    return job;
  }

  if (elapsed < 1600) {
    job.status = 'processing';
    job.progress = Math.min(80, 40 + Math.floor((elapsed - 800) / 20));
    job.message = 'Stitching Your Shared Pose...';
    await job.save();
    return job;
  }

  // Resolve host/guest capture URLs
  const hostCap =
    captures.find((c) => String(c.userId) === String(session.hostId)) ||
    captures[0];
  const guestCap =
    captures.find((c) => String(c.userId) === String(session.guestId)) ||
    captures[1] ||
    hostCap;

  const mediaType = job.mediaType || hostCap.mediaType || 'photo';
  let mediaUrl = hostCap.mediaUrl;

  let peerMediaUrl = null;
  let videoStrategy = 'split_screen';

  if (mediaType === 'photo' && guestCap && guestCap.mediaUrl !== hostCap.mediaUrl) {
    try {
      const { stitchPhotosSideBySide } = require('./mediaStitch');
      mediaUrl = await stitchPhotosSideBySide({
        hostUrl: hostCap.mediaUrl,
        guestUrl: guestCap.mediaUrl,
        userId: session.hostId.toString(),
      });
      videoStrategy = 'split_screen';
    } catch (err) {
      console.error('Photo stitch failed, using host capture:', err.message);
      mediaUrl = hostCap.mediaUrl;
      peerMediaUrl = guestCap.mediaUrl;
      videoStrategy = 'dual_peer';
    }
  }

  // Dual video: both peer recordings kept; client can play split / host primary.
  if (mediaType === 'video') {
    mediaUrl = hostCap.mediaUrl;
    if (guestCap && guestCap.mediaUrl && guestCap.mediaUrl !== hostCap.mediaUrl) {
      peerMediaUrl = guestCap.mediaUrl;
      videoStrategy = 'dual_peer';
    } else {
      videoStrategy = 'host_primary';
    }
  }

  const [host, guest] = await Promise.all([
    User.findById(session.hostId),
    session.guestId ? User.findById(session.guestId) : null,
  ]);
  const partners = [participantDto(host), participantDto(guest)].filter(Boolean);
  const guestName = guest?.displayName || 'Partner';
  const partnersLabel = `You & ${guestName}`;
  const poseId = `pose_${uuid().replace(/-/g, '').slice(0, 12)}`;
  const shareUrl = `https://holdpose.app/p/${poseId}`;
  const durationSec =
    mediaType === 'video' && hostCap.durationMs
      ? Math.min(30, Math.round(hostCap.durationMs / 1000))
      : null;

  const pose = await Pose.create({
    poseId,
    sessionId: session._id,
    ownerIds: [session.hostId, session.guestId].filter(Boolean),
    mediaType,
    mediaUrl,
    peerMediaUrl,
    thumbnailUrl: mediaUrl,
    durationSec,
    layout: 'split_screen',
    videoStrategy,
    partners,
    partnersLabel,
    shareUrl,
    confirmed: false,
  });

  job.status = 'completed';
  job.progress = 100;
  job.message = 'Your Pose is Ready';
  job.poseId = pose.poseId;
  job.previewUrl = mediaUrl;
  job.peerMediaUrl = peerMediaUrl;
  job.shareUrl = shareUrl;
  job.partnersLabel = partnersLabel;
  job.completedAt = new Date();
  session.status = 'completed';
  session.activeStitchJobId = job.jobId;
  await session.save();

  for (const uid of [session.hostId, session.guestId].filter(Boolean)) {
    await notifyUser({
      userId: uid,
      type: 'pose_processed',
      title: 'Your Pose is Ready',
      body: 'Your shared dual-camera moment is ready to review.',
      actions: [],
      payload: { poseId: pose.poseId },
    });
  }

  await job.save();
  return job;
}

async function ensureStitchJobForSession(session) {
  if (session.activeStitchJobId) {
    const existing = await StitchJob.findOne({ jobId: session.activeStitchJobId });
    if (existing && existing.status !== 'failed') return existing;
  }

  const captures = session.captures || [];
  if (!captures.length) return null;

  // Dual-device sessions must wait for both peer uploads before creating a job
  // that can complete; still create a waiting job so clients can poll.
  const needsBoth = !!session.guestId;
  if (needsBoth && captures.length < 2) {
    const mediaType = captures[0].mediaType || 'photo';
    const jobId = `job_${uuid().replace(/-/g, '').slice(0, 10)}`;
    const job = await StitchJob.create({
      jobId,
      sessionId: session._id,
      status: 'pending',
      progress: 18,
      message: 'Waiting for both cameras…',
      mediaType,
      layout: 'split_screen',
      videoStrategy: 'flag_unconfirmed',
      startedAt: new Date(),
    });
    session.activeStitchJobId = jobId;
    session.status = 'uploading';
    await session.save();
    return job;
  }

  const mediaType = captures[0].mediaType || 'photo';
  const jobId = `job_${uuid().replace(/-/g, '').slice(0, 10)}`;
  const job = await StitchJob.create({
    jobId,
    sessionId: session._id,
    status: 'pending',
    progress: 8,
    message: 'Uploading captures…',
    mediaType,
    layout: 'split_screen',
    videoStrategy: 'flag_unconfirmed',
    startedAt: new Date(),
  });
  session.activeStitchJobId = jobId;
  session.status = 'stitching';
  await session.save();
  return job;
}

function stitchJobDto(job) {
  const dto = {
    jobId: job.jobId,
    sessionId: job.sessionId.toString(),
    status: job.status,
    progress: job.progress,
    message: job.message,
    poseId: job.poseId,
    previewUrl: job.previewUrl,
    peerMediaUrl: job.peerMediaUrl || null,
    mediaType: job.mediaType,
    layout: job.layout,
    videoStrategy: job.videoStrategy,
  };
  if (job.status === 'completed') {
    dto.result = {
      shareUrl: job.shareUrl,
      partnersLabel: job.partnersLabel,
      createdAtLabel: createdAtLabel(job.completedAt || job.updatedAt || new Date()),
    };
  }
  if (job.status === 'failed' && job.errorCode) {
    dto.errorCode = job.errorCode;
  }
  return dto;
}

function poseListItem(pose, userId) {
  const other =
    (pose.partners || []).find((p) => p.id !== String(userId)) ||
    (pose.partners || [])[1] ||
    (pose.partners || [])[0];
  return {
    id: pose.poseId,
    mediaType: pose.mediaType,
    durationSec: pose.durationSec,
    thumbnailUrl: pose.thumbnailUrl || pose.mediaUrl,
    mediaUrl: pose.mediaUrl,
    peerMediaUrl: pose.peerMediaUrl || null,
    partnerName: other?.fullName || 'Partner',
    partnerAvatarUrl: other?.avatarUrl || null,
    partner: other
      ? { id: other.id, fullName: other.fullName, avatarUrl: other.avatarUrl }
      : null,
    createdAt: (pose.createdAt || new Date()).toISOString(),
    dayGroup: dayGroup(pose.createdAt || new Date()),
    isFavorite: (pose.favoritedBy || []).some((id) => String(id) === String(userId)),
    sessionId: pose.sessionId?.toString?.() || '',
    partnersLabel: pose.partnersLabel,
    shareUrl: pose.shareUrl,
    layout: pose.layout,
    videoStrategy: pose.videoStrategy,
    localMediaPath: pose.mediaUrl,
    videoDurationMs: pose.durationSec != null ? pose.durationSec * 1000 : null,
  };
}

module.exports = {
  generateSyncCode,
  signalingFor,
  participantDto,
  assertCanCreateSession,
  assertHostAllowsJoin,
  createSessionForHost,
  joinedPayload,
  notifyUser,
  greetingForNow,
  dayGroup,
  createdAtLabel,
  advanceStitchJob,
  ensureStitchJobForSession,
  stitchJobDto,
  poseListItem,
};
