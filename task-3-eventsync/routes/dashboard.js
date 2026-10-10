const express = require('express');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();

router.get('/attendee', requireAuth, asyncHandler(async (req, res) => {
  const registrations = await Registration.find({ user: req.session.userId })
    .sort({ registeredAt: -1 })
    .populate({
      path: 'event',
      select: 'title startAt endAt venue category status coverImage organizerName ticketPrice currency',
      populate: { path: 'organizer', select: 'name email' }
    })
    .lean();
  for (const registration of registrations) {
    if (!registration.paymentStatus && registration.event?.ticketPrice > 0) registration.paymentStatus = 'offline-payment-required';
    if (!registration.paymentStatus) registration.paymentStatus = 'not-required';
  }
  for (const registration of registrations) {
    if (registration.status !== 'confirmed' || registration.event?.status !== 'published') delete registration.event?.venue?.meetingUrl;
  }
  const now = new Date();
  res.json({
    registrations,
    upcoming: registrations.filter((item) => item.status === 'confirmed' && item.event?.status === 'published' && item.event.startAt > now),
    past: registrations.filter((item) => item.event && item.event.startAt <= now)
  });
}));

router.get('/organizer', requireRole('organizer', 'admin'), asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { organizer: req.session.userId };
  const events = await Event.find(filter).sort({ startAt: 1 }).lean();
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - 6);
  const eventIds = events.map((event) => event._id);
  const activity = eventIds.length ? await Registration.aggregate([
    { $match: { event: { $in: eventIds }, status: 'confirmed', registeredAt: { $gte: from } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$registeredAt', timezone: 'UTC' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]) : [];
  const activityByDay = new Map(activity.map((item) => [item._id, item.count]));
  const trends = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(from);
    date.setUTCDate(from.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { date: day, count: activityByDay.get(day) || 0 };
  });
  const counts = {
    total: events.length,
    published: events.filter((event) => event.status === 'published').length,
    drafts: events.filter((event) => event.status === 'draft').length,
    upcoming: events.filter((event) => event.status === 'published' && event.startAt > new Date()).length,
    completed: events.filter((event) => event.status === 'completed').length,
    registrations: events.reduce((sum, event) => sum + event.registeredCount, 0)
  };
  res.json({ events, counts, trends });
}));

module.exports = router;
