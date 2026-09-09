const express = require('express');
const { Ticket } = require('../models');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

const CATEGORIES = ['complaint', 'feedback', 'bug', 'other'];
const PRIORITIES = ['low', 'medium', 'high'];

router.get('/mine', authRequired, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });
    return ok(res, { tickets: tickets.map((t) => t.toJSONSafe()) });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to load tickets');
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return fail(res, 404, 'Ticket not found');
    if (
      ticket.userId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return fail(res, 403, 'Not allowed');
    }
    return ok(res, { ticket: ticket.toJSONSafe() });
  } catch {
    return fail(res, 404, 'Ticket not found');
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { subject, message, priority, category } = req.body || {};
    if (!subject || !message) {
      return fail(res, 400, 'subject and message are required');
    }
    const cat = String(category || 'complaint').toLowerCase();
    if (!CATEGORIES.includes(cat)) {
      return fail(res, 400, 'Invalid category');
    }
    const pri = String(priority || 'medium').toLowerCase();
    if (!PRIORITIES.includes(pri)) {
      return fail(res, 400, 'Invalid priority');
    }
    const ticket = await Ticket.create({
      userId: req.user._id,
      subject: String(subject).trim(),
      message: String(message).trim(),
      category: cat,
      status: 'open',
      priority: pri,
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
      message: String(message).trim(),
      createdAt: new Date(),
    });
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      ticket.status = 'open';
    }
    await ticket.save();
    return ok(res, { ticket: ticket.toJSONSafe() });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to reply');
  }
});

module.exports = router;
