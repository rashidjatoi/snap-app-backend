const express = require('express');
const multer = require('multer');
const { User, Snap, Comment, Report } = require('../models');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { uploadBuffer } = require('../services/firebaseStorage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

router.get('/', authRequired, async (req, res) => {
  try {
    const snaps = await Snap.find({
      $or: [{ ownerId: req.user._id }, { partnerId: req.user._id }],
      status: { $ne: 'removed' },
    }).sort({ createdAt: -1 });
    return ok(res, { snaps: snaps.map((s) => s.toJSONSafe()) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load snaps');
  }
});

router.get('/feed', authRequired, async (req, res) => {
  try {
    const snaps = await Snap.find({ status: 'published' }).sort({ createdAt: -1 });
    return ok(res, { snaps: snaps.map((s) => s.toJSONSafe()) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load feed');
  }
});

router.post('/', authRequired, upload.single('file'), async (req, res) => {
  try {
    const body = req.body || {};
    const partnerId = body.partnerId;
    const type = body.type || (req.file?.mimetype?.startsWith('video/') ? 'video' : 'photo');
    let mediaUrl = body.mediaUrl;
    let thumbnailUrl = body.thumbnailUrl;
    const caption = body.caption || '';

    if (req.file) {
      const uploaded = await uploadBuffer(req.file.buffer, {
        folder: 'snaps',
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        userId: req.user._id.toString(),
      });
      mediaUrl = uploaded.url;
      thumbnailUrl = thumbnailUrl || uploaded.url;
    }

    if (!partnerId || !type || !mediaUrl) {
      return fail(res, 400, 'partnerId, type, and mediaUrl (or file) are required');
    }
    if (!['photo', 'video'].includes(type)) {
      return fail(res, 400, 'type must be photo or video');
    }

    const partner = await User.findOne({ _id: partnerId, status: 'active' });
    if (!partner) return fail(res, 404, 'Partner not found');

    const snap = await Snap.create({
      ownerId: req.user._id,
      partnerId: partner._id,
      type,
      mediaUrl,
      thumbnailUrl: thumbnailUrl || mediaUrl,
      caption,
      status: 'published',
    });
    return ok(res, { snap: snap.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, err.message || 'Failed to create snap');
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const snap = await Snap.findById(req.params.id);
    if (!snap || snap.status === 'removed') return fail(res, 404, 'Snap not found');
    const comments = await Comment.find({ snapId: snap._id, status: 'visible' }).sort({
      createdAt: -1,
    });
    return ok(res, {
      snap: snap.toJSONSafe(),
      comments: comments.map((c) => c.toJSONSafe()),
    });
  } catch {
    return fail(res, 404, 'Snap not found');
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const snap = await Snap.findById(req.params.id);
    if (!snap) return fail(res, 404, 'Snap not found');
    if (
      snap.ownerId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return fail(res, 403, 'Not allowed');
    }
    snap.status = 'removed';
    await snap.save();
    return ok(res, { snap: snap.toJSONSafe() });
  } catch {
    return fail(res, 404, 'Snap not found');
  }
});

router.post('/:id/comments', authRequired, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return fail(res, 400, 'text is required');
    const snap = await Snap.findOne({ _id: req.params.id, status: 'published' });
    if (!snap) return fail(res, 404, 'Snap not found');
    const comment = await Comment.create({
      snapId: snap._id,
      userId: req.user._id,
      text,
      status: 'visible',
    });
    return ok(res, { comment: comment.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to comment');
  }
});

router.post('/:id/report', authRequired, async (req, res) => {
  try {
    const { reason, details } = req.body || {};
    if (!reason) return fail(res, 400, 'reason is required');
    const snap = await Snap.findById(req.params.id);
    if (!snap) return fail(res, 404, 'Snap not found');

    const report = await Report.create({
      targetType: 'snap',
      targetId: snap._id,
      reporterId: req.user._id,
      reason,
      details: details || '',
      status: 'pending',
    });
    if (snap.status === 'published') {
      snap.status = 'flagged';
      await snap.save();
    }
    return ok(res, { report: report.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to report');
  }
});

module.exports = router;
