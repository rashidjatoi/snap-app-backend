const mongoose = require('mongoose');

const snapSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['photo', 'video'], required: true },
    mediaUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    caption: { type: String, default: '' },
    status: { type: String, enum: ['published', 'flagged', 'removed'], default: 'published' },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

snapSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    ownerId: this.ownerId?.toString?.() || this.ownerId,
    partnerId: this.partnerId?.toString?.() || this.partnerId,
    type: this.type,
    mediaUrl: this.mediaUrl,
    thumbnailUrl: this.thumbnailUrl || this.mediaUrl,
    caption: this.caption,
    status: this.status,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Snap', snapSchema);
