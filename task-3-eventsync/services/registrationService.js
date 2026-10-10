const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { HttpError } = require('../utils/errors');

async function registerForEvent(userId, eventId, now = new Date()) {
  const event = await Event.findOneAndUpdate({
    _id: eventId,
    status: 'published',
    startAt: { $gt: now },
    registrationOpensAt: { $lte: now },
    registrationClosesAt: { $gt: now },
    $expr: { $lt: ['$registeredCount', '$capacity'] }
  }, { $inc: { registeredCount: 1 } }, { new: true });
  if (!event) {
    const existing = await Event.findById(eventId).select('status startAt registrationOpensAt registrationClosesAt registeredCount capacity ticketPrice');
    if (!existing) throw new HttpError(404, 'Event not found.');
    if (existing.status !== 'published') throw new HttpError(409, 'This event is not open for registration.');
    if (existing.startAt <= now || existing.registrationClosesAt <= now) throw new HttpError(409, 'Registration for this event has closed.');
    if (existing.registrationOpensAt > now) throw new HttpError(409, 'Registration has not opened yet.');
    throw new HttpError(409, 'This event is full.');
  }

  try {
    const previous = await Registration.findOne({ user: userId, event: eventId });
    if (previous?.status === 'confirmed') {
      await Event.updateOne({ _id: eventId, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });
      throw new HttpError(409, 'You already have a registration for this event.');
    }
    if (previous) {
      const changed = await Registration.updateOne(
        { _id: previous._id, status: 'cancelled' },
        { $set: {
          status: 'confirmed',
          paymentStatus: event.ticketPrice > 0 ? 'offline-payment-required' : 'not-required',
          registeredAt: now,
          cancelledAt: null
        } }
      );
      if (!changed.modifiedCount) {
        await Event.updateOne({ _id: eventId, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });
        throw new HttpError(409, 'Your registration changed. Refresh and try again.');
      }
      return Registration.findById(previous._id);
    }
    const registration = await Registration.create({
      user: userId,
      event: eventId,
      paymentStatus: event.ticketPrice > 0 ? 'offline-payment-required' : 'not-required'
    });
    return registration;
  } catch (error) {
    if (!(error instanceof HttpError)) {
      await Event.updateOne({ _id: eventId, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });
    }
    if (error.code === 11000) throw new HttpError(409, 'You already have a registration for this event.');
    throw error;
  }
}

async function cancelRegistration(userId, registrationId, now = new Date()) {
  const registration = await Registration.findOne({ _id: registrationId, user: userId, status: 'confirmed' });
  if (!registration) throw new HttpError(404, 'Active registration not found.');
  const event = await Event.findById(registration.event).select('startAt registrationClosesAt');
  if (!event) throw new HttpError(404, 'Event not found.');
  if (now >= event.startAt || now >= event.registrationClosesAt) throw new HttpError(409, 'This registration can no longer be cancelled.');
  const changed = await Registration.updateOne(
    { _id: registration._id, user: userId, status: 'confirmed' },
    { $set: { status: 'cancelled', cancelledAt: now } }
  );
  if (!changed.modifiedCount) throw new HttpError(409, 'This registration has already been cancelled.');
  await Event.updateOne({ _id: event._id, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });
  return { ...registration.toObject(), status: 'cancelled', cancelledAt: now };
}

module.exports = { cancelRegistration, registerForEvent };
