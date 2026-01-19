/** @format */

import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { createErrorResponse, ValidationError } from "../../shared/types/errors";
import { getCorrelationId } from "../../shared/utils/context";
import logger from "../../services/logger";

export interface ValidationOptions {
    // Where to validate data from
    source?: 'body' | 'query' | 'params';
    // Whether to strip unknown fields
    stripUnknown?: boolean;
    // Custom error message prefix
    errorPrefix?: string;
}

/**
 * Creates validation middleware for request data using Joi schemas
 * @param schema - Joi validation schema
 * @param options - Validation options
 * @returns Express middleware function
 */
export function validateRequest(schema: Joi.ObjectSchema, options: ValidationOptions = {}) {
    const {
        source = 'body',
        stripUnknown = false,
        errorPrefix = 'Validation failed'
    } = options;

    return (req: Request, res: Response, next: NextFunction) => {
        try {
            // Get data from specified source
            let dataToValidate: any;
            switch (source) {
                case 'body':
                    dataToValidate = req.body;
                    break;
                case 'query':
                    dataToValidate = req.query;
                    break;
                case 'params':
                    dataToValidate = req.params;
                    break;
                default:
                    dataToValidate = req.body;
            }

            // Validate the data
            const validationOptions: Joi.ValidationOptions = {
                abortEarly: false, // Collect all errors
                stripUnknown, // Remove unknown fields if specified
                allowUnknown: !stripUnknown, // Allow unknown fields if not stripping
            };

            const { error, value } = schema.validate(dataToValidate, validationOptions);

            if (error) {
                // Log validation error
                logger.warn(`${errorPrefix}: ${error.details[0].message}`, {
                    source,
                    errors: error.details.map(detail => ({
                        field: detail.path.join('.'),
                        message: detail.message,
                        value: detail.context?.value,
                    })),
                    correlationId: getCorrelationId(),
                });

                // Create structured validation error
                const validationError = new ValidationError(`${errorPrefix}: ${error.details[0].message}`);

                // Add detailed validation errors to response
                const errorResponse = createErrorResponse(validationError, getCorrelationId()) as any;
                errorResponse.details = {
                    source,
                    errors: error.details.map(detail => ({
                        field: detail.path.join('.'),
                        message: detail.message,
                        value: detail.context?.value,
                    })),
                };

                return res.status(validationError.statusCode).json(errorResponse);
            }

            // Replace request data with validated/cleaned data
            switch (source) {
                case 'body':
                    req.body = value;
                    break;
                case 'query':
                    req.query = value;
                    break;
                case 'params':
                    req.params = value;
                    break;
            }

            next();
        } catch (err) {
            logger.error('Validation middleware error', {
                error: (err as Error).message,
                source,
                correlationId: getCorrelationId(),
            });

            const internalError = new ValidationError('Request validation failed');
            res.status(internalError.statusCode).json(
                createErrorResponse(internalError, getCorrelationId())
            );
        }
    };
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
    // Email validation
    email: Joi.string()
        .email({ tlds: { allow: false } })
        .lowercase()
        .trim()
        .required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required',
        }),

    // Password validation
    password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .required()
        .messages({
            'string.min': 'Password must be at least 8 characters long',
            'string.max': 'Password cannot exceed 128 characters',
            'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, and one number',
            'any.required': 'Password is required',
        }),

    // UUID validation
    uuid: Joi.string()
        .uuid({ version: 'uuidv4' })
        .required()
        .messages({
            'string.uuid': 'Invalid UUID format',
            'any.required': 'UUID is required',
        }),

    // Positive integer
    positiveInteger: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'number.base': 'Must be a number',
            'number.integer': 'Must be an integer',
            'number.positive': 'Must be a positive number',
            'any.required': 'This field is required',
        }),

    // Optional positive integer
    optionalPositiveInteger: Joi.number()
        .integer()
        .positive()
        .optional()
        .messages({
            'number.base': 'Must be a number',
            'number.integer': 'Must be an integer',
            'number.positive': 'Must be a positive number',
        }),

    // String with length limits
    string: (min = 1, max = 255) => Joi.string()
        .min(min)
        .max(max)
        .trim()
        .messages({
            'string.min': `Must be at least ${min} characters long`,
            'string.max': `Cannot exceed ${max} characters`,
            'string.base': 'Must be a string',
        }),

    // Boolean
    boolean: Joi.boolean()
        .messages({
            'boolean.base': 'Must be a boolean value',
        }),

    // Date string
    dateString: Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .messages({
            'string.pattern.base': 'Date must be in YYYY-MM-DD format',
        }),

    // URL
    url: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .messages({
            'string.uri': 'Must be a valid HTTP or HTTPS URL',
            'string.uriCustomScheme': 'Must be a valid HTTP or HTTPS URL',
        }),
};

/**
 * Pre-built validation middleware for common use cases
 */
export const validators = {
    // Auth validators
    register: validateRequest(
        Joi.object({
            email: commonSchemas.email,
            password: commonSchemas.password,
        }),
        { errorPrefix: 'Registration validation failed' }
    ),

    login: validateRequest(
        Joi.object({
            email: commonSchemas.email,
            password: Joi.string().required().messages({
                'any.required': 'Password is required',
            }),
        }),
        { errorPrefix: 'Login validation failed' }
    ),

    refreshToken: validateRequest(
        Joi.object({
            refreshToken: Joi.string().required().messages({
                'any.required': 'Refresh token is required',
            }),
        }),
        { errorPrefix: 'Token refresh validation failed' }
    ),

    // Bot validators
    startBot: validateRequest(
        Joi.object({
            strategyId: commonSchemas.uuid.messages({
                'any.required': 'Strategy ID is required',
            }),
            notionalAmount: Joi.number().positive().precision(8).required().messages({
                'number.base': 'Notional amount must be a number',
                'number.positive': 'Notional amount must be positive',
                'any.required': 'Notional amount is required',
            }),
        }),
        { errorPrefix: 'Bot start validation failed' }
    ),

    stopBot: validateRequest(
        Joi.object({
            botId: commonSchemas.uuid.messages({
                'any.required': 'Bot ID is required',
            }),
        }),
        { errorPrefix: 'Bot stop validation failed' }
    ),

    // Generic ID parameter validator
    idParam: validateRequest(
        Joi.object({
            id: commonSchemas.uuid,
        }),
        { source: 'params', errorPrefix: 'ID parameter validation failed' }
    ),

    // Query parameter validators
    pagination: validateRequest(
        Joi.object({
            page: Joi.number().integer().min(1).default(1).messages({
                'number.min': 'Page must be at least 1',
            }),
            limit: Joi.number().integer().min(1).max(100).default(20).messages({
                'number.min': 'Limit must be at least 1',
                'number.max': 'Limit cannot exceed 100',
            }),
            sortBy: Joi.string().optional(),
            sortOrder: Joi.string().valid('asc', 'desc').default('desc').messages({
                'any.only': 'Sort order must be "asc" or "desc"',
            }),
        }),
        { source: 'query', errorPrefix: 'Pagination validation failed' }
    ),
};
