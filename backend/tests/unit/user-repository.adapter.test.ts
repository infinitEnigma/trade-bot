/** @format */

import { UserRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/user-repository.adapter';
import { query } from '../../src/database/pool';
import { UserLevel } from '@trade-bot/shared';

// Mock dependencies
jest.mock('../../src/database/pool', () => ({
    query: jest.fn().mockResolvedValue({})
}));

describe('UserRepositoryAdapter', () => {
    let userRepository: UserRepositoryAdapter;

    beforeEach(() => {
        userRepository = new UserRepositoryAdapter();
        jest.clearAllMocks();
    });

    describe('findByEmail', () => {
        it('should find user by email address', async () => {
            const mockEmail = 'test@example.com';
            const mockUserRow = {
                id: 'test-user-id',
                email: mockEmail,
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01',
                updated_at: '2024-01-01'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUserRow]
            });

            const user = await userRepository.findByEmail(mockEmail);

            expect(query).toHaveBeenCalledWith(
                'SELECT id, email, user_level, created_at, updated_at FROM users WHERE email = $1',
                [mockEmail]
            );
            expect(user).not.toBeNull();
            expect(user?.id).toBe(mockUserRow.id);
            expect(user?.email).toBe(mockUserRow.email);
            expect(user?.userLevel).toBe(mockUserRow.user_level);
        });

        it('should return null when user not found by email', async () => {
            const mockEmail = 'nonexistent@example.com';

            (query as jest.Mock).mockResolvedValue({
                rows: []
            });

            const user = await userRepository.findByEmail(mockEmail);

            expect(user).toBeNull();
        });

        it('should throw error when findByEmail fails', async () => {
            const mockEmail = 'test@example.com';
            const mockError = new Error('Database connection failed');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.findByEmail(mockEmail)).rejects.toThrow(
                'Failed to find user by email: Database connection failed'
            );
        });
    });

    describe('findByEmailWithPassword', () => {
        it('should find user by email with password hash', async () => {
            const mockEmail = 'test@example.com';
            const mockUserRow = {
                id: 'test-user-id',
                email: mockEmail,
                password_hash: 'hashedpassword123',
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01',
                updated_at: '2024-01-01'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUserRow]
            });

            const user = await userRepository.findByEmailWithPassword(mockEmail);

            expect(query).toHaveBeenCalledWith(
                'SELECT id, email, password_hash, user_level, created_at, updated_at FROM users WHERE email = $1',
                [mockEmail]
            );
            expect(user).not.toBeNull();
            expect(user?.id).toBe(mockUserRow.id);
            expect(user?.email).toBe(mockUserRow.email);
            expect(user?.passwordHash).toBe(mockUserRow.password_hash);
        });

        it('should return null when user not found with password', async () => {
            const mockEmail = 'nonexistent@example.com';

            (query as jest.Mock).mockResolvedValue({
                rows: []
            });

            const user = await userRepository.findByEmailWithPassword(mockEmail);

            expect(user).toBeNull();
        });

        it('should throw error when findByEmailWithPassword fails', async () => {
            const mockEmail = 'test@example.com';
            const mockError = new Error('Query failed');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.findByEmailWithPassword(mockEmail)).rejects.toThrow(
                'Failed to find user by email with password: Query failed'
            );
        });
    });

    describe('findById', () => {
        it('should find user by ID', async () => {
            const mockUserId = 'test-user-id';
            const mockUserRow = {
                id: mockUserId,
                email: 'test@example.com',
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01',
                updated_at: '2024-01-01'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUserRow]
            });

            const user = await userRepository.findById(mockUserId);

            expect(query).toHaveBeenCalledWith(
                'SELECT id, email, user_level, created_at, updated_at FROM users WHERE id = $1',
                [mockUserId]
            );
            expect(user).not.toBeNull();
            expect(user?.id).toBe(mockUserRow.id);
            expect(user?.email).toBe(mockUserRow.email);
        });

        it('should return null when user not found by ID', async () => {
            const mockUserId = 'nonexistent-user-id';

            (query as jest.Mock).mockResolvedValue({
                rows: []
            });

            const user = await userRepository.findById(mockUserId);

            expect(user).toBeNull();
        });

        it('should throw error when findById fails', async () => {
            const mockUserId = 'test-user-id';
            const mockError = new Error('Database error');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.findById(mockUserId)).rejects.toThrow(
                'Failed to find user by ID: Database error'
            );
        });
    });

    describe('create', () => {
        it('should create a new user', async () => {
            const mockUserData = {
                email: 'newuser@example.com',
                password: 'password123'
            };
            const mockCreatedUser = {
                id: 'new-user-id',
                email: mockUserData.email,
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01',
                updated_at: '2024-01-01'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockCreatedUser]
            });

            const user = await userRepository.create(mockUserData);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO users'),
                expect.arrayContaining([
                    mockUserData.email,
                    mockUserData.password,
                    UserLevel.BASIC
                ])
            );
            expect(user).not.toBeNull();
            expect(user.id).toBe(mockCreatedUser.id);
            expect(user.email).toBe(mockCreatedUser.email);
            expect(user.userLevel).toBe(mockCreatedUser.user_level);
        });

        it('should throw error when email already exists', async () => {
            const mockUserData = {
                email: 'existing@example.com',
                password: 'password123'
            };
            const mockError = new Error('duplicate key value violates unique constraint');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.create(mockUserData)).rejects.toThrow('Email already exists');
        });

        it('should throw error when user creation fails', async () => {
            const mockUserData = {
                email: 'newuser@example.com',
                password: 'password123'
            };
            const mockError = new Error('Database connection failed');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.create(mockUserData)).rejects.toThrow(
                'Failed to create user: Database connection failed'
            );
        });

        it('should throw error when user creation returns no rows', async () => {
            const mockUserData = {
                email: 'newuser@example.com',
                password: 'password123'
            };

            (query as jest.Mock).mockResolvedValue({ rows: [] });

            await expect(userRepository.create(mockUserData)).rejects.toThrow(
                'User creation failed - no rows returned'
            );
        });
    });

    describe('updateUserLevel', () => {
        it('should update user level', async () => {
            const mockUserId = 'test-user-id';
            const newLevel = UserLevel.VERIFIED;

            (query as jest.Mock).mockResolvedValue({
                rowCount: 1
            });

            const result = await userRepository.updateUserLevel(mockUserId, newLevel);

            expect(query).toHaveBeenCalledWith(
                'UPDATE users SET user_level = $1, updated_at = NOW() WHERE id = $2',
                [newLevel, mockUserId]
            );
            expect(result).toBe(true);
        });

        it('should return false when updating level for non-existent user', async () => {
            const mockUserId = 'nonexistent-user-id';
            const newLevel = UserLevel.VERIFIED;

            (query as jest.Mock).mockResolvedValue({
                rowCount: 0
            });

            const result = await userRepository.updateUserLevel(mockUserId, newLevel);

            expect(result).toBe(false);
        });

        it('should throw error when updateUserLevel fails', async () => {
            const mockUserId = 'test-user-id';
            const newLevel = UserLevel.VERIFIED;
            const mockError = new Error('Update failed');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.updateUserLevel(mockUserId, newLevel)).rejects.toThrow(
                'Failed to update user level: Update failed'
            );
        });
    });

    describe('updateProfile', () => {
        it('should update user profile with email', async () => {
            const mockUserId = 'test-user-id';
            const newEmail = 'newemail@example.com';
            const mockUpdatedUser = {
                id: mockUserId,
                email: newEmail,
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01',
                updated_at: '2024-01-02'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUpdatedUser]
            });

            const user = await userRepository.updateProfile(mockUserId, { email: newEmail });

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE users SET'),
                expect.arrayContaining([newEmail.toLowerCase(), mockUserId])
            );
            expect(user).not.toBeNull();
            expect(user?.email).toBe(newEmail);
        });

        it('should update user profile with user level', async () => {
            const mockUserId = 'test-user-id';
            const newLevel = UserLevel.VERIFIED;
            const mockUpdatedUser = {
                id: mockUserId,
                email: 'test@example.com',
                user_level: newLevel,
                created_at: '2024-01-01',
                updated_at: '2024-01-02'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUpdatedUser]
            });

            const user = await userRepository.updateProfile(mockUserId, { userLevel: newLevel });

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE users SET'),
                expect.arrayContaining([newLevel, mockUserId])
            );
            expect(user).not.toBeNull();
            expect(user?.userLevel).toBe(newLevel);
        });

        it('should update user profile with both email and level', async () => {
            const mockUserId = 'test-user-id';
            const newEmail = 'newemail@example.com';
            const newLevel = UserLevel.VERIFIED;
            const mockUpdatedUser = {
                id: mockUserId,
                email: newEmail,
                user_level: newLevel,
                created_at: '2024-01-01',
                updated_at: '2024-01-02'
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUpdatedUser]
            });

            const user = await userRepository.updateProfile(mockUserId, {
                email: newEmail,
                userLevel: newLevel
            });

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE users SET'),
                expect.arrayContaining([newEmail.toLowerCase(), newLevel, mockUserId])
            );
            expect(user).not.toBeNull();
            expect(user?.email).toBe(newEmail);
            expect(user?.userLevel).toBe(newLevel);
        });

        it('should return null when updating profile for non-existent user', async () => {
            const mockUserId = 'nonexistent-user-id';

            (query as jest.Mock).mockResolvedValue({
                rows: []
            });

            const user = await userRepository.updateProfile(mockUserId, { email: 'newemail@example.com' });

            expect(user).toBeNull();
        });

        it('should throw error when email already exists', async () => {
            const mockUserId = 'test-user-id';
            const newEmail = 'existing@example.com';
            const mockError = new Error('duplicate key value violates unique constraint');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.updateProfile(mockUserId, { email: newEmail })).rejects.toThrow('Email already exists');
        });

        it('should throw error when updateProfile fails', async () => {
            const mockUserId = 'test-user-id';
            const newEmail = 'newemail@example.com';
            const mockError = new Error('Update failed');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.updateProfile(mockUserId, { email: newEmail })).rejects.toThrow(
                'Failed to update user profile: Update failed'
            );
        });
    });

    describe('getAuthenticatedUserData', () => {
        it('should get authenticated user data with roles and credentials info', async () => {
            const mockUserId = 'test-user-id';
            const mockUserRow = {
                id: mockUserId,
                email: 'test@example.com',
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01',
                updated_at: '2024-01-01',
                roles: ['user'],
                has_credentials: false
            };

            (query as jest.Mock).mockResolvedValue({
                rows: [mockUserRow]
            });

            const result = await userRepository.getAuthenticatedUserData(mockUserId);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [mockUserId]
            );
            expect(result).not.toBeNull();
            expect(result?.user.id).toBe(mockUserRow.id);
            expect(result?.user.email).toBe(mockUserRow.email);
            expect(result?.roles).toEqual(mockUserRow.roles);
            expect(result?.hasCredentials).toBe(mockUserRow.has_credentials);
        });

        it('should return null when authenticated user data not found', async () => {
            const mockUserId = 'nonexistent-user-id';

            (query as jest.Mock).mockResolvedValue({
                rows: []
            });

            const result = await userRepository.getAuthenticatedUserData(mockUserId);

            expect(result).toBeNull();
        });

        it('should throw error when getAuthenticatedUserData fails', async () => {
            const mockUserId = 'test-user-id';
            const mockError = new Error('Query failed');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.getAuthenticatedUserData(mockUserId)).rejects.toThrow(
                'Failed to get authenticated user data: Query failed'
            );
        });
    });

    describe('mapRowToUser', () => {
        it('should map database row to User domain object', () => {
            // We need to test the private method by accessing it through the class prototype
            const mapRowToUser = (UserRepositoryAdapter.prototype as any).mapRowToUser;
            const userRepository = new UserRepositoryAdapter();

            const mockUserRow = {
                id: 'test-user-id',
                email: 'test@example.com',
                user_level: UserLevel.BASIC,
                created_at: '2024-01-01T00:00:00.000Z',
                updated_at: '2024-01-02T00:00:00.000Z'
            };

            const user = mapRowToUser.call(userRepository, mockUserRow);

            expect(user).toEqual({
                id: mockUserRow.id,
                email: mockUserRow.email,
                userLevel: UserLevel.BASIC,
                createdAt: new Date(mockUserRow.created_at),
                updatedAt: new Date(mockUserRow.updated_at)
            });
            expect(user.userLevel).toBe(UserLevel.BASIC);
            expect(user.createdAt).toBeInstanceOf(Date);
            expect(user.updatedAt).toBeInstanceOf(Date);
        });

        it('should handle different user levels when mapping', () => {
            const mapRowToUser = (UserRepositoryAdapter.prototype as any).mapRowToUser;
            const userRepository = new UserRepositoryAdapter();

            const mockUserRow = {
                id: 'test-user-id',
                email: 'test@example.com',
                user_level: UserLevel.VERIFIED,
                created_at: '2024-01-01T00:00:00.000Z',
                updated_at: '2024-01-02T00:00:00.000Z'
            };

            const user = mapRowToUser.call(userRepository, mockUserRow);

            expect(user.userLevel).toBe(UserLevel.VERIFIED);
        });
    });

    describe('getWalletAddress', () => {
        it('should get user wallet address from credentials', async () => {
            const mockUserId = 'test-user-id';
            const mockWalletAddress = '0x1234567890123456789012345678901234567890';

            (query as jest.Mock).mockResolvedValue({
                rows: [{ wallet_address: mockWalletAddress }]
            });

            const walletAddress = await userRepository.getWalletAddress(mockUserId);

            expect(query).toHaveBeenCalledWith(
                "SELECT wallet_address FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [mockUserId]
            );
            expect(walletAddress).toBe(mockWalletAddress);
        });

        it('should return null when no wallet address found', async () => {
            const mockUserId = 'test-user-id';

            (query as jest.Mock).mockResolvedValue({
                rows: []
            });

            const walletAddress = await userRepository.getWalletAddress(mockUserId);

            expect(walletAddress).toBeNull();
        });

        it('should throw error when getWalletAddress fails', async () => {
            const mockUserId = 'test-user-id';
            const mockError = new Error('Database error');

            (query as jest.Mock).mockRejectedValue(mockError);

            await expect(userRepository.getWalletAddress(mockUserId)).rejects.toThrow(
                'Failed to get wallet address: Database error'
            );
        });
    });
});
