/** @format */

import { Response, NextFunction } from "express";
import { UserRole } from "@trade-bot/shared";
import { AuthenticatedRequest } from "./auth";

export function requireRole(role: UserRole) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const userRoles = req.user!.roles || [];

        if (!userRoles.includes(role)) {
            return res.status(403).json({
                success: false,
                error: `${role} role required for this action`,
                requiredRole: role,
                userRoles: userRoles
            });
        }
        next();
    };
}

export function requireAnyRole(...roles: UserRole[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const userRoles = req.user!.roles || [];

        const hasRequiredRole = roles.some(role => userRoles.includes(role));

        if (!hasRequiredRole) {
            return res.status(403).json({
                success: false,
                error: `One of the following roles required: ${roles.join(', ')}`,
                requiredRoles: roles,
                userRoles: userRoles
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
