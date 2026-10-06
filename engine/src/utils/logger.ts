/** @format */

import winston from "winston";

// Create winston logger instance for engine
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({
      // NOTE: fecha (logform) has no `ms` token — it expands to minutes (`m`) +
      // seconds (`s`), so `...ss:ms` produced `09:30:23:3023` instead of
      // `09:30:23.023`. `SSS` is the millisecond token (same fix as the backend
      // logger in `backend/src/core/logging/logger.service.ts`).
      format: "YYYY-MM-DD HH:mm:ss.SSS",
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length
        ? ` ${JSON.stringify(meta)}`
        : "";
      return `${timestamp} [ENGINE] ${level.toUpperCase()}: ${message}${metaStr}`;
    })
  ),
  defaultMeta: { service: "trading-engine" },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";
          return `${timestamp} [ENGINE] ${level}: ${message}${metaStr}`;
        })
      ),
    }),

    // File transport for production logging
    ...(process.env.NODE_ENV === "production"
      ? [
          new winston.transports.File({
            filename: "logs/engine-error.log",
            level: "error",
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            ),
          }),
          new winston.transports.File({
            filename: "logs/engine.log",
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            ),
          }),
        ]
      : []),
  ],
});

export { logger };
