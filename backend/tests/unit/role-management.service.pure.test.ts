/** @format */

import { RoleManagementService, createRoleManagementService, RoleManagementServiceDependencies } from '../../src/core/auth/role-management.service.pure';
import { UserRole } from '@trade-bot/shared';

describe('RoleManagementService', () => {
    // Create mock dependencies for the RoleManagementService
    const createMockDependencies = (): RoleManagementServiceDependencies => {
        return {
            roleRepository: {
                hasRole: jest.fn(),
                assignRole: jest.fn(),
                removeRole: jest.fn(),
                getUserRoles: jest.fn(),
                getRoleDetails: jest.fn(),
                getUsersWithRole: jest.fn(),
            },
            auditLogger: {
                logEvent: jest.fn(),
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
            qualificationService: {
                checkQualification: jest.fn(),
                getQualificationCriteria: jest.fn(),
                validateCriteria: jest.fn(),
            },
        };
    };

    describe('Constructor', () => {
        it('should create an instance of RoleManagementService', () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);
            expect(roleManagementService).toBeInstanceOf(RoleManagementService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const roleManagementService = createRoleManagementService(deps);
            expect(roleManagementService).toBeInstanceOf(RoleManagementService);
        });
    });

    describe('Role Assignment', () => {
        it('should successfully assign a role to a user', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;
            const testGrantedBy = 'admin-456';

            (deps.roleRepository.hasRole as jest.Mock).mockResolvedValue(false);
            (deps.roleRepository.assignRole as jest.Mock).mockResolvedValue(undefined);

            await roleManagementService.assignRole(testUserId, testRole, testGrantedBy);

            expect(deps.roleRepository.hasRole).toHaveBeenCalledWith(testUserId, testRole);
            expect(deps.roleRepository.assignRole).toHaveBeenCalledWith(testUserId, testRole, testGrantedBy, undefined);
            expect(deps.auditLogger.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'ROLE_ASSIGNED' })
            );
            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should not assign role if user already has it', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;
            const testGrantedBy = 'admin-456';

            (deps.roleRepository.hasRole as jest.Mock).mockResolvedValue(true);

            await roleManagementService.assignRole(testUserId, testRole, testGrantedBy);

            expect(deps.roleRepository.hasRole).toHaveBeenCalledWith(testUserId, testRole);
            expect(deps.roleRepository.assignRole).not.toHaveBeenCalled();
            expect(deps.auditLogger.logEvent).not.toHaveBeenCalled();
            expect(deps.cache.delete).not.toHaveBeenCalled();
            expect(deps.logger.debug).toHaveBeenCalledWith('User already has role', expect.any(Object));
        });

        it('should handle role assignment errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;
            const testGrantedBy = 'admin-456';

            (deps.roleRepository.hasRole as jest.Mock).mockRejectedValue(new Error('Database error'));

            await expect(roleManagementService.assignRole(testUserId, testRole, testGrantedBy)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Role Removal', () => {
        it('should successfully remove a role from a user', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.removeRole as jest.Mock).mockResolvedValue(true);

            await roleManagementService.removeRole(testUserId, testRole);

            expect(deps.roleRepository.removeRole).toHaveBeenCalledWith(testUserId, testRole);
            expect(deps.auditLogger.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'ROLE_REMOVED' })
            );
            expect(deps.cache.delete).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should not log event if role not found for user', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.removeRole as jest.Mock).mockResolvedValue(false);

            await roleManagementService.removeRole(testUserId, testRole);

            expect(deps.roleRepository.removeRole).toHaveBeenCalledWith(testUserId, testRole);
            expect(deps.auditLogger.logEvent).not.toHaveBeenCalled();
            expect(deps.cache.delete).not.toHaveBeenCalled();
            expect(deps.logger.debug).toHaveBeenCalledWith('Role not found for user', expect.any(Object));
        });

        it('should handle role removal errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.removeRole as jest.Mock).mockRejectedValue(new Error('Database error'));

            await expect(roleManagementService.removeRole(testUserId, testRole)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Role Check', () => {
        it('should return true when user has specified role', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.hasRole as jest.Mock).mockResolvedValue(true);

            const result = await roleManagementService.hasRole(testUserId, testRole);

            expect(result).toBe(true);
            expect(deps.roleRepository.hasRole).toHaveBeenCalledWith(testUserId, testRole);
        });

        it('should return false when user does not have specified role', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.hasRole as jest.Mock).mockResolvedValue(false);

            const result = await roleManagementService.hasRole(testUserId, testRole);

            expect(result).toBe(false);
            expect(deps.roleRepository.hasRole).toHaveBeenCalledWith(testUserId, testRole);
        });

        it('should handle role check errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.hasRole as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await roleManagementService.hasRole(testUserId, testRole);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('User Roles', () => {
        it('should get all roles for a user', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRoles = [UserRole.QUALIFIED_ALPHA];

            (deps.roleRepository.getUserRoles as jest.Mock).mockResolvedValue(testRoles);

            const result = await roleManagementService.getUserRoles(testUserId);

            expect(result).toEqual(testRoles);
            expect(deps.roleRepository.getUserRoles).toHaveBeenCalledWith(testUserId);
        });

        it('should handle getting user roles errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(new Error('Database error'));

            await expect(roleManagementService.getUserRoles(testUserId)).rejects.toThrow();
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Role Details', () => {
        it('should get role details for a user', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;
            const testRoleDetails = {
                role: testRole,
                grantedBy: 'admin-456',
                grantedAt: new Date('2023-01-01'),
            };

            (deps.roleRepository.getRoleDetails as jest.Mock).mockResolvedValue(testRoleDetails);

            const result = await roleManagementService.getRoleDetails(testUserId, testRole);

            expect(result).toEqual(testRoleDetails);
            expect(deps.roleRepository.getRoleDetails).toHaveBeenCalledWith(testUserId, testRole);
        });

        it('should return null when role details not found', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.getRoleDetails as jest.Mock).mockResolvedValue(null);

            const result = await roleManagementService.getRoleDetails(testUserId, testRole);

            expect(result).toBeNull();
        });

        it('should handle getting role details errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.getRoleDetails as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await roleManagementService.getRoleDetails(testUserId, testRole);

            expect(result).toBeNull();
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Users with Role', () => {
        it('should get all users with specific role', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testRole = UserRole.QUALIFIED_ALPHA;
            const testUsers = [
                { userId: 'user-123', role: testRole },
                { userId: 'user-456', role: testRole },
            ];

            (deps.roleRepository.getUsersWithRole as jest.Mock).mockResolvedValue(testUsers);

            const result = await roleManagementService.getUsersWithRole(testRole);

            expect(result).toEqual(testUsers);
            expect(deps.roleRepository.getUsersWithRole).toHaveBeenCalledWith(testRole);
        });

        it('should handle getting users with role errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.getUsersWithRole as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await roleManagementService.getUsersWithRole(testRole);

            expect(result).toEqual([]);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Role Revalidation', () => {
        it('should revalidate role successfully when qualification passes', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.qualificationService?.checkQualification as jest.Mock).mockResolvedValue({ qualified: true });

            const result = await roleManagementService.revalidateRole(testUserId, testRole);

            expect(result).toBe(true);
            expect(deps.qualificationService?.checkQualification).toHaveBeenCalledWith(testUserId, testRole);
        });

        it('should remove role when revalidation fails', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.qualificationService?.checkQualification as jest.Mock).mockResolvedValue({
                qualified: false,
                reason: 'Insufficient balance',
                criteria: {}
            });
            (deps.roleRepository.removeRole as jest.Mock).mockResolvedValue(true);

            const result = await roleManagementService.revalidateRole(testUserId, testRole);

            expect(result).toBe(false);
            expect(deps.roleRepository.removeRole).toHaveBeenCalledWith(testUserId, testRole);
            expect(deps.auditLogger.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'ROLE_REVALIDATION_FAILED' })
            );
        });

        it('should assume valid if no qualification service available', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService({
                ...deps,
                qualificationService: undefined,
            });

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            const result = await roleManagementService.revalidateRole(testUserId, testRole);

            expect(result).toBe(true);
            expect(deps.qualificationService?.checkQualification).not.toHaveBeenCalled();
        });

        it('should handle revalidation errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRole = UserRole.QUALIFIED_ALPHA;

            (deps.qualificationService?.checkQualification as jest.Mock).mockRejectedValue(new Error('Validation error'));

            const result = await roleManagementService.revalidateRole(testUserId, testRole);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Permission Check', () => {
        it('should return true when user has permission', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRequiredRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.getUserRoles as jest.Mock).mockResolvedValue([UserRole.QUALIFIED_ALPHA]);

            const result = await roleManagementService.hasPermission(testUserId, testRequiredRole);

            expect(result).toBe(true);
            expect(deps.roleRepository.getUserRoles).toHaveBeenCalledWith(testUserId);
        });

        it('should return false when user does not have permission', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRequiredRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.getUserRoles as jest.Mock).mockResolvedValue([]);

            const result = await roleManagementService.hasPermission(testUserId, testRequiredRole);

            expect(result).toBe(false);
            expect(deps.roleRepository.getUserRoles).toHaveBeenCalledWith(testUserId);
        });

        it('should handle permission check errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRequiredRole = UserRole.QUALIFIED_ALPHA;

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await roleManagementService.hasPermission(testUserId, testRequiredRole);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Role Level Management', () => {
        it('should get user highest role level', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';

            (deps.roleRepository.getUserRoles as jest.Mock).mockResolvedValue([UserRole.QUALIFIED_ALPHA]);

            const result = await roleManagementService.getUserHighestRoleLevel(testUserId);

            expect(result).toBeGreaterThan(0);
            expect(deps.roleRepository.getUserRoles).toHaveBeenCalledWith(testUserId);
        });

        it('should handle getting highest role level errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await roleManagementService.getUserHighestRoleLevel(testUserId);

            expect(result).toBe(0);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Admin Check', () => {
        it('should return true when user has admin role', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';

            (deps.roleRepository.getUserRoles as jest.Mock).mockResolvedValue([UserRole.QUALIFIED_ALPHA]);

            const result = await roleManagementService.isAdminUser(testUserId);

            expect(result).toBe(true);
            expect(deps.roleRepository.getUserRoles).toHaveBeenCalledWith(testUserId);
        });

        it('should return false when user does not have admin role', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';

            (deps.roleRepository.getUserRoles as jest.Mock).mockResolvedValue([]);

            const result = await roleManagementService.isAdminUser(testUserId);

            expect(result).toBe(false);
            expect(deps.roleRepository.getUserRoles).toHaveBeenCalledWith(testUserId);
        });

        it('should handle admin check errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await roleManagementService.isAdminUser(testUserId);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        it('should handle hasPermission method errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testRequiredRole = UserRole.QUALIFIED_ALPHA;
            const testError = new Error('Database error');

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(testError);

            const result = await roleManagementService.hasPermission(testUserId, testRequiredRole);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalledWith(
                'Failed to check user permissions',
                expect.any(Object)
            );
        });

        it('should handle getUserHighestRoleLevel method errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testError = new Error('Database error');

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(testError);

            const result = await roleManagementService.getUserHighestRoleLevel(testUserId);

            expect(result).toBe(0);
            expect(deps.logger.error).toHaveBeenCalledWith(
                "Failed to get user's highest role level",
                expect.any(Object)
            );
        });

        it('should handle isAdminUser method errors', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const testError = new Error('Database error');

            (deps.roleRepository.getUserRoles as jest.Mock).mockRejectedValue(testError);

            const result = await roleManagementService.isAdminUser(testUserId);

            expect(result).toBe(false);
            expect(deps.logger.error).toHaveBeenCalledWith(
                'Failed to check if user is admin',
                expect.any(Object)
            );
        });
    });

    describe('Cache Invalidation', () => {
        it('should handle cache deletion failures', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const cacheError = new Error('Cache connection failed');

            (deps.cache.delete as jest.Mock).mockRejectedValue(cacheError);
            (deps.roleRepository.hasRole as jest.Mock).mockResolvedValue(false);
            (deps.roleRepository.assignRole as jest.Mock).mockResolvedValue(undefined);

            await roleManagementService.assignRole(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(deps.logger.warn).toHaveBeenCalled();
        });

        it('should log warning for each failed cache key deletion', async () => {
            const deps = createMockDependencies();
            const roleManagementService = new RoleManagementService(deps);

            const testUserId = 'user-123';
            const cacheError = new Error('Cache connection failed');

            (deps.cache.delete as jest.Mock).mockRejectedValue(cacheError);
            (deps.roleRepository.hasRole as jest.Mock).mockResolvedValue(false);
            (deps.roleRepository.assignRole as jest.Mock).mockResolvedValue(undefined);

            await roleManagementService.assignRole(testUserId, UserRole.QUALIFIED_ALPHA);

            expect(deps.cache.delete).toHaveBeenCalledTimes(3);
            expect(deps.logger.warn).toHaveBeenCalledTimes(3);
        });
    });
});
