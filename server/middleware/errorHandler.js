/**
 * Global error handling middleware
 */

function errorHandler(err, req, res, next) {
  console.error("Error occurred:", {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Default error response
  let statusCode = 500;
  let message = "Internal server error";

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = err.message;
  } else if (err.name === "NotFoundError") {
    statusCode = 404;
    message = err.message;
  } else if (err.code === "ENOENT") {
    statusCode = 404;
    message = "File or directory not found";
  } else if (err.code === "EACCES") {
    statusCode = 403;
    message = "Permission denied";
  } else if (err.response && err.response.status) {
    // Axios error
    statusCode = err.response.status;
    message = err.response.data?.message || err.message;
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === "production" && statusCode === 500) {
    message = "Internal server error";
  }

  res.status(statusCode).json({
    error: message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
