const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    targetType: { type: String, enum: ['snap', 'comment'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true },
    details: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
    resolution: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

reportSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    targetType: this.targetType,
    targetId: this.targetId?.toString?.() || this.targetId,
    reporterId: this.reporterId?.toString?.() || this.reporterId,
    reason: this.reason,
    details: this.details,
    status: this.status,
    resolution: this.resolution,
    resolvedAt: this.resolvedAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Report', reportSchema);
