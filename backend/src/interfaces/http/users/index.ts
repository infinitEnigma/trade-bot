/**
 * User Routes
 *
 * Main user routes router that imports and mounts modular user route components.
 * Provides centralized routing for all user-related operations.
 */

import { Router } from "express";
import { userProfileRoutes } from "./profile";
import { userKodiakRoutes } from "./kodiak";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";

const router = Router();

// Mount modular user routes
router.use("/", userProfileRoutes);
router.use("/", userKodiakRoutes);

logger.info("User routes initialized with modular architecture");

export { router as userRoutes };

// Re-export individual route modules for domain access
export { userProfileRoutes } from "./profile";
export { userKodiakRoutes } from "./kodiak";
