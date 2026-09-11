/** @format */

import { RoleQualificationService, createRoleQualificationService, RoleQualificationServiceDependencies } from '../../src/core/auth/role-qualification.service';
import { UserRole, UserLevel } from '@trade-bot/shared';

describe('RoleQualificationService', () => {
    // Save original environment variables for cleanup
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Set required environment variables for tests
        process.env.ADMIN_CONTRACT_ADDRESS = '0x5a30c392714a9a9a8177c7998d9d59c3dd120917';
        process.env.ADMIN_TOKEN_ID = '1695';
        process.env.ETHERSCAN_API_KEY = 'test-api-key';
        process.env.ADMIN_CHAIN_ID = '8094';
    });

    afterEach(() => {
        // Restore original environment variables
        process.env = { ...originalEnv };
        // Clear fetch mock only if it was mocked
        if (global.fetch && (global.fetch as any).mockRestore) {
            (global.fetch as jest.Mock).mockRestore();
        }
    });

    // Create mock dependencies for the RoleQualificationService
    const createMockDependencies = (): RoleQualificationServiceDependencies => {
        return {
            userRepository: {
                findById: jest.fn(),
                findByEmail: jest.fn(),
                findByEmailWithPassword: jest.fn(),
                create: jest.fn(),
                updateUserLevel: jest.fn(),
                updateProfile: jest.fn(),
                getAuthenticatedUserData: jest.fn(),
                getWalletAddress: jest.fn(),
            },
            cache: {
                get: jest.fn(),
                setex: jest.fn(),
                delete: jest.fn(),
                set: jest.fn(),
                exists: jest.fn(),
                mget: jest.fn(),
                mset: jest.fn(),
                atomicConditionalUpdate: jest.fn(),
            },
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                child: jest.fn(),
            },
        };
    };

    describe('Constructor', () => {
        it('should create an instance of RoleQualificationService', () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);
            expect(roleQualificationService).toBeInstanceOf(RoleQualificationService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const roleQualificationService = createRoleQualificationService(deps);
            expect(roleQualificationService).toBeInstanceOf(RoleQualificationService);
        });
    });

    describe('Qualification Check', () => {
        it('should return not qualified if user not found', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue(null);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result).toEqual({
                qualified: false,
                reason: 'User not found'
            });
            expect(deps.userRepository.findById).toHaveBeenCalledWith(testUserId);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should return not qualified for unknown role', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            const unknownRole = 'UNKNOWN_ROLE' as UserRole;
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date()
            });

            const result = await roleQualificationService.checkQualification(testUserId, unknownRole);

            expect(result).toEqual({
                qualified: false,
                reason: `Unknown role: ${unknownRole}`
            });
        });

        it('should handle qualification check errors', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            const testError = new Error('Database error');
            (deps.userRepository.findById as jest.Mock).mockRejectedValue(testError);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result).toEqual({
                qualified: false,
                reason: 'Qualification check failed'
            });
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Alpha Role Qualification', () => {
        it('should not qualify if user level is not verified', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.BASIC,
                createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days old
            });

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('User must be verified');
            expect(result.criteria).toEqual(expect.objectContaining({
                currentLevel: UserLevel.BASIC,
                requiredLevel: UserLevel.VERIFIED
            }));
        });

        it('should not qualify if user has no Kodiak credentials', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days old
            });

            // Mock checkUserHasKodiakCredentials to return false
            const checkUserHasKodiakCredentialsSpy = jest.spyOn(
                RoleQualificationService.prototype as any,
                'checkUserHasKodiakCredentials'
            ).mockResolvedValue(false);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('User must have Kodiak credentials');
            expect(result.criteria).toEqual({ hasKodiakCredentials: false });
            checkUserHasKodiakCredentialsSpy.mockRestore();
        });

        it('should not qualify if account is less than 30 days old', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000) // 29 days old
            });

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('Account must be at least 30 days old');
            expect(result.criteria).toEqual(expect.objectContaining({
                accountAgeDays: 29,
                minimumRequiredDays: 30
            }));
        });

        it('should not qualify if user has no completed trades', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days old
            });

            // Mock checkUserHasCompletedTrades to return false
            const checkUserHasCompletedTradesSpy = jest.spyOn(
                RoleQualificationService.prototype as any,
                'checkUserHasCompletedTrades'
            ).mockResolvedValue(false);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('User must have completed trades');
            expect(result.criteria).toEqual({ hasCompletedTrades: false });
            checkUserHasCompletedTradesSpy.mockRestore();
        });

        it('should qualify for alpha role when all criteria are met', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days old
            });

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(result.qualified).toBe(true);
            expect(result.criteria).toEqual(expect.objectContaining({
                userLevel: UserLevel.VERIFIED,
                hasKodiakCredentials: true,
                hasCompletedTrades: true
            }));
            expect((result.criteria as any).accountAgeDays).toBeGreaterThanOrEqual(30);
        });
    });

    describe('Qualification Criteria', () => {
        it('should get qualification criteria for alpha role', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const criteria = await roleQualificationService.getQualificationCriteria(UserRole.QUALIFIED_ALPHA);

            expect(criteria).toEqual({
                userLevel: UserLevel.VERIFIED,
                hasKodiakCredentials: true,
                minimumAccountAge: 30,
                hasCompletedTrades: true
            });
        });

        it('should return null for unknown role criteria', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const unknownRole = 'UNKNOWN_ROLE' as UserRole;
            const criteria = await roleQualificationService.getQualificationCriteria(unknownRole);

            expect(criteria).toBeNull();
        });

    });

    describe('Criteria Validation', () => {
        it('should validate alpha role criteria successfully', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const validCriteria = {
                userLevel: UserLevel.VERIFIED,
                hasKodiakCredentials: true,
                minimumAccountAge: 30,
                hasCompletedTrades: true
            };

            const result = roleQualificationService.validateCriteria(validCriteria, UserRole.QUALIFIED_ALPHA);

            expect(result).toBe(true);
        });

        it('should invalidate criteria with missing properties', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const invalidCriteria = {
                userLevel: UserLevel.VERIFIED,
                hasKodiakCredentials: true
            };

            const result = roleQualificationService.validateCriteria(invalidCriteria, UserRole.QUALIFIED_ALPHA);

            expect(result).toBe(false);
        });

        it('should invalidate criteria with incorrect types', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const invalidCriteria = {
                userLevel: 'VERIFIED', // Should be enum
                hasKodiakCredentials: 'true', // Should be boolean
                minimumAccountAge: '30', // Should be number
                hasCompletedTrades: 'true' // Should be boolean
            };

            const result = roleQualificationService.validateCriteria(invalidCriteria, UserRole.QUALIFIED_ALPHA);

            expect(result).toBe(false);
        });

        it('should invalidate criteria for unknown role', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const validCriteria = {
                userLevel: UserLevel.VERIFIED,
                hasKodiakCredentials: true,
                minimumAccountAge: 30,
                hasCompletedTrades: true
            };
            const unknownRole = 'UNKNOWN_ROLE' as UserRole;

            const result = roleQualificationService.validateCriteria(validCriteria, unknownRole);

            expect(result).toBe(false);
        });

        it('should handle validation errors', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testError = new Error('Validation error');
            // Mocking internal implementation to throw error
            jest.spyOn(RoleQualificationService.prototype as any, 'validateAlphaCriteria')
                .mockImplementation(() => { throw testError; });

            const validCriteria = {
                userLevel: UserLevel.VERIFIED,
                hasKodiakCredentials: true,
                minimumAccountAge: 30,
                hasCompletedTrades: true
            };

            const result = roleQualificationService.validateCriteria(validCriteria, UserRole.QUALIFIED_ALPHA);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('System Admin Role Qualification', () => {
        it('should not qualify if user level is not verified', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.BASIC,
                createdAt: new Date()
            });

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.SYSTEM_ADMIN);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('User must be verified');
            expect(result.criteria).toEqual(expect.objectContaining({
                currentLevel: UserLevel.BASIC,
                requiredLevel: UserLevel.VERIFIED
            }));
        });

        it('should not qualify if user has no wallet address', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date()
            });
            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue(null);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.SYSTEM_ADMIN);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('User does not have admin token');
            expect(result.criteria).toEqual(expect.objectContaining({
                hasAdminToken: false
            }));
        });

        it('should not qualify if user does not have admin token', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date()
            });
            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue('0x1234...');

            // Mock checkWalletForAdminToken to return false
            const checkWalletForAdminTokenSpy = jest.spyOn(
                RoleQualificationService.prototype as any,
                'checkWalletForAdminToken'
            ).mockResolvedValue(false);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.SYSTEM_ADMIN);

            expect(result.qualified).toBe(false);
            expect(result.reason).toEqual('User does not have admin token');
            expect(result.criteria).toEqual(expect.objectContaining({
                hasAdminToken: false
            }));
            checkWalletForAdminTokenSpy.mockRestore();
        });

        it('should qualify for system admin role when all criteria are met', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const testUserId = 'user-123';
            (deps.userRepository.findById as jest.Mock).mockResolvedValue({
                id: testUserId,
                userLevel: UserLevel.VERIFIED,
                createdAt: new Date()
            });
            (deps.userRepository.getWalletAddress as jest.Mock).mockResolvedValue('0x1234...');

            // Mock checkWalletForAdminToken to return true
            const checkWalletForAdminTokenSpy = jest.spyOn(
                RoleQualificationService.prototype as any,
                'checkWalletForAdminToken'
            ).mockResolvedValue(true);

            const result = await roleQualificationService.checkQualification(testUserId, UserRole.SYSTEM_ADMIN);

            expect(result.qualified).toBe(true);
            expect(result.criteria).toEqual(expect.objectContaining({
                userLevel: UserLevel.VERIFIED,
                hasAdminToken: true
            }));
            checkWalletForAdminTokenSpy.mockRestore();
        });
    });

    describe('System Admin Criteria', () => {
        it('should get qualification criteria for system admin role', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const criteria = await roleQualificationService.getQualificationCriteria(UserRole.SYSTEM_ADMIN);

            expect(criteria).toEqual(expect.objectContaining({
                userLevel: UserLevel.VERIFIED,
                hasAdminToken: true
            }));
            expect(typeof (criteria as any)?.contractAddress).toBe('string');
            expect(typeof (criteria as any)?.tokenId).toBe('string');
        });

        it('should validate system admin role criteria successfully', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const validCriteria = {
                userLevel: UserLevel.VERIFIED,
                hasAdminToken: true,
                contractAddress: '0x1234...',
                tokenId: '123'
            };

            const result = roleQualificationService.validateCriteria(validCriteria, UserRole.SYSTEM_ADMIN);

            expect(result).toBe(true);
        });

        it('should invalidate system admin criteria with missing properties', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const invalidCriteria = {
                userLevel: UserLevel.VERIFIED,
                hasAdminToken: true
            };

            const result = roleQualificationService.validateCriteria(invalidCriteria, UserRole.SYSTEM_ADMIN);

            expect(result).toBe(false);
        });

        it('should invalidate system admin criteria with incorrect types', async () => {
            const deps = createMockDependencies();
            const roleQualificationService = new RoleQualificationService(deps);

            const invalidCriteria = {
                userLevel: 'VERIFIED', // Should be enum
                hasAdminToken: 'true', // Should be boolean
                contractAddress: 123, // Should be string
                tokenId: true // Should be string or number
            };

            const result = roleQualificationService.validateCriteria(invalidCriteria, UserRole.SYSTEM_ADMIN);

            expect(result).toBe(false);
        });
    });

    describe('Internal Methods', () => {

        describe('getAccountAgeDays', () => {
            it('should calculate account age correctly', async () => {
                const deps = createMockDependencies();
                const roleQualificationService = new RoleQualificationService(deps);

                const creationDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
                const age = (roleQualificationService as any).getAccountAgeDays(creationDate);

                expect(age).toEqual(30);
            });

            it('should handle very old accounts', async () => {
                const deps = createMockDependencies();
                const roleQualificationService = new RoleQualificationService(deps);

                const creationDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
                const age = (roleQualificationService as any).getAccountAgeDays(creationDate);

                expect(age).toEqual(365);
            });
        });

        describe('checkWalletForAdminToken', () => {
            it('should return false if API response is invalid', async () => {
                const deps = createMockDependencies();
                const roleQualificationService = new RoleQualificationService(deps);

                // Mock fetch to return invalid JSON
                global.fetch = jest.fn().mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve({ status: '0', message: 'Error' })
                });

                const result = await (roleQualificationService as any).checkWalletForAdminToken(
                    '0x1234...',
                    '0x5678...',
                    '123',
                    'test-api-key',
                    '80094'
                );

                expect(result).toBe(false);
                expect(global.fetch).toHaveBeenCalled();
            });

            it('should return false if API request fails', async () => {
                const deps = createMockDependencies();
                const roleQualificationService = new RoleQualificationService(deps);

                // Mock fetch to reject
                global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

                const result = await (roleQualificationService as any).checkWalletForAdminToken(
                    '0x1234...',
                    '0x5678...',
                    '123',
                    'test-api-key',
                    '80094'
                );

                expect(result).toBe(false);
                expect(global.fetch).toHaveBeenCalled();
            });
        });
    });
});
