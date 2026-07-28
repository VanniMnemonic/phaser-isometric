import type { Projection } from './projection';
import type { GridRect, Point, Rect } from './types';

export interface CullPadding {
    /** How much an object extends ABOVE its own anchor, in pixels. Include
     *  the graphic's height AND maxElevation * elevationStep, because
     *  elevation lifts the sprite on screen. */
    above: number;
    /** How much it extends BELOW the anchor. Usually 0 for sprites anchored
     *  at their feet. */
    below: number;
    /** The graphic's maximum half-width. */
    sides: number;
}

/**
 * The range of cells that can intersect the view. Both ends INCLUSIVE.
 *
 * The widened view's four corners are unprojected and the AABB is taken in
 * grid space: four inversions, regardless of map size. Phaser's
 * IsometricCullTiles instead iterates the ENTIRE map every frame, calling
 * tileToWorldXY for every cell (200x200 = 40,000 conversions/frame), and
 * CheckIsoBounds only evaluates the origin point with padding computed from
 * the map's tileHeight — which is why taller-than-cell tiles pop.
 *
 * The result is CONSERVATIVE: it can include cells that aren't visible, it
 * can never exclude one that is. Erring high costs a few extra iterations;
 * erring low makes chunks of the world disappear.
 */
export function cullBounds(projection: Projection, view: Rect, pad: CullPadding): GridRect {
    // Un oggetto che si estende `above` sopra il proprio ancoraggio e' visibile
    // anche quando l'ancoraggio sta SOTTO il bordo inferiore della vista, fino a
    // `above` piu' in basso. Simmetricamente per `below` in alto.
    const left = view.x - pad.sides;
    const right = view.x + view.width + pad.sides;
    const top = view.y - pad.below;
    const bottom = view.y + view.height + pad.above;

    const scratch: Point = { x: 0, y: 0 };
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    // I quattro angoli bastano: la trasformazione e' affine, quindi l'immagine di
    // un rettangolo e' un parallelogramma, il cui AABB e' determinato dai vertici.
    const angoli: ReadonlyArray<readonly [number, number]> = [
        [left, top], [right, top], [right, bottom], [left, bottom]
    ];

    for (const [ax, ay] of angoli) {
        projection.unprojectInto(scratch, ax, ay, 0);
        if (scratch.x < minX) minX = scratch.x;
        if (scratch.x > maxX) maxX = scratch.x;
        if (scratch.y < minY) minY = scratch.y;
        if (scratch.y > maxY) maxY = scratch.y;
    }

    // Mezza cella per lato. `project` restituisce il CENTRO, quindi il rombo di
    // una cella il cui centro cade appena fuori dal parallelogramma puo' ancora
    // intersecarlo: mezza cella su gx e mezza su gy coprono esattamente il
    // semi-rombo (tw/2 in orizzontale, th/2 in verticale). Senza questo margine
    // il culling sbaglia per difetto proprio sul bordo, che e' dove si nota.
    return {
        minX: Math.floor(minX - 0.5),
        maxX: Math.ceil(maxX + 0.5),
        minY: Math.floor(minY - 0.5),
        maxY: Math.ceil(maxY + 0.5)
    };
}
