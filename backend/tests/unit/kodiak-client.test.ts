/** @format */

import { KodiakClient } from '../../src/infrastructure/external/kodiak-client';
import logger from '../../src/core/logging/logger.service';

// Mock dependencies
jest.mock('../../src/core/logging/logger.service');

// Mock fetch globally for all tests
beforeAll(() => {
    // Mock fetch for Node.js environment
    global.fetch = jest.fn();
});

beforeEach(() => {
    // Clear all mocks to ensure clean state
    jest.clearAllMocks();

    // Reset fetch mock for each test
    global.fetch = jest.fn();
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('KodiakClient', () => {
    let client: KodiakClient;

    beforeEach(() => {
        client = new KodiakClient();
        jest.clearAllMocks();
    });

    // Helper function to mock signature generation for tests that need it
    const mockSignatureGeneration = () => {
        (client as any).generateSignature = jest.fn().mockResolvedValue('mock-signature-12345');
    };

    describe('constructor', () => {
        it('should use default configuration when no config provided', () => {
            const defaultClient = new KodiakClient();

            expect(defaultClient).toBeDefined();
        });

        it('should use custom configuration when provided', () => {
            const customClient = new KodiakClient({
                baseUrl: 'https://custom.api.com',
                timeout: 60000,
                retryAttempts: 5,
            });

            expect(customClient).toBeDefined();
        });
    });

    describe('get', () => {
        it('should make authenticated GET request', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, data: 'test' }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: true,
                data: 'test',
            });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.orderly.org/test/endpoint',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'orderly-account-id': 'test-account',
                        'orderly-key': 'test-api-key',
                    }),
                })
            );
        });

        it('should handle API errors', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Invalid signature'),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Invalid signature',
                statusCode: 401,
            });
        });

        it('should handle network errors', async () => {
            // Mock signature generation to prevent import errors
            (client as any).generateSignature = jest.fn().mockResolvedValue('mock-signature-12345');
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Request failed after 3 attempts: Network error',
            });
        });

        it('should handle timeout errors', async () => {
            // Mock signature generation to prevent import errors
            (client as any).generateSignature = jest.fn().mockResolvedValue('mock-signature-12345');
            global.fetch = jest.fn().mockRejectedValue(new Error('Request timeout'));

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Request failed after 3 attempts: Request timeout',
            });
        });
    });

    describe('post', () => {
        it('should make authenticated POST request with body', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, data: 'created' }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };
            const body = { symbol: 'BTC-USDC', quantity: 1 };

            const result = await client.post('/test/endpoint', credentials, body);

            expect(result).toEqual({
                success: true,
                data: 'created',
            });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.orderly.org/test/endpoint',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'orderly-account-id': 'test-account',
                        'orderly-key': 'test-api-key',
                    }),
                    body: JSON.stringify(body),
                })
            );
        });

        it('should handle POST request without body', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.post('/test/endpoint', credentials);

            expect(result).toEqual({
                success: true,
                data: { success: true },
            });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.orderly.org/test/endpoint',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'orderly-account-id': 'test-account',
                        'orderly-key': 'test-api-key',
                        'orderly-signature': expect.any(String),
                        'orderly-timestamp': expect.any(String),
                    }),
                    body: undefined,
                })
            );
        });
    });

    describe('put', () => {
        it('should make authenticated PUT request', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, data: 'updated' }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };
            const body = { symbol: 'BTC-USDC', quantity: 2 };

            const result = await client.put('/test/endpoint', credentials, body);

            expect(result).toEqual({
                success: true,
                data: 'updated',
            });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.orderly.org/test/endpoint',
                expect.objectContaining({
                    method: 'PUT',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'orderly-account-id': 'test-account',
                        'orderly-key': 'test-api-key',
                    }),
                    body: JSON.stringify(body),
                })
            );
        });
    });

    describe('delete', () => {
        it('should make authenticated DELETE request', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.delete('/test/endpoint', credentials);

            expect(result).toEqual({
                success: true,
                data: { success: true },
            });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.orderly.org/test/endpoint',
                expect.objectContaining({
                    method: 'DELETE',
                    headers: expect.objectContaining({
                        'orderly-account-id': 'test-account',
                        'orderly-key': 'test-api-key',
                    }),
                })
            );
        });
    });

    describe('request retry logic', () => {
        it('should retry on server errors (5xx)', async () => {
            mockSignatureGeneration();
            let callCount = 0;
            global.fetch = jest.fn().mockImplementation(() => {
                callCount++;
                if (callCount < 3) {
                    return Promise.resolve({
                        ok: false,
                        status: 500,
                        statusText: 'Internal Server Error',
                        text: () => Promise.resolve('Server error'),
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                });
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: true,
                data: { success: true },
            });
            expect(global.fetch).toHaveBeenCalledTimes(3);
        });

        it('should not retry on client errors (4xx)', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: () => Promise.resolve('Invalid request'),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Invalid request',
                statusCode: 400,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('should fail after max retries', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: () => Promise.resolve('Server error'),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Request failed after 3 attempts: HTTP 500: Server error',
            });
            expect(global.fetch).toHaveBeenCalledTimes(3);
        });
    });

    describe('signature generation', () => {
        it('should generate valid signature for request', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            await client.get('/test/endpoint', credentials);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'orderly-signature': expect.any(String),
                        'orderly-timestamp': expect.any(String),
                    }),
                })
            );
        });

        it('should handle signature generation errors', async () => {
            // Mock signature generation to throw error
            const originalGenerateSignature = (client as any).generateSignature;
            (client as any).generateSignature = jest.fn().mockRejectedValue(new Error('Signature error'));

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Request error: Signature error',
            });
            expect(logger.error).toHaveBeenCalledWith('Kodiak API request error', {
                method: 'GET',
                url: 'https://api.orderly.org/test/endpoint',
                error: 'Signature error',
            });
        });
    });

    describe('request timeout', () => {
        it('should timeout requests after configured duration', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockImplementation(() => {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        reject(new Error('Request timeout'));
                    }, 100); // Short timeout to trigger quickly
                });
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: expect.stringContaining('Request timeout'),
            });
        });
    });

    describe('error handling', () => {
        it('should handle malformed JSON responses', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.reject(new Error('Invalid JSON')),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Request failed after 3 attempts: Invalid JSON',
            });
        });

        it('should handle empty response bodies', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(null),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: true,
                data: null,
            });
        });

        it('should handle API responses with success: false', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    success: false,
                    message: 'Insufficient balance',
                }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Insufficient balance',
            });
        });

        it('should handle API responses with error field', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    success: false,
                    error: 'Invalid parameters',
                }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.get('/test/endpoint', credentials);

            expect(result).toEqual({
                success: false,
                error: 'Invalid parameters',
            });
        });
    });

    describe('testConnectivity', () => {
        it('should return success for valid credentials', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.testConnectivity(credentials);

            expect(result).toEqual({ success: true });
            expect(logger.info).toHaveBeenCalledWith('Kodiak API connectivity test successful', {
                accountId: 'test-account',
            });
        });

        it('should return error for invalid credentials', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    success: false,
                    message: 'Invalid API key',
                }),
            });

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.testConnectivity(credentials);

            expect(result).toEqual({
                success: false,
                error: 'Invalid API key',
            });
            expect(logger.warn).toHaveBeenCalledWith('Kodiak API connectivity test failed', {
                accountId: 'test-account',
                error: 'Invalid API key',
            });
        });

        it('should handle connectivity test errors', async () => {
            mockSignatureGeneration();
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const credentials = {
                accountId: 'test-account',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
            };

            const result = await client.testConnectivity(credentials);

            expect(result).toEqual({
                success: false,
                error: 'Request failed after 3 attempts: Network error',
            });
            expect(logger.warn).toHaveBeenCalledWith('Kodiak API connectivity test failed', {
                accountId: 'test-account',
                error: 'Request failed after 3 attempts: Network error',
            });
        });
    });

    describe('buildUrl', () => {
        it('should build URL with leading slash', () => {
            const clientWithCustomUrl = new KodiakClient({
                baseUrl: 'https://custom.api.com',
            });

            const url = (clientWithCustomUrl as any).buildUrl('/test/endpoint');
            expect(url).toBe('https://custom.api.com/test/endpoint');
        });

        it('should build URL without leading slash', () => {
            const clientWithCustomUrl = new KodiakClient({
                baseUrl: 'https://custom.api.com',
            });

            const url = (clientWithCustomUrl as any).buildUrl('test/endpoint');
            expect(url).toBe('https://custom.api.com/test/endpoint');
        });

        it('should use default base URL', () => {
            const url = (client as any).buildUrl('/test/endpoint');
            expect(url).toBe('https://api.orderly.org/test/endpoint');
        });
    });

    describe('handleApiSuccess', () => {
        it('should handle successful response with success: true', () => {
            const response = { success: true, data: { id: 123 } };
            const result = (client as any).handleApiSuccess(response);

            expect(result).toEqual({
                success: true,
                data: { id: 123 },
            });
        });

        it('should handle successful response with success: false', () => {
            const response = { success: false, message: 'Insufficient balance' };
            const result = (client as any).handleApiSuccess(response);

            expect(result).toEqual({
                success: false,
                error: 'Insufficient balance',
            });
        });

        it('should handle response without success field', () => {
            const response = { data: { id: 123 } };
            const result = (client as any).handleApiSuccess(response);

            expect(result).toEqual({
                success: true,
                data: { data: { id: 123 } },
            });
        });

        it('should handle response with error field', () => {
            const response = { success: false, error: 'Invalid parameters' };
            const result = (client as any).handleApiSuccess(response);

            expect(result).toEqual({
                success: false,
                error: 'Invalid parameters',
            });
        });
    });

    describe('handleApiError', () => {
        it('should handle JSON error response', () => {
            const result = (client as any).handleApiError(400, '{"message": "Invalid request"}');

            expect(result).toEqual({
                success: false,
                error: 'Invalid request',
                statusCode: 400,
            });
        });

        it('should handle plain text error response', () => {
            const result = (client as any).handleApiError(500, 'Internal Server Error');

            expect(result).toEqual({
                success: false,
                error: 'Internal Server Error',
                statusCode: 500,
            });
        });

        it('should handle malformed JSON', () => {
            const result = (client as any).handleApiError(400, 'Invalid JSON');

            expect(result).toEqual({
                success: false,
                error: 'Invalid JSON',
                statusCode: 400,
            });
        });

        it('should include status code in error', () => {
            const result = (client as any).handleApiError(401, 'Unauthorized');

            expect(result).toEqual({
                success: false,
                error: 'Unauthorized',
                statusCode: 401,
            });
        });
    });

    describe('delay utility', () => {
        it('should delay execution', async () => {
            const start = Date.now();
            await (client as any).delay(100);
            const end = Date.now();

            expect(end - start).toBeGreaterThanOrEqual(100);
        });
    });
});