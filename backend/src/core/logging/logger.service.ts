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
 * Two-stage drain, both bounded by `timeoutMs` so shutdown can never hang:
 *
 * 1. Drain the logger→transport pipe. The winston Logger is a Transform
 *    piping into each transport; entries logged moments before exit can still
 *    be sitting in that pipe. Ending the transports directly (the original
 *    implementation) dropped everything still in flight — the whole
 *    "Graceful shutdown completed successfully" tail never reached disk in
 *    production (confirmed live 2026-09-29: sequence ran, exit 0, file silent).
 *
 * 2. Close each DailyRotateFile via its own `close()`. `t.end()` only waits
 *    for the transport's write queue — but `DailyRotateFile.log()` invokes its
 *    callback synchronously after buffering the chunk in `logStream`, so that
 *    queue is empty long before the bytes hit the file. `close()` ends
 *    `logStream` and emits `finish` only once the underlying file stream has
 *    flushed, which is the real barrier before `process.exit()`.
 */
export async function flushLogs(timeoutMs = 3000): Promise<void> {
  const fileTransports = logger.transports.filter(
    t => t instanceof DailyRotateFile
  ) as DailyRotateFile[];
  if (fileTransports.length === 0) return;

  const deadline = Date.now() + timeoutMs;

  // Stage 1: wait until the logger's Transform buffers and every transport's
  // write queue are empty (each iteration lets the event loop move data).
  const pipePending = (): boolean => {
    const l = logger as unknown as {
      writableLength?: number;
      readableLength?: number;
    };
    if ((l.writableLength ?? 0) > 0 || (l.readableLength ?? 0) > 0) return true;
    return fileTransports.some(
      t =>
        ((t as unknown as { writableLength?: number }).writableLength ?? 0) > 0
    );
  };
  while (pipePending() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // Stage 2: close the rotate streams and wait for their flush barrier
  // (`close()` → `logStream.end()` → `finish`), racing the remaining budget.
  const remaining = Math.max(0, deadline - Date.now());
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
            // After close(), any logging that still happens (e.g. later tests
            // in the same process) writes to an ended file stream; dRF does
            // not listen for that error and an unhandled 'error' event would
            // crash the process. Post-flush writes are best-effort — swallow.
            const logStream = (
              t as unknown as {
                logStream?: { on?: (ev: string, fn: () => void) => void };
              }
            ).logStream;
            logStream?.on?.("error", () => undefined);
            try {
              const closable = t as unknown as { close?: () => void };
              if (typeof closable.close === "function") {
                closable.close();
              } else {
                // Transport without dRF's close barrier (defensive) — fall
                // back to ending the transport itself.
                t.end(done);
              }
            } catch {
              resolve();
            }
          })
      )
    ),
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, remaining);
      // Don't let the flush bound itself keep the loop alive.
      (timer as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
}

export default logger;
