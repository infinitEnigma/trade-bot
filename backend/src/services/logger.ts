/** @format */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

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
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// ✅ Create logger instance
const logger = winston.createLogger({
  levels: LOG_LEVELS,
  format: winston.format.combine(
    // ✅ Add timestamp to all logs
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss:ms',
    }),
    // ✅ Add severity level
        winston.format.printf(
          (info: any) => `${info.timestamp} ${info.level}: ${info.message}`
        )
  ),
  defaultMeta: { service: 'trade-bot' },
});

// ✅ Console transport (development)
if (process.env.NODE_ENV !== 'production') {
  winston.addColors(LOG_COLORS);

  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(
          (info) =>
            `${info.timestamp} ${info.level}: ${info.message}` +
            (info.metadata ? ` ${JSON.stringify(info.metadata)}` : '')
        )
      ),
    })
  );
}

// ✅ File transports (all environments)
const logsDir = path.join(process.cwd(), 'logs');

// ✅ All logs
logger.add(
  new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  })
);

// ✅ Error logs only
logger.add(
  new DailyRotateFile({
    level: 'error',
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  })
);

// ✅ HTTP request logs
logger.add(
  new DailyRotateFile({
    level: 'http',
    filename: path.join(logsDir, 'http-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '7d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  })
);

export default logger;
