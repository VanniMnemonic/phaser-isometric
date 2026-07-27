import { IsoConfigError } from './errors';
import type { Band, DepthLayout, DepthStrategy } from './types';

/**
 * chiave = (gx + gy + rowOffset) * rowStride + banda * bandStride + sub
 *
 * 15 * 256 + 255 = 4095 < 4096: due righe adiacenti non possono mai
 * sovrapporsi. Il comparatore di Phaser e' `a._depth - b._depth`, fisso e senza
 * hook: a parita' di depth l'ordine dipende dall'inserimento nella display
 * list, quindi la garanzia va costruita QUI — a valle non c'e' piu' modo.
 *
 * Semantica dei cinque campi di `DepthLayout` (non documentati altrove —
 * questo e' il primo e unico consumatore del tipo):
 * - `rowStride`: quanto vale, in unita' di depth, avanzare di UNA riga
 *   (gx + gy). Deve essere maggiore dello spazio occupato da tutte le bande
 *   e i sub di una riga, altrimenti una riga potrebbe raggiungere quella
 *   successiva e la garanzia "riga domina banda" salterebbe.
 * - `bandStride`: quanto vale avanzare di UNA banda all'interno della stessa
 *   riga. Deve essere maggiore dello spazio occupato da tutti i sub di una
 *   banda (`subCapacity - 1`).
 * - `subCapacity`: quanti sub distinti puo' avere una singola cella+banda
 *   (0..subCapacity-1). Un sub fuori da questo intervallo e' rifiutato a
 *   chiamata.
 * - `maxBands`: quante bande esistono (0..maxBands-1). Una banda fuori da
 *   questo intervallo e' rifiutata a chiamata.
 * - `rowOffset`: costante sommata a (gx + gy) prima di moltiplicare per
 *   rowStride. Serve a spostare l'intero intervallo di chiavi in modo che
 *   coordinate di griglia negative producano comunque chiavi non negative.
 */
export const DEFAULT_LAYOUT: DepthLayout = Object.freeze({
    rowStride: 4096,
    bandStride: 256,
    subCapacity: 256,
    maxBands: 16,
    rowOffset: 0
});

export const DEFAULT_BANDS = Object.freeze({
    floor: 0,
    decal: 1,
    prop: 2,
    item: 3,
    actor: 4,
    hero: 5,
    overlay: 6
});

export interface DepthAssigner {
    readonly layout: DepthLayout;
    keyFor(gx: number, gy: number, band: Band, sub?: number): number;
}

export interface DepthAssignerOptions {
    layout?: Partial<DepthLayout>;
    strategy?: DepthStrategy;
    /** La riga massima (gx+gy) che il mondo puo' raggiungere. Serve a rifiutare
     *  alla COSTRUZIONE un layout che traboccherebbe, invece di scoprirlo a
     *  runtime quando l'ordine e' gia' sbagliato. */
    maxRow?: number;
}

export function createDepthAssigner(opts: DepthAssignerOptions = {}): DepthAssigner {
    const layout: DepthLayout = Object.freeze({ ...DEFAULT_LAYOUT, ...opts.layout });
    const { rowStride, bandStride, subCapacity, maxBands, rowOffset } = layout;

    const positivi = { rowStride, bandStride, subCapacity, maxBands };
    for (const name of Object.keys(positivi) as Array<keyof typeof positivi>) {
        const value = positivi[name];
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new IsoConfigError(
                `${name} deve essere un intero positivo (vale ${String(value)})`,
                `passa un intero positivo per ${name}`
            );
        }
    }

    const maxWithinRow = (maxBands - 1) * bandStride + (subCapacity - 1);
    if (maxWithinRow >= rowStride) {
        throw new IsoConfigError(
            `le bande invadono la riga successiva: il massimo interno alla riga e' ${maxWithinRow}, ma rowStride e' ${rowStride}`,
            'aumenta rowStride, oppure riduci bandStride, subCapacity o maxBands'
        );
    }

    const maxRow = opts.maxRow ?? 4096;
    const worstKey = (maxRow + rowOffset) * rowStride + maxWithinRow;
    if (!Number.isSafeInteger(worstKey)) {
        throw new IsoConfigError(
            `la chiave massima (riga ${maxRow}) non e' un intero esatto: ${worstKey}`,
            'riduci rowStride oppure maxRow: oltre 2^53 le chiavi smettono di essere distinguibili'
        );
    }

    const strategy: DepthStrategy = opts.strategy ?? ((gx, gy, band, sub) => {
        if (!Number.isInteger(band) || band < 0 || band >= maxBands) {
            throw new IsoConfigError(
                `banda ${String(band)} fuori dal layout (ammesse 0..${maxBands - 1})`,
                'usa una banda valida, oppure alza maxBands nel layout'
            );
        }
        if (!Number.isInteger(sub) || sub < 0 || sub >= subCapacity) {
            throw new IsoConfigError(
                `sub ${String(sub)} fuori dalla capacita' (ammessi 0..${subCapacity - 1})`,
                'alza subCapacity nel layout, oppure riduci gli oggetti nella stessa cella e banda'
            );
        }
        return (gx + gy + rowOffset) * rowStride + band * bandStride + sub;
    });

    return Object.freeze({
        layout,
        keyFor(gx: number, gy: number, band: Band, sub = 0): number {
            return strategy(gx, gy, band, sub);
        }
    });
}
