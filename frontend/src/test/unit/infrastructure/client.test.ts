/** @format */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { httpClient } from "../../../infrastructure/api/client";

// Mock console.log and console.error to avoid cluttering test output
vi.spyOn(console, "log").mockImplementation(() => { });
vi.spyOn(console, "warn").mockImplementation(() => { });
vi.spyOn(console, "error").mockImplementation(() => { });

describe("HttpClient", () => {
    describe("Singleton Pattern", () => {
        it("should return the same instance when getInstance is called multiple times", () => {
            const instance1 = httpClient;
            const instance2 = httpClient;
            expect(instance1).toBe(instance2);
        });
    });

    describe("Client Configuration", () => {
        it("should create an instance with correct base configuration", () => {
            const client = httpClient.getClient();
            expect(client).toBeDefined();
        });
    });

    describe("Request Interceptor", () => {
        it("should log requests with URL", () => {
            const client = httpClient.getClient();

            // Get the request interceptor function
            const requestInterceptors = (client.interceptors.request as any).handlers;
            const requestInterceptor = requestInterceptors.find((interceptor: any) => interceptor.fulfilled)?.fulfilled;

            expect(requestInterceptor).toBeDefined();

            const mockConfig = {
                url: "/api/test",
                method: "get",
                headers: {},
                data: {},
                params: {},
                baseURL: "http://localhost",
                timeout: 0,
                withCredentials: true
            };

            const result = requestInterceptor!(mockConfig);

            expect(result).toEqual(mockConfig);
        });

        it("should handle request errors", async () => {
            const client = httpClient.getClient();

            // Get the request interceptor error handler
            const requestInterceptors = (client.interceptors.request as any).handlers;
            const errorInterceptor = requestInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

            expect(errorInterceptor).toBeDefined();

            const mockError = new Error("Request failed");

            await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
        });
    });

    describe("Response Interceptor", () => {
        describe("Success Responses", () => {
            it("should wrap responses without success field in ApiResponse format", async () => {
                const client = httpClient.getClient();

                // Create a mock response that will trigger the interceptor
                const mockData = { id: 1, name: "Test Data" };
                const mockRequest = {
                    url: "/test",
                    method: "get",
                    headers: {},
                    data: {},
                    params: {},
                    baseURL: "http://localhost",
                    timeout: 0,
                    withCredentials: true
                };

                // Get the interceptor functions from axios
                // Axios interceptors are stored in interceptor.fulfilled and interceptor.rejected arrays
                const responseInterceptors = (client.interceptors.response as any).handlers;
                const successInterceptor = responseInterceptors.find((interceptor: any) => interceptor.fulfilled)?.fulfilled;

                expect(successInterceptor).toBeDefined();

                const result = await successInterceptor!({
                    data: mockData,
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    config: mockRequest
                });

                expect(result.data).toEqual({
                    success: true,
                    data: mockData
                });
            });

            it("should return responses with success field as-is", async () => {
                const client = httpClient.getClient();

                const mockResponse = {
                    success: true,
                    data: { id: 1, name: "Test Data" }
                };

                const mockRequest = {
                    url: "/test",
                    method: "get",
                    headers: {},
                    data: {},
                    params: {},
                    baseURL: "http://localhost",
                    timeout: 0,
                    withCredentials: true
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const successInterceptor = responseInterceptors.find((interceptor: any) => interceptor.fulfilled)?.fulfilled;

                const result = await successInterceptor!({
                    data: mockResponse,
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    config: mockRequest
                });

                expect(result.data).toEqual(mockResponse);
            });
        });

        describe("Error Handling", () => {
            beforeEach(() => {
                // Mock window methods
                vi.spyOn(window.location, "assign").mockImplementation(() => { });
                vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
            });

            afterEach(() => {
                vi.clearAllMocks();
            });

            it("should handle 429 rate limiting errors", async () => {
                const client = httpClient.getClient();

                const mockError = {
                    response: {
                        status: 429,
                        data: { retryAfter: 60 },
                        headers: {
                            "ratelimit-limit": "100",
                            "ratelimit-remaining": "0",
                            "ratelimit-reset": Date.now() + 60000
                        }
                    },
                    config: { url: "/api/test" }
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toHaveProperty("retryAfter", 60);
                await expect(errorInterceptor!(mockError)).rejects.toHaveProperty("message", expect.stringContaining("Rate limited"));
            });

            it("should handle network errors (ERR_NETWORK)", async () => {
                const client = httpClient.getClient();

                const mockError = {
                    response: undefined,
                    code: "ERR_NETWORK"
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
                expect(window.dispatchEvent).toHaveBeenCalled();
                expect(window.location.href).toEqual("/login");
            });

            it("should handle 401 on auth endpoints by redirecting to login", async () => {
                const client = httpClient.getClient();

                const mockError = {
                    response: { status: 401 },
                    config: { url: "/api/auth/login", _retry: false }
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
                expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
                expect(window.location.href).toEqual("/login");
            });

            it("should handle 401 on user profile endpoint by redirecting to login", async () => {
                const client = httpClient.getClient();

                const mockError = {
                    response: { status: 401 },
                    config: { url: "/api/user/profile", _retry: false }
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
                expect(window.dispatchEvent).toHaveBeenCalled();
                expect(window.location.href).toEqual("/login");
            });

            it("should not redirect for 401 on non-auth endpoints", async () => {
                const client = httpClient.getClient();

                // Save original href
                const originalHref = window.location.href;
                // Mock href to be something else initially
                Object.defineProperty(window.location, 'href', {
                    writable: true,
                    value: 'http://localhost/dashboard'
                });

                const mockError = {
                    response: { status: 401 },
                    config: { url: "/api/market/data", _retry: false }
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
                expect(window.dispatchEvent).not.toHaveBeenCalled();
                expect(window.location.href).not.toEqual("/login");

                // Restore original href
                Object.defineProperty(window.location, 'href', {
                    writable: true,
                    value: originalHref
                });
            });

            it("should handle 403 forbidden errors", async () => {
                const client = httpClient.getClient();

                const mockError = {
                    response: { status: 403 },
                    config: { url: "/api/restricted" }
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
            });

            it("should handle 500+ errors on auth endpoints by redirecting to login", async () => {
                const client = httpClient.getClient();

                const mockError = {
                    response: { status: 500 },
                    config: { url: "/api/auth/login" }
                };

                const responseInterceptors = (client.interceptors.response as any).handlers;
                const errorInterceptor = responseInterceptors.find((interceptor: any) => interceptor.rejected)?.rejected;

                await expect(errorInterceptor!(mockError)).rejects.toEqual(mockError);
                expect(window.dispatchEvent).toHaveBeenCalled();
                expect(window.location.href).toEqual("/login");
            });
        });
    });
});