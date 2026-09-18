import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        // The MCP integration test spawns a real node process over stdio.
        testTimeout: 20000,
        hookTimeout: 20000,
        restoreMocks: true,
        unstubEnvs: true,
    },
});
