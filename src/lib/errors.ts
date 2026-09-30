export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'BAD_GATEWAY'
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static validation(details: unknown, message = 'Validation failed') {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(entity = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${entity} not found`);
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static unprocessable(message: string, details?: unknown) {
    return new AppError(422, 'UNPROCESSABLE', message, details);
  }
  static badGateway(message: string) {
    return new AppError(502, 'BAD_GATEWAY', message);
  }
}
