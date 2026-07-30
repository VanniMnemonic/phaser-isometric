import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
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

/**
 * The version the CLI prints, read from the manifest at build time. Injected
 * rather than imported so that `dist/cli.js` needs no JSON import at runtime,
 * and so the printed version cannot drift from the published one: there is
 * only one place it can come from.
 */
const VERSION: string = JSON.parse(
    readFileSync(new URL('package.json', import.meta.url), 'utf8')
).version;

export default defineConfig({
    root: PACKAGE_ROOT,
    define: {
        __ISO_VERSION__: JSON.stringify(VERSION)
    },
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
                debug: fileURLToPath(new URL('src/debug.ts', import.meta.url)),
                // The `bin` target. Its shebang lives on line 1 of the source:
                // Rollup re-emits a module's shebang only when that module is
                // the chunk's entry facade, which makes leakage into the other
                // three entries structurally impossible.
                cli: fileURLToPath(new URL('src/cli.ts', import.meta.url))
            },
            formats: ['es']
        },
        rollupOptions: {
            // `/^node:/` is defence in depth, not decoration. Vite's client
            // build resolves a `node:` builtin to an empty browser stub and
            // succeeds with only a warning, so a future `import ... from
            // 'node:fs'` in the CLI would compile, bundle, and then find
            // `undefined` at runtime. External short-circuits that path,
            // because `external` is consulted before any plugin resolveId.
            external: ['phaser', /^node:/],
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunk-[name].js'
            }
        }
    }
});
