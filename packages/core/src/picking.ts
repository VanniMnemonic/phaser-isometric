import type { Projection } from './projection';
import type { Cell, HeightSource, Point } from './types';

export interface PickOptions {
    /** La quota massima da provare. Se omessa, si usa `maxElevation` della
     *  sorgente quando ce l'ha, altrimenti 0. */
    maxElevation?: number;
}

/**
 * La cella la cui faccia superiore e' visibile nel punto schermo dato.
 *
 * DIREZIONE — e' il punto in cui l'intuizione sbaglia. Per un punto schermo
 * fisso il candidato a quota z soddisfa
 *     gx + gy = 2 * (sy - oy + z*e) / th
 * quindi gx+gy CRESCE con z: un candidato piu' alto sta piu' AVANTI, non piu'
 * indietro. Il pixel mostra la superficie disegnata per ultima, cioe' quella con
 * gx+gy massimo, cioe' quella con z MASSIMO. Percio' si itera z in ordine
 * DECRESCENTE e si restituisce il primo candidato valido. Concretamente: la cima
 * di una torre vicina copre il pavimento lontano che le sta dietro.
 *
 * Il confronto e' con la quota ESATTA (`=== z`), non con "esiste terreno": una
 * cella che esiste ma sta a un'altra quota non e' su questo pixel.
 *
 * Costo O(maxElevation), esatto al pixel, nessun hit-test.
 *
 * LIMITE DICHIARATO: individua solo le facce SUPERIORI. Il fianco verticale di
 * una colonna non e' pescabile — servirebbe un modello a volumi, che il modello
 * a una quota per cella non ha.
 */
export function pick(
    projection: Projection,
    sx: number,
    sy: number,
    heights: HeightSource,
    opts: PickOptions = {}
): Cell | null {
    const dichiarata = (heights as { maxElevation?: number }).maxElevation;
    const maxElevation = opts.maxElevation ?? (typeof dichiarata === 'number' ? dichiarata : 0);

    const scratch: Point = { x: 0, y: 0 };

    for (let z = maxElevation; z >= 0; z--) {
        projection.unprojectInto(scratch, sx, sy, z);
        const gx = Math.round(scratch.x);
        const gy = Math.round(scratch.y);
        if (heights.heightAt(gx, gy) === z) {
            return { gx, gy, z };
        }
    }

    return null;
}
