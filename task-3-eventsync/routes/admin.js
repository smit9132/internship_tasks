const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { requireRole } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../utils/errors');
const { validateEvent } = require('../utils/validation');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/stats', asyncHandler(async (req, res) => {
  const [users, events, registrations] = await Promise.all([
    User.countDocuments(), Event.countDocuments(), Registration.countDocuments({ status: 'confirmed' })
  ]);
  res.json({ users, events, registrations });
}));

router.get('/users', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const filter = search ? { $or: [{ name: { $regex: escapeRegex(search), $options: 'i' } }, { email: { $regex: escapeRegex(search), $options: 'i' } }] } : {};
  const [users, total] = await Promise.all([
    User.find(filter).select('name email role isActive createdAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter)
  ]);
  const registrationCounts = users.length ? await Registration.aggregate([
    { $match: { user: { $in: users.map((user) => user._id) } } },
    { $group: {
      _id: '$user',
      total: { $sum: 1 },
      confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } }
    } }
  ]) : [];
  const countsByUser = new Map(registrationCounts.map((item) => [String(item._id), item]));
  const userRegistrations = users.length ? await Registration.find({ user: { $in: users.map((user) => user._id) } })
    .select('user event status paymentStatus registeredAt')
    .sort({ registeredAt: -1 })
    .populate('event', 'title category startAt status ticketPrice currency')
    .lean() : [];
  const registrationsByUser = new Map();
  for (const registration of userRegistrations) {
    const userId = String(registration.user);
    const registrations = registrationsByUser.get(userId) || [];
    registrations.push({
      _id: registration._id,
      event: registration.event ? {
        _id: registration.event._id,
        title: registration.event.title,
        category: registration.event.category,
        startAt: registration.event.startAt,
        status: registration.event.status
      } : null,
      status: registration.status,
      paymentStatus: registration.paymentStatus || (registration.event?.ticketPrice > 0 ? 'offline-payment-required' : 'not-required'),
      registeredAt: registration.registeredAt
    });
    registrationsByUser.set(userId, registrations);
  }
  const usersWithRegistrations = users.map((user) => {
    const counts = countsByUser.get(String(user._id));
    return {
      ...user,
      registrationCount: counts?.total || 0,
      confirmedRegistrationCount: counts?.confirmed || 0,
      registrations: registrationsByUser.get(String(user._id)) || []
    };
  });
  res.json({ users: usersWithRegistrations, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.patch('/users/:userId', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new HttpError(400, 'Invalid user identifier.');
  const allowed = ['attendee', 'organizer', 'admin'];
  if (req.body.role !== undefined && !allowed.includes(req.body.role)) throw new HttpError(400, 'Choose a valid role.');
  if (req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') throw new HttpError(400, 'isActive must be true or false.');
  if (req.body.role === undefined && req.body.isActive === undefined) throw new HttpError(400, 'Provide a role or account status to update.');
  if (req.params.userId === req.session.userId && (req.body.role !== undefined && req.body.role !== 'admin' || req.body.isActive === false)) throw new HttpError(409, 'You cannot remove your own administrator access or deactivate your account.');
  const updates = {};
  if (req.body.role !== undefined) updates.role = req.body.role;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  const user = await User.findByIdAndUpdate(req.params.userId, updates, { new: true, runValidators: true }).select('name email role isActive createdAt');
  if (!user) throw new HttpError(404, 'User not found.');
  res.json({ user });
}));

router.get('/events', asyncHandler(async (req, res) => {
  const events = await Event.find().sort({ createdAt: -1 }).populate('organizer', 'name email').lean();
  res.json({ events });
}));

router.patch('/events/:eventId', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.eventId)) throw new HttpError(400, 'Invalid event identifier.');
  if (!['published', 'cancelled', 'completed'].includes(req.body.status)) throw new HttpError(400, 'Choose published, cancelled, or completed.');
  const event = await Event.findById(req.params.eventId);
  if (!event) throw new HttpError(404, 'Event not found.');
  if (req.body.status === 'published') {
    const errors = validateEvent(event.toObject());
    if (event.startAt <= new Date()) errors.push('A past event cannot be published.');
    if (errors.length) throw new HttpError(400, 'This event is not ready to publish.', { details: errors });
  }
  event.status = req.body.status;
  await event.save();
  res.json({ event });
}));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
