import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';

/** Where log files are written. Absolute, so transports never depend on cwd. */
const logsDir = process.env.ABS_LOG_DIR ?? path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_FILES = 5;

/**
 * Every level goes to stderr.
 *
 * This server speaks MCP over stdio, where stdout carries the JSON-RPC channel
 * — a single log line on stdout corrupts the protocol. Winston's Console
 * transport defaults `stderrLevels` to `{}`, so without this the lookup never
 * matches and even `error` is written to stdout.
 */
const ALL_LEVELS_TO_STDERR = Object.keys(winston.config.npm.levels);

const logger = winston.createLogger({
    level: process.env.ABS_LOG_LEVEL ?? 'debug',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.File({
            filename: path.join(logsDir, 'abs-error.log'),
            level: 'error',
            maxsize: MAX_LOG_SIZE_BYTES,
            maxFiles: MAX_LOG_FILES,
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'abs-info.log'),
            maxsize: MAX_LOG_SIZE_BYTES,
            maxFiles: MAX_LOG_FILES,
        }),
        new winston.transports.Console({
            level: process.env.ABS_LOG_LEVEL ?? 'debug',
            stderrLevels: ALL_LEVELS_TO_STDERR,
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.printf(({ level, message, timestamp, ...metadata }) => {
                    let msg = `${timestamp} [${level}] ${message}`;
                    if (Object.keys(metadata).length > 0) {
                        msg += ` ${JSON.stringify(metadata)}`;
                    }
                    return msg;
                })
            ),
        }),
    ],
});

export default logger;
