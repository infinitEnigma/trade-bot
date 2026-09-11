/** @format */

import { PasswordAdapter } from '../../src/infrastructure/adapters/password/password.adapter';
import { hashPassword, comparePassword } from '../../src/workers/password-worker';

// Mock dependencies
jest.mock('../../src/workers/password-worker', () => ({
    hashPassword: jest.fn(),
    comparePassword: jest.fn()
}));

// Mock logger
jest.mock('../../src/core/logging', () => ({
    logger: {
        warn: jest.fn()
    }
}));

describe('PasswordAdapter', () => {
    let passwordAdapter: PasswordAdapter;

    beforeEach(() => {
        passwordAdapter = new PasswordAdapter();
        jest.clearAllMocks();
    });

    describe('hash', () => {
        it('should hash a password using default rounds', async () => {
            const password = 'TestPassword1!';
            const hashedPassword = 'hashed-password';

            (hashPassword as jest.Mock).mockResolvedValue(hashedPassword);

            const result = await passwordAdapter.hash(password);

            expect(hashPassword).toHaveBeenCalledWith(password, 12);
            expect(result).toEqual(hashedPassword);
        });

        it('should hash a password using custom rounds', async () => {
            const password = 'TestPassword1!';
            const hashedPassword = 'hashed-password';
            const customRounds = 10;

            (hashPassword as jest.Mock).mockResolvedValue(hashedPassword);

            const result = await passwordAdapter.hash(password, customRounds);

            expect(hashPassword).toHaveBeenCalledWith(password, customRounds);
            expect(result).toEqual(hashedPassword);
        });

        it('should throw error when password is empty', async () => {
            await expect(passwordAdapter.hash('')).rejects.toThrow('Password cannot be empty');
            expect(hashPassword).not.toHaveBeenCalled();
        });

        it('should throw error when rounds are less than 8', async () => {
            await expect(passwordAdapter.hash('TestPassword1!', 7)).rejects.toThrow('Bcrypt rounds must be between 8 and 20');
            expect(hashPassword).not.toHaveBeenCalled();
        });

        it('should throw error when rounds are greater than 20', async () => {
            await expect(passwordAdapter.hash('TestPassword1!', 21)).rejects.toThrow('Bcrypt rounds must be between 8 and 20');
            expect(hashPassword).not.toHaveBeenCalled();
        });

        it('should throw error with message when hashing fails', async () => {
            const password = 'TestPassword1!';
            const error = new Error('Hashing failed');

            (hashPassword as jest.Mock).mockRejectedValue(error);

            await expect(passwordAdapter.hash(password)).rejects.toThrow(`Password hashing failed: ${error.message}`);
        });
    });

    describe('verify', () => {
        it('should verify a valid password', async () => {
            const password = 'TestPassword1!';
            const hash = 'hashed-password';

            (comparePassword as jest.Mock).mockResolvedValue(true);

            const result = await passwordAdapter.verify(password, hash);

            expect(comparePassword).toHaveBeenCalledWith(password, hash);
            expect(result).toBe(true);
        });

        it('should reject an invalid password', async () => {
            const password = 'TestPassword1!';
            const hash = 'hashed-password';

            (comparePassword as jest.Mock).mockResolvedValue(false);

            const result = await passwordAdapter.verify(password, hash);

            expect(comparePassword).toHaveBeenCalledWith(password, hash);
            expect(result).toBe(false);
        });

        it('should return false when password is empty', async () => {
            const result = await passwordAdapter.verify('', 'hashed-password');

            expect(comparePassword).not.toHaveBeenCalled();
            expect(result).toBe(false);
        });

        it('should return false when hash is empty', async () => {
            const result = await passwordAdapter.verify('TestPassword1!', '');

            expect(comparePassword).not.toHaveBeenCalled();
            expect(result).toBe(false);
        });

        it('should return false and log warning when verification fails', async () => {
            const password = 'TestPassword1!';
            const hash = 'hashed-password';
            const error = new Error('Verification failed');

            (comparePassword as jest.Mock).mockRejectedValue(error);

            const result = await passwordAdapter.verify(password, hash);

            expect(comparePassword).toHaveBeenCalledWith(password, hash);
            expect(result).toBe(false);
        });
    });

    describe('getRecommendedRounds', () => {
        it('should return 8 rounds in test environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const rounds = passwordAdapter.getRecommendedRounds();

            expect(rounds).toBe(8);
            process.env.NODE_ENV = originalEnv;
        });

        it('should return 12 rounds in production environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const rounds = passwordAdapter.getRecommendedRounds();

            expect(rounds).toBe(12);
            process.env.NODE_ENV = originalEnv;
        });

        it('should return 12 rounds in development environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const rounds = passwordAdapter.getRecommendedRounds();

            expect(rounds).toBe(12);
            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('validatePasswordStrength', () => {
        it('should validate a strong password', () => {
            const result = passwordAdapter.validatePasswordStrength('TestPassword1!');

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it('should reject password shorter than 8 characters', () => {
            const result = passwordAdapter.validatePasswordStrength('Test1!');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must be at least 8 characters long');
        });

        it('should reject password without uppercase letter', () => {
            const result = passwordAdapter.validatePasswordStrength('testpassword1!');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
        });

        it('should reject password without lowercase letter', () => {
            const result = passwordAdapter.validatePasswordStrength('TESTPASSWORD1!');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one lowercase letter');
        });

        it('should reject password without number', () => {
            const result = passwordAdapter.validatePasswordStrength('TestPassword!');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one number');
        });

        it('should reject password with only whitespace', () => {
            const result = passwordAdapter.validatePasswordStrength('        ');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
            expect(result.errors).toContain('Password must contain at least one lowercase letter');
            expect(result.errors).toContain('Password must contain at least one number');
        });

        it('should reject empty password', () => {
            const result = passwordAdapter.validatePasswordStrength('');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must be at least 8 characters long');
            expect(result.errors).toContain('Password must contain at least one uppercase letter');
            expect(result.errors).toContain('Password must contain at least one lowercase letter');
            expect(result.errors).toContain('Password must contain at least one number');
        });

        it('should reject password without numbers or special characters', () => {
            const result = passwordAdapter.validatePasswordStrength('TestPassword');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Password must contain at least one number');
        });
    });
});