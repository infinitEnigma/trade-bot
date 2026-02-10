/** @format */

import { Router } from "express";
import { botManagementRoutes } from "./management";
import { botEngineRoutes } from "./engine";
import { botReconciliationWorker } from "../../../workers/bot-reconciliation";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";

const router = Router();

// Mount modular routes
router.use("/management", botManagementRoutes);
router.use("/engine", botEngineRoutes);

// Start bot reconciliation worker on module load
botReconciliationWorker.start();

logger.info("Bot routes initialized with modular architecture");

// Graceful shutdown handler
process.on('SIGTERM', () => {
  logger.info("Received SIGTERM, stopping bot reconciliation worker");
  botReconciliationWorker.stop();
});

process.on('SIGINT', () => {
  logger.info("Received SIGINT, stopping bot reconciliation worker");
  botReconciliationWorker.stop();
});


// Re-export individual route modules for domain access
export { botManagementRoutes } from "./management";
export { botEngineRoutes } from "./engine";

export { router as botRoutes };
