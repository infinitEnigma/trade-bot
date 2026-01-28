/** @format */

import { Response, NextFunction } from "express";
import { UserRole } from "../../../../shared/src";
import { AuthenticatedRequest } from "./auth";

export function requireRole(role: UserRole) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const userRoles = req.user?.roles || [];
        const success = false;

        if (!userRoles.includes(role)) {
            return res.status(403).json({
                success,
                error: `${role} role required for this action`,
                requiredRole: role,
                userRoles
            });
        }
        next();
    };
}

export function requireAnyRole(...roles: UserRole[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const userRoles = req.user?.roles || [];
        const success = false;

        const hasRequiredRole = roles.some(role => userRoles.includes(role));

        if (!hasRequiredRole) {
            return res.status(403).json({
                success,
                error: `One of the following roles required: ${roles.join(', ')}`,
                requiredRoles: roles,
                userRoles
            });
        }
        next();
    };
}

export function hasRole(userRoles: string[], role: UserRole): boolean {
    return userRoles.includes(role);
}

export function hasAnyRole(userRoles: string[], ...roles: UserRole[]): boolean {
    return roles.some(role => userRoles.includes(role));
}
