/** @format */

import { PasswordServiceAdapter } from '../../src/infrastructure/adapters/encryption/password.service.adapter';
import bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('bcryptjs', () => ({
    hash: jest.fn(),
    compare: jest.fn()
}));

describe('PasswordServiceAdapter', () => {
    let passwordService: PasswordServiceAdapter;

    beforeEach(() => {
        passwordService = new PasswordServiceAdapter();
        jest.clearAllMocks();
    });

    describe('hash', () => {
        it('should hash a password using bcrypt with default rounds', async () => {
            const password = 'test-password';
            const hashedPassword = 'hashed-password';

            (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

            const result = await passwordService.hash(password);

            expect(bcrypt.hash).toHaveBeenCalledWith(password, 12);
            expect(result).toEqual(hashedPassword);
        });

        it('should hash a password using bcrypt with custom rounds', async () => {
            const password = 'test-password';
            const hashedPassword = 'hashed-password';
            const customRounds = 8;

            (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

            const result = await passwordService.hash(password, customRounds);

            expect(bcrypt.hash).toHaveBeenCalledWith(password, customRounds);
            expect(result).toEqual(hashedPassword);
        });

        it('should throw error when bcrypt hash fails', async () => {
            const password = 'test-password';
            const error = new Error('Hashing failed');

            (bcrypt.hash as jest.Mock).mockRejectedValue(error);

            await expect(passwordService.hash(password)).rejects.toThrow(`Failed to hash password: ${error.message}`);
        });
    });

    describe('verify', () => {
        it('should verify a valid password', async () => {
            const password = 'test-password';
            const hash = 'hashed-password';

            (bcrypt.compare as jest.Mock).mockResolvedValue(true);

            const result = await passwordService.verify(password, hash);

            expect(bcrypt.compare).toHaveBeenCalledWith(password, hash);
            expect(result).toBe(true);
        });

        it('should reject an invalid password', async () => {
            const password = 'test-password';
            const hash = 'hashed-password';

            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const result = await passwordService.verify(password, hash);

            expect(bcrypt.compare).toHaveBeenCalledWith(password, hash);
            expect(result).toBe(false);
        });

        it('should throw error when bcrypt compare fails', async () => {
            const password = 'test-password';
            const hash = 'hashed-password';
            const error = new Error('Comparison failed');

            (bcrypt.compare as jest.Mock).mockRejectedValue(error);

            await expect(passwordService.verify(password, hash)).rejects.toThrow(`Failed to verify password: ${error.message}`);
        });
    });
});