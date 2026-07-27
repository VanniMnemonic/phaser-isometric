import type { HeightSource } from './types';

export interface HeightGrid extends HeightSource {
    readonly width: number;
    readonly height: number;
    /** Un limite SUPERIORE alla quota presente. Monotono: non scende quando una
     *  cella viene abbassata, perche' ricalcolarlo costerebbe O(W*H) a ogni
     *  scrittura. E' tutto cio' di cui il picking ha bisogno. */
    readonly maxElevation: number;
    setHeight(gx: number, gy: number, z: number | null): void;
}

const ABYSS = Number.NEGATIVE_INFINITY;

/**
 * Una heightmap densa e rettangolare: una quota per cella, `null` = abisso.
 *
 * `null` NON e' quota 0. Zero e' terreno valido e calpestabile; null e' assenza
 * di terreno. Un `if (!h)` li confonde entrambi, ed e' il difetto classico di
 * ogni heightmap sparsa.
 *
 * Internamente l'abisso e' -Infinity dentro un Float64Array: un solo buffer,
 * nessun boxing, e il confronto con una quota reale e' sempre falso.
 */
export function createHeightGrid(width: number, height: number, fill: number | null = 0): HeightGrid {
    const cells = new Float64Array(Math.max(0, width * height));
    cells.fill(fill === null ? ABYSS : fill);

    let maxElevation = fill === null ? 0 : fill;

    function inside(gx: number, gy: number): boolean {
        return Number.isInteger(gx) && Number.isInteger(gy)
            && gx >= 0 && gx < width && gy >= 0 && gy < height;
    }

    return {
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
    };
}
