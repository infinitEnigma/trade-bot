/** @format */

import { Router } from "express";
import { botManagementRoutes } from "./management";
import { botEngineRoutes } from "./engine";

const router = Router();

// Mount modular routes
router.use("/management", botManagementRoutes);
router.use("/engine", botEngineRoutes);

// NOTE: Background workers (reconciliation) must NOT start as a route-module
// side effect. Their lifecycle is owned exclusively by the main server
// startup/shutdown (see backend/src/index.ts). Side-effect startups here
// previously raced the server lifecycle and could start the legacy worker
// even though main declared it disabled.

// Re-export individual route modules for domain access
export { botManagementRoutes } from "./management";
export { botEngineRoutes } from "./engine";

export { router as botRoutes };
