/** @format */

import { csrfMiddleware, csrfTokenMiddleware, getCsrfToken, CSRFRequest } from '../../src/interfaces/middleware/csrf';
import { Request, Response, NextFunction } from 'express';
import Tokens from 'csrf';

// Mock the logger
jest.mock('../../src/core/logging');

describe('CSRF Middleware', () => {
    let req: Partial<CSRFRequest>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        // Create a fresh req object with all properties as plain objects
        req = {
            cookies: {},
            headers: {},
            method: 'POST',
            path: '/api/test',
            ip: '127.0.0.1',
            query: {}
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            cookie: jest.fn(),
            locals: {}
        };
        next = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
        // Restore original implementation of Tokens.secretSync
        jest.restoreAllMocks();
    });

    describe('csrfMiddleware', () => {
        it('should skip CSRF protection for safe methods', () => {
            const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

            safeMethods.forEach(method => {
                req.method = method;
                csrfMiddleware(req as Request, res as Response, next);
                expect(next).toHaveBeenCalled();
            });
        });

        it('should reject requests without CSRF token', () => {
            // Create a new request object specifically for this test with all required properties
            const testReq = {
                cookies: {},
                headers: {},
                method: 'POST',
                path: '/api/test',
                ip: '127.0.0.1',
                query: {},
                body: {},
                get: jest.fn() // Mock get method for user agent
            };

            csrfMiddleware(testReq as unknown as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                code: -2001,
                message: "CSRF token required for this operation"
            });
            expect(next).not.toHaveBeenCalled();
        });

        it('should reject requests without CSRF secret', () => {
            req.method = 'POST';
            (req.headers as any)['x-csrf-token'] = 'valid-token';

            csrfMiddleware(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                code: -2002,
                message: "CSRF secret not found - please re-authenticate"
            });
            expect(next).not.toHaveBeenCalled();
        });

        it('should reject requests with invalid CSRF token', () => {
            req.method = 'POST';
            (req.headers as any)['x-csrf-token'] = 'invalid-token';
            (req.cookies as any).csrfSecret = 'valid-secret';

            csrfMiddleware(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                code: -2003,
                message: "Invalid CSRF token"
            });
            expect(next).not.toHaveBeenCalled();
        });

        it('should accept valid CSRF token from header', () => {
            const tokensInstance = new Tokens();
            const secret = tokensInstance.secretSync();
            const token = tokensInstance.create(secret);

            req.method = 'POST';
            (req.headers as any)['x-csrf-token'] = token;
            (req.cookies as any).csrfSecret = secret;

            csrfMiddleware(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
        });

        it('should accept valid CSRF token from body', () => {
            const tokensInstance = new Tokens();
            const secret = tokensInstance.secretSync();
            const token = tokensInstance.create(secret);

            req.method = 'POST';
            req.body = { _csrf: token };
            (req.cookies as any).csrfSecret = secret;

            csrfMiddleware(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
        });

        it('should accept valid CSRF token from query string', () => {
            const tokensInstance = new Tokens();
            const secret = tokensInstance.secretSync();
            const token = tokensInstance.create(secret);

            req.method = 'POST';
            (req.query as any)._csrf = token;
            (req.cookies as any).csrfSecret = secret;

            csrfMiddleware(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
        });

        it('should accept valid CSRF token from cookie', () => {
            const tokensInstance = new Tokens();
            const secret = tokensInstance.secretSync();
            const token = tokensInstance.create(secret);

            req.method = 'POST';
            (req.cookies as any).csrfToken = token;
            (req.cookies as any).csrfSecret = secret;

            csrfMiddleware(req as Request, res as Response, next);

            expect(next).toHaveBeenCalled();
        });

        it('should handle errors gracefully', () => {
            // Create a new request object specifically for this test
            const errorReq = {
                cookies: {},
                headers: {},
                method: 'POST',
                path: '/api/test',
                ip: '127.0.0.1',
                query: {}
            };

            // Cause an error by setting invalid cookie property
            Object.defineProperty(errorReq, 'cookies', {
                get: () => { throw new Error('Cookie parsing error'); }
            });

            csrfMiddleware(errorReq as unknown as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                code: -2000,
                message: "CSRF validation error"
            });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('csrfTokenMiddleware', () => {
        it('should set CSRF token and secret cookies', () => {
            csrfTokenMiddleware(req as Request, res as Response, next);

            expect(res.cookie).toHaveBeenCalledTimes(2);
            expect(next).toHaveBeenCalled();
            expect((res as any).locals.csrfToken).toBeDefined();
            expect(req.csrfToken).toBeDefined();
            expect(typeof req.csrfToken).toBe('function');
        });

        it('should set cookies with correct options', () => {
            csrfTokenMiddleware(req as Request, res as Response, next);

            expect(res.cookie).toHaveBeenCalledWith(
                'csrfSecret',
                expect.any(String),
                expect.objectContaining({
                    httpOnly: true,
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000
                })
            );

            expect(res.cookie).toHaveBeenCalledWith(
                'csrfToken',
                expect.any(String),
                expect.objectContaining({
                    httpOnly: false,
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000
                })
            );
        });

        it('should handle errors during token generation', () => {
            // Mock tokens to throw an error
            jest.spyOn(Tokens.prototype, 'secretSync').mockImplementation(() => {
                throw new Error('Token generation error');
            });

            csrfTokenMiddleware(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                code: -2004,
                message: "Failed to generate CSRF token"
            });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('getCsrfToken', () => {
        it('should return token from req.csrfToken() method', () => {
            const testToken = 'test-token';
            req.csrfToken = jest.fn().mockReturnValue(testToken);

            const token = getCsrfToken(req as CSRFRequest);

            expect(token).toBe(testToken);
            expect(req.csrfToken).toHaveBeenCalled();
        });

        it('should generate token from csrfSecret cookie', () => {
            const tokensInstance = new Tokens();
            const secret = tokensInstance.secretSync();
            (req.cookies as any).csrfSecret = secret;

            const token = getCsrfToken(req as CSRFRequest);

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect((token as string).length).toBeGreaterThan(0);
        });

        it('should return null if no CSRF token or secret available', () => {
            const token = getCsrfToken(req as CSRFRequest);
            expect(token).toBeNull();
        });
    });
});