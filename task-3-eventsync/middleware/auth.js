const { HttpError } = require('../utils/errors');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  if (!req.session.userId) return next(new HttpError(401, 'Please log in to continue.'));
  try {
    const user = await User.findById(req.session.userId).select('role isActive');
    if (!user || !user.isActive) return next(new HttpError(401, 'Please log in to continue.'));
    req.user = user;
    req.session.role = user.role;
  } catch (error) {
    return next(error);
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to perform this action.'));
    next();
  });
}

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token');
  if (!req.session.csrfToken || !token || token !== req.session.csrfToken) return next(new HttpError(403, 'Security token is missing or invalid. Refresh the page and try again.'));
  next();
}

module.exports = { requireAuth, requireCsrf, requireRole };
