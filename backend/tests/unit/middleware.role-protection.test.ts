/** @format */

import { requireRole, requireAnyRole, hasRole, hasAnyRole } from "../../src/interfaces/middleware/role-protection";
import { UserRole } from "@trade-bot/shared";

describe("Role Protection Middleware", () => {
    describe("Utility Functions", () => {
        describe("hasRole", () => {
            it("should return true when user has the required role", () => {
                const userRoles: UserRole[] = [UserRole.QUALIFIED_ALPHA];
                const result = hasRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(true);
            });

            it("should return false when user does not have the required role", () => {
                const userRoles: UserRole[] = [];
                const result = hasRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(false);
            });

            it("should return false when user roles array is empty", () => {
                const userRoles: UserRole[] = [];
                const result = hasRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(false);
            });
        });

        describe("hasAnyRole", () => {
            it("should return true when user has one of the required roles", () => {
                const userRoles = [UserRole.QUALIFIED_ALPHA];
                const result = hasAnyRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(true);
            });

            it("should return true when user has multiple roles including the required one", () => {
                const userRoles: UserRole[] = [UserRole.QUALIFIED_ALPHA];
                const result = hasAnyRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(true);
            });

            it("should return false when user has none of the required roles", () => {
                const userRoles: UserRole[] = [];
                const result = hasAnyRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(false);
            });

            it("should return false when user roles array is empty", () => {
                const userRoles: UserRole[] = [];
                const result = hasAnyRole(userRoles, UserRole.QUALIFIED_ALPHA);
                expect(result).toBe(false);
            });
        });
    });

    describe("Middleware Functions", () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            // Create mock response object
            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            // Create mock next function
            next = jest.fn();
        });

        describe("requireRole", () => {
            it("should call next() when user has the required role", () => {
                req = {
                    user: {
                        roles: [UserRole.QUALIFIED_ALPHA]
                    }
                };

                const middleware = requireRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(next).toHaveBeenCalledTimes(1);
                expect(res.status).not.toHaveBeenCalled();
                expect(res.json).not.toHaveBeenCalled();
            });

            it("should return 403 when user does not have the required role", () => {
                req = {
                    user: {
                        roles: []
                    }
                };

                const middleware = requireRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: expect.stringContaining(UserRole.QUALIFIED_ALPHA),
                        requiredRole: UserRole.QUALIFIED_ALPHA,
                        userRoles: []
                    })
                );
                expect(next).not.toHaveBeenCalled();
            });

            it("should return 403 when user object is undefined", () => {
                req = {};

                const middleware = requireRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: expect.stringContaining(UserRole.QUALIFIED_ALPHA),
                        requiredRole: UserRole.QUALIFIED_ALPHA,
                        userRoles: []
                    })
                );
                expect(next).not.toHaveBeenCalled();
            });

            it("should return 403 when user roles are undefined", () => {
                req = {
                    user: {}
                };

                const middleware = requireRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: expect.stringContaining(UserRole.QUALIFIED_ALPHA),
                        requiredRole: UserRole.QUALIFIED_ALPHA,
                        userRoles: []
                    })
                );
                expect(next).not.toHaveBeenCalled();
            });
        });

        describe("requireAnyRole", () => {
            it("should call next() when user has one of the required roles", () => {
                req = {
                    user: {
                        roles: [UserRole.QUALIFIED_ALPHA]
                    }
                };

                const middleware = requireAnyRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(next).toHaveBeenCalledTimes(1);
                expect(res.status).not.toHaveBeenCalled();
                expect(res.json).not.toHaveBeenCalled();
            });

            it("should call next() when user has multiple roles including required one", () => {
                req = {
                    user: {
                        roles: [UserRole.QUALIFIED_ALPHA]
                    }
                };

                const middleware = requireAnyRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(next).toHaveBeenCalledTimes(1);
                expect(res.status).not.toHaveBeenCalled();
                expect(res.json).not.toHaveBeenCalled();
            });

            it("should return 403 when user has none of the required roles", () => {
                req = {
                    user: {
                        roles: []
                    }
                };

                const middleware = requireAnyRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: expect.stringContaining("One of the following roles required"),
                        requiredRoles: [UserRole.QUALIFIED_ALPHA],
                        userRoles: []
                    })
                );
                expect(next).not.toHaveBeenCalled();
            });

            it("should return 403 when user object is undefined", () => {
                req = {};

                const middleware = requireAnyRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: expect.stringContaining("One of the following roles required"),
                        requiredRoles: [UserRole.QUALIFIED_ALPHA],
                        userRoles: []
                    })
                );
                expect(next).not.toHaveBeenCalled();
            });

            it("should return 403 when user roles are undefined", () => {
                req = {
                    user: {}
                };

                const middleware = requireAnyRole(UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        error: expect.stringContaining("One of the following roles required"),
                        requiredRoles: [UserRole.QUALIFIED_ALPHA],
                        userRoles: []
                    })
                );
                expect(next).not.toHaveBeenCalled();
            });

            it("should handle multiple required roles", () => {
                req = {
                    user: {
                        roles: [UserRole.QUALIFIED_ALPHA]
                    }
                };

                const middleware = requireAnyRole(UserRole.QUALIFIED_ALPHA, UserRole.QUALIFIED_ALPHA);
                middleware(req, res, next);

                expect(next).toHaveBeenCalledTimes(1);
                expect(res.status).not.toHaveBeenCalled();
                expect(res.json).not.toHaveBeenCalled();
            });
        });
    });
});