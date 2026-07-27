/** A point in screen coordinates (pixels). */
export interface Point { x: number; y: number }

/** A cell of the isometric grid, with its elevation. */
export interface Cell { gx: number; gy: number; z: number }

/** A rectangle in screen coordinates. */
export interface Rect { x: number; y: number; width: number; height: number }

/** A range of cells, both ends INCLUSIVE. */
export interface GridRect { minX: number; maxX: number; minY: number; maxY: number }

/**
 * The source of elevations. It's an interface, not a class: it's the joint
 * through which you bring your own data. `null` means abyss — a cell that
 * cannot be walked on and is not drawn — and is distinct from elevation 0,
 * which is valid ground.
 */
export interface HeightSource {
    /**
     * The elevation at grid cell (gx, gy), or `null` for the abyss.
     *
     * CONTRACT relied on by `pick`: elevations are INTEGERS. `pick` probes
     * one integer step at a time over the range it is given (`minElevation`
     * to `maxElevation`, both inclusive, default `minElevation` 0). A cell
     * whose true elevation is fractional, or falls outside the probed range,
     * is not an error — it is simply never matched, and stays unpickable.
     */
    heightAt(gx: number, gy: number): number | null;

    /**
     * OPTIONAL capability: an upper bound on the elevations present.
     *
     * If the source exposes it, `pick` uses it as the default for how high
     * to search. If it does NOT expose it, whoever calls `pick` MUST pass
     * `opts.maxElevation`, otherwise the default is 0 and picking probes
     * only the floor: anything elevated silently becomes unpickable.
     *
     * It is declared here, and not read via a structural cast, precisely so
     * that whoever implements their own source sees it in the interface
     * instead of discovering it from a wrong result.
     */
    readonly maxElevation?: number;
}

/** How a projection is built. Both forms produce the same matrix. */
export type ProjectionSpec =
    | { type: 'diamond'; tileWidth: number; tileHeight: number; elevationStep?: number }
    | { type: 'matrix'; a: number; b: number; c: number; d: number; elevationStep?: number };

export interface ProjectionOptions {
    /** Translation applied after projection. Must be an INTEGER: a
     *  fractional origin would reintroduce exactly the rounding that the
     *  center convention eliminates. */
    origin?: Point;
}

/** The index of a depth band. */
export type Band = number;

export interface DepthLayout {
    rowStride: number;
    bandStride: number;
    subCapacity: number;
    maxBands: number;
    rowOffset: number;
}

/**
 * Replaces the closed-form depth formula. Whoever supplies it takes on
 * responsibility for the absence of ties: the core's guarantee only holds
 * for the default implementation.
 */
export type DepthStrategy = (gx: number, gy: number, band: Band, sub: number) => number;
