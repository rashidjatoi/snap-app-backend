const express = require('express');
const { Snap, Comment, Report, User } = require('../../models');
const { ok, fail } = require('../../utils/response');

const router = express.Router();

router.get('/reports', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const reports = await Report.find(filter).sort({ createdAt: -1 });

    const enriched = await Promise.all(
      reports.map(async (r) => {
        let target = null;
        if (r.targetType === 'snap') {
          const snap = await Snap.findById(r.targetId);
          target = snap ? snap.toJSONSafe() : null;
        }
        if (r.targetType === 'comment') {
          const comment = await Comment.findById(r.targetId);
          target = comment ? comment.toJSONSafe() : null;
        }
        const reporter = await User.findById(r.reporterId);
        return {
          ...r.toJSONSafe(),
          target,
          reporter: reporter
            ? {
                id: reporter._id.toString(),
                username: reporter.username,
                displayName: reporter.displayName,
              }
            : null,
        };
      }),
    );
    return ok(res, { reports: enriched });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load reports');
  }
});

router.patch('/reports/:id', async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['remove', 'dismiss', 'hide_comment'].includes(action)) {
      return fail(res, 400, 'action must be remove, dismiss, or hide_comment');
    }
    const report = await Report.findById(req.params.id);
    if (!report) return fail(res, 404, 'Report not found');

    report.status = 'resolved';
    report.resolvedAt = new Date();
    report.resolution = action;

    if (action === 'remove' && report.targetType === 'snap') {
      await Snap.findByIdAndUpdate(report.targetId, { status: 'removed' });
    }
    if (action === 'hide_comment' && report.targetType === 'comment') {
      await Comment.findByIdAndUpdate(report.targetId, { status: 'hidden' });
    }
    if (action === 'dismiss' && report.targetType === 'snap') {
      const snap = await Snap.findById(report.targetId);
      if (snap && snap.status === 'flagged') {
        snap.status = 'published';
        await snap.save();
      }
    }
    await report.save();
    return ok(res, { report: report.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to resolve report');
  }
});

router.get('/snaps', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const snaps = await Snap.find(filter).sort({ createdAt: -1 });
    return ok(res, { snaps: snaps.map((s) => s.toJSONSafe()) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load snaps');
  }
});

router.get('/poses', async (req, res) => {
  try {
    const { Pose } = require('../../models');
    const filter = {};
    if (req.query.mediaType) filter.mediaType = req.query.mediaType;
    const poses = await Pose.find(filter).sort({ createdAt: -1 }).limit(200);
    const list = poses.map((p) => ({
      id: p._id.toString(),
      poseId: p.poseId,
      sessionId: p.sessionId?.toString?.() || p.sessionId,
      mediaType: p.mediaType,
      mediaUrl: p.mediaUrl,
      peerMediaUrl: p.peerMediaUrl,
      thumbnailUrl: p.thumbnailUrl,
      durationSec: p.durationSec,
      partnersLabel: p.partnersLabel,
      partners: p.partners,
      shareUrl: p.shareUrl,
      confirmed: p.confirmed,
      ownerIds: (p.ownerIds || []).map((id) => id.toString()),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
    return ok(res, { poses: list });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load poses');
  }
});

router.patch('/poses/:id', async (req, res) => {
  try {
    const { Pose } = require('../../models');
    const { action } = req.body || {};
    const pose =
      (await Pose.findOne({ poseId: req.params.id })) ||
      (await Pose.findById(req.params.id).catch(() => null));
    if (!pose) return fail(res, 404, 'Pose not found');

    if (action === 'remove') {
      // Soft-remove by clearing public share + unconfirm
      pose.confirmed = false;
      pose.shareUrl = null;
      await pose.save();
      return ok(res, {
        pose: {
          id: pose._id.toString(),
          poseId: pose.poseId,
          confirmed: pose.confirmed,
          shareUrl: pose.shareUrl,
        },
      });
    }
    if (action === 'delete') {
      await Pose.deleteOne({ _id: pose._id });
      return ok(res, { deleted: true, poseId: pose.poseId });
    }
    return fail(res, 400, 'action must be remove or delete');
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to update pose');
  }
});

router.patch('/snaps/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['published', 'flagged', 'removed'].includes(status)) {
      return fail(res, 400, 'Invalid status');
    }
    const snap = await Snap.findById(req.params.id);
    if (!snap) return fail(res, 404, 'Snap not found');
    snap.status = status;
    await snap.save();
    return ok(res, { snap: snap.toJSONSafe() });
  } catch {
    return fail(res, 404, 'Snap not found');
  }
});

router.get('/comments', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const comments = await Comment.find(filter).sort({ createdAt: -1 });
    const enriched = await Promise.all(
      comments.map(async (c) => {
        const user = await User.findById(c.userId);
        return {
          ...c.toJSONSafe(),
          user: user
            ? {
                id: user._id.toString(),
                username: user.username,
                displayName: user.displayName,
              }
            : null,
        };
      }),
    );
    return ok(res, { comments: enriched });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load comments');
  }
});

router.patch('/comments/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['visible', 'hidden'].includes(status)) {
      return fail(res, 400, 'status must be visible or hidden');
    }
    const comment = await Comment.findById(req.params.id);
    if (!comment) return fail(res, 404, 'Comment not found');
    comment.status = status;
    await comment.save();
    return ok(res, { comment: comment.toJSONSafe() });
  } catch {
    return fail(res, 404, 'Comment not found');
  }
});

module.exports = router;
