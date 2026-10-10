const CATEGORIES = ['Technology', 'Business', 'Arts', 'Music', 'Food', 'Wellness', 'Education', 'Community', 'Other'];
const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

function validateRegistration(data = {}) {
  const errors = [];
  if (typeof data.name !== 'string' || data.name.trim().length < 2 || data.name.trim().length > 80) errors.push('Name must be between 2 and 80 characters.');
  if (typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254) errors.push('Enter a valid email address.');
  if (typeof data.password !== 'string' || data.password.length < 10 || data.password.length > 128) errors.push('Password must be between 10 and 128 characters.');
  return errors;
}

function validateEvent(data = {}) {
  const errors = [];
  if (typeof data.title !== 'string' || data.title.trim().length < 4 || data.title.trim().length > 120) errors.push('Title must be between 4 and 120 characters.');
  if (typeof data.description !== 'string' || data.description.trim().length < 20 || data.description.trim().length > 10000) errors.push('Description must be between 20 and 10,000 characters.');
  if (!CATEGORIES.includes(data.category)) errors.push('Choose a valid event category.');
  if (!data.venue || !['online', 'in-person'].includes(data.venue.type)) errors.push('Choose an online or in-person venue.');
  if (data.venue?.type === 'online' && !isHttpUrl(data.venue.meetingUrl)) errors.push('Online events need a valid meeting URL.');
  if (data.venue?.type === 'in-person' && (!stringLength(data.venue.name, 2, 120) || !stringLength(data.venue.address, 3, 300))) errors.push('In-person events need a venue name and address.');
  if (data.coverImage && !isHttpUrl(data.coverImage)) errors.push('Cover image must be a valid HTTP or HTTPS URL.');
  const start = validDate(data.startAt);
  const end = validDate(data.endAt);
  const opens = validDate(data.registrationOpensAt);
  const closes = validDate(data.registrationClosesAt);
  if (!start || !end || end <= start) errors.push('Event end must be after its start.');
  if (!opens || !closes || closes <= opens) errors.push('Registration closing time must be after its opening time.');
  if (start && closes && closes > start) errors.push('Registration must close no later than the event start.');
  if (start && opens && opens >= start) errors.push('Registration must open before the event starts.');
  if (!Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 100000) errors.push('Capacity must be a whole number between 1 and 100,000.');
  if (data.ticketPrice !== undefined && (!Number.isFinite(data.ticketPrice) || data.ticketPrice < 0 || data.ticketPrice > 1000000)) errors.push('Ticket price must be between 0 and 1,000,000.');
  if (data.currency !== undefined && !/^[A-Za-z]{3}$/.test(data.currency)) errors.push('Currency must be a three-letter code.');
  if (typeof data.timezone !== 'string' || data.timezone !== 'UTC' && !TIMEZONES.has(data.timezone)) errors.push('Choose a valid timezone.');
  return errors;
}

function validateProfile(data = {}) {
  const errors = [];
  if (typeof data.name !== 'string' || data.name.trim().length < 2 || data.name.trim().length > 80) errors.push('Name must be between 2 and 80 characters.');
  if (data.email !== undefined && (typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254)) errors.push('Enter a valid email address.');
  return errors;
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function validDate(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function stringLength(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

module.exports = { CATEGORIES, validateEvent, validateProfile, validateRegistration };
