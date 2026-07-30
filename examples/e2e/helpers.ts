import type { Locator, Page } from '@playwright/test';
// Type-only: erased at compile time, so it never becomes a runtime import of
// `examples/src/scene.ts` (which imports `phaser` as a VALUE — Phaser's ESM
// bundle touches `window` at module top-level and crashes outside a browser,
// exactly where Playwright's Node-side test collection would load it). This
// import exists only to pull in that module's `declare global { interface
// Window { __iso?: ... } }` augmentation, so `window.__iso` type-checks here.
import type {} from '../src/scene';

/** One decoded pixel, straight `[0,255]` channels. */
export interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

/**
 * Decodes a PNG screenshot buffer inside the browser (a plain `<img>` onto a
 * fresh 2D `<canvas>`) and reads back one or more pixels from it.
 *
 * This never touches the game's own WebGL canvas or its drawing buffer — it
 * decodes a STATIC image Playwright already captured through the compositor
 * (`page.screenshot()` / `locator.screenshot()`), so it needs none of the
 * `preserveDrawingBuffer` workaround Task 11 had to remove: that flag was
 * only ever necessary for `drawImage`-ing the LIVE WebGL canvas in-page,
 * which is a completely different technique from this one.
 */
export async function samplePixels(page: Page, png: Buffer, points: ReadonlyArray<{ x: number; y: number }>): Promise<RGBA[]> {
    const base64 = png.toString('base64');
    const raw = await page.evaluate(async ({ base64, points }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable for pixel sampling');
        ctx.drawImage(img, 0, 0);

        return points.map(({ x, y }) => {
            const data = ctx.getImageData(x, y, 1, 1).data;
            return [data[0], data[1], data[2], data[3]];
        });
    }, { base64, points });

    return raw.map(([r, g, b, a]) => ({ r, g, b, a }));
}

/** As {@link samplePixels}, for exactly one point. */
export async function samplePixel(page: Page, png: Buffer, x: number, y: number): Promise<RGBA> {
    const [pixel] = await samplePixels(page, png, [{ x, y }]);
    return pixel;
}

/** An inclusive box in RGB space. Every bound is optional; an omitted one
 *  does not constrain that channel. */
export interface ColourRange {
    rMin?: number; rMax?: number;
    gMin?: number; gMax?: number;
    bMin?: number; bMax?: number;
}

/**
 * Counts the pixels of a PNG screenshot whose colour falls inside `range`
 * — or, with `outside` set, the ones that fall outside it.
 *
 * Same technique as {@link samplePixels} and for the same reason: it decodes a
 * static image the compositor already produced, so it needs none of the
 * `preserveDrawingBuffer` workaround that reading the live WebGL canvas would.
 *
 * A plain range rather than a predicate function: `page.evaluate` cannot carry
 * a closure into the page, and the alternative — shipping predicate source
 * text and rebuilding it with `new Function` — trades a type-checked argument
 * for a string nobody checks.
 */
export async function countPixels(
    page: Page,
    png: Buffer,
    range: ColourRange,
    opts: { outside?: boolean } = {}
): Promise<number> {
    const base64 = png.toString('base64');
    const outside = opts.outside ?? false;

    return page.evaluate(async ({ base64, range, outside }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable for pixel counting');
        ctx.drawImage(img, 0, 0);

        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i] as number;
            const g = data[i + 1] as number;
            const b = data[i + 2] as number;
            const inside =
                r >= (range.rMin ?? 0) && r <= (range.rMax ?? 255) &&
                g >= (range.gMin ?? 0) && g <= (range.gMax ?? 255) &&
                b >= (range.bMin ?? 0) && b <= (range.bMax ?? 255);
            if (inside !== outside) n += 1;
        }
        return n;
    }, { base64, range, outside });
}

/**
 * Deterministic PRNG (mulberry32). Same seed, same sequence, every run — the
 * 20 points Proof 4 clicks are reproducible, not re-rolled per CI run.
 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function (): number {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Navigates to the playground, waits for `window.__iso` to exist, then lets
 * several REAL frames render before returning. That wait matters: this whole
 * task exists because `DisplayList.depthSort()` — and everything downstream
 * of it, including `camera.renderList` — only ever runs from a genuine
 * `Camera.preRender()`, which HEADLESS/jsdom never calls. One `create()`
 * completing is not proof a frame has rendered; five real `requestAnimationFrame`
 * ticks is.
 */
export async function readyScene(page: Page, path = '/'): Promise<{ box: Box; canvas: Locator }> {
    await page.goto(path);
    await page.waitForFunction(() => Boolean(window.__iso));
    await waitFrames(page, 5);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box — did the game fail to boot?');

    return { box, canvas };
}

/** Waits for `n` real `requestAnimationFrame` callbacks to fire in-page. */
export async function waitFrames(page: Page, n: number): Promise<void> {
    await page.evaluate((count) => new Promise<void>((resolve) => {
        let remaining = count;
        function tick(): void {
            remaining -= 1;
            if (remaining <= 0) resolve(); else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }), n);
}

/** Converts a point in the game CANVAS's own pixel space into PAGE space, for `page.mouse`/`page.screenshot`. */
export function toPage(box: Box, x: number, y: number): { x: number; y: number } {
    return { x: box.x + x, y: box.y + y };
}
