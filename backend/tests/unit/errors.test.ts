/** @format */

import {
    ErrorCodes,
    AppError,
    ValidationError,
    MissingRequiredFieldError,
    InvalidFormatError,
    AuthenticationError,
    AuthorizationError,
    InvalidCredentialsError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    ConnectionError,
    ExternalServiceError,
    ServiceUnavailableError,
    InsufficientBalanceError,
    PositionSizeExceededError,
    InternalError,
    ConfigurationError,
    isOperationalError,
    getErrorStatusCode,
    createErrorResponse,
    DataFreshnessUtils
} from '@trade-bot/shared';

describe('Error System', () => {
    describe('ErrorCodes Enum', () => {
        it('should define all standard error codes', () => {
            // Validation Errors
            expect(ErrorCodes.VALIDATION_ERROR).toBeDefined();
            expect(ErrorCodes.MISSING_REQUIRED_FIELD).toBeDefined();
            expect(ErrorCodes.INVALID_FORMAT).toBeDefined();
            expect(ErrorCodes.OUT_OF_RANGE).toBeDefined();

            // Authentication/Authorization Errors
            expect(ErrorCodes.UNAUTHENTICATED).toBeDefined();
            expect(ErrorCodes.INSUFFICIENT_PERMISSIONS).toBeDefined();
            expect(ErrorCodes.INVALID_CREDENTIALS).toBeDefined();
            expect(ErrorCodes.TOKEN_EXPIRED).toBeDefined();

            // Resource Errors
            expect(ErrorCodes.NOT_FOUND).toBeDefined();
            expect(ErrorCodes.ALREADY_EXISTS).toBeDefined();
            expect(ErrorCodes.CONFLICT).toBeDefined();

            // Database Errors
            expect(ErrorCodes.DATABASE_ERROR).toBeDefined();
            expect(ErrorCodes.CONNECTION_ERROR).toBeDefined();
            expect(ErrorCodes.QUERY_ERROR).toBeDefined();

            // External Service Errors
            expect(ErrorCodes.EXTERNAL_SERVICE_ERROR).toBeDefined();
            expect(ErrorCodes.API_RATE_LIMITED).toBeDefined();
            expect(ErrorCodes.SERVICE_UNAVAILABLE).toBeDefined();

            // Business Logic Errors
            expect(ErrorCodes.INSUFFICIENT_BALANCE).toBeDefined();
            expect(ErrorCodes.INVALID_TRADE).toBeDefined();
            expect(ErrorCodes.POSITION_SIZE_EXCEEDED).toBeDefined();

            // System Errors
            expect(ErrorCodes.INTERNAL_ERROR).toBeDefined();
            expect(ErrorCodes.CONFIGURATION_ERROR).toBeDefined();
            expect(ErrorCodes.ENCRYPTION_ERROR).toBeDefined();
        });
    });

    describe('AppError Base Class', () => {
        it('should create an instance with basic properties', () => {
            const message = 'Test error message';
            const code = ErrorCodes.INTERNAL_ERROR;
            const statusCode = 500;
            const context = { correlationId: 'test-correlation-id' };

            const error = new AppError(message, code, statusCode, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(code);
            expect(error.statusCode).toBe(statusCode);
            expect(error.isOperational).toBe(true);
            expect(error.context).toEqual(context);
            expect(error.name).toBe('AppError');
        });

        it('should create an instance with default values', () => {
            const message = 'Test error message';
            const code = ErrorCodes.INTERNAL_ERROR;

            const error = new AppError(message, code);

            expect(error.statusCode).toBe(500);
            expect(error.context).toEqual({});
            expect(error.isOperational).toBe(true);
        });

        it('should convert to response with correlation id', () => {
            const message = 'Test error message';
            const code = ErrorCodes.INTERNAL_ERROR;
            const context = { correlationId: 'original-correlation-id' };

            const error = new AppError(message, code, 500, context);
            const correlationId = 'test-correlation-id';
            const response = error.toResponse(correlationId);

            expect(response.success).toBe(false);
            expect(response.error).toBe(message);
            expect(response.code).toBe(code);
            expect(response.correlationId).toBe(correlationId);
            expect(response.timestamp).toBeDefined();
        });

        it('should maintain stack trace', () => {
            const error = new AppError('Test error', ErrorCodes.INTERNAL_ERROR);
            expect(error.stack).toBeDefined();
        });
    });

    describe('Validation Errors', () => {
        it('should create ValidationError instance', () => {
            const message = 'Test validation error';
            const context = { field: 'test-field' };

            const error = new ValidationError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
            expect(error.statusCode).toBe(400);
            expect(error.context).toEqual(context);
        });

        it('should create MissingRequiredFieldError instance', () => {
            const field = 'username';
            const context = { correlationId: 'test-correlation-id' };

            const error = new MissingRequiredFieldError(field, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).toBeInstanceOf(MissingRequiredFieldError);
            expect(error.message).toContain(field);
            expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
            expect(error.statusCode).toBe(400);
            expect(error.context.field).toBe(field);
            expect(error.name).toBe('MissingRequiredFieldError');
        });

        it('should create InvalidFormatError instance', () => {
            const field = 'email';
            const expected = 'email format';
            const received = 'invalid-email';
            const context = { correlationId: 'test-correlation-id' };

            const error = new InvalidFormatError(field, expected, received, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).toBeInstanceOf(InvalidFormatError);
            expect(error.message).toContain(field);
            expect(error.message).toContain(expected);
            expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
            expect(error.statusCode).toBe(400);
            expect(error.context.field).toBe(field);
            expect(error.context.expected).toBe(expected);
            expect(error.context.received).toBe(received);
            expect(error.name).toBe('InvalidFormatError');
        });
    });

    describe('Authentication/Authorization Errors', () => {
        it('should create AuthenticationError instance', () => {
            const message = 'Custom authentication error';
            const context = { userId: '123' };

            const error = new AuthenticationError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(AuthenticationError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.UNAUTHENTICATED);
            expect(error.statusCode).toBe(401);
            expect(error.context).toEqual(context);
        });

        it('should create AuthenticationError with default message', () => {
            const error = new AuthenticationError();

            expect(error.message).toBe('Authentication required');
        });

        it('should create AuthorizationError instance', () => {
            const message = 'Custom authorization error';
            const context = { userId: '123', userLevel: 'basic' };

            const error = new AuthorizationError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(AuthorizationError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.INSUFFICIENT_PERMISSIONS);
            expect(error.statusCode).toBe(403);
            expect(error.context).toEqual(context);
        });

        it('should create AuthorizationError with default message', () => {
            const error = new AuthorizationError();

            expect(error.message).toBe('Insufficient permissions');
        });

        it('should create InvalidCredentialsError instance', () => {
            const context = { correlationId: 'test-correlation-id' };

            const error = new InvalidCredentialsError(context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(InvalidCredentialsError);
            expect(error.message).toBe('Invalid credentials provided');
            expect(error.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
            expect(error.statusCode).toBe(401);
            expect(error.context).toEqual(context);
            expect(error.name).toBe('InvalidCredentialsError');
        });
    });

    describe('Resource Errors', () => {
        it('should create NotFoundError instance', () => {
            const resource = 'User';
            const context = { correlationId: 'test-correlation-id' };

            const error = new NotFoundError(resource, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(NotFoundError);
            expect(error.message).toContain(resource);
            expect(error.code).toBe(ErrorCodes.NOT_FOUND);
            expect(error.statusCode).toBe(404);
            expect(error.context).toEqual(context);
        });

        it('should create ConflictError instance', () => {
            const message = 'Resource already exists';
            const context = { correlationId: 'test-correlation-id' };

            const error = new ConflictError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ConflictError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.CONFLICT);
            expect(error.statusCode).toBe(409);
            expect(error.context).toEqual(context);
        });
    });

    describe('Database Errors', () => {
        it('should create DatabaseError instance', () => {
            const message = 'Custom database error';
            const context = { operation: 'SELECT', service: 'postgres' };

            const error = new DatabaseError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(DatabaseError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.DATABASE_ERROR);
            expect(error.statusCode).toBe(500);
            expect(error.context).toEqual(context);
        });

        it('should create DatabaseError with default message', () => {
            const error = new DatabaseError();

            expect(error.message).toBe('Database operation failed');
        });

        it('should create ConnectionError instance', () => {
            const context = { correlationId: 'test-correlation-id' };

            const error = new ConnectionError(context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(DatabaseError);
            expect(error).toBeInstanceOf(ConnectionError);
            expect(error.message).toBe('Database connection failed');
            expect(error.code).toBe(ErrorCodes.CONNECTION_ERROR);
            expect(error.statusCode).toBe(500);
            expect(error.context).toEqual(context);
            expect(error.name).toBe('ConnectionError');
        });
    });

    describe('External Service Errors', () => {
        it('should create ExternalServiceError instance', () => {
            const service = 'Kraken';
            const context = { correlationId: 'test-correlation-id' };

            const error = new ExternalServiceError(service, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ExternalServiceError);
            expect(error.message).toContain(service);
            expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
            expect(error.statusCode).toBe(502);
            expect(error.context.service).toBe(service);
        });

        it('should create ServiceUnavailableError instance', () => {
            const service = 'Kraken';
            const context = { correlationId: 'test-correlation-id' };

            const error = new ServiceUnavailableError(service, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ExternalServiceError);
            expect(error).toBeInstanceOf(ServiceUnavailableError);
            expect(error.message).toContain(service);
            expect(error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
            expect(error.statusCode).toBe(503);
            expect(error.context.service).toBe(service);
            expect(error.name).toBe('ServiceUnavailableError');
        });
    });

    describe('Business Logic Errors', () => {
        it('should create InsufficientBalanceError instance', () => {
            const required = 100;
            const available = 50;
            const context = { correlationId: 'test-correlation-id' };

            const error = new InsufficientBalanceError(required, available, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).toBeInstanceOf(InsufficientBalanceError);
            expect(error.message).toContain(String(required));
            expect(error.message).toContain(String(available));
            expect(error.code).toBe(ErrorCodes.INSUFFICIENT_BALANCE);
            expect(error.statusCode).toBe(400);
            expect(error.context.required).toBe(required);
            expect(error.context.available).toBe(available);
            expect(error.name).toBe('InsufficientBalanceError');
        });

        it('should include additional data in InsufficientBalanceError response', () => {
            const required = 100;
            const available = 50;

            const error = new InsufficientBalanceError(required, available);
            const response = error.toResponse();

            expect(response.required).toBe(required);
            expect(response.available).toBe(available);
        });

        it('should create PositionSizeExceededError instance', () => {
            const requested = 150;
            const maxAllowed = 100;
            const context = { correlationId: 'test-correlation-id' };

            const error = new PositionSizeExceededError(requested, maxAllowed, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).toBeInstanceOf(PositionSizeExceededError);
            expect(error.message).toContain(String(requested));
            expect(error.message).toContain(String(maxAllowed));
            expect(error.code).toBe(ErrorCodes.POSITION_SIZE_EXCEEDED);
            expect(error.statusCode).toBe(400);
            expect(error.context.requested).toBe(requested);
            expect(error.context.maxAllowed).toBe(maxAllowed);
            expect(error.name).toBe('PositionSizeExceededError');
        });

        it('should include additional data in PositionSizeExceededError response', () => {
            const requested = 150;
            const maxAllowed = 100;

            const error = new PositionSizeExceededError(requested, maxAllowed);
            const response = error.toResponse();

            expect(response.requested).toBe(requested);
            expect(response.maxAllowed).toBe(maxAllowed);
        });
    });

    describe('System Errors', () => {
        it('should create InternalError instance', () => {
            const message = 'Custom internal error';
            const context = { operation: 'test-operation' };

            const error = new InternalError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(InternalError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
            expect(error.statusCode).toBe(500);
            expect(error.context).toEqual(context);
        });

        it('should create InternalError with default message', () => {
            const error = new InternalError();

            expect(error.message).toBe('Internal server error');
        });

        it('should create ConfigurationError instance', () => {
            const message = 'Invalid configuration';
            const context = { configurationKey: 'apiKey' };

            const error = new ConfigurationError(message, context);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error).toBeInstanceOf(InternalError);
            expect(error).toBeInstanceOf(ConfigurationError);
            expect(error.message).toBe(message);
            expect(error.code).toBe(ErrorCodes.CONFIGURATION_ERROR);
            expect(error.statusCode).toBe(500);
            expect(error.context).toEqual(context);
            expect(error.name).toBe('ConfigurationError');
        });
    });

    describe('Error Utility Functions', () => {
        it('should identify operational errors', () => {
            const appError = new AppError('Operational error', ErrorCodes.INTERNAL_ERROR);
            const genericError = new Error('Generic error');

            expect(isOperationalError(appError)).toBe(true);
            expect(isOperationalError(genericError)).toBe(false);
        });

        it('should get correct status code from errors', () => {
            const appError = new AppError('Error', ErrorCodes.VALIDATION_ERROR, 400);
            const genericError = new Error('Generic error');

            expect(getErrorStatusCode(appError)).toBe(400);
            expect(getErrorStatusCode(genericError)).toBe(500);
        });

        it('should create error response from AppError', () => {
            const message = 'Test error';
            const code = ErrorCodes.VALIDATION_ERROR;
            const statusCode = 400;
            const context = { correlationId: 'test-correlation-id' };
            const correlationId = 'new-correlation-id';

            const error = new AppError(message, code, statusCode, context);
            const response = createErrorResponse(error, correlationId);

            expect(response.success).toBe(false);
            expect(response.error).toBe(message);
            expect(response.code).toBe(code);
            expect(response.correlationId).toBe(correlationId);
            expect(response.timestamp).toBeDefined();
        });

        it('should create error response from generic Error', () => {
            const message = 'Generic error';
            const correlationId = 'test-correlation-id';

            const error = new Error(message);
            const response = createErrorResponse(error, correlationId);

            expect(response.success).toBe(false);
            expect(response.error).toBe('An unexpected error occurred');
            expect(response.code).toBe(ErrorCodes.INTERNAL_ERROR);
            expect(response.correlationId).toBe(correlationId);
            expect(response.timestamp).toBeDefined();
        });
    });

    describe('Data Freshness Utils', () => {
        it('should create realtime metadata', () => {
            const lastUpdated = Date.now() - 1000;
            const metadata = DataFreshnessUtils.createRealtimeMetadata(lastUpdated);

            expect(metadata.lastUpdated).toBe(lastUpdated);
            expect(metadata.updateFrequency).toBe(5000);
            expect(metadata.recommendedPollInterval).toBe(10000);
            expect(metadata.nextExpectedUpdate).toBe(lastUpdated + 5000);
            expect(metadata.isStale).toBe(false);
            expect(metadata.stalenessThreshold).toBe(30000);
            expect(metadata.dataSource).toBe('websocket');
        });

        it('should create API metadata', () => {
            const updateFrequency = 10000;
            const lastUpdated = Date.now() - 1000;
            const metadata = DataFreshnessUtils.createApiMetadata(updateFrequency, lastUpdated);

            expect(metadata.lastUpdated).toBe(lastUpdated);
            expect(metadata.updateFrequency).toBe(updateFrequency);
            expect(metadata.recommendedPollInterval).toBe(Math.max(updateFrequency * 2, 30000));
            expect(metadata.nextExpectedUpdate).toBe(lastUpdated + updateFrequency);
            expect(metadata.isStale).toBe(false);
            expect(metadata.stalenessThreshold).toBe(updateFrequency * 3);
            expect(metadata.dataSource).toBe('api');
        });

        it('should create cache metadata', () => {
            const cacheTTL = 60; // 1 minute
            const lastUpdated = Date.now() - 1000;
            const metadata = DataFreshnessUtils.createCacheMetadata(cacheTTL, lastUpdated);

            expect(metadata.lastUpdated).toBe(lastUpdated);
            expect(metadata.updateFrequency).toBe(cacheTTL * 1000);
            expect(metadata.recommendedPollInterval).toBe(Math.max(cacheTTL * 1000, 30000));
            expect(metadata.nextExpectedUpdate).toBe(lastUpdated + (cacheTTL * 1000));
            expect(metadata.isStale).toBe(false);
            expect(metadata.stalenessThreshold).toBe(cacheTTL * 1000);
            expect(metadata.dataSource).toBe('cache');
            expect(metadata.cacheTTLRemaining).toBeGreaterThan(0);
            expect(metadata.cacheTTLRemaining).toBeLessThan(cacheTTL);
        });

        it('should create static metadata', () => {
            const lastUpdated = Date.now() - 1000;
            const metadata = DataFreshnessUtils.createStaticMetadata(lastUpdated);

            expect(metadata.lastUpdated).toBe(lastUpdated);
            expect(metadata.updateFrequency).toBe(1800000);
            expect(metadata.recommendedPollInterval).toBe(1800000);
            expect(metadata.nextExpectedUpdate).toBe(lastUpdated + 1800000);
            expect(metadata.isStale).toBe(false);
            expect(metadata.stalenessThreshold).toBe(3600000);
            expect(metadata.dataSource).toBe('static');
        });
    });
});