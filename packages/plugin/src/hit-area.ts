import Phaser from 'phaser';
import { diamondPoints } from '@iso-internal/core';

/** What `makeDiamondHitArea` needs from its target. */
export interface DiamondTarget {
    width: number;
    height: number;
    displayOriginX: number;
    displayOriginY: number;
    input: Phaser.Types.Input.InteractiveObject | null;
    setInteractive(
        hitArea?: unknown,
        callback?: Phaser.Types.Input.HitAreaCallback,
        dropZone?: boolean
    ): unknown;
    removeInteractive(): unknown;
}

export interface DiamondHitAreaOptions {
    /** Defaults to the projection's tile width. */
    tileWidth?: number;
    /** Defaults to the projection's tile height. */
    tileHeight?: number;
}

/**
 * Gives `target` a diamond-shaped hit area matching one cell.
 *
 * Phaser's default hit area is a Rectangle covering the whole frame, which on a
 * diamond over-covers by roughly a factor of two and steals clicks from
 * neighbouring cells.
 *
 * `Phaser.Geom.Polygon.Contains` is used directly as the callback: its
 * half-open edge rule tiles the plane exactly once per point, so a click on a
 * shared edge lands on exactly one cell. A hand-rolled
 * `|dx|/(tw/2) + |dy|/(th/2) <= 1` would claim both.
 */
export function applyDiamondHitArea<T extends DiamondTarget>(
    target: T,
    tileWidth: number,
    tileHeight: number
): T {
    // Validate BEFORE mutating: `diamondPoints` throws on a non-finite frame
    // size or a non-positive tile size. Computing the points first, before
    // touching `target.input` at all, means a rejected call leaves the
    // target's existing hit area (if any) completely untouched.
    const points = diamondPoints({
        frameWidth: target.width,
        frameHeight: target.height,
        tileWidth,
        tileHeight,
        // `displayOrigin` is already added by the time the callback runs, so the
        // diamond has to be authored around that same point.
        originX: target.width === 0 ? 0 : target.displayOriginX / target.width,
        originY: target.height === 0 ? 0 : target.displayOriginY / target.height
    });

    // setInteractive is NOT idempotent: called a second time it only re-enables
    // input and leaves the old hit area in place. Tearing it down first is the
    // only way a later call actually replaces the shape.
    if (target.input) target.removeInteractive();

    target.setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);

    return target;
}
