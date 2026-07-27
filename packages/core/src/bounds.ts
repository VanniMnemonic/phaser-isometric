import { IsoConfigError } from './errors';
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
 * L'AABB schermo di una griglia W x H.
 *
 * L'estensione reale e' (W+H)*tw/2 in orizzontale e (W+H)*th/2 in verticale, con
 * la x che parte NEGATIVA: la cella (0, H-1) e' il vertice piu' a sinistra.
 * widthInPixels/heightInPixels e TilemapLayerBase.setSize di Phaser usano invece
 * la formula ortogonale, quindi
 *     camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
 * e' sbagliato su iso.
 *
 * I quattro angoli della griglia bastano: la trasformazione e' affine, quindi
 * ogni cella interna cade nell'inviluppo convesso dei quattro angoli, e gli
 * scostamenti dei vertici del rombo sono gli stessi per ogni cella.
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
    for (const [name, value] of [
        ['gridWidth', gridWidth],
        ['gridHeight', gridHeight],
        ['maxElevation', opts.maxElevation ?? 0]
    ] as const) {
        if (!Number.isFinite(value)) {
            throw new IsoConfigError(
                `${name} non e' un numero finito (vale ${String(value)})`,
                `passa un numero finito per ${name}`
            );
        }
    }

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
 * L'AABB schermo delle sole celle date. Serve a centrare un diorama sul
 * contenuto DISEGNATO invece che sull'estensione teorica della griglia.
 * `null` se l'insieme e' vuoto: un rettangolo degenere sarebbe indistinguibile
 * da un contenuto di dimensione zero.
 */
export function contentBounds(projection: Projection, cells: Iterable<Cell>): Rect | null {
    const points: Point[] = [];
    for (const c of cells) {
        for (const p of projection.cornersOf(c.gx, c.gy, c.z)) points.push(p);
    }
    return boundsOf(points);
}
