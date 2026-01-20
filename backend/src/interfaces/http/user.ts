/**
 * User Routes
 *
 * Main user routes router that imports and mounts modular user route components.
 * Provides centralized routing for all user-related operations.
 */

import { Router } from "express";
import { userProfileRoutes } from "./user-profile";
import { userKodiakRoutes } from "./user-kodiak";
import logger from "../../core/logging/logger.service";

const router = Router();

// Mount modular user routes
router.use("/", userProfileRoutes);
router.use("/", userKodiakRoutes);

logger.info("User routes initialized with modular architecture");

export { router as userRoutes };
