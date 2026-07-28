import { requireFinite } from './errors';
import type { Projection } from './projection';
import type { Cell, Point, Rect } from './types';

function boundsOf(points: Iterable<Point>): Rect | null {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let almenoUno = false;

    for (const p of points) {
        almenoUno = true;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    if (!almenoUno) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The screen-space AABB of a W x H grid.
 *
 * The real extent is (W+H)*tw/2 horizontally and (W+H)*th/2 vertically, with
 * x starting NEGATIVE: cell (0, H-1) is the leftmost vertex. Phaser's
 * widthInPixels/heightInPixels and TilemapLayerBase.setSize use the
 * orthogonal formula instead, so
 *     camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
 * is wrong on iso.
 *
 * The grid's four corners are enough: the transform is affine, so every
 * interior cell falls inside the convex hull of the four corners, and the
 * diamond's vertex offsets are the same for every cell.
 */
export function worldBounds(
    projection: Projection,
    gridWidth: number,
    gridHeight: number,
    opts: { maxElevation?: number } = {}
): Rect {
    // Validare la finitezza PRIMA della guardia su <= 0, perche' NaN non e' ne'
    // <= 0 ne' > 0: scivolerebbe oltre. Con gridWidth = NaN i quattro angoli
    // proiettati diventano tutti {x:NaN,y:NaN}, e in boundsOf i confronti
    // `NaN < minX` e `NaN > maxX` sono entrambi falsi — i punti sparirebbero dal
    // min/max senza azzerare `almenoUno`. Il risultato sarebbe un Rect piccolo e
    // sbagliato, derivato dal solo angolo (0,0) che e' sempre finito: per
    // camera.setBounds, un clamp minuscolo senza alcun segnale.
    //
    // Non e' un percorso caldo: worldBounds si chiama a ogni cambio di livello,
    // non a ogni frame. Lanciare qui e' la stessa disciplina di createProjection.
    requireFinite(gridWidth, 'gridWidth');
    requireFinite(gridHeight, 'gridHeight');
    requireFinite(opts.maxElevation ?? 0, 'maxElevation');

    if (gridWidth <= 0 || gridHeight <= 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const W = gridWidth - 1;
    const H = gridHeight - 1;
    const points: Point[] = [];
    const angoli: ReadonlyArray<readonly [number, number]> = [[0, 0], [W, 0], [0, H], [W, H]];
    for (const [gx, gy] of angoli) {
        for (const p of projection.cornersOf(gx, gy, 0)) points.push(p);
    }

    // Il cast e' sound SOLO grazie ai due controlli sopra: dimensioni finite e
    // > 0 garantiscono 16 punti finiti, quindi boundsOf non puo' restituire null.
    // Se una futura modifica tocca quelle guardie, questo cast va rivisto.
    const base = boundsOf(points) as Rect;
    const lift = (opts.maxElevation ?? 0) * projection.elevationStep;
    return { x: base.x, y: base.y - lift, width: base.width, height: base.height + lift };
}

/**
 * The screen-space AABB of only the given cells. Useful for centering a
 * diorama on the content actually DRAWN instead of the grid's theoretical
 * extent. `null` when the set is empty: a degenerate rectangle would be
 * indistinguishable from zero-size content.
 */
export function contentBounds(projection: Projection, cells: Iterable<Cell>): Rect | null {
    const points: Point[] = [];
    for (const c of cells) {
        for (const p of projection.cornersOf(c.gx, c.gy, c.z)) points.push(p);
    }
    return boundsOf(points);
}
