import { describe, it, expect } from 'vitest';
import winston from 'winston';
import logger from '../src/utils/logger.js';

/**
 * The logger is a protocol hazard, not just a convenience.
 *
 * This server speaks MCP over stdio, where **stdout is the JSON-RPC channel**.
 * Any byte winston writes there corrupts the protocol. Winston's Console
 * transport defaults to stdout for every level — `stderrLevels` defaults to
 * `{}`, so the level lookup never matches and even `error` goes to stdout.
 *
 * These tests pin the routing so a future edit cannot silently reintroduce it.
 */

describe('logger', () => {
    const consoleTransport = logger.transports.find(
        (transport): transport is winston.transports.ConsoleTransportInstance =>
            transport instanceof winston.transports.Console
    );

    it('has a console transport', () => {
        expect(consoleTransport).toBeDefined();
    });

    it('routes every level to stderr, never stdout', () => {
        // If any level is missing here it lands on stdout and breaks the
        // MCP stdio channel the moment this logger is reachable from the server.
        const routed = Object.keys(consoleTransport?.stderrLevels ?? {}).sort();

        expect(routed).toEqual(Object.keys(winston.config.npm.levels).sort());
    });

    it('writes its files under an absolute path', () => {
        // Relative transport filenames resolve against cwd, which for a server
        // launched by a desktop host is not the repo. Both file transports must
        // carry an absolute path.
        const fileTransports = logger.transports.filter(
            (transport): transport is winston.transports.FileTransportInstance =>
                transport instanceof winston.transports.File
        );

        expect(fileTransports.length).toBeGreaterThan(0);
        for (const transport of fileTransports) {
            expect(transport.dirname).toMatch(/^\//);
        }
    });
});
