const express = require('express');
const { User, Payment, Coupon, Subscription } = require('../../models');
const { publicUser } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');

const router = express.Router();

router.get('/premium-users', async (req, res) => {
  const users = await User.find({ role: 'user', premium: true }).sort({ displayName: 1 });
  return ok(res, { users: users.map(publicUser) });
});

router.get('/payments', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const payments = await Payment.find(filter).sort({ createdAt: -1 });
    const enriched = await Promise.all(
      payments.map(async (p) => {
        const user = await User.findById(p.userId);
        return {
          ...p.toJSONSafe(),
          user: user
            ? {
                id: user._id.toString(),
                email: user.email,
                displayName: user.displayName,
              }
            : null,
        };
      }),
    );
    return ok(res, { payments: enriched });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load payments');
  }
});

router.post('/payments/:id/refund', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return fail(res, 404, 'Payment not found');
    if (payment.status !== 'completed') {
      return fail(res, 400, 'Only completed payments can be refunded');
    }
    payment.status = 'refunded';
    payment.refundedAt = new Date();
    await payment.save();
    return ok(res, { payment: payment.toJSONSafe() });
  } catch {
    return fail(res, 404, 'Payment not found');
  }
});

router.get('/coupons', async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  return ok(res, { coupons: coupons.map((c) => c.toJSONSafe()) });
});

router.post('/coupons', async (req, res) => {
  try {
    const { code, discountPercent, maxUses, expiresAt } = req.body || {};
    if (!code || !discountPercent) {
      return fail(res, 400, 'code and discountPercent are required');
    }
    const exists = await Coupon.findOne({ code: String(code).toUpperCase() });
    if (exists) return fail(res, 409, 'Coupon code already exists');

    const coupon = await Coupon.create({
      code: String(code).toUpperCase(),
      discountPercent: Number(discountPercent),
      active: true,
      maxUses: maxUses || 100,
      usedCount: 0,
      expiresAt: expiresAt || new Date(Date.now() + 30 * 86400000),
    });
    return ok(res, { coupon: coupon.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to create coupon');
  }
});

router.patch('/coupons/:id', async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return fail(res, 404, 'Coupon not found');
    if (req.body.active !== undefined) coupon.active = !!req.body.active;
    if (req.body.maxUses !== undefined) coupon.maxUses = Number(req.body.maxUses);
    if (req.body.discountPercent !== undefined) {
      coupon.discountPercent = Number(req.body.discountPercent);
    }
    await coupon.save();
    return ok(res, { coupon: coupon.toJSONSafe() });
  } catch {
    return fail(res, 404, 'Coupon not found');
  }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const subs = await Subscription.find().sort({ startedAt: -1 });
    const enriched = await Promise.all(
      subs.map(async (s) => {
        const user = await User.findById(s.userId);
        return {
          ...s.toJSONSafe(),
          user: user
            ? {
                id: user._id.toString(),
                email: user.email,
                displayName: user.displayName,
              }
            : null,
        };
      }),
    );
    return ok(res, { subscriptions: enriched });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load subscriptions');
  }
});

module.exports = router;
