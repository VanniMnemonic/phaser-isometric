import type { Projection } from './projection';
import type { GridRect, Point, Rect } from './types';

export interface CullPadding {
    /** Quanto un oggetto si estende SOPRA il proprio ancoraggio, in pixel.
     *  Include l'altezza della grafica E maxElevation * elevationStep, perche'
     *  la quota alza lo sprite sullo schermo. */
    above: number;
    /** Quanto si estende SOTTO l'ancoraggio. Di solito 0 per sprite ancorati ai piedi. */
    below: number;
    /** La mezza larghezza massima della grafica. */
    sides: number;
}

/**
 * L'intervallo di celle che puo' intersecare la vista. Estremi INCLUSI.
 *
 * Si invertono i quattro angoli della vista allargata e si prende l'AABB in
 * spazio griglia: quattro inversioni, indipendentemente dalla dimensione della
 * mappa. IsometricCullTiles di Phaser itera invece l'INTERA mappa a ogni frame
 * chiamando tileToWorldXY per ogni cella (200x200 = 40.000 conversioni/frame), e
 * CheckIsoBounds valuta solo il punto d'origine con padding calcolato sulla
 * tileHeight della mappa — per questo i tile piu' alti della cella poppano.
 *
 * Il risultato e' CONSERVATIVO: puo' includere celle non visibili, non puo' mai
 * escluderne una visibile. Sbagliare per eccesso costa qualche iterazione;
 * sbagliare per difetto fa sparire pezzi di mondo.
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
