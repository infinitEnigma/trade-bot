/** @format */

/**
 * Custom error classes for structured error handling
 * Provides consistent error categorization and user-friendly messages
 */

export enum ErrorCode {
  // Validation Errors (400)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  OUT_OF_RANGE = 'OUT_OF_RANGE',

  // Authentication/Authorization Errors (401/403)
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Resource Errors (404/409)
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',

  // Database Errors (500)
  DATABASE_ERROR = 'DATABASE_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',

  // External Service Errors (502/503)
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Business Logic Errors (400/422)
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_TRADE = 'INVALID_TRADE',
  POSITION_SIZE_EXCEEDED = 'POSITION_SIZE_EXCEEDED',

  // System Errors (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
}

export interface ErrorContext {
  field?: string;
  value?: any;
  limit?: number;
  expected?: any;
  received?: any;
  correlationId?: string;
  userId?: string;
  service?: string;
  operation?: string;
  required?: number;
  available?: number;
  requested?: number;
  maxAllowed?: number;
}

/**
 * Base application error class
 */
export class AppError extends Error {
  public code: ErrorCode;
  public statusCode: number;
  public readonly isOperational: boolean;
  public readonly context: ErrorContext;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    context: ErrorContext = {},
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to user-friendly response
   */
  toResponse(correlationId?: string) {
    return {
      success: false,
      error: this.getUserMessage(),
      code: this.code,
      correlationId: correlationId || this.context.correlationId,
      ...(this.getAdditionalData()),
    };
  }

  /**
   * Get user-friendly error message
   */
  protected getUserMessage(): string {
    // Override in subclasses for specific messages
    return this.message;
  }

  /**
   * Get additional response data
   */
  protected getAdditionalData(): Record<string, any> {
    return {};
  }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, context);
  }

  protected getUserMessage(): string {
    return `Validation failed: ${this.message}`;
  }
}

export class MissingRequiredFieldError extends ValidationError {
  constructor(field: string, context: ErrorContext = {}) {
    super(`Field '${field}' is required`, { ...context, field });
    this.name = 'MissingRequiredFieldError';
  }
}

export class InvalidFormatError extends ValidationError {
  constructor(field: string, expected: string, received?: any, context: ErrorContext = {}) {
    super(`Field '${field}' has invalid format. Expected: ${expected}`, {
      ...context,
      field,
      expected,
      received
    });
    this.name = 'InvalidFormatError';
  }
}

/**
 * Authentication/Authorization errors (401/403)
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context: ErrorContext = {}) {
    super(message, ErrorCode.UNAUTHENTICATED, 401, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', context: ErrorContext = {}) {
    super(message, ErrorCode.INSUFFICIENT_PERMISSIONS, 403, context);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(context: ErrorContext = {}) {
    super('Invalid credentials provided', ErrorCode.INVALID_CREDENTIALS, 401, context);
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Resource errors (404/409)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, context: ErrorContext = {}) {
    super(`${resource} not found`, ErrorCode.NOT_FOUND, 404, context);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, ErrorCode.CONFLICT, 409, context);
  }
}

/**
 * Database errors (500)
 */
export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed', context: ErrorContext = {}) {
    super(message, ErrorCode.DATABASE_ERROR, 500, context);
  }

  protected getUserMessage(): string {
    return 'A temporary database issue occurred. Please try again.';
  }
}

export class ConnectionError extends DatabaseError {
  constructor(context: ErrorContext = {}) {
    super('Database connection failed', context);
    this.name = 'ConnectionError';
    this.code = ErrorCode.CONNECTION_ERROR;
  }

  protected getUserMessage(): string {
    return 'Database temporarily unavailable. Please try again in a moment.';
  }
}

/**
 * External service errors (502/503)
 */
export class ExternalServiceError extends AppError {
  constructor(service: string, context: ErrorContext = {}) {
    super(`${service} service unavailable`, ErrorCode.EXTERNAL_SERVICE_ERROR, 502, {
      ...context,
      service
    });
  }

  protected getUserMessage(): string {
    return `External service temporarily unavailable. Please try again later.`;
  }
}

export class ServiceUnavailableError extends ExternalServiceError {
  constructor(service: string, context: ErrorContext = {}) {
    super(service, context);
    this.name = 'ServiceUnavailableError';
    this.statusCode = 503;
    this.code = ErrorCode.SERVICE_UNAVAILABLE;
  }
}

/**
 * Business logic errors (400/422)
 */
export class InsufficientBalanceError extends ValidationError {
  constructor(required: number, available: number, context: ErrorContext = {}) {
    super(`Insufficient balance. Required: ${required}, Available: ${available}`, {
      ...context,
      required,
      available
    });
    this.name = 'InsufficientBalanceError';
    this.code = ErrorCode.INSUFFICIENT_BALANCE;
  }

  protected getAdditionalData() {
    return {
      required: this.context.required,
      available: this.context.available,
    };
  }
}

export class PositionSizeExceededError extends ValidationError {
  constructor(requested: number, maxAllowed: number, context: ErrorContext = {}) {
    super(`Position size ${requested} exceeds maximum allowed ${maxAllowed}`, {
      ...context,
      requested,
      maxAllowed
    });
    this.name = 'PositionSizeExceededError';
    this.code = ErrorCode.POSITION_SIZE_EXCEEDED;
  }

  protected getAdditionalData() {
    return {
      requested: this.context.requested,
      maxAllowed: this.context.maxAllowed,
    };
  }
}

/**
 * System errors (500)
 */
export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', context: ErrorContext = {}) {
    super(message, ErrorCode.INTERNAL_ERROR, 500, context);
  }

  protected getUserMessage(): string {
    return 'An unexpected error occurred. Please try again or contact support if the issue persists.';
  }
}

export class ConfigurationError extends InternalError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, context);
    this.name = 'ConfigurationError';
    this.code = ErrorCode.CONFIGURATION_ERROR;
  }
}

/**
 * Utility functions
 */
export function isOperationalError(error: Error): error is AppError {
  return error instanceof AppError && error.isOperational;
}

export function getErrorStatusCode(error: Error): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  return 500;
}

export function createErrorResponse(error: Error, correlationId?: string) {
  if (error instanceof AppError) {
    return error.toResponse(correlationId);
  }

  // Fallback for unknown errors
  return {
    success: false,
    error: 'An unexpected error occurred',
    code: ErrorCode.INTERNAL_ERROR,
    correlationId,
  };
}
