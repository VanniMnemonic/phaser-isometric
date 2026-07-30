import { defineConfig } from 'vite';

// A relative base so `dist/` can be opened straight from disk (file://) or
// served from any subpath — this is a test-bench artefact, not a deployed
// site with a fixed root.
export default defineConfig({
    base: './',
    build: {
        outDir: 'dist'
    }
});
