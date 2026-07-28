import { requireNonNegativeInteger } from './errors';
import type { HeightSource } from './types';

export interface HeightGrid extends HeightSource {
    readonly width: number;
    readonly height: number;
    /** An UPPER bound on the elevations present. Monotonic: it never goes
     *  down when a cell is lowered, because recomputing it would cost
     *  O(W*H) on every write. It is all picking needs. */
    readonly maxElevation: number;
    setHeight(gx: number, gy: number, z: number | null): void;
}

const ABYSS = Number.NEGATIVE_INFINITY;

/**
 * A dense, rectangular heightmap: one elevation per cell, `null` = abyss.
 *
 * `null` is NOT elevation 0. Zero is valid, walkable ground; null is the
 * absence of ground. An `if (!h)` check confuses the two, and that is the
 * classic defect of every sparse heightmap.
 *
 * Internally the abyss is -Infinity inside a Float64Array: a single buffer,
 * no boxing, and comparing against a real elevation is always false.
 */
export function createHeightGrid(width: number, height: number, fill: number | null = 0): HeightGrid {
    // Validare alla costruzione, come createProjection e createDepthAssigner.
    // Con una dimensione frazionaria `inside()` accetterebbe una cella il cui
    // indice calcolato e' frazionario: `cells[2.5]` legge `undefined`, quindi
    // `heightAt` violerebbe il proprio contratto `number | null` e `setHeight`
    // perderebbe la scrittura in silenzio — un undefined che si propaga fino al
    // picking, dove diventa difficile da diagnosticare.
    requireNonNegativeInteger(width, 'width');
    requireNonNegativeInteger(height, 'height');

    const cells = new Float64Array(width * height);
    cells.fill(fill === null ? ABYSS : fill);

    let maxElevation = fill === null ? 0 : fill;

    function inside(gx: number, gy: number): boolean {
        return Number.isInteger(gx) && Number.isInteger(gy)
            && gx >= 0 && gx < width && gy >= 0 && gy < height;
    }

    // Congelato come createProjection e createDepthAssigner: senza,
    // `grid.width = 100` lascerebbe il campo pubblico in disaccordo con il
    // `width` catturato dalla closure di `inside()` — la stessa famiglia di
    // difetto dell'aliasing sull'origine gia' corretto in projection.ts.
    // `maxElevation` resta un getter dietro il freeze: legge la variabile di
    // closure, non una proprieta' dati, quindi congelare l'oggetto non ne
    // blocca l'aggiornamento via `setHeight`.
    return Object.freeze({
        width,
        height,
        get maxElevation(): number { return maxElevation; },

        heightAt(gx: number, gy: number): number | null {
            if (!inside(gx, gy)) return null;
            const v = cells[gy * width + gx] as number;
            return v === ABYSS ? null : v;
        },

        setHeight(gx: number, gy: number, z: number | null): void {
            if (!inside(gx, gy)) return;
            cells[gy * width + gx] = z === null ? ABYSS : z;
            if (z !== null && z > maxElevation) maxElevation = z;
        }
    });
}
