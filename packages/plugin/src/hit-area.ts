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
 *
 * Re-calling this on a target that already has an interactive hit area
 * updates it IN PLACE — `input.hitArea` and `input.hitAreaCallback` are
 * reassigned directly, `setInteractive` is not called a second time. This is
 * not a style choice: `removeInteractive()` followed by `setInteractive()`
 * (the seemingly obvious way to "replace" a hit area) is broken. Measured on
 * 4.2.1: `removeInteractive()` calls `InputPlugin#clear`, which only QUEUES
 * the object for removal (`_pendingRemoval`) — it does not synchronously drop
 * it from `InputPlugin#_list`. The `setInteractive()` one line later then
 * finds the object still present in `_list` and, because `queueForInsertion`
 * checks `_list` first, never re-queues it for insertion either. On the
 * following game step, `InputPlugin`'s pending-queue flush finds the object in
 * BOTH `_pendingRemoval` and `_list`, splices it out, and calls `clear()` a
 * SECOND time — this time against the NEW `InteractiveObject` just installed,
 * nulling `target.input` for good. One step after any re-call, the object
 * would not be interactive at all. Phaser's own JSDoc on `removeInteractive`
 * names this exact alternative: "If you wish to resize a hit area, don't
 * remove and then set it as being interactive. Instead, access the hit area
 * object directly ...".
 */
export function applyDiamondHitArea<T extends DiamondTarget>(
    target: T,
    tileWidth: number,
    tileHeight: number
): T {
    // Validate BEFORE mutating: `diamondPoints` throws on a non-positive frame
    // or tile size, or a non-finite origin. Computing the points first, before
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

    const polygon = new Phaser.Geom.Polygon(points);

    if (target.input) {
        // Already interactive: mutate the EXISTING InteractiveObject's shape
        // and callback in place. Do not remove-then-set (see above).
        target.input.hitArea = polygon;
        target.input.hitAreaCallback = Phaser.Geom.Polygon.Contains;
    } else {
        // Not yet interactive: this is the only safe moment to call
        // setInteractive, since there is no existing InteractiveObject for a
        // later removeInteractive()/setInteractive() pair to corrupt.
        target.setInteractive(polygon, Phaser.Geom.Polygon.Contains);
    }

    return target;
}
