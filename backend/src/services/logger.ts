/** @format */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { getContextForLogging } from '../utils/context';

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

// ✅ Custom format that includes correlation ID
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss:ms',
  }),
  winston.format.printf((info: any) => {
    const context = getContextForLogging();
    const contextStr = Object.keys(context).length > 0
      ? ` [${Object.entries(context).map(([k, v]) => `${k}=${v}`).join(' ')}]`
      : '';

    return `${info.timestamp} ${info.level}: ${info.message}${contextStr}`;
  })
);

// ✅ Create logger instance
const logger = winston.createLogger({
  levels: LOG_LEVELS,
  format: customFormat,
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
