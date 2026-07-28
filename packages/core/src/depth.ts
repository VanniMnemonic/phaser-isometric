import { IsoConfigError } from './errors';
import type { Band, DepthLayout, DepthStrategy } from './types';

/**
 * key = (gx + gy + rowOffset) * rowStride + band * bandStride + sub
 *
 * 15 * 256 + 255 = 4095 < 4096: two adjacent rows can never overlap.
 * Phaser's comparator is `a._depth - b._depth`, fixed with no hook: when
 * depth ties, ordering falls back to display-list insertion order, so the
 * guarantee has to be built HERE — there is no way to fix it downstream.
 *
 * Semantics of `DepthLayout`'s five fields (undocumented elsewhere — this is
 * the type's first and only consumer):
 * - `rowStride`: how much, in depth units, advancing by ONE row (gx + gy) is
 *   worth. Must exceed the space occupied by every band and sub of a single
 *   row, or a row could reach into the next one and the "row dominates band"
 *   guarantee would break.
 * - `bandStride`: how much advancing by ONE band within the same row is
 *   worth. Must exceed the space occupied by every sub of a band
 *   (`subCapacity - 1`).
 * - `subCapacity`: how many distinct subs a single cell+band can have
 *   (0..subCapacity-1). A sub outside this range is rejected at call time.
 * - `maxBands`: how many bands exist (0..maxBands-1). A band outside this
 *   range is rejected at call time.
 * - `rowOffset`: a constant added to (gx + gy) before multiplying by
 *   rowStride. Lets the whole key range shift so that negative grid
 *   coordinates still produce non-negative keys.
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
    /** The maximum row (gx+gy) the world can reach. Lets a layout that would
     *  overflow be rejected AT CONSTRUCTION, instead of discovered at
     *  runtime once the ordering is already wrong. */
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
                `${name} must be a positive integer (got ${String(value)})`,
                `pass a positive integer for ${name}, for example ${DEFAULT_LAYOUT[name]}`
            );
        }
    }

    const maxWithinRow = (maxBands - 1) * bandStride + (subCapacity - 1);
    if (maxWithinRow >= rowStride) {
        throw new IsoConfigError(
            `bands spill into the next row: the maximum within a row is ${maxWithinRow}, but rowStride is ${rowStride}`,
            'increase rowStride, or reduce bandStride, subCapacity, or maxBands'
        );
    }

    const maxRow = opts.maxRow ?? 4096;
    const worstKey = (maxRow + rowOffset) * rowStride + maxWithinRow;
    if (!Number.isSafeInteger(worstKey)) {
        throw new IsoConfigError(
            `the maximum key (row ${maxRow}) is not an exact integer: ${worstKey}`,
            'reduce rowStride or maxRow: past 2^53 keys stop being distinguishable'
        );
    }

    const strategy: DepthStrategy = opts.strategy ?? ((gx, gy, band, sub) => {
        // Consistente con band/sub qui sotto: senza questo controllo un gx/gy
        // frazionario (es. un attore a meta' passo fra due celle) rompe "la riga
        // domina la banda" — vedi Task 3 della review finale.
        if (!Number.isInteger(gx) || !Number.isInteger(gy)) {
            throw new IsoConfigError(
                `gx/gy must be integers (got gx=${String(gx)} gy=${String(gy)})`,
                'round grid coordinates before computing depth: a fractional gx/gy breaks the row-dominates-band guarantee'
            );
        }
        if (!Number.isInteger(band) || band < 0 || band >= maxBands) {
            throw new IsoConfigError(
                `band ${String(band)} is outside the layout (allowed 0..${maxBands - 1})`,
                'use a valid band, or raise maxBands in the layout'
            );
        }
        if (!Number.isInteger(sub) || sub < 0 || sub >= subCapacity) {
            throw new IsoConfigError(
                `sub ${String(sub)} is outside the capacity (allowed 0..${subCapacity - 1})`,
                'raise subCapacity in the layout, or reduce the number of objects sharing the same cell and band'
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
