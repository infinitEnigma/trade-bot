/** @format */

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import { getContextForLogging } from "../../shared/utils/context";

// ✅ Define log levels
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// ✅ Define log colors
const LOG_COLORS = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white",
};

// ✅ Custom format that includes correlation ID
const customFormat = winston.format.combine(
  winston.format.timestamp({
    // NOTE: fecha (logform) has no `ms` token — it expands to minutes (`m`) +
    // seconds (`s`), so `...ss:ms` produced `07:56:15:5615` instead of
    // `07:56:15.615`. `SSS` is the millisecond token.
    format: "YYYY-MM-DD HH:mm:ss.SSS",
  }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const context = getContextForLogging();
    const contextStr =
      Object.keys(context).length > 0
        ? ` [${Object.entries(context)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}]`
        : "";

    return `${info.timestamp} ${info.level}: ${info.message}${contextStr}`;
  })
);

// ✅ Create logger instance
const logger = winston.createLogger({
  levels: LOG_LEVELS,
  format: customFormat,
  defaultMeta: { service: "trade-bot" },
});

// ✅ Console transport (development and tests)
if (process.env.NODE_ENV !== "production") {
  winston.addColors(LOG_COLORS);

  // Configure console transport based on environment
  const consoleLevel = process.env.NODE_ENV === "test" ? "warn" : "debug";

  logger.add(
    new winston.transports.Console({
      level: consoleLevel,
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(
          info =>
            `${info.timestamp} ${info.level}: ${info.message}${info.metadata ? ` ${JSON.stringify(info.metadata)}` : ""}`
        )
      ),
    })
  );
}

// ✅ File transports (all environments)
const logsDir = path.join(process.cwd(), "logs");

// Filter to exclude HTTP logs from app.log
const excludeHttpLogs = winston.format(info => {
  if (info.level === "http") {
    return false; // Skip HTTP logs for this transport
  }
  return info;
});

// ✅ All logs except HTTP (HTTP logs go to separate file)
logger.add(
  new DailyRotateFile({
    filename: path.join(logsDir, "app-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "14d",
    format: winston.format.combine(
      excludeHttpLogs(),
      winston.format.timestamp(),
      winston.format.json()
    ),
    level: "debug", // Capture all levels except HTTP (filtered out)
  })
);

// Filter to exclude HTTP logs from error.log
const excludeHttpErrors = winston.format(info => {
  if (info.level === "http") {
    return false; // Skip HTTP logs for this transport
  }
  return info;
});

// ✅ Error logs only
logger.add(
  new DailyRotateFile({
    level: "error",
    filename: path.join(logsDir, "error-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "30d",
    format: winston.format.combine(
      excludeHttpErrors(),
      winston.format.timestamp(),
      winston.format.json()
    ),
  })
);

// Filter to include only HTTP logs
const includeOnlyHttpLogs = winston.format(info => {
  if (info.level === "http") {
    return info; // Only include HTTP logs for this transport
  }
  return false;
});

// ✅ HTTP request logs (only HTTP level)
logger.add(
  new DailyRotateFile({
    filename: path.join(logsDir, "http-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "7d",
    format: winston.format.combine(
      includeOnlyHttpLogs(),
      winston.format.timestamp(),
      winston.format.json()
    ),
    level: "http", // Process HTTP logs
  })
);

/**
 * Flush buffered log output before process exit (L10).
 *
 * Winston file transports buffer writes; `process.exit(0)` immediately after
 * the last `logger.info` can truncate the shutdown tail (the missing
 * "Graceful shutdown completed successfully" line). Best-effort: ends each
 * file transport and waits for its `finish`/`close`, bounded by `timeoutMs`
 * so shutdown can never hang on logging.
 */
export async function flushLogs(timeoutMs = 3000): Promise<void> {
  const fileTransports = logger.transports.filter(
    t => t instanceof DailyRotateFile
  );
  if (fileTransports.length === 0) return;
  await Promise.race([
    Promise.all(
      fileTransports.map(
        t =>
          new Promise<void>(resolve => {
            const done = (): void => {
              t.removeListener("finish", done);
              t.removeListener("error", done);
              resolve();
            };
            t.once("finish", done);
            t.once("error", done);
            try {
              t.end(done);
            } catch {
              resolve();
            }
          })
      )
    ),
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      // Don't let the flush bound itself keep the loop alive.
      (timer as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
}

export default logger;
