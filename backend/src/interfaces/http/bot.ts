/** @format */

import { Router } from "express";
import { botManagementRoutes } from "./bot-management";
import { botEngineRoutes } from "./bot-engine";
import { botReconciliationWorker } from "../../workers/bot-reconciliation";
import logger from "../../services/logger";

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


export { router as botRoutes };
