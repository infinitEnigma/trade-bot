/** @format */

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
//import * as winston from "winston";
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
    format: "YYYY-MM-DD HH:mm:ss:ms",
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

// ✅ All logs except HTTP (HTTP logs go to separate file)
logger.add(
  new DailyRotateFile({
    filename: path.join(logsDir, "app-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "14d",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    level: "debug", // Capture all levels except HTTP
    // Winston doesn't support per-transport level filtering for specific levels,
    // so we'll handle this with a custom format
  })
);

// ✅ Error logs only
logger.add(
  new DailyRotateFile({
    level: "error",
    filename: path.join(logsDir, "error-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "30d",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  })
);

// ✅ HTTP request logs (only HTTP level)
logger.add(
  new DailyRotateFile({
    level: "http",
    filename: path.join(logsDir, "http-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: "20m",
    maxFiles: "7d",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  })
);

// Apply filtering for app.log to exclude HTTP logs
const originalLog = logger.log;
logger.log = function (...args: any[]) {
  const level = args[0];

  if (level === "http") {
    // Only log HTTP level to http.log
    const httpTransport = logger.transports.find(t =>
      t instanceof DailyRotateFile && t.filename && t.filename.includes("http-")
    );

    if (httpTransport) {
      const info = {
        level: args[0],
        message: args[1],
        ...(args[2] || {})
      };
      return (httpTransport as any).log(info);
    }
  } else {
    // Log all other levels to app.log and error.log (if applicable)
    return (originalLog as any).apply(this, args);
  }
};

export default logger;
