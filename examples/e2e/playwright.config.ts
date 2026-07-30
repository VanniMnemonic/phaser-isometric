import { defineConfig } from '@playwright/test';

const PORT = 4321;
// `localhost`, not `127.0.0.1`: Vite's dev server without an explicit
// `--host` binds only where Node's `net` module resolves "localhost" on this
// machine, which measured out to the IPv6 loopback — `127.0.0.1` connection-
// refused, `localhost` fine. Matching that here avoids a 30s webServer
// timeout that looks like "the server never started" when it actually did.
const BASE_URL = `http://localhost:${PORT}`;

// Task 11's gate scene lives in its own Vite project (`examples/from-docs`),
// separate from the playground above, so it needs its own dev server on its
// own port rather than sharing PORT/BASE_URL.
const PORT_FROM_DOCS = 4322;
const FROM_DOCS_URL = `http://localhost:${PORT_FROM_DOCS}`;

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
    webServer: [
        {
            command: `pnpm --filter examples exec vite --port ${PORT} --strictPort`,
            url: BASE_URL,
            // FALSE, always — not `!process.env.CI`. This repo is routinely
            // worked from multiple `git worktree`s at once, each with its own
            // checkout of `examples/`. `reuseExistingServer: true` would silently
            // accept WHATEVER already answers on 4321 (a `vite` left running from
            // another worktree, or a stale one from an earlier session) instead
            // of spawning this worktree's own server — a green `pnpm e2e` that
            // proves nothing about the code actually in this diff, and
            // `--strictPort` on our own command can't catch it, because our
            // command is never even spawned in that case. `false` forces
            // Playwright to always launch its own server from THIS checkout; if
            // the port is genuinely taken, `--strictPort` then fails loudly
            // instead of the mistake passing silently.
            reuseExistingServer: false,
            timeout: 30_000
        },
        {
            command: `pnpm --filter from-docs exec vite --port ${PORT_FROM_DOCS} --strictPort`,
            url: FROM_DOCS_URL,
            reuseExistingServer: false,
            timeout: 30_000
        }
    ]
});
