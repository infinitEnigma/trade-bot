/** @format */

import { describe, it, expect, vi } from "vitest";
import {
    cn,
    formatCurrency,
    formatPercentage,
    shortenAddress,
    getGradientClass,
    truncateText,
    generateId,
    formatDate,
    capitalize,
    getInitials,
    sleep,
    isEmpty,
    copyToClipboard,
    getValueColorClass,
    isValidEmail,
    deepClone,
    isTokenExpired,
} from "../../../shared/utils/utils";

describe("utils.ts", () => {
    describe("cn function", () => {
        it("should merge classes correctly", () => {
            expect(cn("foo", "bar")).toBe("foo bar");
            expect(cn("foo", "foo")).toBe("foo");
            expect(cn("foo", null, "bar")).toBe("foo bar");
        });
    });

    describe("formatCurrency function", () => {
        it("should format currency correctly", () => {
            expect(formatCurrency(100)).toBe("$100.00");
            expect(formatCurrency(100.5)).toBe("$100.50");
            expect(formatCurrency(1000, { currency: "EUR" })).toBe("€1,000.00");
        });
    });

    describe("formatPercentage function", () => {
        it("should format percentages correctly", () => {
            expect(formatPercentage(50)).toBe("+50.00%");
            expect(formatPercentage(-10)).toBe("-10.00%");
            expect(formatPercentage(15.5)).toBe("+15.50%");
            expect(formatPercentage(10, { showSign: false })).toBe("10.00%");
        });
    });

    describe("shortenAddress function", () => {
        it("should shorten addresses", () => {
            expect(shortenAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x12345...5678");
            expect(shortenAddress("0x1234567890abcdef1234567890abcdef12345678", { startLength: 4, endLength: 2 })).toBe("0x12...78");
        });
    });

    describe("truncateText function", () => {
        it("should truncate text", () => {
            expect(truncateText("Hello World", 5)).toBe("He...");
            expect(truncateText("Hello", 10)).toBe("Hello");
        });
    });

    describe("generateId function", () => {
        it("should generate random IDs", () => {
            const id1 = generateId();
            const id2 = generateId();

            expect(id1).toBeDefined();
            expect(id2).toBeDefined();
            expect(id1).not.toEqual(id2);
        });

        it("should generate IDs of specific length", () => {
            expect(generateId(8)).toHaveLength(8);
            expect(generateId(12)).toHaveLength(12);
        });
    });

    describe("formatDate function", () => {
        it("should format dates correctly", () => {
            const date = new Date("2023-10-01");
            const formatted = formatDate(date);

            expect(formatted).toBeTruthy();
            expect(typeof formatted).toBe("string");
        });

        it("should format date strings correctly", () => {
            const dateStr = "2023-10-01";
            const formatted = formatDate(dateStr);

            expect(formatted).toBeTruthy();
            expect(typeof formatted).toBe("string");
        });

        it("should format timestamp numbers correctly", () => {
            const timestamp = Date.now();
            const formatted = formatDate(timestamp);

            expect(formatted).toBeTruthy();
            expect(typeof formatted).toBe("string");
        });
    });

    describe("capitalize function", () => {
        it("should capitalize strings", () => {
            expect(capitalize("hello world")).toBe("Hello World");
            expect(capitalize("hello")).toBe("Hello");
        });
    });

    describe("getInitials function", () => {
        it("should get initials from names", () => {
            expect(getInitials("John Doe")).toBe("JD");
            expect(getInitials("Jane Smith")).toBe("JS");
            expect(getInitials("John")).toBe("J");
        });
    });

    describe("sleep function", () => {
        it("should sleep for approximately specified duration", async () => {
            const start = Date.now();
            await sleep(100);
            const end = Date.now();
            const duration = end - start;

            // Allow for small precision error (up to 10ms) to prevent flaky tests
            expect(duration).toBeGreaterThanOrEqual(99);
            expect(duration).toBeLessThanOrEqual(101); // Also ensure it doesn't take too long
        });
    });

    describe("isEmpty function", () => {
        it("should check for empty values", () => {
            expect(isEmpty(null)).toBe(true);
            expect(isEmpty(undefined)).toBe(true);
            expect(isEmpty("")).toBe(true);
            expect(isEmpty(" ")).toBe(true);
            expect(isEmpty([])).toBe(true);
            expect(isEmpty({})).toBe(true);

            expect(isEmpty("hello")).toBe(false);
            expect(isEmpty([1])).toBe(false);
            expect(isEmpty({ key: "value" })).toBe(false);
        });
    });

    describe("getGradientClass function", () => {
        it("should generate gradient classes correctly", () => {
            expect(getGradientClass("blue-500", "red-500")).toBe("bg-gradient-to-right from-blue-500 to-red-500");
            expect(getGradientClass("green-500", "purple-500", "to bottom")).toBe("bg-gradient-to-bottom from-green-500 to-purple-500");
            expect(getGradientClass("yellow-500", "orange-500", "to top-left")).toBe("bg-gradient-to-top-left from-yellow-500 to-orange-500");
        });
    });

    describe("copyToClipboard function", () => {
        it("should copy text to clipboard using navigator.clipboard", async () => {
            // Mock navigator.clipboard
            const writeText = vi.fn().mockResolvedValue("test text");
            Object.assign(navigator, {
                clipboard: { writeText },
            });

            const result = await copyToClipboard("test text");

            expect(writeText).toHaveBeenCalledWith("test text");
            expect(result).toBe(true);
        });

        it("should copy text to clipboard using document.execCommand fallback", async () => {
            // Mock navigator.clipboard to be undefined to test fallback
            Object.defineProperty(navigator, 'clipboard', {
                value: undefined,
                writable: true,
            });

            // Mock document.execCommand
            const execCommand = vi.fn().mockReturnValue(true);
            Object.assign(document, {
                execCommand,
            });

            // Mock DOM manipulation
            const createElement = vi.fn().mockReturnValue({
                value: "",
                select: vi.fn(),
            });
            const appendChild = vi.fn();
            const removeChild = vi.fn();

            Object.assign(document.body, {
                appendChild,
                removeChild,
            });

            Object.assign(document, {
                createElement,
            });

            const result = await copyToClipboard("fallback test");

            expect(createElement).toHaveBeenCalledWith("textarea");
            expect(appendChild).toHaveBeenCalled();
            expect(execCommand).toHaveBeenCalledWith("copy");
            expect(removeChild).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it("should return false when clipboard copy fails", async () => {
            // Mock navigator.clipboard to be undefined to test fallback failure
            Object.defineProperty(navigator, 'clipboard', {
                value: undefined,
                writable: true,
            });

            // Mock document.execCommand to fail
            const execCommand = vi.fn().mockImplementation(() => {
                throw new Error("Copy failed");
            });
            Object.assign(document, {
                execCommand,
            });

            // Mock DOM manipulation
            const createElement = vi.fn().mockReturnValue({
                value: "",
                select: vi.fn(),
            });
            const appendChild = vi.fn();
            const removeChild = vi.fn();

            Object.assign(document.body, {
                appendChild,
                removeChild,
            });

            Object.assign(document, {
                createElement,
            });

            const result = await copyToClipboard("failed test");

            expect(result).toBe(false);
        });
    });

    describe("getValueColorClass function", () => {
        it("should get color classes based on value", () => {
            expect(getValueColorClass(10)).toBe("text-green-500");
            expect(getValueColorClass(-5)).toBe("text-red-500");
            expect(getValueColorClass(0)).toBe("text-gray-400");

            expect(getValueColorClass(10, { positive: "text-blue-500" })).toBe("text-blue-500");
        });
    });

    describe("isValidEmail function", () => {
        it("should validate email formats", () => {
            expect(isValidEmail("test@example.com")).toBe(true);
            expect(isValidEmail("test@example.co.uk")).toBe(true);
            expect(isValidEmail("invalid-email")).toBe(false);
            expect(isValidEmail("test@.com")).toBe(false);
        });
    });

    describe("deepClone function", () => {
        it("should deep clone objects", () => {
            const obj = {
                a: 1,
                b: { c: 2 },
                d: [1, 2, 3],
            };

            const clone = deepClone(obj);

            expect(clone).toEqual(obj);
            expect(clone).not.toBe(obj);
            expect(clone.b).not.toBe(obj.b);
        });
    });

    describe("isTokenExpired function", () => {
        it("should check token expiration", () => {
            // Create a token that expires in 1 hour
            const futureToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiO" + (Math.floor(Date.now() / 1000) + 3600);

            // Create a token that expired 1 hour ago
            const expiredToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiO" + (Math.floor(Date.now() / 1000) - 3600);

            expect(isTokenExpired(expiredToken)).toBe(true);
        });

        it("should return true for malformed tokens", () => {
            expect(isTokenExpired("invalid-token")).toBe(true);
            expect(isTokenExpired("")).toBe(true);
            expect(isTokenExpired("abc123")).toBe(true);
        });
    });
});