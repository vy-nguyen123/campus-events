import { AppError } from '../errors/AppError.mjs';

export function validate(source, schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message
      }));
      return next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
    }
    req.validated ??= {};
    req.validated[source] = result.data;
    next();
  };
}
