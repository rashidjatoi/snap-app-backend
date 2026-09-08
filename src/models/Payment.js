const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['pending', 'completed', 'refunded'], default: 'pending' },
    method: { type: String, default: 'card' },
    description: { type: String, default: '' },
    refundedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

paymentSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    userId: this.userId?.toString?.() || this.userId,
    amount: this.amount,
    currency: this.currency,
    status: this.status,
    method: this.method,
    description: this.description,
    refundedAt: this.refundedAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Payment', paymentSchema);
