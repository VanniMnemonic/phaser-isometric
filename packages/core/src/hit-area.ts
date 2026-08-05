import { requireFinite, requirePositive } from './errors';
import type { Projection } from './projection';

export interface CellPointsOptions {
    /** The texture frame's width, in pixels. Must be positive. */
    frameWidth: number;
    /** The texture frame's height, in pixels. Must be positive. */
    frameHeight: number;
    /** The sprite's horizontal origin, 0..1. */
    originX: number;
    /** The sprite's vertical origin, 0..1. */
    originY: number;
}

/**
 * The four vertices of a cell's top face, in FRAME space, as a flat
 * `[x0,y0, x1,y1, x2,y2, x3,y3]` — the shape `Phaser.Geom.Polygon` takes.
 *
 * This is {@link diamondPoints} generalised to ANY projection. Under the
 * `'diamond'` preset a cell is a rhombus and the two functions agree bit for
 * bit; under a `'matrix'` spec whose columns are not the preset's
 * `a = tw/2, b = th/2, c = -tw/2, d = th/2`, a cell is a SKEWED
 * PARALLELOGRAM and only this function describes it. That is not a corner
 * case: it is every axonometry whose orientation is not 45°, which includes
 * the ordinary 30°/15° view a vector editor's isometric-grid panel produces.
 *
 * The offsets come from {@link Projection.cornersOf}, not from a second copy
 * of the formula. Two implementations of the same geometry would eventually
 * disagree, and the disagreement would show up as clicks landing on the wrong
 * cell — the exact defect this function exists to remove.
 *
 * `projection.origin` is subtracted back out because a hit area lives in FRAME
 * space, around the sprite's display origin: the world translation is already
 * carried by the sprite's own position, and adding it here would offset every
 * hit area by the origin.
 *
 * Vertices may fall outside the frame (a tall tile anchored at its feet puts
 * the far vertex below it); that is correct, and a hit area is not required to
 * stay inside its texture.
 */
export function cellPoints(projection: Projection, opts: CellPointsOptions): number[] {
    requirePositive(opts.frameWidth, 'frameWidth');
    requirePositive(opts.frameHeight, 'frameHeight');
    requireFinite(opts.originX, 'originX');
    requireFinite(opts.originY, 'originY');

    const cx = opts.originX * opts.frameWidth;
    const cy = opts.originY * opts.frameHeight;

    // `cornersOf(0, 0, 0)` is the cell at the grid origin, so its vertices are
    // `origin + offset`: subtracting `origin` leaves the four offsets, which
    // are the same for every cell because the transform is affine.
    // `cornersOf(0, 0, 0)` is the cell at the grid origin, so its vertices are
    // `origin + offset`: subtracting `origin` leaves the four offsets, which
    // are the same for every cell because the transform is affine.
    const out: number[] = [];
    for (const corner of projection.cornersOf(0, 0, 0)) {
        out.push(cx + (corner.x - projection.origin.x), cy + (corner.y - projection.origin.y));
    }
    return out;
}

export interface DiamondPointsOptions {
    /** The texture frame's width, in pixels. Must be positive. */
    frameWidth: number;
    /** The texture frame's height, in pixels. Must be positive. */
    frameHeight: number;
    /** The diamond's full width — the cell's tile width. */
    tileWidth: number;
    /** The diamond's full height — the cell's tile height. */
    tileHeight: number;
    /** The sprite's horizontal origin, 0..1. */
    originX: number;
    /** The sprite's vertical origin, 0..1. */
    originY: number;
}

/**
 * The four vertices of a cell's diamond, in FRAME space, as a flat
 * `[x0,y0, x1,y1, x2,y2, x3,y3]` — the shape `Phaser.Geom.Polygon` takes.
 *
 * Frame space, top-left anchored, is the space a `hitAreaCallback` receives:
 * the display origin has already been added and the camera's zoom, scroll and
 * rotation have already been removed. So this is arithmetic on constants, with
 * no runtime state — which is why it lives here and not in the Phaser shell.
 *
 * Clockwise from the top: top, right, bottom, left. Vertices may fall outside
 * the frame (a tall tile anchored at its feet puts the bottom vertex below it);
 * that is correct, and a hit area is not required to stay inside its texture.
 */
export function diamondPoints(opts: DiamondPointsOptions): number[] {
    requirePositive(opts.frameWidth, 'frameWidth');
    requirePositive(opts.frameHeight, 'frameHeight');
    requirePositive(opts.tileWidth, 'tileWidth');
    requirePositive(opts.tileHeight, 'tileHeight');
    requireFinite(opts.originX, 'originX');
    requireFinite(opts.originY, 'originY');

    const cx = opts.originX * opts.frameWidth;
    const cy = opts.originY * opts.frameHeight;
    const hw = opts.tileWidth / 2;
    const hh = opts.tileHeight / 2;

    return [
        cx, cy - hh,
        cx + hw, cy,
        cx, cy + hh,
        cx - hw, cy
    ];
}
