import { defineConfig } from '@playwright/test';

const PORT = 4321;
// `localhost`, not `127.0.0.1`: Vite's dev server without an explicit
// `--host` binds only where Node's `net` module resolves "localhost" on this
// machine, which measured out to the IPv6 loopback — `127.0.0.1` connection-
// refused, `localhost` fine. Matching that here avoids a 30s webServer
// timeout that looks like "the server never started" when it actually did.
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The browser gate (Task 12): the one place in this plan where a claim about
 * RENDERING gets checked against a real compositor and a real GPU-backed
 * canvas instead of source reading or a headless/jsdom measurement.
 *
 * `--strictPort` on the Vite dev server: fail loudly if 4321 is already
 * taken, rather than silently binding elsewhere and leaving Playwright
 * waiting on a `url` nothing ever answers.
 */
export default defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    retries: 0,
    reporter: [
        ['list'],
        ['html', { outputFolder: './playwright-report', open: 'never' }]
    ],
    outputDir: './test-results',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                viewport: { width: 1024, height: 800 },
                deviceScaleFactor: 1
            }
        }
    ],
    webServer: {
        command: `pnpm --filter examples exec vite --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
    }
});
