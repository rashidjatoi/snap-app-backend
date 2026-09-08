const mongoose = require('mongoose');

const partnerSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    fullName: { type: String, required: true },
    avatarUrl: { type: String, default: null },
  },
  { _id: false },
);

const poseSchema = new mongoose.Schema(
  {
    poseId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    ownerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    mediaType: { type: String, enum: ['photo', 'video'], required: true },
    mediaUrl: { type: String, required: true },
    peerMediaUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    durationSec: { type: Number, default: null },
    layout: { type: String, default: 'split_screen' },
    videoStrategy: { type: String, default: 'flag_unconfirmed' },
    partners: { type: [partnerSchema], default: [] },
    partnersLabel: { type: String, default: 'You & Partner' },
    shareUrl: { type: String, default: null },
    confirmed: { type: Boolean, default: false },
    isFavorite: { type: Boolean, default: false },
    favoritedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

module.exports = mongoose.model('Pose', poseSchema);
