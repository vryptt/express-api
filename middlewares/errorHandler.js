export function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    status: 404,
    message: `Route ${req.originalUrl} not found`
  });
}

export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === "development";
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Invalid input data";
  }

  if (err.name === "UnauthorizedError") {
    statusCode = 401;
    message = "Unauthorized";
  }

  if (err.code === 11000) {
    statusCode = 400;
    message = "Duplicate field value entered";
  }

  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid ID format";
  }

  if (err.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Invalid JSON payload";
  }

  const response = {
    success: false,
    status: statusCode,
    message
  };

  if (isDev) {
    response.stack = err.stack;
    response.error = err;
  }

  res.status(statusCode).json(response);
}

export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}