import type { Projection } from './projection';
import type { Cell, HeightSource, Point } from './types';

export interface PickOptions {
    /** The maximum elevation to try. If omitted, uses the source's own
     *  `maxElevation` when it has one, otherwise 0. */
    maxElevation?: number;
    /** The minimum elevation to try. Defaults to 0. Lower it (e.g. to a
     *  negative number) to let picking reach into a sunken area — elevations
     *  below 0 are otherwise never probed, so a `HeightGrid` built with a
     *  negative `fill` would be silently unpickable everywhere. */
    minElevation?: number;
}

/**
 * The cell whose top face is visible at the given screen point.
 *
 * DIRECTION — this is where intuition gets it wrong. For a fixed screen
 * point, the candidate at elevation z satisfies
 *     gx + gy = 2 * (sy - oy + z*e) / th
 * so gx+gy GROWS with z: a taller candidate sits FARTHER FORWARD, not
 * farther back. The pixel shows whichever surface was drawn last, i.e. the
 * one with the largest gx+gy, i.e. the one with the LARGEST z. That is why z
 * is iterated in DECREASING order, returning the first valid candidate.
 * Concretely: the top of a nearby tower covers the distant floor behind it.
 *
 * The comparison is against the EXACT elevation (`=== z`), not "does terrain
 * exist": a cell that exists but sits at a different elevation is not on
 * this pixel.
 *
 * Cost O(maxElevation - minElevation), pixel-exact, no hit-test.
 *
 * DECLARED LIMIT: finds only TOP faces. The vertical side of a column is not
 * pickable — that would need a volumetric model, which the one-elevation-
 * per-cell model does not have.
 */
export function pick(
    projection: Projection,
    sx: number,
    sy: number,
    heights: HeightSource,
    opts: PickOptions = {}
): Cell | null {
    // `maxElevation` e' una capability dichiarata su HeightSource, non un campo
    // annusato con un cast: chi implementa la propria sorgente la vede nel tipo.
    // Se manca e il chiamante non passa `opts.maxElevation`, il default e' 0 e si
    // sonda solo il pavimento — comportamento documentato, non una sorpresa.
    const maxElevation = opts.maxElevation ?? heights.maxElevation ?? 0;
    const minElevation = opts.minElevation ?? 0;

    // Percorso caldo: mai lanciare. Un limite non finito (un `Infinity` da una
    // HeightSource di terze parti mal fatta, o un NaN/±Infinity dalla config di
    // chi chiama) manderebbe il loop sotto in un ciclo che non termina mai
    // (`Infinity - 1 === Infinity`, quindi `z >= minElevation` resta vero per
    // sempre) invece che restituire un mancato pescaggio. La guardia e' O(1) e
    // fallisce restituendo `null`, non lanciando — coerente con la disciplina
    // "la configurazione valida e lancia, il percorso caldo non lancia mai".
    //
    // Non basta `Number.isFinite`: oltre Number.MAX_SAFE_INTEGER il passo -1 si
    // perde per arrotondamento in virgola mobile (es. 1e300 - 1 === 1e300), quindi
    // il loop non termina comunque pur restando "finito". Raggiungibile dalla sola
    // API del pacchetto: `createHeightGrid(4,4,0).setHeight(0,0,1e300)` porta
    // `maxElevation` a 1e300 e appende `pick` allo stesso modo di Infinity.
    if (
        !Number.isFinite(maxElevation) || !Number.isFinite(minElevation) ||
        Math.abs(maxElevation) > Number.MAX_SAFE_INTEGER || Math.abs(minElevation) > Number.MAX_SAFE_INTEGER
    ) return null;

    const scratch: Point = { x: 0, y: 0 };

    for (let z = maxElevation; z >= minElevation; z--) {
        projection.unprojectInto(scratch, sx, sy, z);
        // `+ 0` normalizza un -0 legittimo (es. round(-0.4) su un punto nella
        // meta' sinistra della cella (0,0)) a +0: un consumatore che confronta
        // il risultato con `Object.is` o con una libreria di assert che
        // distingue -0 da +0 (come `toEqual`) altrimenti fallirebbe su un
        // risultato matematicamente corretto.
        const gx = Math.round(scratch.x) + 0;
        const gy = Math.round(scratch.y) + 0;
        if (heights.heightAt(gx, gy) === z) {
            // Stessa normalizzazione di gx/gy: se opts.maxElevation e' -0, z parte
            // da -0 e resta tale finche' non viene restituito (===-0 confonde -0 e
            // 0, quindi il confronto sopra non lo avrebbe gia' filtrato).
            return { gx, gy, z: z + 0 };
        }
    }

    return null;
}
