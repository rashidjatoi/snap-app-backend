const express = require('express');
const { Ticket, User } = require('../../models');
const { ok, fail } = require('../../utils/response');

const router = express.Router();

async function withUser(ticket) {
  const user = await User.findById(ticket.userId);
  return {
    ...ticket.toJSONSafe(),
    user: user
      ? {
          id: user._id.toString(),
          email: user.email,
          displayName: user.displayName,
          username: user.username,
        }
      : null,
  };
}

router.get('/tickets', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const tickets = await Ticket.find(filter).sort({ createdAt: -1 });
    const enriched = await Promise.all(tickets.map(withUser));
    return ok(res, { tickets: enriched });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load tickets');
  }
});

router.get('/tickets/:id', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return fail(res, 404, 'Ticket not found');
    return ok(res, { ticket: await withUser(ticket) });
  } catch {
    return fail(res, 404, 'Ticket not found');
  }
});

router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return fail(res, 400, 'message is required');
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return fail(res, 404, 'Ticket not found');
    ticket.replies.push({
      authorId: req.user._id,
      authorRole: 'admin',
      message,
      createdAt: new Date(),
    });
    await ticket.save();
    return ok(res, { ticket: await withUser(ticket) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to reply');
  }
});

router.patch('/tickets/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['open', 'pending', 'resolved', 'closed'].includes(status)) {
      return fail(res, 400, 'Invalid status');
    }
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return fail(res, 404, 'Ticket not found');
    ticket.status = status;
    await ticket.save();
    return ok(res, { ticket: await withUser(ticket) });
  } catch {
    return fail(res, 404, 'Ticket not found');
  }
});

module.exports = router;
