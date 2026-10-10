class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details?.details || details;
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (error.name === 'ValidationError') return res.status(400).json({ error: 'Invalid request data.', details: Object.values(error.errors).map((item) => item.message) });
  if (error.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier.' });
  if (error.code === 11000) return res.status(409).json({ error: 'This record already exists.' });
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
  console.error('Unhandled request error:', error.message);
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
}

module.exports = { HttpError, asyncHandler, errorHandler };
