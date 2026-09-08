const express = require('express');
const { Ticket } = require('../models');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

router.get('/mine', authRequired, async (req, res) => {
  const tickets = await Ticket.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return ok(res, { tickets: tickets.map((t) => t.toJSONSafe()) });
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { subject, message, priority } = req.body || {};
    if (!subject || !message) return fail(res, 400, 'subject and message are required');
    const ticket = await Ticket.create({
      userId: req.user._id,
      subject,
      message,
      status: 'open',
      priority: priority || 'medium',
      replies: [],
    });
    return ok(res, { ticket: ticket.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to create ticket');
  }
});

router.post('/:id/reply', authRequired, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return fail(res, 400, 'message is required');
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return fail(res, 404, 'Ticket not found');
    if (
      ticket.userId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return fail(res, 403, 'Not allowed');
    }
    ticket.replies.push({
      authorId: req.user._id,
      authorRole: req.user.role,
      message,
      createdAt: new Date(),
    });
    if (ticket.status === 'resolved') ticket.status = 'open';
    await ticket.save();
    return ok(res, { ticket: ticket.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to reply');
  }
});

module.exports = router;
