const mongoose = require('mongoose');

const stitchJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    progress: { type: Number, default: 0 },
    message: { type: String, default: 'Uploading captures…' },
    mediaType: { type: String, enum: ['photo', 'video'], default: 'photo' },
    layout: { type: String, default: 'split_screen' },
    videoStrategy: { type: String, default: 'flag_unconfirmed' },
    poseId: { type: String, default: null },
    previewUrl: { type: String, default: null },
    shareUrl: { type: String, default: null },
    partnersLabel: { type: String, default: 'You & Partner' },
    errorCode: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('StitchJob', stitchJobSchema);
