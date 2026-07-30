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
 *
 * `root` is anchored to this file's own directory, not left to Vite's
 * default. Vite resolves a relative `build.outDir` against `root`, and
 * `root` defaults to `process.cwd()` — the invoking shell's directory, not
 * the directory of this config file. Without an explicit `root`, running
 * this exact config from the repository root (`vite build --config
 * packages/plugin/vite.config.ts`) would resolve `outDir: 'dist'` to
 * `<repo-root>/dist/` and, because `emptyOutDir` is true, wipe it on every
 * build. Pinning `root` here makes the output land in
 * `packages/plugin/dist/` regardless of the caller's working directory.
 */
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: PACKAGE_ROOT,
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
