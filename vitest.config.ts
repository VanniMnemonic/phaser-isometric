import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['packages/*/test/**/*.test.ts'],
        // Deve girare PRIMA di qualunque import di Phaser, quindi vive qui e non
        // in un beforeAll. Sotto 'node' e' un no-op grazie alla guardia interna.
        setupFiles: ['./packages/plugin/test/vendor/phaser-jsdom-setup.js']
    }
});
