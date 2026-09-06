const express = require('express');
const SupportTicket = require('../models/SupportTicket');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const sendEmail = require('../utils/email');

const router = express.Router();

router.get('/mine', requireAuth, async (req, res) => {
  res.json({ success: true, data: await SupportTicket.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean() });
});

router.post('/', requireAuth, async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject na ujumbe vinahitajika.' });
  const ticket = await new SupportTicket({ userId: req.user._id, subject, message }).save();
  res.status(201).json({ success: true, data: ticket });
});

router.get('/admin/all', requireAdmin, async (req, res) => {
  res.json({ success: true, data: await SupportTicket.find().populate('userId', 'username email').sort({ createdAt: -1 }).lean() });
});

router.patch('/admin/:id', requireAdmin, async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id).populate('userId', 'username email');
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket haipatikani.' });
  ticket.status = req.body.status === 'resolved' ? 'resolved' : 'open';
  ticket.adminReply = String(req.body.adminReply || '').trim();
  ticket.resolvedAt = ticket.status === 'resolved' ? new Date() : null;
  await ticket.save();
  if (ticket.adminReply && ticket.userId?.email) {
    await sendEmail({ to: ticket.userId.email, subject: `Support update: ${ticket.subject}`, text: ticket.adminReply, html: `<h1 style="margin:0 0 16px;color:#173638;">Support update</h1><p>${ticket.adminReply.replace(/\n/g, '<br>')}</p><p style="color:#718083;">Ticket: ${ticket._id}</p>` });
  }
  res.json({ success: true, data: ticket });
});

module.exports = router;