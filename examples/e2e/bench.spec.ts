import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
// Type-only: erased at compile time, so it never becomes a runtime import of
// `examples/src/bench.ts` (which imports `phaser` as a VALUE — same crash render.spec.ts's
// helpers.ts documents in full for scene.ts). This pulls in `BenchResults`/`IsoBenchHook` and
// the `declare global { interface Window { __bench?: ... } } ` augmentation for free.
import type { BenchResults, IsoBenchHook } from '../src/bench';

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(here, 'artifacts');

// Runtime CONSTANTS still have to be duplicated (types don't, see the import above): these are
// values, and importing a value from bench.ts would force Node to evaluate the whole module,
// including its `new Phaser.Game(...)` side effect. Copied 1:1 from examples/src/bench.ts.
const ENTITY_COUNT = 500;
const WARMUP_FRAMES = 60;
const MEASURE_FRAMES = 300;
const P95_THRESHOLD_MS = 16.6;
const RUNS = 3;

async function runOnce(page: Page): Promise<{ results: BenchResults; rendererInfo: string | null }> {
    // A fresh navigation per run — no JIT warm-up, GC state, or GL context carries over from a
    // previous run, so the three runs are independent samples of the same fixed workload
    // (fixed PRNG seed inside bench.ts), not three points on one continuously-warming curve.
    await page.goto('/bench.html');
    await page.waitForFunction(() => Boolean(window.__bench));

    // WARMUP_FRAMES + MEASURE_FRAMES frames at a plausibly-slow 20fps would still be well
    // under 30s; this generous ceiling exists for slow/loaded machines, not because the run is
    // expected to take anywhere near it.
    await page.waitForFunction(() => window.__bench?.done === true, undefined, { timeout: 60_000 });

    const hook = await page.evaluate(() => window.__bench as IsoBenchHook);
    if (!hook.results) throw new Error('bench finished but produced no results');
    return { results: hook.results, rendererInfo: hook.rendererInfo };
}

test.describe('Task 13 — the 500-entity benchmark gate', () => {
    test.setTimeout(90_000);

    test(`measures the four metrics across ${RUNS} independent runs`, async ({ page }) => {
        const runs: Array<{ results: BenchResults; rendererInfo: string | null }> = [];

        for (let i = 0; i < RUNS; i += 1) {
            const run = await runOnce(page);
            runs.push(run);

            // Printed on every run, pass or miss: this IS the evidence trail, not just a
            // diagnostic for failure — same convention as Proof 4's row dump in render.spec.ts.
            console.log(`[bench run ${i + 1}/${RUNS}] renderer=${run.rendererInfo ?? '(none)'}`);
            console.log(JSON.stringify(run.results, null, 2));

            // The correctness invariant this task is allowed to BLOCK on (per the brief): the
            // single `sortChildrenFlag` boolean must coalesce N `setDepth()` calls into exactly
            // ONE actual sort per frame, every single measured frame, with no exceptions.
            expect(run.results.depthSortPerFrame.min, `run ${i + 1}: depthSort min`).toBe(1);
            expect(run.results.depthSortPerFrame.max, `run ${i + 1}: depthSort max`).toBe(1);
            expect(run.results.depthSortPerFrame.mean, `run ${i + 1}: depthSort mean`).toBe(1);

            // Sanity, not a performance gate: the metrics must be real numbers, not NaN/negative
            // from an instrumentation bug. This is NOT the 16.6ms threshold — see below for why
            // that one is not a hard `expect()`.
            expect(run.results.measuredFrames).toBe(MEASURE_FRAMES);
            expect(run.results.warmupFrames).toBe(WARMUP_FRAMES);
            expect(run.results.frameTime.p95).toBeGreaterThan(0);
            expect(run.results.placeCost.p95).toBeGreaterThanOrEqual(0);
            expect(run.results.culling.total).toBe(ENTITY_COUNT);

            // The culling invariant this metric exists to prove: the camera's view must
            // genuinely exclude some real fraction of the 500 entities, not merely compute a
            // number nobody acts on. If this ever fails, the benchmark scene's camera/grid
            // geometry no longer produces a real culling effect and the "entities drawn vs.
            // total" metric would be theatre.
            expect(run.results.culling.drawnMean, `run ${i + 1}: culling must exclude something real`)
                .toBeLessThan(run.results.culling.total);
        }

        // The p95 frame-time threshold (16.6ms / 60fps) is the number this whole task exists to
        // report — it is NOT asserted here as a pass/fail CI gate. Per the brief: if the honest
        // measurement misses the threshold, that is the task working, not the task failing, and
        // the report — not a red CI run — is where that distance gets recorded. A build that
        // breaks because reality is slower than the aspirational number would be exactly the
        // wrong incentive: it would pressure someone to shrink the scene until the number looks
        // good, which is the one thing this task is explicitly forbidden from doing.
        for (const [i, run] of runs.entries()) {
            const verdict = run.results.frameTime.p95 < P95_THRESHOLD_MS ? 'PASS' : 'MISS';
            console.log(
                `[bench run ${i + 1}/${RUNS}] p95=${run.results.frameTime.p95.toFixed(3)}ms `
                + `vs threshold=${P95_THRESHOLD_MS}ms: ${verdict}`
            );
        }

        fs.mkdirSync(ARTIFACTS, { recursive: true });
        fs.writeFileSync(
            path.join(ARTIFACTS, 'bench-results.json'),
            JSON.stringify({ entityCount: ENTITY_COUNT, p95ThresholdMs: P95_THRESHOLD_MS, runs }, null, 2)
        );
    });
});
