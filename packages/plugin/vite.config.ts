import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Library build for the published package.
 *
 * Three entries, one for each subpath in the exports map. `phaser` stays
 * external — bundling a second copy would create a second set of classes,
 * making `instanceof` false and registering the factory on a prototype the
 * host game never sees. The pure core, by contrast, IS bundled: it is not a
 * published dependency, and Rollup hoists the part both entries share into a
 * single chunk, so `phaser-isometric` and `phaser-isometric/core` keep one
 * module instance between them.
 */
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2020',
        minify: false,
        sourcemap: true,
        lib: {
            entry: {
                index: fileURLToPath(new URL('src/index.ts', import.meta.url)),
                core: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
                debug: fileURLToPath(new URL('src/debug.ts', import.meta.url))
            },
            formats: ['es']
        },
        rollupOptions: {
            external: ['phaser'],
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunk-[name].js'
            }
        }
    }
});
