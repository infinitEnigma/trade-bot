/** @format */

import { RoleQualificationService, createRoleQualificationService, RoleQualificationServiceDependencies } from '../../src/core/auth/role-qualification.service';
import { UserRole, UserLevel } from '@trade-bot/shared';

describe('RoleQualificationService', () => {
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
    });
});