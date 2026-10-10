const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const supertest = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-only-session-secret-that-is-not-for-production';
process.env.CORS_ORIGINS = '';

const User = require('../models/User');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { createApp } = require('../server');
const { validateEvent, validateRegistration } = require('../utils/validation');

let mongo;
let app;
let server;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('eventsync_test');
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User.init(), Event.init(), Registration.init()]);
  app = createApp();
  server = app.listen(0);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Event.deleteMany({}), Registration.deleteMany({}),
    mongoose.connection.collection('sessions').deleteMany({})
  ]);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

function validEvent(overrides = {}) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    title: 'A thoughtful community gathering',
    description: 'Come meet good people and make a little more room for creativity.',
    category: 'Community',
    venue: { type: 'in-person', name: 'The Greenhouse', address: '12 Garden Lane' },
    startAt: start.toISOString(), endAt: end.toISOString(),
    registrationOpensAt: new Date(Date.now() - 60000).toISOString(),
    registrationClosesAt: new Date(start.getTime() - 60 * 60 * 1000).toISOString(),
    timezone: 'UTC', capacity: 2, ticketPrice: 0, currency: 'USD',
    ...overrides
  };
}

async function signedIn(name = 'Test Person', email = `user-${Math.random()}@example.test`, role = 'attendee') {
  const password = 'correct-horse-battery';
  const user = await User.create({ name, email, password, role });
  const agent = supertest.agent(server);
  let csrf = (await agent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password }).expect(200);
  csrf = (await agent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  return { agent, csrf, user };
}

async function createPublishedEvent(owner, overrides = {}) {
  const created = await owner.agent.post('/api/events').set('X-CSRF-Token', owner.csrf).send(validEvent(overrides)).expect(201);
  const event = created.body.event;
  await supertest(server).get(`/api/events/${event._id}`).expect(404);
  await owner.agent.post(`/api/events/${event._id}/publish`).set('X-CSRF-Token', owner.csrf).send({}).expect(200);
  return event;
}

test('registration validates inputs, hashes passwords, and ignores self-selected roles', async () => {
  const agent = supertest.agent(server);
  const csrf = (await agent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  await agent.post('/api/auth/register').set('X-CSRF-Token', csrf).send({ name: 'A', email: 'bad', password: 'short', role: 'admin' }).expect(400);
  const response = await agent.post('/api/auth/register').set('X-CSRF-Token', csrf).send({
    name: 'Regular Person', email: 'REGULAR@example.test', password: 'a-secure-password', role: 'admin'
  }).expect(201);
  assert.equal(response.body.user.role, 'attendee');
  assert.equal(response.body.user.email, 'regular@example.test');
  const saved = await User.findOne({ email: 'regular@example.test' }).select('+password');
  assert.notEqual(saved.password, 'a-secure-password');
  assert.equal(await saved.comparePassword('a-secure-password'), true);
  assert.equal(validateRegistration({ name: 'X', email: 'bad', password: 'x' }).length, 3);
});

test('CSRF tokens are required for mutations and sessions authenticate correctly', async () => {
  const agent = supertest.agent(server);
  await agent.post('/api/auth/login').send({ email: 'no@example.test', password: 'password' }).expect(403);
  const attendee = await signedIn();
  const me = await attendee.agent.get('/api/auth/me').expect(200);
  assert.equal(me.body.user.role, 'attendee');
  await attendee.agent.post('/api/events').set('X-CSRF-Token', attendee.csrf).send(validEvent()).expect(403);
});

test('organizers can create and publish events but cannot modify another organizer event', async () => {
  const organizer = await signedIn('Organizer', undefined, 'organizer');
  const other = await signedIn('Another organizer', undefined, 'organizer');
  const invalid = await organizer.agent.post('/api/events').set('X-CSRF-Token', organizer.csrf).send(validEvent({ capacity: 0 })).expect(400);
  assert.match(invalid.body.error, /correct/i);
  const event = await createPublishedEvent(organizer);
  assert.equal(event.status, 'draft');
  await other.agent.patch(`/api/events/${event._id}`).set('X-CSRF-Token', other.csrf).send({ title: 'Hijacked event title' }).expect(404);
  const publicList = await supertest(server).get('/api/events').expect(200);
  assert.equal(publicList.body.events.some((item) => item._id === event._id), true);
  assert.equal((await supertest(server).get(`/api/events/${event._id}`).expect(200)).body.event.title, event.title);
});

test('invalid event dates and impossible capacities are rejected server-side', async () => {
  const organizer = await signedIn('Date checker', undefined, 'organizer');
  const reversed = validEvent({ endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  const response = await organizer.agent.post('/api/events').set('X-CSRF-Token', organizer.csrf).send(reversed).expect(400);
  assert.match(response.body.details.join(' '), /end must be after its start/i);
  const overCapacity = validEvent({ capacity: 100001 });
  assert.ok(validateEvent(overCapacity).some((message) => message.includes('Capacity')));
});

test('duplicate registrations are prevented and concurrent reservations never exceed capacity', async () => {
  const organizer = await signedIn('Organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer, { capacity: 1 });
  const first = await signedIn('First attendee');
  const second = await signedIn('Second attendee');
  const outcomes = await Promise.all([
    first.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', first.csrf).send({}),
    second.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', second.csrf).send({})
  ]);
  assert.deepEqual(outcomes.map((item) => item.status).sort(), [201, 409]);
  const stored = await Event.findById(event._id);
  assert.equal(stored.registeredCount, 1);
  const winner = outcomes[0].status === 201 ? first : second;
  await winner.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', winner.csrf).send({}).expect(409);
  assert.equal((await Event.findById(event._id)).registeredCount, 1);
});

test('attendees can register for older free events with no stored ticket price', async () => {
  const organizer = await signedIn('Legacy event organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer);
  await Event.collection.updateOne({ _id: new mongoose.Types.ObjectId(event._id) }, { $unset: { ticketPrice: '' } });
  const attendee = await signedIn('Legacy event attendee');
  const response = await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201);
  assert.equal(response.body.registration.status, 'confirmed');
  assert.equal((await Event.findById(event._id)).registeredCount, 1);
});

test('registration closing time is enforced and cancellations release capacity', async () => {
  const organizer = await signedIn('Organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer);
  const attendee = await signedIn('Booking attendee');
  const registration = (await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201)).body.registration;
  await attendee.agent.delete(`/api/events/registrations/${registration._id}`).set('X-CSRF-Token', attendee.csrf).send({}).expect(200);
  assert.equal((await Event.findById(event._id)).registeredCount, 0);
  assert.equal((await Registration.findById(registration._id)).status, 'cancelled');
  await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201);
  await Event.updateOne({ _id: event._id }, { $set: { registrationClosesAt: new Date(Date.now() - 1000) } });
  const another = await signedIn('Late attendee');
  await another.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', another.csrf).send({}).expect(409);
});

test('paid events reserve a seat and clearly mark that offline payment is required', async () => {
  const organizer = await signedIn('Paid-event organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer, { ticketPrice: 25, currency: 'USD' });
  const attendee = await signedIn('Would-be paid attendee');
  const response = await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201);
  assert.equal(response.body.registration.paymentStatus, 'offline-payment-required');
  assert.match(response.body.message, /no payment was collected/i);
  assert.match(response.body.message, /arrange payment/i);
  assert.equal((await Event.findById(event._id)).registeredCount, 1);
  const organizerView = await organizer.agent.get(`/api/events/${event._id}/registrations`).expect(200);
  assert.equal(organizerView.body.registrations[0].paymentStatus, 'offline-payment-required');
  const csv = await organizer.agent.get(`/api/events/${event._id}/registrations.csv`).expect(200);
  assert.match(csv.text, /offline-payment-required/);
  const privateEvent = (await attendee.agent.get(`/api/events/${event._id}`).expect(200)).body.event;
  assert.equal(privateEvent.organizer.email, organizer.user.email);
  const registeredEvent = await attendee.agent.get(`/api/events/${event._id}`).expect(200);
  assert.equal(registeredEvent.body.registration.paymentStatus, 'offline-payment-required');
  const publicEvent = (await supertest(server).get(`/api/events/${event._id}`).expect(200)).body.event;
  assert.equal(publicEvent.organizer.email, undefined);
  await attendee.agent.delete(`/api/events/registrations/${response.body.registration._id}`).set('X-CSRF-Token', attendee.csrf).send({}).expect(200);
  const renewed = await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201);
  assert.equal(renewed.body.registration.paymentStatus, 'offline-payment-required');
  assert.equal((await Event.findById(event._id)).registeredCount, 1);
});

test('attendees cannot read or cancel another user registration; meeting links are private', async () => {
  const organizer = await signedIn('Online organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer, {
    venue: { type: 'online', meetingUrl: 'https://meet.example.test/private-room' }
  });
  const attendee = await signedIn('Registered attendee');
  const registration = (await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201)).body.registration;
  const stranger = await signedIn('Unregistered attendee');
  const myRecords = await stranger.agent.get('/api/events/mine/registrations').expect(200);
  assert.equal(myRecords.body.registrations.length, 0);
  await stranger.agent.delete(`/api/events/registrations/${registration._id}`).set('X-CSRF-Token', stranger.csrf).send({}).expect(404);
  const publicEvent = (await supertest(server).get(`/api/events/${event._id}`).expect(200)).body.event;
  assert.equal(publicEvent.venue.meetingUrl, undefined);
  const registeredEvent = (await attendee.agent.get(`/api/events/${event._id}`).expect(200)).body.event;
  assert.equal(registeredEvent.venue.meetingUrl, 'https://meet.example.test/private-room');
  assert.equal((await organizer.agent.get(`/api/events/${event._id}/registrations`).expect(200)).body.registrations.length, 1);
  const otherOrganizer = await signedIn('Not the host', undefined, 'organizer');
  await otherOrganizer.agent.get(`/api/events/${event._id}/registrations`).expect(404);
});

test('only administrators can use admin endpoints and role updates are validated', async () => {
  await supertest(server).get('/api/admin/users').expect(401);
  const organizer = await signedIn('Ordinary organizer', undefined, 'organizer');
  await organizer.agent.get('/api/admin/users').expect(403);
  const admin = await signedIn('Actual admin', undefined, 'admin');
  const users = await admin.agent.get('/api/admin/users').expect(200);
  assert.ok(users.body.users.length >= 2);
  const response = await admin.agent.patch(`/api/admin/users/${organizer.user.id}`).set('X-CSRF-Token', admin.csrf).send({ role: 'superadmin' }).expect(400);
  assert.match(response.body.error, /valid role/i);
  await admin.agent.patch(`/api/admin/users/${admin.user.id}`).set('X-CSRF-Token', admin.csrf).send({ role: 'attendee' }).expect(409);
});

test('admin user list shows account creation and confirmed/cancelled event registration counts', async () => {
  const organizer = await signedIn('Admin count organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer);
  const attendee = await signedIn('Admin count attendee');
  const registration = (await attendee.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', attendee.csrf).send({}).expect(201)).body.registration;
  await attendee.agent.delete(`/api/events/registrations/${registration._id}`).set('X-CSRF-Token', attendee.csrf).send({}).expect(200);
  const admin = await signedIn('Admin count admin', undefined, 'admin');
  const response = await admin.agent.get('/api/admin/users?q=Admin%20count%20attendee').expect(200);
  assert.equal(response.body.pagination.total, 1);
  const listedUser = response.body.users[0];
  assert.equal(listedUser.name, attendee.user.name);
  assert.equal(listedUser.email, attendee.user.email);
  assert.equal(listedUser.registrationCount, 1);
  assert.equal(listedUser.confirmedRegistrationCount, 0);
  assert.ok(listedUser.createdAt);
  assert.equal(listedUser.registrations.length, 1);
  assert.equal(listedUser.registrations[0].event.title, event.title);
  assert.equal(listedUser.registrations[0].status, 'cancelled');
  const stats = await admin.agent.get('/api/admin/stats').expect(200);
  assert.equal(typeof stats.body.users, 'number');
  assert.equal(stats.body.stats, undefined);
});

test('admin moderation changes visibility and deactivated users lose access', async () => {
  const organizer = await signedIn('Moderated organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer);
  const admin = await signedIn('EventSync admin', undefined, 'admin');
  await admin.agent.patch(`/api/admin/events/${event._id}`).set('X-CSRF-Token', admin.csrf).send({ status: 'cancelled' }).expect(200);
  await supertest(server).get(`/api/events/${event._id}`).expect(404);
  await admin.agent.patch(`/api/admin/users/${organizer.user.id}`).set('X-CSRF-Token', admin.csrf).send({ isActive: false }).expect(200);
  await organizer.agent.get('/api/auth/me').expect(401);
});

test('organizers may mark their ended published events completed', async () => {
  const organizer = await signedIn('Completing organizer', undefined, 'organizer');
  const event = await createPublishedEvent(organizer);
  await Event.updateOne({ _id: event._id }, { $set: { endAt: new Date(Date.now() - 1000) } });
  const response = await organizer.agent.post(`/api/events/${event._id}/complete`).set('X-CSRF-Token', organizer.csrf).send({}).expect(200);
  assert.equal(response.body.event.status, 'completed');
  await organizer.agent.post(`/api/events/${event._id}/register`).set('X-CSRF-Token', organizer.csrf).send({}).expect(409);
});

test('unknown routes and malformed identifiers return safe client errors', async () => {
  await supertest(server).get('/api/events/not-an-id').expect(400);
  await supertest(server).get('/api/events?category=not-real').expect(400);
  await supertest(server).get('/api/events?from=not-a-date').expect(400);
  await supertest(server).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
  const response = await supertest(server).get('/api/unknown').expect(404);
  assert.equal(response.text.includes('stack'), false);
});

test('public pages are served with security headers', async () => {
  const page = await supertest(server).get('/').expect(200);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  await supertest(server).get('/dashboard.html').expect(200);
  await supertest(server).get('/admin.html').expect(200);
});
