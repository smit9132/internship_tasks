const express = require('express');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { CATEGORIES } = require('../utils/validation');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../utils/errors');
const { validateEvent } = require('../utils/validation');
const { cancelRegistration, registerForEvent } = require('../services/registrationService');

const router = express.Router();
const editableFields = ['title', 'description', 'category', 'coverImage', 'venue', 'startAt', 'endAt', 'timezone', 'registrationOpensAt', 'registrationClosesAt', 'capacity', 'ticketPrice', 'currency'];
const eventInput = (body, organizerName) => ({
  ...Object.fromEntries(editableFields.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])),
  organizerName
});

router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(24, Number.parseInt(req.query.limit, 10) || 12));
  const filter = { status: 'published', startAt: { $gte: new Date() } };
  if (typeof req.query.category === 'string' && req.query.category) {
    if (!CATEGORIES.includes(req.query.category)) throw new HttpError(400, 'Choose a valid event category.');
    filter.category = req.query.category;
  }
  if (typeof req.query.from === 'string' && req.query.from) {
    if (Number.isNaN(Date.parse(req.query.from))) throw new HttpError(400, 'The start date filter is invalid.');
    filter.startAt.$gte = new Date(req.query.from);
  }
  if (typeof req.query.to === 'string' && req.query.to) {
    if (Number.isNaN(Date.parse(req.query.to))) throw new HttpError(400, 'The end date filter is invalid.');
    filter.startAt.$lte = new Date(req.query.to);
  }
  if (filter.startAt.$lte && filter.startAt.$lte < filter.startAt.$gte) throw new HttpError(400, 'The end date must be on or after the start date.');
  if (req.query.sort && !['date-asc', 'date-desc', 'popular'].includes(req.query.sort)) throw new HttpError(400, 'Choose a valid event sort order.');
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (query) filter.$text = { $search: query };
  const sort = req.query.sort === 'date-desc' ? { startAt: -1 } : req.query.sort === 'popular' ? { registeredCount: -1, startAt: 1 } : { startAt: 1 };
  const [events, total] = await Promise.all([
    Event.find(filter).select('-venue.meetingUrl').sort(sort).skip((page - 1) * limit).limit(limit).populate('organizer', 'name').lean(),
    Event.countDocuments(filter)
  ]);
  res.json({ events, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/mine/registrations', requireAuth, asyncHandler(async (req, res) => {
  const registrations = await Registration.find({ user: req.session.userId }).sort({ registeredAt: -1 }).populate({ path: 'event', populate: { path: 'organizer', select: 'name' } }).lean();
  res.json({ registrations });
}));

router.delete('/registrations/:registrationId', requireAuth, asyncHandler(async (req, res) => {
  const registration = await cancelRegistration(req.session.userId, req.params.registrationId);
  res.json({ registration, message: 'Your registration has been cancelled.' });
}));

router.get('/organizer/mine', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const events = await Event.find({ organizer: req.session.userId }).sort({ startAt: 1 }).lean();
  res.json({ events });
}));

router.get('/:eventId', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.eventId)) throw new HttpError(400, 'Invalid event identifier.');
  const event = await Event.findOne({ _id: req.params.eventId, status: { $in: ['published', 'completed'] } }).populate('organizer', 'name email').lean();
  if (!event) throw new HttpError(404, 'Event not found.');
  const isHost = req.session.userId && String(event.organizer._id) === req.session.userId;
  const hasRegistration = req.session.userId && await Registration.exists({ user: req.session.userId, event: event._id, status: 'confirmed' });
  const myRegistration = req.session.userId ? await Registration.findOne({
    user: req.session.userId, event: event._id, status: 'confirmed'
  }).select('status paymentStatus') : null;
  if ((!isHost && !hasRegistration) || event.status === 'completed') delete event.venue.meetingUrl;
  if (!isHost && !hasRegistration) delete event.organizer.email;
  res.json({ event, registration: myRegistration });
}));

router.post('/:eventId/register', requireAuth, asyncHandler(async (req, res) => {
  const registration = await registerForEvent(req.session.userId, req.params.eventId);
  let message = 'You are registered for this event.';
  if (registration.paymentStatus === 'offline-payment-required') {
    const event = await Event.findById(req.params.eventId).select('title ticketPrice currency organizer').populate('organizer', 'email');
    const contact = event?.organizer?.email;
    message = `Your spot is reserved. No payment was collected.${contact ? ` Contact the organizer at ${contact} to arrange payment of ${event.currency} ${Number(event.ticketPrice).toFixed(2)}.` : ' Contact the organizer to arrange payment.'}`;
  }
  res.status(201).json({ registration, message });
}));

router.post('/', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const user = await requireOrganizer(req.session.userId);
  const input = eventInput(req.body, user.name);
  const errors = validateEvent(input);
  if (errors.length) throw new HttpError(400, 'Please correct the event details.', { details: errors });
  const event = await Event.create({ ...input, organizer: user._id, status: 'draft' });
  res.status(201).json({ event });
}));

router.patch('/:eventId', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.params.eventId, req.session.userId, req.session.role);
  const user = await requireOrganizer(req.session.userId);
  const updates = eventInput(req.body, user.name);
  if (!Object.keys(updates).some((key) => editableFields.includes(key))) throw new HttpError(400, 'No editable event fields were provided.');
  const candidate = { ...event.toObject(), ...updates };
  const errors = validateEvent(candidate);
  if (errors.length) throw new HttpError(400, 'Please correct the event details.', { details: errors });
  if (candidate.capacity < event.registeredCount) throw new HttpError(409, 'Capacity cannot be lower than the current number of registrations.');
  const filter = { _id: event._id, registeredCount: { $lte: candidate.capacity } };
  if (req.session.role !== 'admin') filter.organizer = req.session.userId;
  const updated = await Event.findOneAndUpdate(filter, { $set: updates }, { new: true, runValidators: true });
  if (!updated) throw new HttpError(409, 'The event changed while you were editing it. Refresh and try again.');
  res.json({ event: updated });
}));

router.post('/:eventId/publish', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.params.eventId, req.session.userId, req.session.role);
  if (!['draft', 'published'].includes(event.status)) throw new HttpError(409, 'This event cannot be published in its current status.');
  const errors = validateEvent(event.toObject());
  if (event.startAt <= new Date()) errors.push('A past event cannot be published.');
  if (errors.length) throw new HttpError(400, 'Complete all event details before publishing.', { details: errors });
  event.status = 'published';
  await event.save();
  res.json({ event });
}));

router.post('/:eventId/cancel', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.params.eventId, req.session.userId, req.session.role);
  if (event.status === 'completed') throw new HttpError(409, 'Completed events cannot be cancelled.');
  event.status = 'cancelled';
  await event.save();
  res.json({ event });
}));

router.post('/:eventId/complete', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.params.eventId, req.session.userId, req.session.role);
  if (event.status !== 'published' || event.endAt > new Date()) throw new HttpError(409, 'Only a published event that has ended can be marked completed.');
  event.status = 'completed';
  await event.save();
  res.json({ event });
}));

router.get('/:eventId/registrations', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  await ownedEvent(req.params.eventId, req.session.userId, req.session.role);
  const registrations = await Registration.find({ event: req.params.eventId, status: 'confirmed' }).sort({ registeredAt: -1 }).populate('user', 'name email').lean();
  res.json({ registrations });
}));

router.get('/:eventId/registrations.csv', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  await ownedEvent(req.params.eventId, req.session.userId, req.session.role);
  const registrations = await Registration.find({ event: req.params.eventId, status: 'confirmed' }).sort({ registeredAt: 1 }).populate('user', 'name email').lean();
  const cell = (value) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const event = await Event.findById(req.params.eventId).select('ticketPrice');
  const csv = ['Name,Email,Status,Payment,Registered At', ...registrations.map((item) => [
    item.user.name,
    item.user.email,
    item.status,
    item.paymentStatus || (event?.ticketPrice > 0 ? 'offline-payment-required' : 'not-required'),
    item.registeredAt.toISOString()
  ].map(cell).join(','))].join('\r\n');
  res.type('text/csv').attachment(`eventsync-attendees-${req.params.eventId}.csv`).send(csv);
}));

async function requireOrganizer(userId) {
  const User = require('../models/User');
  const user = await User.findById(userId).select('name');
  if (!user) throw new HttpError(401, 'Please log in to continue.');
  return user;
}
async function ownedEvent(eventId, userId, role) {
  if (!mongoose.isValidObjectId(eventId)) throw new HttpError(400, 'Invalid event identifier.');
  const filter = { _id: eventId };
  if (role !== 'admin') filter.organizer = userId;
  const event = await Event.findOne(filter);
  if (!event) throw new HttpError(404, 'Event not found.');
  return event;
}

module.exports = router;
