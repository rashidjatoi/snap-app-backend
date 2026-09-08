const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    snapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Snap', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

commentSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    snapId: this.snapId?.toString?.() || this.snapId,
    userId: this.userId?.toString?.() || this.userId,
    text: this.text,
    status: this.status,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Comment', commentSchema);
