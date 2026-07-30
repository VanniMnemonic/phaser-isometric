import { IsoConfigError } from './errors';
import { DEFAULT_BANDS } from './depth';
import type { DepthAssigner } from './depth';
import type { Projection } from './projection';
import type { Band, GridRect, HeightSource, Rect } from './types';

/** A single piece of text to draw, already positioned in world pixels. */
export interface DebugLabel {
    readonly x: number;
    readonly y: number;
    readonly text: string;
}

export interface DebugModelOptions {
    /** Inclusive grid range to draw. An empty range yields an empty model. */
    readonly area: GridRect;
    /**
     * Where each cell's elevation comes from. Omit it and every cell is drawn
     * at elevation 0; pass one and cells with no ground are skipped, which is
     * what makes the overlay show the abyss instead of paving over it.
     */
    readonly heights?: HeightSource | null;
    /** Which labels to build. All off by default: an outline-only overlay is
     *  the cheapest useful one, and text is what makes it unreadable. */
    readonly show?: {
        readonly coords?: boolean;
        readonly elevation?: boolean;
        readonly depthKeys?: boolean;
    };
    /** Required when `show.depthKeys` is on, and rejected as missing if not. */
    readonly depth?: DepthAssigner;
    /** Band used for the depth-key labels. Defaults to `floor`. */
    readonly band?: Band;
}

export interface DebugModel {
    /** One closed diamond per drawn cell: 8 numbers, x,y clockwise from the
     *  top vertex — the exact shape `Graphics.strokePoints` wants. */
    readonly diamonds: readonly (readonly number[])[];
    readonly labels: readonly DebugLabel[];
    /** AABB in world pixels of everything in `diamonds`. All zeros when
     *  nothing was drawn. */
    readonly bounds: Rect;
    /** How many cells the area covers. */
    readonly cellsRequested: number;
    /**
     * How many had ground and were drawn.
     *
     * Reported separately from `cellsRequested` on purpose: a bare `3` cannot
     * tell "the area held three cells" apart from "the area held four and one
     * is an abyss", and those two call for opposite reactions.
     */
    readonly cellsDrawn: number;
}

/** Vertical gap between stacked labels on the same cell, in pixels. */
const LABEL_LINE_HEIGHT = 12;

/**
 * Turns a grid area into the geometry a debug overlay draws.
 *
 * Pure and Phaser-free by design: this is where every coordinate of the
 * overlay is computed, so the renderer in the plugin shell has nothing left
 * to calculate — and so the whole overlay stays testable in Node.
 */
export function buildDebugModel(projection: Projection, opts: DebugModelOptions): DebugModel {
    const show = opts.show ?? {};

    if (show.depthKeys && !opts.depth) {
        throw new IsoConfigError(
            'show.depthKeys was requested but no depth assigner was given',
            'pass the plugin depth assigner as opts.depth, for example iso.depth'
        );
    }

    const band = opts.band ?? DEFAULT_BANDS.floor;
    const diamonds: number[][] = [];
    const labels: DebugLabel[] = [];

    let cellsRequested = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let gy = opts.area.minY; gy <= opts.area.maxY; gy += 1) {
        for (let gx = opts.area.minX; gx <= opts.area.maxX; gx += 1) {
            cellsRequested += 1;

            const z = opts.heights ? opts.heights.heightAt(gx, gy) : 0;
            if (z === null) continue;

            const flat: number[] = [];
            for (const corner of projection.cornersOf(gx, gy, z)) {
                flat.push(corner.x, corner.y);
                if (corner.x < minX) minX = corner.x;
                if (corner.x > maxX) maxX = corner.x;
                if (corner.y < minY) minY = corner.y;
                if (corner.y > maxY) maxY = corner.y;
            }
            diamonds.push(flat);

            if (!show.coords && !show.elevation && !show.depthKeys) continue;

            const centre = projection.project(gx, gy, z);
            let riga = centre.y;

            if (show.coords) {
                labels.push({ x: centre.x, y: riga, text: `${gx},${gy}` });
                riga += LABEL_LINE_HEIGHT;
            }
            if (show.elevation) {
                labels.push({ x: centre.x, y: riga, text: `z${z}` });
                riga += LABEL_LINE_HEIGHT;
            }
            if (show.depthKeys && opts.depth) {
                labels.push({ x: centre.x, y: riga, text: `#${opts.depth.keyFor(gx, gy, band)}` });
            }
        }
    }

    const bounds: Rect = diamonds.length === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    return { diamonds, labels, bounds, cellsRequested, cellsDrawn: diamonds.length };
}
