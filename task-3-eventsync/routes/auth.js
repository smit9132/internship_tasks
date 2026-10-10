const express = require('express');
const crypto = require('node:crypto');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../utils/errors');
const { validateProfile, validateRegistration } = require('../utils/validation');

const router = express.Router();

router.get('/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
});

router.post('/register', asyncHandler(async (req, res) => {
  const errors = validateRegistration(req.body);
  if (errors.length) throw new HttpError(400, 'Please correct the highlighted information.');
  const user = await User.create({
    name: req.body.name.trim(), email: req.body.email.trim().toLowerCase(), password: req.body.password
  });
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  res.status(201).json({ user: user.toJSON() });
}));

router.post('/login', asyncHandler(async (req, res) => {
  if (typeof req.body.email !== 'string' || typeof req.body.password !== 'string' || req.body.email.length > 254 || req.body.password.length > 128) throw new HttpError(400, 'Enter a valid email and password.');
  const user = await User.findOne({ email: req.body.email.trim().toLowerCase() }).select('+password');
  if (!user || !user.isActive || !(await user.comparePassword(req.body.password))) throw new HttpError(401, 'Email or password is incorrect.');
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  res.json({ user: user.toJSON() });
}));

router.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('eventsync.sid');
    res.json({ message: 'You have been logged out.' });
  });
});

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) throw new HttpError(401, 'Please log in to continue.');
  res.json({ user });
}));

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const errors = validateProfile(req.body);
  if (errors.length) throw new HttpError(400, 'Please correct the highlighted information.');
  const updates = { name: req.body.name.trim() };
  if (req.body.email !== undefined) updates.email = req.body.email.trim().toLowerCase();
  const user = await User.findByIdAndUpdate(req.session.userId, updates, { new: true, runValidators: true });
  if (!user) throw new HttpError(404, 'User not found.');
  res.json({ user });
}));

module.exports = router;
