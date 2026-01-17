/** @format */

import { Request, Response, NextFunction } from "express";
import {
  setRequestContext,
  generateCorrelationId,
  generateRequestId,
} from "../utils/context";

export function contextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get or generate correlation ID
  const correlationId =
    (req.headers["x-correlation-id"] as string) || generateCorrelationId();

  // Set request context for the current async execution
  setRequestContext({
    correlationId,
    startTime: Date.now(),
    requestId: generateRequestId(),
  });

  // Add correlation ID to response headers for client-side tracking
  res.setHeader("x-correlation-id", correlationId);

  // Add request duration tracking
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    // Duration is tracked in context and can be logged by other middleware
    const context = require("../utils/context").getCurrentContext();
    if (context) {
      context.duration = duration;
    }
  });

  next();
}
