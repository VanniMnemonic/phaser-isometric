import { requireFinite, requirePositive } from './errors';

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
