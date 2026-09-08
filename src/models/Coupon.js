const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountPercent: { type: Number, required: true },
    active: { type: Boolean, default: true },
    maxUses: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

couponSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    code: this.code,
    discountPercent: this.discountPercent,
    active: this.active,
    maxUses: this.maxUses,
    usedCount: this.usedCount,
    expiresAt: this.expiresAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Coupon', couponSchema);
