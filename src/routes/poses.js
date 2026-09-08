const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { Pose } = require('../models');
const { poseListItem, notifyUser, createdAtLabel } = require('../services/sessionService');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const query = { ownerIds: req.user._id, confirmed: true };
    if (filter === 'photo') query.mediaType = 'photo';
    if (filter === 'video') query.mediaType = 'video';

    const totalCount = await Pose.countDocuments(query);
    const poses = await Pose.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return ok(res, {
      totalCount,
      items: poses.map((p) => poseListItem(p, req.user._id)),
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to list poses');
  }
});

router.delete('/', authRequired, async (req, res) => {
  try {
    const result = await Pose.deleteMany({ ownerIds: req.user._id });
    return ok(res, { deletedCount: result.deletedCount || 0 });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to delete poses');
  }
});

router.get('/:poseId', authRequired, async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose) return fail(res, 404, 'Pose not found');
    return ok(res, {
      id: pose.poseId,
      mediaType: pose.mediaType,
      mediaUrl: pose.mediaUrl,
      thumbnailUrl: pose.thumbnailUrl || pose.mediaUrl,
      partners: pose.partners,
      createdAt: pose.createdAt?.toISOString?.(),
      shareUrl: pose.shareUrl,
      partnersLabel: pose.partnersLabel,
      layout: pose.layout,
      videoStrategy: pose.videoStrategy,
      confirmed: pose.confirmed,
      isFavorite: (pose.favoritedBy || []).some((id) => String(id) === String(req.user._id)),
      durationSec: pose.durationSec,
      sessionId: pose.sessionId?.toString?.(),
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to load pose');
  }
});

router.post('/:poseId/confirm', authRequired, async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose) return fail(res, 404, 'Pose not found');
    pose.confirmed = true;
    await pose.save();

    await notifyUser({
      userId: req.user._id,
      type: 'pose_saved',
      title: 'New pose saved',
      body: 'Your shared pose was saved to My Poses.',
      payload: { poseId: pose.poseId },
    });

    return ok(res, {
      id: pose.poseId,
      confirmed: true,
      savedToInAppGallery: true,
      createdAtLabel: createdAtLabel(pose.createdAt || new Date()),
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Confirm failed');
  }
});

router.post('/:poseId/favorite', authRequired, async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose) return fail(res, 404, 'Pose not found');
    const uid = req.user._id;
    if (!(pose.favoritedBy || []).some((id) => String(id) === String(uid))) {
      pose.favoritedBy.push(uid);
      pose.isFavorite = true;
      await pose.save();
    }
    return ok(res, { favorited: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Favorite failed');
  }
});

router.delete('/:poseId/favorite', authRequired, async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose) return fail(res, 404, 'Pose not found');
    pose.favoritedBy = (pose.favoritedBy || []).filter(
      (id) => String(id) !== String(req.user._id),
    );
    pose.isFavorite = pose.favoritedBy.length > 0;
    await pose.save();
    return ok(res, { favorited: false });
  } catch (err) {
    return fail(res, 500, err.message || 'Unfavorite failed');
  }
});

router.post('/:poseId/share-link', authRequired, async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose) return fail(res, 404, 'Pose not found');
    if (!pose.shareUrl) {
      pose.shareUrl = `https://holdpose.app/p/${pose.poseId}`;
      await pose.save();
    }
    return ok(res, { shareUrl: pose.shareUrl });
  } catch (err) {
    return fail(res, 500, err.message || 'Share link failed');
  }
});

router.delete('/:poseId', authRequired, async (req, res) => {
  try {
    const pose = await Pose.findOne({ poseId: req.params.poseId });
    if (!pose) return fail(res, 404, 'Pose not found');
    // Soft-remove for this user
    pose.ownerIds = (pose.ownerIds || []).filter(
      (id) => String(id) !== String(req.user._id),
    );
    if (!pose.ownerIds.length) {
      await pose.deleteOne();
    } else {
      await pose.save();
    }
    return ok(res, { deleted: true });
  } catch (err) {
    return fail(res, 500, err.message || 'Delete failed');
  }
});

module.exports = router;
