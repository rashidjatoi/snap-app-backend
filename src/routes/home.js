const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { Session, Pose, UserNotification, User } = require('../models');
const {
  greetingForNow,
  createdAtLabel,
} = require('../services/sessionService');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const user = req.user;
    const name = user.displayName || 'Guest';
    const initial = name.trim() ? name.trim()[0].toUpperCase() : 'G';

    const activeSession = await Session.findOne({
      $or: [{ hostId: user._id }, { guestId: user._id }],
      status: { $in: ['ready_to_pair', 'paired', 'live', 'capturing', 'uploading', 'stitching'] },
    }).sort({ updatedAt: -1 });

    let activePair = null;
    if (activeSession) {
      const partnerId =
        String(activeSession.hostId) === String(user._id)
          ? activeSession.guestId
          : activeSession.hostId;
      if (partnerId) {
        const partner = await User.findById(partnerId);
        if (partner) {
          activePair = {
            partnerId: partner._id.toString(),
            partnerName: partner.displayName,
            partnerAvatarUrl: partner.avatarUrl,
            online: !!partner.onlineStatus,
            readyToPose: ['paired', 'live'].includes(activeSession.status),
            live: ['live', 'capturing', 'uploading', 'stitching'].includes(
              activeSession.status,
            ),
          };
        }
      }
    }

    const poseQuery = { ownerIds: user._id, confirmed: true };
    const posesCount = await Pose.countDocuments(poseQuery);
    const recent = await Pose.find(poseQuery).sort({ createdAt: -1 }).limit(8);
    const sessionsCount = await Session.countDocuments({
      $or: [{ hostId: user._id }, { guestId: user._id }],
    });
    const partnerIds = new Set();
    const allSessions = await Session.find({
      $or: [{ hostId: user._id }, { guestId: user._id }],
      guestId: { $ne: null },
    }).select('hostId guestId');
    for (const s of allSessions) {
      const other =
        String(s.hostId) === String(user._id) ? s.guestId : s.hostId;
      if (other) partnerIds.add(String(other));
    }

    const unreadNotifications = await UserNotification.countDocuments({
      userId: user._id,
      read: false,
    });

    return ok(res, {
      greeting: greetingForNow(),
      user: {
        id: user._id.toString(),
        fullName: name,
        avatarUrl: user.avatarUrl,
        initial,
      },
      activePair,
      stats: {
        poses: posesCount,
        partners: partnerIds.size,
        sessions: sessionsCount,
      },
      unreadNotifications,
      recentPoses: recent.map((p) => {
        const other =
          (p.partners || []).find((x) => x.id !== user._id.toString()) ||
          (p.partners || [])[0];
        return {
          id: p.poseId,
          thumbnailUrl: p.thumbnailUrl || p.mediaUrl,
          partnerName: other?.fullName || 'Partner',
          createdAtLabel: createdAtLabel(p.createdAt || new Date()),
          createdAt: (p.createdAt || new Date()).toISOString(),
          mediaType: p.mediaType,
        };
      }),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, err.message || 'Home failed');
  }
});

module.exports = router;
