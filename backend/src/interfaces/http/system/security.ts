/**
 * Security Routes
 *
 * API endpoints for security assessment, monitoring, and management.
 * Provides access to database security checks and encryption management.
 */

import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth.middleware";
import { databaseSecurityService } from "../../../infrastructure/security/database-security.service";
import logger from "../../../core/logging/logger.service";

const router = Router();

// All security routes require authentication (admin role check can be added later)
const adminMiddleware = [authMiddleware];

/**
 * GET /api/security/assessment
 * Get comprehensive database security assessment
 */
router.get("/assessment", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Security assessment requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        logger.info("Security assessment requested", {
            userId: req.user.userId,
            userLevel: req.user.userLevel,
        });

        const assessment = await databaseSecurityService.assessDatabaseSecurity();

        res.json({
            success: true,
            data: assessment,
            generatedAt: new Date().toISOString(),
        });

    } catch (error) {
        logger.error("Security assessment failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to generate security assessment",
        });
    }
});

/**
 * GET /api/security/metrics
 * Get security metrics for monitoring
 */
router.get("/metrics", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Security metrics requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        const metrics = await databaseSecurityService.getSecurityMetrics();

        res.json({
            success: true,
            data: metrics,
        });

    } catch (error) {
        logger.error("Security metrics retrieval failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to retrieve security metrics",
        });
    }
});

/**
 * GET /api/security/audit-report
 * Generate and download security audit report
 */
router.get("/audit-report", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Security audit report requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        logger.info("Security audit report requested", {
            userId: req.user.userId,
            userLevel: req.user.userLevel,
        });

        const report = await databaseSecurityService.generateSecurityAuditReport();

        // Set headers for file download
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="security-audit-${new Date().toISOString().split('T')[0]}.txt"`);

        res.send(report);

    } catch (error) {
        logger.error("Security audit report generation failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to generate security audit report",
        });
    }
});

/**
 * GET /api/security/migration-plan
 * Get encryption migration plan
 */
router.get("/migration-plan", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Migration plan requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        const migrationPlan = await databaseSecurityService.generateEncryptionMigrationPlan();

        res.json({
            success: true,
            data: migrationPlan,
            totalTables: migrationPlan.length,
        });

    } catch (error) {
        logger.error("Migration plan generation failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to generate migration plan",
        });
    }
});

/**
 * POST /api/security/migrate-table
 * Migrate encryption for a specific table
 */
router.post("/migrate-table", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Table encryption migration requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        const { tableName, columns } = req.body;

        if (!tableName || !Array.isArray(columns) || columns.length === 0) {
            return res.status(400).json({
                success: false,
                error: "tableName (string) and columns (array) are required",
            });
        }

        logger.info("Table encryption migration requested", {
            userId: req.user.userId,
            tableName,
            columns,
        });

        const result = await databaseSecurityService.migrateTableEncryption(tableName, columns);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: "Migration completed with errors",
                data: result,
            });
        }

        res.json({
            success: true,
            message: `Successfully migrated ${result.migratedRows} records`,
            data: result,
        });

    } catch (error) {
        logger.error("Table encryption migration failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
            tableName: req.body.tableName,
        });

        res.status(500).json({
            success: false,
            error: "Failed to migrate table encryption",
        });
    }
});

/**
 * POST /api/security/enable-encryption
 * Enable database-level encryption (PostgreSQL TDE)
 */
router.post("/enable-encryption", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Database encryption enable requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        logger.warn("Database encryption enable requested", {
            userId: req.user.userId,
            userLevel: req.user.userLevel,
        });

        const result = await databaseSecurityService.enableDatabaseEncryption();

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.message,
            });
        }

        res.json({
            success: true,
            message: result.message,
            requiresRestart: result.requiresRestart,
        });

    } catch (error) {
        logger.error("Database encryption enable failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to enable database encryption",
        });
    }
});

/**
 * POST /api/security/rotate-keys
 * Trigger encryption key rotation
 */
router.post("/rotate-keys", adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Defensive check - user should be set by authMiddleware
        if (!req.user) {
            logger.warn("Encryption key rotation requested without authenticated user");
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated",
            });
        }

        logger.warn("Encryption key rotation requested", {
            userId: req.user.userId,
            userLevel: req.user.userLevel,
        });

        const { encryptionService } = await import("../../../infrastructure");

        const needsRotation = await encryptionService.isKeyRotationNeeded();

        if (!needsRotation) {
            return res.json({
                success: true,
                message: "Key rotation not needed at this time",
                rotated: false,
            });
        }

        await encryptionService.rotateEncryptionKeys();

        res.json({
            success: true,
            message: "Encryption keys rotated successfully",
            rotated: true,
        });

    } catch (error) {
        logger.error("Encryption key rotation failed", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to rotate encryption keys",
        });
    }
});

export { router as securityRoutes };
