const mongoose = require('mongoose');

const pairRequestSchema = new mongoose.Schema(
  {
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired'],
      default: 'pending',
    },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PairRequest', pairRequestSchema);
