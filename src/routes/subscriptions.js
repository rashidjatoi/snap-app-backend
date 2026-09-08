const express = require('express');
const { Subscription, Payment, Coupon } = require('../models');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

router.get('/me', authRequired, async (req, res) => {
  const sub = await Subscription.findOne({ userId: req.user._id, status: 'active' });
  return ok(res, {
    premium: !!req.user.premium,
    subscription: sub ? sub.toJSONSafe() : null,
  });
});

router.post('/subscribe', authRequired, async (req, res) => {
  try {
    const plan = (req.body && req.body.plan) || 'premium_monthly';
    const price = plan === 'premium_yearly' ? 79.99 : 9.99;

    const existing = await Subscription.findOne({
      userId: req.user._id,
      status: 'active',
    });
    if (existing) {
      return ok(res, { subscription: existing.toJSONSafe(), payment: null });
    }

    req.user.premium = true;
    await req.user.save();

    const payment = await Payment.create({
      userId: req.user._id,
      amount: price,
      currency: 'USD',
      status: 'completed',
      method: 'card',
      description: plan,
    });

    const renews = new Date();
    renews.setMonth(renews.getMonth() + (plan === 'premium_yearly' ? 12 : 1));

    const subscription = await Subscription.create({
      userId: req.user._id,
      plan,
      status: 'active',
      price,
      startedAt: new Date(),
      renewsAt: renews,
    });

    return ok(res, {
      subscription: subscription.toJSONSafe(),
      payment: payment.toJSONSafe(),
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Subscribe failed');
  }
});

router.post('/cancel', authRequired, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ userId: req.user._id, status: 'active' });
    if (!sub) return fail(res, 404, 'No active subscription');
    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    await sub.save();
    req.user.premium = false;
    await req.user.save();
    return ok(res, { subscription: sub.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Cancel failed');
  }
});

router.get('/coupons/:code', authRequired, async (req, res) => {
  const coupon = await Coupon.findOne({
    code: String(req.params.code).toUpperCase(),
    active: true,
  });
  if (!coupon) return fail(res, 404, 'Coupon not found');
  return ok(res, { coupon: coupon.toJSONSafe() });
});

module.exports = router;
