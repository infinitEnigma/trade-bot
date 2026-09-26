/** @format */

import { Request, Response, NextFunction } from "express";
import { httpLogger as contextHttpLogger } from "../../core/logging";
import {
  generateCorrelationId,
  getCorrelationId,
  runWithContext,
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
  // Reuse the correlation id already minted by `contextMiddleware` (mounted
  // before this middleware) instead of minting a second one: the id in the
  // `x-correlation-id` response header must match the id in the log lines, or
  // the documented "correlate the request with the logs" runbook cannot work.
  const correlationId = getCorrelationId() ?? generateCorrelationId();
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

        // Log the response using context-aware HTTP logger.
        // `req.originalUrl` (not `req.url`) because Express rewrites `req.url`
        // to the router-relative path while a mounted router handles it, so the
        // response line used to read `/?limit=50` for `/api/market/trades?limit=50`.
        contextHttpLogger.http("HTTP response", {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          contentLength: res.get("Content-Length"),
          userAgent: req.get("User-Agent"),
          ip: req.ip,
        });

        // Call original end method
        return originalEnd.call(this, chunk, encoding ?? "utf8", cb);
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
    url: req.originalUrl,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  next(err);
}
