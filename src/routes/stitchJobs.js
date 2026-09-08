const express = require('express');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');
const { StitchJob } = require('../models');
const { advanceStitchJob, stitchJobDto } = require('../services/sessionService');

const router = express.Router();

router.get('/:jobId', authRequired, async (req, res) => {
  try {
    let job = await StitchJob.findOne({ jobId: req.params.jobId });
    if (!job) return fail(res, 404, 'Stitch job not found', 'STITCH_JOB_NOT_FOUND');
    job = await advanceStitchJob(job);
    return ok(res, stitchJobDto(job));
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to load stitch job');
  }
});

module.exports = router;
