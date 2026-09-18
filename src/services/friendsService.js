const { Friendship, User } = require('../models');

function friendDto(user, extras = {}) {
  if (!user) return null;
  const showOnline = user.privacy?.showOnlineStatus !== false;
  return {
    id: user._id.toString(),
    fullName: user.displayName,
    username: user.username,
    avatarUrl: user.avatarUrl,
    avatarColor: user.avatarColor,
    bio: user.bio || '',
    online: showOnline ? !!user.onlineStatus : false,
    ...extras,
  };
}

async function areFriends(userIdA, userIdB) {
  if (!userIdA || !userIdB) return false;
  if (String(userIdA) === String(userIdB)) return false;
  const pair = Friendship.orderedPair(userIdA, userIdB);
  const row = await Friendship.findOne({
    userA: pair.userA,
    userB: pair.userB,
    status: 'accepted',
  }).lean();
  return !!row;
}

async function getFriendship(userIdA, userIdB) {
  const pair = Friendship.orderedPair(userIdA, userIdB);
  return Friendship.findOne({ userA: pair.userA, userB: pair.userB });
}

/**
 * After a successful scan/code pair, ensure both users are friends.
 * Creates an accepted friendship (or upgrades pending/declined → accepted).
 * Returns { created: boolean, friendshipId } or null if invalid.
 */
async function ensureAcceptedFriends(userIdA, userIdB, { requestedBy } = {}) {
  if (!userIdA || !userIdB) return null;
  if (String(userIdA) === String(userIdB)) return null;

  const pair = Friendship.orderedPair(userIdA, userIdB);
  let row = await Friendship.findOne({
    userA: pair.userA,
    userB: pair.userB,
  });

  if (row?.status === 'accepted') {
    return { created: false, friendshipId: row._id.toString() };
  }

  const initiator = requestedBy || userIdA;
  if (row) {
    row.status = 'accepted';
    row.requestedBy = row.requestedBy || initiator;
    await row.save();
  } else {
    row = await Friendship.create({
      ...pair,
      requestedBy: initiator,
      status: 'accepted',
    });
  }

  return { created: true, friendshipId: row._id.toString() };
}

/**
 * Notify both users they became friends via pairing (best-effort).
 */
async function notifyBecameFriends(userIdA, userIdB) {
  const { notifyUser } = require('./pushNotify');
  const [a, b] = await Promise.all([
    User.findById(userIdA),
    User.findById(userIdB),
  ]);
  if (!a || !b) return;

  await Promise.all([
    notifyUser({
      userId: a._id,
      type: 'friend_request',
      title: `You're now friends with ${b.displayName}`,
      body: 'You paired for a HoldPose — send a PosePing anytime.',
      actions: [],
      payload: {},
      actor: {
        initial: (b.displayName || '?')[0].toUpperCase(),
        name: b.displayName,
      },
    }),
    notifyUser({
      userId: b._id,
      type: 'friend_request',
      title: `You're now friends with ${a.displayName}`,
      body: 'You paired for a HoldPose — send a PosePing anytime.',
      actions: [],
      payload: {},
      actor: {
        initial: (a.displayName || '?')[0].toUpperCase(),
        name: a.displayName,
      },
    }),
  ]);
}

async function listFriends(userId) {
  // Past HoldPose session partners should appear as friends (backfill).
  await syncFriendsFromSessionPartners(userId);

  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ userA: userId }, { userB: userId }],
  }).sort({ updatedAt: -1 });

  const otherIds = rows.map((r) =>
    String(r.userA) === String(userId) ? r.userB : r.userA,
  );
  const users = await User.find({ _id: { $in: otherIds } });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));

  return rows
    .map((r) => {
      const otherId =
        String(r.userA) === String(userId) ? r.userB : r.userA;
      const u = byId.get(String(otherId));
      if (!u) return null;
      return friendDto(u, {
        friendshipId: r._id.toString(),
        friendsSince: r.updatedAt,
      });
    })
    .filter(Boolean);
}

/**
 * Create accepted friendships for anyone this user has already paired with
 * in a live session. Fixes dashboard “1 partners” vs empty friends list.
 */
async function syncFriendsFromSessionPartners(userId) {
  const { Session } = require('../models');
  const sessions = await Session.find({
    $or: [{ hostId: userId }, { guestId: userId }],
    guestId: { $ne: null },
  })
    .select('hostId guestId')
    .limit(500)
    .lean();

  const otherIds = new Set();
  for (const s of sessions) {
    const other =
      String(s.hostId) === String(userId) ? s.guestId : s.hostId;
    if (other) otherIds.add(String(other));
  }
  if (otherIds.size === 0) return 0;

  let created = 0;
  for (const otherId of otherIds) {
    try {
      const result = await ensureAcceptedFriends(userId, otherId, {
        requestedBy: userId,
      });
      if (result?.created) created += 1;
    } catch (err) {
      console.warn(
        'syncFriendsFromSessionPartners failed for',
        otherId,
        err.message,
      );
    }
  }
  return created;
}

async function countAcceptedFriends(userId) {
  await syncFriendsFromSessionPartners(userId);
  return Friendship.countDocuments({
    status: 'accepted',
    $or: [{ userA: userId }, { userB: userId }],
  });
}

async function listPendingFor(userId) {
  const incoming = await Friendship.find({
    status: 'pending',
    $or: [{ userA: userId }, { userB: userId }],
    requestedBy: { $ne: userId },
  }).sort({ createdAt: -1 });

  const outgoing = await Friendship.find({
    status: 'pending',
    requestedBy: userId,
  }).sort({ createdAt: -1 });

  async function mapRows(rows, direction) {
    const otherIds = rows.map((r) =>
      String(r.userA) === String(userId) ? r.userB : r.userA,
    );
    const users = await User.find({ _id: { $in: otherIds } });
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    return rows
      .map((r) => {
        const otherId =
          String(r.userA) === String(userId) ? r.userB : r.userA;
        const u = byId.get(String(otherId));
        if (!u) return null;
        return {
          id: r._id.toString(),
          direction,
          createdAt: r.createdAt,
          user: friendDto(u),
        };
      })
      .filter(Boolean);
  }

  return {
    incoming: await mapRows(incoming, 'incoming'),
    outgoing: await mapRows(outgoing, 'outgoing'),
  };
}

module.exports = {
  friendDto,
  areFriends,
  getFriendship,
  ensureAcceptedFriends,
  notifyBecameFriends,
  listFriends,
  listPendingFor,
  syncFriendsFromSessionPartners,
  countAcceptedFriends,
};
