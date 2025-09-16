import winston from 'winston';
import 'winston-daily-rotate-file';
import chalk from 'chalk';

const { combine, timestamp, errors, printf, json } = winston.format;

const customFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const levelColor = {
    error: chalk.red.bold,
    warn: chalk.yellow.bold,
    info: chalk.cyan.bold,
    http: chalk.magenta.bold,
    verbose: chalk.blue,
    debug: chalk.green,
    silly: chalk.gray,
  }[level] || chalk.white;

  let log = `${chalk.gray(timestamp)} [${levelColor(level)}]: ${chalk.white(message)}`;

  if (stack) {
    log += `\n${chalk.redBright(stack)}`;
  }

  if (Object.keys(meta).length > 0) {
    log += `\n${chalk.gray(JSON.stringify(meta, null, 2))}`;
  }

  return log;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    json()
  ),
  transports: [
    new winston.transports.DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      timestamp({ format: 'HH:mm:ss' }),
      customFormat
    )
  }));
}