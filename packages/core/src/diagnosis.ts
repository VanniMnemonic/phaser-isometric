import { createProjection, isRhombus, tileSizeOf } from './projection';
import { createDepthAssigner } from './depth';
import { worldBounds } from './bounds';
import type { Projection } from './projection';
import type { DepthAssignerOptions } from './depth';
import type { Cell, DepthLayout, Point, ProjectionSpec, Rect } from './types';

/**
 * The whole dossier `npx phaser-isometric diagnose` prints, as data.
 *
 * It lives in the core, not in the CLI, for two reasons that both outlive the
 * CLI: everything here is arithmetic, and the shell is forbidden from doing
 * arithmetic; and a diagnosis that can be built in Node without a browser is
 * one that a test — or a future tool — can check without one either.
 *
 * The function takes a {@link ProjectionSpec}, never a built
 * {@link Projection}. A `Projection` does not retain `spec.type`, so from one
 * there is no honest way to report `diamond` versus `matrix`, nor the tile
 * size the caller actually asked for.
 */

/** A condition worth reporting that is NOT severe enough to reject. */
export interface DiagnosisWarning {
    /** Stable kebab-case identifier. Safe to match on; the wording is not. */
    readonly code: string;
    /** What is wrong, in one clause, with no trailing period. */
    readonly symptom: string;
    /** The correction, named. Same contract as `IsoConfigError.fix`: a report
     *  that describes only the symptom forces the reader to guess. */
    readonly fix: string;
}

export interface DiagnosisInput {
    readonly projection: ProjectionSpec;
    readonly origin?: Point;
    readonly depth?: DepthAssignerOptions;
    readonly grid?: { readonly width: number; readonly height: number };
    /** Highest elevation the grid reaches. Defaults to 0. */
    readonly maxElevation?: number;
}

export interface ProjectionFacts {
    readonly type: 'diamond' | 'matrix';
    /** `null` for a matrix spec: a raw matrix has no tile size to report. */
    readonly tileWidth: number | null;
    readonly tileHeight: number | null;
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly det: number;
    /**
     * `|det| / max(|a|,|b|,|c|,|d|)^2`. Exactly 1 for a 2:1 diamond and
     * approaching 0 as the matrix nears singular, so it says how much room is
     * left before inversion stops being trustworthy — which a bare
     * determinant does not, since `det` scales with the square of the tile.
     *
     * There is deliberately no `invertible` field: `createProjection` rejects
     * `det === 0` outright, so such a field could only ever read `true`, and a
     * value that can never disagree with anything is not evidence.
     */
    readonly conditioning: number;
    readonly elevationStep: number;
    readonly origin: Point;
}

export interface DepthFacts {
    /** The layout actually in force, after defaults are filled in. */
    readonly layout: DepthLayout;
    /** The largest key offset reachable inside one row. */
    readonly maxWithinRow: number;
    /** How many keys are left in a row after `maxWithinRow`. Zero on the
     *  default layout, by design: 15*256+255 = 4095 exactly fills 4096. */
    readonly withinRowHeadroom: number;
    /** The row the layout was validated up to, from `depth.maxRow`. */
    readonly declaredMaxRow: number;
    /** The key produced at `declaredMaxRow`, worst band and sub. */
    readonly worstKey: number;
    /** Largest row whose worst key is still an exact integer. */
    readonly maxSafeRow: number;
    /** `maxSafeRow - declaredMaxRow`. */
    readonly safeRowHeadroom: number;
}

export interface GridFacts {
    readonly width: number;
    readonly height: number;
    readonly cells: number;
    /** The largest `gx + gy` in the grid, i.e. the last row drawn. */
    readonly maxRow: number;
    readonly maxElevation: number;
    readonly worstKeyInGrid: number;
    readonly bounds: Rect;
    readonly elevationLiftPx: number;
}

export interface RoundTripFacts {
    readonly probes: number;
    /** Worst `|gx' - gx|` or `|gy' - gy|` over the probes, in GRID units. */
    readonly maxGridError: number;
    /** Worst screen-space disagreement over the probes, in pixels. */
    readonly maxScreenError: number;
    /** The probe that produced `maxGridError`, or `null` when all were exact. */
    readonly worstCell: Cell | null;
    readonly exact: boolean;
}

export interface Diagnosis {
    /** Shape of THIS structure, not the package version. The two are separate
     *  contracts and are allowed to move independently. */
    readonly schema: 1;
    readonly projection: ProjectionFacts;
    readonly depth: DepthFacts;
    /** `null` unless the caller supplied a grid. */
    readonly grid: GridFacts | null;
    readonly roundTrip: RoundTripFacts;
    /** Fixed order, never from a Set or object iteration: the rendered card is
     *  compared verbatim, so the order is part of the contract. */
    readonly warnings: readonly DiagnosisWarning[];
}

/** Sopra questa magnitudine `toFixed` di un renderer passerebbe a notazione
 *  scientifica (la soglia vera e' 1e21). Avvisiamo con quindici ordini di
 *  margine, cosi' un `na` non arriva mai senza essere stato annunciato. */
const SCALA_IMPLAUSIBILE = 100000;

/** Sotto questo condizionamento l'inversione perde cifre significative molto
 *  prima che `det` arrivi a zero. Un diamond ci arriva solo oltre il 40:1. */
const CONDIZIONAMENTO_MINIMO = 0.05;

/** Il round trip del core e' esatto per costruzione; questa e' la tolleranza
 *  sotto cui un residuo e' rumore di virgola mobile e non un difetto. */
const TOLLERANZA_ROUND_TRIP = 1e-9;

function assi(p: Projection): number {
    return Math.max(Math.abs(p.a), Math.abs(p.b), Math.abs(p.c), Math.abs(p.d));
}

/** Le sonde del round trip: deterministiche, e il loro NUMERO finisce nel
 *  dossier, cosi' `maxGridError = 0` non e' mai un caso di "zero sonde". */
function sonde(input: DiagnosisInput, maxElevation: number): Cell[] {
    const out: Cell[] = [];
    const visti = new Set<string>();
    const aggiungi = (gx: number, gy: number, z: number): void => {
        const chiave = `${gx}|${gy}|${z}`;
        if (visti.has(chiave)) return;
        visti.add(chiave);
        out.push({ gx, gy, z });
    };

    if (input.grid) {
        const { width, height } = input.grid;
        const ultimaX = width - 1;
        const ultimaY = height - 1;
        const centroX = Math.floor(width * 0.5);
        const centroY = Math.floor(height * 0.5);
        const quote = maxElevation > 0 ? [0, maxElevation] : [0];
        for (const z of quote) {
            aggiungi(0, 0, z);
            aggiungi(ultimaX, 0, z);
            aggiungi(0, ultimaY, z);
            aggiungi(ultimaX, ultimaY, z);
            aggiungi(centroX, centroY, z);
        }
        return out;
    }

    for (const [gx, gy] of [[0, 0], [1, 1], [-1, -1], [1024, 1024], [-1024, -1024]] as const) {
        aggiungi(gx, gy, 0);
    }
    return out;
}

function roundTrip(p: Projection, celle: readonly Cell[]): RoundTripFacts {
    let maxGridError = 0;
    let maxScreenError = 0;
    let worstCell: Cell | null = null;

    for (const cella of celle) {
        const schermo = p.project(cella.gx, cella.gy, cella.z);
        const indietro = p.unproject(schermo.x, schermo.y, cella.z);
        const errore = Math.max(Math.abs(indietro.x - cella.gx), Math.abs(indietro.y - cella.gy));
        if (errore > maxGridError) {
            maxGridError = errore;
            worstCell = cella;
        }
        const ririproiettato = p.project(indietro.x, indietro.y, cella.z);
        maxScreenError = Math.max(
            maxScreenError,
            Math.abs(ririproiettato.x - schermo.x),
            Math.abs(ririproiettato.y - schermo.y)
        );
    }

    return {
        probes: celle.length,
        maxGridError,
        maxScreenError,
        worstCell: maxGridError > 0 ? worstCell : null,
        exact: maxGridError <= TOLLERANZA_ROUND_TRIP
    };
}

/**
 * Builds the full diagnosis for a projection and depth configuration.
 *
 * Throws {@link IsoConfigError} for anything the constructors already reject —
 * a singular matrix, a fractional origin, a layout whose bands spill into the
 * next row. Those are errors, not warnings, and the caller should surface the
 * error's `symptom` and `fix` rather than fold them into this report: a
 * warning that can never fire is worse than no warning at all.
 */
export function buildDiagnosis(input: DiagnosisInput): Diagnosis {
    const p = createProjection(input.projection, input.origin ? { origin: input.origin } : {});
    const assegnatore = createDepthAssigner(input.depth ?? {});
    const layout = assegnatore.layout;
    const maxElevation = input.maxElevation ?? 0;

    const scala = assi(p);
    const conditioning = Math.abs(p.det) / (scala * scala);
    const misuraTile = tileSizeOf(p);
    const diamante = input.projection.type === 'diamond';

    const projection: ProjectionFacts = {
        type: input.projection.type,
        tileWidth: diamante ? misuraTile.tileWidth : null,
        tileHeight: diamante ? misuraTile.tileHeight : null,
        a: p.a, b: p.b, c: p.c, d: p.d,
        det: p.det,
        conditioning,
        elevationStep: p.elevationStep,
        origin: p.origin
    };

    const maxWithinRow = (layout.maxBands - 1) * layout.bandStride + (layout.subCapacity - 1);
    const declaredMaxRow = input.depth?.maxRow ?? 4096;
    const worstKey = (declaredMaxRow + layout.rowOffset) * layout.rowStride + maxWithinRow;
    const maxSafeRow =
        Math.floor((Number.MAX_SAFE_INTEGER - maxWithinRow) / layout.rowStride) - layout.rowOffset;

    const depth: DepthFacts = {
        layout,
        maxWithinRow,
        withinRowHeadroom: layout.rowStride - 1 - maxWithinRow,
        declaredMaxRow,
        worstKey,
        maxSafeRow,
        safeRowHeadroom: maxSafeRow - declaredMaxRow
    };

    let grid: GridFacts | null = null;
    if (input.grid) {
        const { width, height } = input.grid;
        const maxRow = (width - 1) + (height - 1);
        grid = {
            width,
            height,
            cells: width * height,
            maxRow,
            maxElevation,
            worstKeyInGrid: (maxRow + layout.rowOffset) * layout.rowStride + maxWithinRow,
            bounds: worldBounds(p, width, height, { maxElevation }),
            elevationLiftPx: maxElevation * p.elevationStep
        };
    }

    const roundTripFacts = roundTrip(p, sonde(input, maxElevation));

    // Ordine FISSO, mai da un Set: la scheda resa viene confrontata verbatim.
    const warnings: DiagnosisWarning[] = [];

    if (diamante && (!Number.isInteger(p.a) || !Number.isInteger(p.d))) {
        warnings.push({
            code: 'fractional-tile-centres',
            symptom: `tile centres land on half pixels (a=${p.a} d=${p.d})`,
            fix: 'use an even tileWidth and tileHeight, for example 96x48'
        });
    }

    // Sta accanto a 'fractional-tile-centres' perche' e' l'altra domanda sulla
    // FORMA della cella, e prima di ogni avviso sulla quota. Non puo' scattare
    // su uno spec 'diamond': il preset soddisfa entrambe le relazioni per
    // costruzione.
    if (!isRhombus(p)) {
        // Il rapporto fra l'area del rombo che `tileSizeOf` farebbe costruire
        // (2|a*d|) e l'area vera della cella (|det|). Vale esattamente 1 su un
        // rombo. Il numero, e non solo il fatto, perche' e' quello che dice
        // quanto sarebbe sbagliata la hit area: a 15 gradi di orientamento vale
        // 1.866, cioe' 2cos^2(15 gradi).
        const eccessoDelRombo = Math.abs(2 * p.a * p.d) / Math.abs(p.det);
        warnings.push({
            code: 'cell-is-not-a-rhombus',
            symptom:
                `cells are skewed parallelograms, not rhombuses (a=${p.a} b=${p.b} c=${p.c} d=${p.d}), ` +
                `so a diamond hit area would cover ${eccessoDelRombo} times the cell's own area`,
            fix: 'give game objects their hit area with makeCellHitArea(target), not makeDiamondHitArea(target): ' +
                'tileSizeOf reads only a and d, so a rhombus derived from it is the wrong SHAPE, not just the wrong size'
        });
    }

    if (p.elevationStep === 0) {
        warnings.push({
            code: 'elevation-step-zero',
            symptom: 'elevationStep is 0, so elevation has no effect on screen',
            fix: 'pass elevationStep, or use the diamond preset, which defaults it to half the tile height'
        });
    } else if (!Number.isInteger(p.elevationStep)) {
        warnings.push({
            code: 'elevation-step-fractional',
            symptom: `elevationStep is not an integer (${p.elevationStep}), so raised sprites land on half pixels`,
            fix: 'round elevationStep to an integer'
        });
    }

    if (conditioning < CONDIZIONAMENTO_MINIMO) {
        warnings.push({
            code: 'near-singular-matrix',
            symptom: `the matrix is close to singular (conditioning ${conditioning})`,
            fix: 'move columns (a,b) and (c,d) further apart: near-collinear columns lose precision on every unproject'
        });
    }

    if (scala > SCALA_IMPLAUSIBILE) {
        warnings.push({
            code: 'implausible-tile-scale',
            symptom: `the largest matrix component is ${scala}, far past any plausible tile size`,
            fix: 'check the units: these are screen pixels per grid step, not world units'
        });
    }

    if (!roundTripFacts.exact) {
        warnings.push({
            code: 'round-trip-inexact',
            symptom: `project then unproject disagrees by ${roundTripFacts.maxGridError} cells at worst`,
            fix: 'this projection loses precision: check the matrix for near-collinear columns or an extreme scale'
        });
    }

    if (grid && grid.maxRow > declaredMaxRow) {
        warnings.push({
            code: 'grid-exceeds-declared-max-row',
            symptom: `the grid reaches row ${grid.maxRow}, past the ${declaredMaxRow} the depth layout was validated for`,
            fix: `pass maxRow: ${grid.maxRow} or higher when creating the depth assigner`
        });
    }

    return { schema: 1, projection, depth, grid, roundTrip: roundTripFacts, warnings };
}
