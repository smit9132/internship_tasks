function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: 'Resource not found',
  });
}

function errorHandler(err, req, res, next) {
  console.error(err);
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  return res.status(statusCode).json({
    success: false,
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };
