const express = require('express');
const { User, Snap, Payment, Ticket, Report } = require('../../models');
const { ok, fail } = require('../../utils/response');

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.get('/overview', async (req, res) => {
  try {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const dayAgo = new Date(now.getTime() - dayMs);

    const [
      totalUsers,
      dailyActiveUsers,
      newSignups,
      premiumUsers,
      openTickets,
      pendingReports,
      publishedSnaps,
      completedPayments,
      refundedPayments,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', lastActiveAt: { $gte: dayAgo } }),
      User.countDocuments({ role: 'user', createdAt: { $gte: dayAgo } }),
      User.countDocuments({ role: 'user', premium: true }),
      Ticket.countDocuments({ status: 'open' }),
      Report.countDocuments({ status: 'pending' }),
      Snap.countDocuments({ status: 'published' }),
      Payment.find({ status: 'completed' }),
      Payment.find({ status: 'refunded' }),
    ]);

    const revenue = completedPayments.reduce((sum, p) => sum + p.amount, 0);
    const refunds = refundedPayments.reduce((sum, p) => sum + p.amount, 0);

    const users = await User.find({ role: 'user' }).select('createdAt');
    const signupsByDay = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = startOfDay(new Date(now.getTime() - i * dayMs));
      const next = new Date(day.getTime() + dayMs);
      const count = users.filter((u) => u.createdAt >= day && u.createdAt < next).length;
      signupsByDay.push({ date: day.toISOString().slice(0, 10), count });
    }

    const revenueByDay = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = startOfDay(new Date(now.getTime() - i * dayMs));
      const next = new Date(day.getTime() + dayMs);
      const amount = completedPayments
        .filter((p) => p.createdAt >= day && p.createdAt < next)
        .reduce((sum, p) => sum + p.amount, 0);
      revenueByDay.push({
        date: day.toISOString().slice(0, 10),
        amount: Number(amount.toFixed(2)),
      });
    }

    return ok(res, {
      totals: {
        totalUsers,
        dailyActiveUsers,
        newSignups,
        premiumUsers,
        revenue: Number(revenue.toFixed(2)),
        refunds: Number(refunds.toFixed(2)),
        openTickets,
        pendingReports,
        publishedSnaps,
      },
      signupsByDay,
      revenueByDay,
    });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load analytics');
  }
});

module.exports = router;
