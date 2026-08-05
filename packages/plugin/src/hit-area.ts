import Phaser from 'phaser';
import { cellPoints, diamondPoints } from '@iso-internal/core';
import type { Projection } from '@iso-internal/core';

/** What a hit-area helper needs from its target. */
export interface HitAreaTarget {
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

/** Former name of {@link HitAreaTarget}, kept so existing imports resolve.
 *  The type was never diamond-specific — only its first consumer was. */
export type DiamondTarget = HitAreaTarget;

export interface DiamondHitAreaOptions {
    /** Defaults to the projection's tile width. */
    tileWidth?: number;
    /** Defaults to the projection's tile height. */
    tileHeight?: number;
}

/**
 * Installs `points` as `target`'s hit area, with `Polygon.Contains` as the
 * callback.
 *
 * `Phaser.Geom.Polygon.Contains` is used directly: its half-open edge rule
 * assigns a point on a shared edge to exactly one of the two polygons that
 * meet there, where a hand-rolled inequality would let both claim it. Note
 * what that does and does NOT buy. It resolves the tie on an edge; it cannot
 * make overlapping shapes stop overlapping. "One cell per point" is therefore
 * a property of hit areas that TILE — i.e. that have the cell's real shape —
 * not of this callback, and the caller is the one that decides which.
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
function installaPoligono<T extends HitAreaTarget>(target: T, points: number[]): T {
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

/**
 * Gives `target` a hit area with the CELL's real shape under `projection` —
 * a rhombus when the projection is one, a skewed parallelogram otherwise.
 *
 * This is the one to reach for. Phaser's default hit area is a Rectangle
 * covering the whole frame, which over-covers a cell by roughly a factor of
 * two and steals clicks from its neighbours; a rhombus assumed on a projection
 * that does not have one is the same failure in a subtler form.
 */
export function applyCellHitArea<T extends HitAreaTarget>(target: T, projection: Projection): T {
    // Validate BEFORE mutating: `cellPoints` throws on a non-positive frame or
    // a non-finite origin. Computing the points first, before touching
    // `target.input` at all, means a rejected call leaves the target's
    // existing hit area (if any) completely untouched.
    return installaPoligono(target, cellPoints(projection, {
        frameWidth: target.width,
        frameHeight: target.height,
        // `displayOrigin` is already added by the time the callback runs, so the
        // shape has to be authored around that same point.
        originX: target.width === 0 ? 0 : target.displayOriginX / target.width,
        originY: target.height === 0 ? 0 : target.displayOriginY / target.height
    }));
}

/**
 * Gives `target` a rhombus-shaped hit area of the given size.
 *
 * Correct for a cell only when the projection's cell IS a rhombus — see
 * `isRhombus`. `IsoPlugin#makeDiamondHitArea` is the guarded entry point:
 * it refuses to derive the size from a projection that has no tile size to
 * give. Use {@link applyCellHitArea} unless you specifically want a rhombus
 * of your own choosing.
 */
export function applyDiamondHitArea<T extends HitAreaTarget>(
    target: T,
    tileWidth: number,
    tileHeight: number
): T {
    // Same all-or-nothing discipline as applyCellHitArea: `diamondPoints`
    // throws on a non-positive frame or tile size, or a non-finite origin,
    // and it runs before anything on `target` is touched.
    return installaPoligono(target, diamondPoints({
        frameWidth: target.width,
        frameHeight: target.height,
        tileWidth,
        tileHeight,
        originX: target.width === 0 ? 0 : target.displayOriginX / target.width,
        originY: target.height === 0 ? 0 : target.displayOriginY / target.height
    }));
}
