/** @format */

import { Request, Response, NextFunction } from "express";
import { httpLogger as contextHttpLogger } from "../../core/logging";
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
      // Log the incoming request using context-aware HTTP logger
      contextHttpLogger.http("HTTP request", {
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
        this: Response,
        chunk?: string | Buffer,
        encoding?: BufferEncoding,
        cb?: () => void
      ): Response {
        const duration = Date.now() - startTime;

        // Log the response using context-aware HTTP logger
        contextHttpLogger.http("HTTP response", {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          contentLength: res.get("Content-Length"),
          userAgent: req.get("User-Agent"),
          ip: req.ip,
        });

        // Call original end method
        return originalEnd.call(this, chunk, encoding ?? 'utf8', cb);
      } as typeof res.end;

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
  contextHttpLogger.error("Application error", err, {
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
