import { ZodError } from 'zod';

export const errorHandler = (err, req, res, next) => {
  console.error('[ResoX Error Handler]', err);

  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return res.status(400).json({
      success: false,
      error: issues[0]?.message || 'Validation failed',
      details: issues,
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'An unexpected internal server error occurred.';

  return res.status(statusCode).json({
    success: false,
    error: message,
  });
};
