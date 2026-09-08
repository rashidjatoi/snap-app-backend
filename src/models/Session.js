const mongoose = require('mongoose');

const captureSchema = new mongoose.Schema(
  {
    captureId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['photo', 'video'], required: true },
    durationMs: { type: Number, default: null },
    capturedAt: { type: Date, default: Date.now },
    clientCaptureId: { type: String, default: null },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    syncCode: { type: String, required: true, unique: true, uppercase: true, index: true },
    qrPayload: { type: String, required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: [
        'ready_to_pair',
        'paired',
        'live',
        'capturing',
        'uploading',
        'stitching',
        'completed',
        'ended',
        'failed',
      ],
      default: 'ready_to_pair',
    },
    privacy: { type: String, enum: ['private', 'friends'], default: 'private' },
    signalingToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    captures: { type: [captureSchema], default: [] },
    activeStitchJobId: { type: String, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

sessionSchema.methods.participant = function participant(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    fullName: user.displayName || user.fullName || 'User',
    avatarUrl: user.avatarUrl || null,
  };
};

module.exports = mongoose.model('Session', sessionSchema);
