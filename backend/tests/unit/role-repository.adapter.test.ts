/** @format */

import { RoleRepositoryAdapter, roleRepositoryAdapter } from '../../src/infrastructure/adapters/repositories/role-repository.adapter';
import { UserRole, RoleDetails, UserRoleAssignment } from '@trade-bot/shared';
import { databaseLogger as logger } from '../../src/core/logging/context-aware-logger.service';
import { query } from '../../src/database/pool';

// Mock dependencies
jest.mock('../../src/core/logging/context-aware-logger.service', () => ({
    databaseLogger: {
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../../src/database/pool', () => ({
    query: jest.fn()
}));

describe('RoleRepositoryAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should create a RoleRepositoryAdapter instance', () => {
            const adapter = new RoleRepositoryAdapter();
            expect(adapter).toBeInstanceOf(RoleRepositoryAdapter);
        });

        it('should export a singleton instance', () => {
            expect(roleRepositoryAdapter).toBeInstanceOf(RoleRepositoryAdapter);
        });
    });

    describe('assignRole', () => {
        it('should assign a role to a user', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;
            const grantedBy = 'granter-id';
            const criteria = { test: 'criteria' };

            await adapter.assignRole(userId, role, grantedBy, criteria);

            expect(query).toHaveBeenCalledTimes(2);
            expect(query).toHaveBeenCalledWith(
                "SELECT id FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );
            expect(query).toHaveBeenCalledWith(
                "INSERT INTO user_roles (user_id, role, granted_by, criteria_met) VALUES ($1, $2, $3, $4)",
                [userId, role, grantedBy, JSON.stringify(criteria)]
            );
            expect(logger.info).toHaveBeenCalled();
        });

        it('should not assign role if user already has it', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [{ id: '1' }] });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;
            const grantedBy = 'granter-id';

            await adapter.assignRole(userId, role, grantedBy);

            expect(query).toHaveBeenCalledTimes(1);
            expect(query).toHaveBeenCalledWith(
                "SELECT id FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );
            expect(logger.debug).toHaveBeenCalledWith("User already has role", expect.any(Object));
        });

        it('should log error and rethrow when query fails', async () => {
            const testError = new Error('Database connection error');
            (query as jest.Mock).mockRejectedValue(testError);
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;
            const grantedBy = 'granter-id';

            await expect(adapter.assignRole(userId, role, grantedBy)).rejects.toThrow(testError);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('removeRole', () => {
        it('should remove role from user', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const result = await adapter.removeRole(userId, role);

            expect(result).toBe(true);
            expect(query).toHaveBeenCalledWith(
                "DELETE FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );
            expect(logger.info).toHaveBeenCalled();
        });

        it('should return false if role not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const result = await adapter.removeRole(userId, role);

            expect(result).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith("Role not found for user", expect.any(Object));
        });

        it('should log error and rethrow when query fails', async () => {
            const testError = new Error('Database connection error');
            (query as jest.Mock).mockRejectedValue(testError);
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            await expect(adapter.removeRole(userId, role)).rejects.toThrow(testError);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('hasRole', () => {
        it('should return true if user has role', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [{ 1: 1 }] });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const result = await adapter.hasRole(userId, role);

            expect(result).toBe(true);
            expect(query).toHaveBeenCalledWith(
                "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2 LIMIT 1",
                [userId, role]
            );
        });

        it('should return false if user does not have role', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const result = await adapter.hasRole(userId, role);

            expect(result).toBe(false);
        });

        it('should log error and return false when query fails', async () => {
            const testError = new Error('Database connection error');
            (query as jest.Mock).mockRejectedValue(testError);
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const result = await adapter.hasRole(userId, role);

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('getUserRoles', () => {
        it('should return user roles', async () => {
            (query as jest.Mock).mockResolvedValue({
                rows: [
                    { role: UserRole.QUALIFIED_ALPHA }
                ]
            });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';

            const roles = await adapter.getUserRoles(userId);

            expect(roles).toEqual([UserRole.QUALIFIED_ALPHA]);
            expect(query).toHaveBeenCalledWith(
                "SELECT role FROM user_roles WHERE user_id = $1",
                [userId]
            );
        });

        it('should return empty array if user has no roles', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';

            const roles = await adapter.getUserRoles(userId);

            expect(roles).toEqual([]);
        });

        it('should log error and return empty array when query fails', async () => {
            const testError = new Error('Database connection error');
            (query as jest.Mock).mockRejectedValue(testError);
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';

            const roles = await adapter.getUserRoles(userId);

            expect(roles).toEqual([]);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('getRoleDetails', () => {
        it('should return role details for existing role', async () => {
            const grantedAt = new Date('2024-01-01');
            const grantedBy = 'granter-id';
            const criteriaMet = { test: 'criteria' };
            (query as jest.Mock).mockResolvedValue({
                rows: [{
                    granted_at: grantedAt,
                    granted_by: grantedBy,
                    criteria_met: JSON.stringify(criteriaMet)
                }]
            });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const details = await adapter.getRoleDetails(userId, role);

            expect(details).toBeInstanceOf(RoleDetails);
            expect(details).not.toBeNull();
            expect(details!.grantedAt).toEqual(grantedAt);
            expect(details!.grantedBy).toEqual(grantedBy);
            expect(details!.criteriaMet).toEqual(criteriaMet);
            expect(query).toHaveBeenCalledWith(
                "SELECT granted_at, granted_by, criteria_met FROM user_roles WHERE user_id = $1 AND role = $2",
                [userId, role]
            );
        });

        it('should return null if role details not found', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const details = await adapter.getRoleDetails(userId, role);

            expect(details).toBeNull();
        });

        it('should handle invalid JSON in criteria_met', async () => {
            (query as jest.Mock).mockResolvedValue({
                rows: [{
                    granted_at: new Date(),
                    granted_by: 'granter-id',
                    criteria_met: 'invalid-json'
                }]
            });
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const details = await adapter.getRoleDetails(userId, role);

            expect(details).toBeInstanceOf(RoleDetails);
            expect(details!.criteriaMet).toEqual('invalid-json');
        });

        it('should log error and return null when query fails', async () => {
            const testError = new Error('Database connection error');
            (query as jest.Mock).mockRejectedValue(testError);
            const adapter = new RoleRepositoryAdapter();
            const userId = 'test-user-id';
            const role = UserRole.QUALIFIED_ALPHA;

            const details = await adapter.getRoleDetails(userId, role);

            expect(details).toBeNull();
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('getUsersWithRole', () => {
        it('should return users with specific role', async () => {
            const grantedAt = new Date('2024-01-01');
            const grantedBy = 'granter-id';
            const criteriaMet = { test: 'criteria' };
            (query as jest.Mock).mockResolvedValue({
                rows: [{
                    user_id: 'user1',
                    granted_at: grantedAt,
                    granted_by: grantedBy,
                    criteria_met: JSON.stringify(criteriaMet)
                }]
            });
            const adapter = new RoleRepositoryAdapter();
            const role = UserRole.QUALIFIED_ALPHA;

            const users = await adapter.getUsersWithRole(role);

            expect(users).toHaveLength(1);
            expect(users[0]).toBeInstanceOf(UserRoleAssignment);
            expect(users[0].userId).toEqual('user1');
            expect(users[0].role).toEqual(role);
            expect(users[0].grantedAt).toEqual(grantedAt);
            expect(users[0].grantedBy).toEqual(grantedBy);
            expect(users[0].criteriaMet).toEqual(criteriaMet);
            expect(query).toHaveBeenCalledWith(
                "SELECT user_id, granted_at, granted_by, criteria_met FROM user_roles WHERE role = $1 ORDER BY granted_at DESC",
                [role]
            );
        });

        it('should return empty array if no users have role', async () => {
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            const adapter = new RoleRepositoryAdapter();
            const role = UserRole.QUALIFIED_ALPHA;

            const users = await adapter.getUsersWithRole(role);

            expect(users).toEqual([]);
        });

        it('should handle invalid JSON in criteria_met for user roles', async () => {
            (query as jest.Mock).mockResolvedValue({
                rows: [{
                    user_id: 'user1',
                    granted_at: new Date(),
                    granted_by: 'granter-id',
                    criteria_met: 'invalid-json'
                }]
            });
            const adapter = new RoleRepositoryAdapter();
            const role = UserRole.QUALIFIED_ALPHA;

            const users = await adapter.getUsersWithRole(role);

            expect(users).toHaveLength(1);
            expect(users[0].criteriaMet).toEqual('invalid-json');
        });

        it('should log error and return empty array when query fails', async () => {
            const testError = new Error('Database connection error');
            (query as jest.Mock).mockRejectedValue(testError);
            const adapter = new RoleRepositoryAdapter();
            const role = UserRole.QUALIFIED_ALPHA;

            const users = await adapter.getUsersWithRole(role);

            expect(users).toEqual([]);
            expect(logger.error).toHaveBeenCalled();
        });
    });
});