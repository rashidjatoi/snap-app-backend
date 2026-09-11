const express = require('express');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { uploadBuffer } = require('../services/firebaseStorage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});
const uploadFrames = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 120 },
});

router.post('/', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'file is required');

    const folder = (req.body && req.body.folder) || 'uploads';
    const allowed = ['avatars', 'snaps', 'poses', 'uploads', 'captures'];
    const safeFolder = allowed.includes(folder) ? folder : 'uploads';

    const result = await uploadBuffer(req.file.buffer, {
      folder: safeFolder,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      userId: req.user._id.toString(),
    });

    return ok(res, {
      url: result.url,
      path: result.path,
      contentType: result.contentType,
    });
  } catch (err) {
    console.error('Upload failed', err);
    return fail(res, 500, err.message || 'Upload failed');
  }
});

/**
 * Encode a PNG frame burst into a playable H.264 mp4 (Genymotion-safe path —
 * avoids WebRTC MediaRecorder / camera-plugin audio HAL crashes).
 */
router.post(
  '/from-frames',
  authRequired,
  uploadFrames.array('frames', 120),
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) return fail(res, 400, 'frames are required');
      const fps = Math.min(12, Math.max(1, Number(req.body?.fps) || 4));
      const { framesToMp4 } = require('../services/mediaStitch');
      const mp4 = await framesToMp4(
        files.map((f) => f.buffer),
        { fps },
      );
      return ok(res, {
        contentType: 'video/mp4',
        byteLength: mp4.length,
        base64: mp4.toString('base64'),
      });
    } catch (err) {
      console.error('from-frames failed', err);
      return fail(res, 500, err.message || 'Frame encode failed');
    }
  },
);

module.exports = router;
