import Phaser from 'phaser';
import { createHeightGrid, isoScenePlugin } from 'phaser-isometric';
import type { IsoSprite } from 'phaser-isometric';

/**
 * The 500-entity benchmark scene (Task 13).
 *
 * Turns the spec's public promise — "hundreds of dynamic objects" — into a measured number.
 * See `.superpowers/sdd/2026-07-28-phaser-shell/task-13-report.md` for the threshold, the
 * predictions written down before this file existed, and the measured results.
 */

/** Grid size for the (data-only, unrendered) height source. */
export const GRID_SIZE = 100;
/** How many `IsoSprite`s move every frame. */
export const ENTITY_COUNT = 500;
export const TILE_WIDTH = 96;
export const TILE_HEIGHT = 48;
export const CANVAS_WIDTH = 1024;
export const CANVAS_HEIGHT = 768;
/** Frames discarded before measurement starts, so the JIT/GPU/GC have settled. */
export const WARMUP_FRAMES = 60;
/** Frames actually measured, after warm-up. */
export const MEASURE_FRAMES = 300;
/** The threshold chosen BEFORE measuring — 60 fps. Never adjusted to fit a result. */
export const P95_THRESHOLD_MS = 16.6;

/** One measured frame's worth of instrumentation. */
export interface FrameSample {
    readonly frameTimeMs: number;
    readonly placeCostMs: number;
    /** Actual `StableSort` executions this frame — must be exactly 1. */
    readonly depthSortCount: number;
    readonly drawn: number;
    readonly total: number;
}

interface Stat {
    readonly median: number;
    readonly p95: number;
    readonly min: number;
    readonly max: number;
}

/** The four metrics the brief asks for, aggregated over `MEASURE_FRAMES` samples. */
export interface BenchResults {
    readonly warmupFrames: number;
    readonly measuredFrames: number;
    readonly frameTime: Stat;
    readonly placeCost: Stat;
    readonly depthSortPerFrame: { readonly min: number; readonly max: number; readonly mean: number };
    readonly culling: {
        readonly drawnMin: number;
        readonly drawnMax: number;
        readonly drawnMean: number;
        readonly total: number;
    };
}

/** What Playwright reads back from `window.__bench`. */
export interface IsoBenchHook {
    readonly done: boolean;
    readonly results: BenchResults | null;
    /**
     * The WebGL renderer string (`gl.getParameter(gl.RENDERER)`), or `null` if a WebGL context
     * could not be created at all. Read once, at boot — this is what tells the report whether
     * the run went through real GPU acceleration or a software rasterizer, instead of leaving
     * that as a guess.
     */
    readonly rendererInfo: string | null;
}

declare global {
    interface Window {
        __bench?: IsoBenchHook;
    }
}

/**
 * Deterministic PRNG (mulberry32). Duplicated from `examples/e2e/helpers.ts` rather than
 * imported: that file pulls in `@playwright/test` types and is meant to run in Node, not to be
 * bundled into a browser page. Same seed, same entity layout and motion on every run, so
 * repeated benchmark runs measure the SAME workload, not a freshly-rolled one each time.
 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function (): number {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The eight grid-aligned directions an entity can move in. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
];

/** True median; for an even sample count this averages the two central values. */
function median(sorted: readonly number[]): number {
    const n = sorted.length;
    if (n === 0) return NaN;
    const mid = Math.floor(n / 2);
    return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Nearest-rank p95 (the common convention for latency-style percentiles). */
function p95(sorted: readonly number[]): number {
    const n = sorted.length;
    if (n === 0) return NaN;
    const rank = Math.ceil(0.95 * n);
    const idx = Math.max(0, Math.min(n - 1, rank - 1));
    return sorted[idx];
}

function statOf(values: readonly number[]): Stat {
    const sorted = values.slice().sort((a, b) => a - b);
    return {
        median: median(sorted),
        p95: p95(sorted),
        min: sorted[0],
        max: sorted[sorted.length - 1]
    };
}

function mean(values: readonly number[]): number {
    let total = 0;
    for (const v of values) total += v;
    return total / values.length;
}

function readRendererInfo(canvas: HTMLCanvasElement): string | null {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return null;

    // `WEBGL_debug_renderer_info` is what actually distinguishes a real GPU string (e.g.
    // "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, ...)") from a software one (e.g.
    // "SwiftShader" / "llvmpipe") — the plain, un-extended RENDERER parameter is usually just
    // "WebKit WebGL" / "Mozilla" and tells us nothing. Not every context exposes the extension,
    // so this can legitimately come back null.
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return gl.getParameter(gl.RENDERER) as string;
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
}

export class BenchScene extends Phaser.Scene {
    private readonly entities: IsoSprite[] = [];
    private readonly dirX = new Int8Array(ENTITY_COUNT);
    private readonly dirY = new Int8Array(ENTITY_COUNT);
    private readonly followTarget = { gx: 0, gy: 0, z: 0 };

    private readonly frameSamples: FrameSample[] = [];
    private depthSortCount = 0;
    private lastPostRenderAt: number | null = null;
    private framesSeen = 0;
    private finished = false;

    private pendingPlaceCostMs = 0;
    private pendingDrawn = 0;
    private rendererInfo: string | null = null;

    create(): void {
        this.iso.configure({ type: 'diamond', tileWidth: TILE_WIDTH, tileHeight: TILE_HEIGHT });

        // Data-only: a HeightSource for `setHeights()`/`cameraBounds()`, never rendered as
        // floor tiles. "100x100 grid of elevations" (the brief's own wording) is not the same
        // claim as "10,000 rendered quads" — see the report for why that distinction matters
        // here.
        const heights = createHeightGrid(GRID_SIZE, GRID_SIZE, 0);
        this.iso.setHeights(heights);
        this.iso.cameraBounds(GRID_SIZE, GRID_SIZE);

        const g = this.add.graphics();
        g.fillStyle(0xffb703, 1);
        g.fillRect(0, 0, 32, 32);
        g.generateTexture('entity', 32, 32);
        g.destroy();

        const rand = mulberry32(0xb5e17a5);
        for (let i = 0; i < ENTITY_COUNT; i += 1) {
            const gx = Math.floor(rand() * GRID_SIZE);
            const gy = Math.floor(rand() * GRID_SIZE);
            const sprite = this.add.isoSprite(gx, gy, 'entity').setCell(gx, gy, 0, this.iso.bands.actor);
            this.entities.push(sprite);

            const [dx, dy] = DIRECTIONS[Math.floor(rand() * DIRECTIONS.length)];
            this.dirX[i] = dx;
            this.dirY[i] = dy;
        }

        this.followTarget.gx = this.entities[0].gx;
        this.followTarget.gy = this.entities[0].gy;
        this.iso.follow(this.followTarget);

        // Instance-level override, shadowing the DisplayList prototype's own `depthSort`. Counts
        // only the calls where a sort ACTUALLY runs (`sortChildrenFlag` was true going in) — see
        // docs/recon/depth-displaylist.md §2. This must read 1 every single measured frame; see
        // the report's predictions for why, and the brief for why anything else is grounds for
        // BLOCKED rather than something to explain away.
        const displayList = this.sys.displayList;
        const originalDepthSort = displayList.depthSort.bind(displayList);
        displayList.depthSort = (): void => {
            if (displayList.sortChildrenFlag) this.depthSortCount += 1;
            originalDepthSort();
        };

        this.game.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);

        this.rendererInfo = readRendererInfo(this.sys.game.canvas);
        window.__bench = { done: false, results: null, rendererInfo: this.rendererInfo };
    }

    update(): void {
        if (this.finished) return;

        const actorBand = this.iso.bands.actor;

        // The metric: cost of `place()` x ENTITY_COUNT, isolated from Phaser's own render pass
        // (which has not run yet this frame — see the trace in the report).
        const t0 = performance.now();
        for (let i = 0; i < ENTITY_COUNT; i += 1) {
            const sprite = this.entities[i];

            let nx = sprite.gx + this.dirX[i];
            if (nx < 0 || nx >= GRID_SIZE) {
                this.dirX[i] = -this.dirX[i];
                nx = sprite.gx + this.dirX[i];
            }

            let ny = sprite.gy + this.dirY[i];
            if (ny < 0 || ny >= GRID_SIZE) {
                this.dirY[i] = -this.dirY[i];
                ny = sprite.gy + this.dirY[i];
            }

            sprite.setCell(nx, ny, 0, actorBand);
        }
        this.pendingPlaceCostMs = performance.now() - t0;

        this.followTarget.gx = this.entities[0].gx;
        this.followTarget.gy = this.entities[0].gy;

        // Culling: proves it removes something real by actually driving `.visible` off it, not
        // just computing a number nobody acts on.
        const cull = this.iso.cull({ above: 16, below: 16, sides: 16 });
        let drawn = 0;
        for (const sprite of this.entities) {
            const inside = sprite.gx >= cull.minX && sprite.gx <= cull.maxX
                && sprite.gy >= cull.minY && sprite.gy <= cull.maxY;
            sprite.visible = inside;
            if (inside) drawn += 1;
        }
        this.pendingDrawn = drawn;
    }

    private onPostRender(): void {
        const now = performance.now();

        if (this.lastPostRenderAt !== null) {
            const frameTimeMs = now - this.lastPostRenderAt;
            this.framesSeen += 1;

            if (this.framesSeen > WARMUP_FRAMES && !this.finished) {
                this.frameSamples.push({
                    frameTimeMs,
                    placeCostMs: this.pendingPlaceCostMs,
                    depthSortCount: this.depthSortCount,
                    drawn: this.pendingDrawn,
                    total: ENTITY_COUNT
                });
            }

            if (this.framesSeen === WARMUP_FRAMES + MEASURE_FRAMES && !this.finished) {
                this.finish();
            }
        }

        this.lastPostRenderAt = now;
        this.depthSortCount = 0;
    }

    private finish(): void {
        this.finished = true;

        const frameTimes = this.frameSamples.map(s => s.frameTimeMs);
        const placeCosts = this.frameSamples.map(s => s.placeCostMs);
        const depthSorts = this.frameSamples.map(s => s.depthSortCount);
        const drawnCounts = this.frameSamples.map(s => s.drawn);

        const results: BenchResults = {
            warmupFrames: WARMUP_FRAMES,
            measuredFrames: this.frameSamples.length,
            frameTime: statOf(frameTimes),
            placeCost: statOf(placeCosts),
            depthSortPerFrame: {
                min: Math.min(...depthSorts),
                max: Math.max(...depthSorts),
                mean: mean(depthSorts)
            },
            culling: {
                drawnMin: Math.min(...drawnCounts),
                drawnMax: Math.max(...drawnCounts),
                drawnMean: mean(drawnCounts),
                total: ENTITY_COUNT
            }
        };

        window.__bench = { done: true, results, rendererInfo: this.rendererInfo };
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#11141a',
    plugins: { scene: [isoScenePlugin()] },
    scene: [BenchScene]
});
