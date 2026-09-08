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

router.post('/', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'file is required');

    const folder = (req.body && req.body.folder) || 'uploads';
    const allowed = ['avatars', 'snaps', 'poses', 'uploads'];
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

module.exports = router;
