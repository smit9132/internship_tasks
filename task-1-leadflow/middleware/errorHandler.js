function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let status = error.status || 500;
  let message = error.message;
  let details;

  if (error.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body contains invalid JSON.';
  } else if (error.name === 'ValidationError') {
    status = 400;
    message = 'Lead validation failed.';
    details = Object.values(error.errors).map(({ path, message: fieldMessage }) => ({
      field: path,
      message: fieldMessage,
    }));
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'A lead field has an invalid value.';
  } else if (error.code === 11000) {
    status = 409;
    message = 'A lead with this email address already exists.';
  } else if (status >= 500) {
    status = 500;
    message = 'An unexpected server error occurred.';
    console.error(`Request failed (${error.name || 'Error'}).`);
  }

  const response = {
    success: false,
    error: {
      message: message || 'Request failed.',
    },
  };
  if (details) {
    response.error.details = details;
  }

  res.status(status).json(response);
}

module.exports = errorHandler;
