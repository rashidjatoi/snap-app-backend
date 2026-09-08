const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, enum: ['premium_monthly', 'premium_yearly'], default: 'premium_monthly' },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    price: { type: Number, required: true },
    startedAt: { type: Date, default: Date.now },
    renewsAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

subscriptionSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    userId: this.userId?.toString?.() || this.userId,
    plan: this.plan,
    status: this.status,
    price: this.price,
    startedAt: this.startedAt,
    renewsAt: this.renewsAt,
    cancelledAt: this.cancelledAt,
  };
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
