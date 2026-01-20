/** @format */

import { Request, Response, NextFunction } from "express";
import { logger } from "../../core/logging";
import {
  generateCorrelationId,
  runWithContext,
  getContextForLogging,
} from "../../shared/utils/context";

/**
 * HTTP request logging middleware
 * Logs all incoming HTTP requests with structured data and correlation IDs
 */
export function httpLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate correlation ID for this request
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  // Set up request context
  runWithContext(
    {
      correlationId,
      startTime,
    },
    () => {
      // Log the incoming request
      logger.http("HTTP request", {
        ...getContextForLogging(),
        method: req.method,
        url: req.url,
        userAgent: req.get("User-Agent"),
        ip: req.ip,
        contentLength: req.get("Content-Length"),
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        body:
          req.method !== "GET" && req.body && Object.keys(req.body).length > 0
            ? "[REDACTED]"
            : undefined,
      });

      // Override res.end to log response details
      const originalEnd = res.end;
      res.end = function (
        chunk?: any,
        encoding?: BufferEncoding | (() => void)
      ) {
        const duration = Date.now() - startTime;

        // Log the response
        logger.http("HTTP response", {
          ...getContextForLogging(),
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          contentLength: res.get("Content-Length"),
          userAgent: req.get("User-Agent"),
          ip: req.ip,
        });

        // Call original end method
        return originalEnd.call(this, chunk, encoding as any);
      };

      next();
    }
  );
}

/**
 * Error logging middleware
 * Logs application errors with context
 */
export function errorLogger(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error("Application error", {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  next(err);
}
