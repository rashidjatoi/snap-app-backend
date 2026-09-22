const { Session } = require('../models');

const ACTIVE_STATUSES = [
  'ready_to_pair',
  'paired',
  'live',
  'capturing',
  'uploading',
  'stitching',
];

/** Idle paired/live sessions drop off home after this (ended snaps linger otherwise). */
const IDLE_PAIR_MS = 5 * 60 * 1000;

/**
 * Mark past-expiresAt sessions as ended so they never appear as "Ready to Pose".
 * Also ends paired/live sessions idle for 5+ minutes (left without /end).
 */
async function expireStaleSessions({ userId } = {}) {
  const now = new Date();
  const base = {};
  if (userId) {
    base.$or = [{ hostId: userId }, { guestId: userId }];
  }

  await Session.updateMany(
    {
      ...base,
      status: { $in: ACTIVE_STATUSES },
      expiresAt: { $lte: now },
    },
    { $set: { status: 'ended', endedAt: now } },
  );

  const idleCutoff = new Date(now.getTime() - IDLE_PAIR_MS);
  await Session.updateMany(
    {
      ...base,
      status: { $in: ['paired', 'live'] },
      updatedAt: { $lte: idleCutoff },
    },
    { $set: { status: 'ended', endedAt: now } },
  );
}

function isSessionExpired(session, now = new Date()) {
  if (!session) return true;
  if (!session.expiresAt) return true;
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

function isIdlePaired(session, now = new Date()) {
  if (!session) return true;
  const status = String(session.status || '');
  if (!['paired', 'live'].includes(status)) return false;
  const updated = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
  return updated > 0 && now.getTime() - updated >= IDLE_PAIR_MS;
}

module.exports = {
  ACTIVE_STATUSES,
  IDLE_PAIR_MS,
  expireStaleSessions,
  isSessionExpired,
  isIdlePaired,
};
