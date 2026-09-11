const { Session } = require('../models');

const ACTIVE_STATUSES = [
  'ready_to_pair',
  'paired',
  'live',
  'capturing',
  'uploading',
  'stitching',
];

/**
 * Mark past-expiresAt sessions as ended so they never appear as "Ready to Pose".
 */
async function expireStaleSessions({ userId } = {}) {
  const now = new Date();
  const filter = {
    status: { $in: ACTIVE_STATUSES },
    expiresAt: { $lte: now },
  };
  if (userId) {
    filter.$or = [{ hostId: userId }, { guestId: userId }];
  }
  await Session.updateMany(filter, {
    $set: { status: 'ended', endedAt: now },
  });
}

function isSessionExpired(session, now = new Date()) {
  if (!session) return true;
  if (!session.expiresAt) return true;
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

module.exports = {
  ACTIVE_STATUSES,
  expireStaleSessions,
  isSessionExpired,
};
