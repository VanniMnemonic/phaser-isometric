import Phaser from 'phaser';
import { buildDebugModel } from '@iso-internal/core';
import type { Band, CullPadding, GridRect } from '@iso-internal/core';
import { IsoUsageError } from './errors';
import type { IsoPlugin } from './plugin';

export interface IsoDebugOptions {
    /** Cells to draw. Defaults to whatever `iso.cull(pad)` reports as visible,
     *  which is also the cheapest way to see the culling working. */
    area?: GridRect;
    /** Padding handed to `iso.cull()` when `area` is omitted. */
    pad?: CullPadding;
    show?: { coords?: boolean; elevation?: boolean; depthKeys?: boolean };
    /** Band used for the depth-key labels. */
    band?: Band;
    /** Outline colour, `0xRRGGBB`. */
    color?: number;
    /** Outline alpha, 0 to 1. */
    alpha?: number;
    /** Label colour, as a CSS string. */
    textColor?: string;
    /** Label size, as a CSS string. */
    fontSize?: string;
}

export interface IsoDebugOverlay {
    /** The Graphics object the outlines are stroked into. Exposed so the
     *  overlay can be re-parented, tinted or hidden by the host game. */
    readonly graphics: Phaser.GameObjects.Graphics;
    /** How many cells the last draw actually produced an outline for. */
    readonly cellsDrawn: number;
    /** Rebuilds the model from the plugin's CURRENT state and redraws. */
    redraw(): IsoDebugOverlay;
    /** Draws a different area from now on, and redraws immediately. */
    setArea(area: GridRect): IsoDebugOverlay;
    /** Removes the Graphics and every label from the Scene. */
    destroy(): void;
}

const DEFAULT_PAD: CullPadding = { above: 0, below: 0, sides: 0 };

/**
 * Draws the isometric debug overlay: cell outlines, and optionally grid
 * coordinates, elevations and depth keys.
 *
 * Lives behind the `phaser-isometric/debug` subpath so it never reaches a
 * production bundle unless it is imported on purpose. Phaser's own
 * `TilemapLayer.renderDebug` is a no-op for anything that is not orthogonal,
 * which is why this exists at all.
 *
 * Every coordinate it draws comes from the core's `buildDebugModel`: this
 * module decides colours and Phaser objects, never positions.
 */
export function createIsoDebug(iso: IsoPlugin, opts: IsoDebugOptions = {}): IsoDebugOverlay {
    if (!iso.isConfigured) {
        throw new IsoUsageError(
            'the isometric plugin has no projection yet, so there is nothing to draw a debug overlay for',
            'call iso.configure({ ... }) before createIsoDebug(iso), or install the plugin with isoScenePlugin({ ... })'
        );
    }

    const scene = iso.graphicsScene;
    const graphics = scene.add.graphics();
    graphics.setDepth(Number.MAX_SAFE_INTEGER);

    let area: GridRect | null = opts.area ?? null;
    let labels: Phaser.GameObjects.Text[] = [];
    let cellsDrawn = 0;

    const textStyle = {
        color: opts.textColor ?? '#ffffff',
        fontSize: opts.fontSize ?? '10px'
    };

    function clearLabels(): void {
        for (const label of labels) label.destroy();
        labels = [];
    }

    function draw(): void {
        const zona = area ?? iso.cull(opts.pad ?? DEFAULT_PAD);
        const model = buildDebugModel(iso.projection, {
            area: zona,
            heights: iso.heights,
            depth: iso.depth,
            band: opts.band,
            show: opts.show
        });

        graphics.clear();
        clearLabels();
        graphics.lineStyle(1, opts.color ?? 0x00ff88, opts.alpha ?? 0.6);

        for (const diamond of model.diamonds) {
            // Phaser's own .d.ts declares `strokePoints(points: Phaser.Math.Vector2[])`,
            // but `Graphics.js` only ever reads `.x`/`.y` off each element (verified
            // against the shipped source) — the exact same over-strict-typing quirk
            // `hit-area.test.ts` already pins for `Polygon`'s points. The cast, not a
            // real `Vector2[]`, is what avoids paying for objects this call never uses.
            graphics.strokePoints(toPoints(diamond) as unknown as Phaser.Math.Vector2[], true);
        }
        for (const label of model.labels) {
            const text = scene.add.text(label.x, label.y, label.text, textStyle);
            text.setOrigin(0.5, 0.5);
            text.setDepth(Number.MAX_SAFE_INTEGER);
            labels.push(text);
        }

        cellsDrawn = model.cellsDrawn;
    }

    // Il modello consegna coppie x,y piatte perche' e' la forma che non
    // costringe il core a conoscere Vector2; strokePoints vuole oggetti.
    // La conversione e' l'unico adattamento di forma che questo modulo fa.
    function toPoints(flat: readonly number[]): { x: number; y: number }[] {
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < flat.length; i += 2) {
            points.push({ x: flat[i] as number, y: flat[i + 1] as number });
        }
        return points;
    }

    draw();

    return {
        graphics,
        get cellsDrawn() { return cellsDrawn; },
        redraw() { draw(); return this; },
        setArea(next: GridRect) { area = next; draw(); return this; },
        destroy() { clearLabels(); graphics.destroy(); }
    };
}
