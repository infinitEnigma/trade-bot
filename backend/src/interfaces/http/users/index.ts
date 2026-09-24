/**
 * User Routes
 *
 * Main user routes router that imports and mounts modular user route components.
 * Provides centralized routing for all user-related operations.
 */

import { Router } from "express";
import { userProfileRoutes } from "./profile";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";

const router = Router();

// Mount modular user routes.
//
// NOTE: route-config.ts mounts the wallets/accounts routers at top level
// (/api/wallets, /api/accounts). Mounting them here as well would double
// them under /api/user/* — so this composite router carries only profile.
// Keeping the names exported lets route-config mount them top-level and any
// test import the routers directly.
router.use("/", userProfileRoutes);

logger.info("User routes initialized with modular architecture");

export { router as userRoutes };

// Re-export individual route modules for domain access
export { userProfileRoutes } from "./profile";
export { walletsRoutes } from "./wallets";
export { exchangeAccountRoutes } from "./accounts";
