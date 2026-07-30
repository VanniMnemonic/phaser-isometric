import { IsoConfigError, requireFinite, requirePositive } from './errors';
import type { Point, ProjectionSpec, ProjectionOptions } from './types';

/**
 * An isometric projection.
 *
 * CONVENTION, single and non-negotiable: `project` returns the CENTER of the
 * cell's top face. That is the choice that makes the rounding exact instead
 * of approximate — the grid-space unit square `[gx-0.5,gx+0.5]×[gy-0.5,gy+0.5]`
 * centered on the origin is what the matrix maps EXACTLY onto the cell's
 * diamond, corner-for-corner and edge-for-edge. This is precisely where
 * Phaser contradicts itself: IsometricTileToWorldXY returns the bounding-box
 * corner while IsometricWorldToTileXY assumes the diamond's vertex, so the
 * round-trip comes out shifted by half a cell.
 *
 * That square-to-diamond mapping is an exact fact about the matrix, but it is
 * silent on which cell owns a point exactly ON a shared boundary — "round
 * gx and round gy, on both axes, the ordinary way" is NOT the rule that
 * recovers the diamond's actual owner there. `pick()` (`picking.ts`) rounds
 * `gx` up on an exact `.5` but `gy` DOWN on an exact `.5` — asymmetric on
 * purpose, to match `Phaser.Geom.Polygon.Contains`'s half-open pnpoly rule,
 * the rule `makeDiamondHitArea`'s hit areas are actually built on. Getting
 * this wrong is not cosmetic: it was a real, ~0.79%-of-pixels defect (Task
 * 12), caught only by comparing `pick()` against a genuine click in a
 * browser — the geometric fact above says nothing about tie-breaking. See
 * `picking.ts`'s JSDoc for the full derivation and its own stated limits.
 */
export interface Projection {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly det: number;
    readonly elevationStep: number;
    readonly origin: Point;

    project(gx: number, gy: number, z?: number): Point;
    projectInto(out: Point, gx: number, gy: number, z?: number): Point;
    /** Inverts the projection: returns GRID coordinates (fractional), not
     *  screen pixels, despite sharing the `Point` shape. Round to reach a cell. */
    unproject(sx: number, sy: number, z?: number): Point;
    /** As {@link unproject}, writing into `out`. `out` is filled with GRID
     *  coordinates. */
    unprojectInto(out: Point, sx: number, sy: number, z?: number): Point;
    cornersOf(gx: number, gy: number, z?: number): [Point, Point, Point, Point];
}

export function createProjection(spec: ProjectionSpec, opts: ProjectionOptions = {}): Projection {
    let a: number;
    let b: number;
    let c: number;
    let d: number;
    let elevationStep: number;

    if (spec.type === 'diamond') {
        requirePositive(spec.tileWidth, 'tileWidth');
        requirePositive(spec.tileHeight, 'tileHeight');
        a = spec.tileWidth / 2;
        b = spec.tileHeight / 2;
        c = -spec.tileWidth / 2;
        d = spec.tileHeight / 2;
        elevationStep = spec.elevationStep ?? spec.tileHeight / 2;
    } else {
        requireFinite(spec.a, 'a');
        requireFinite(spec.b, 'b');
        requireFinite(spec.c, 'c');
        requireFinite(spec.d, 'd');
        a = spec.a;
        b = spec.b;
        c = spec.c;
        d = spec.d;
        elevationStep = spec.elevationStep ?? 0;
    }

    requireFinite(elevationStep, 'elevationStep');

    const det = a * d - b * c;
    if (det === 0) {
        throw new IsoConfigError(
            `the projection matrix is not invertible (det = 0, a=${a} b=${b} c=${c} d=${d})`,
            'columns (a,b) and (c,d) are collinear: change one of them, or use the diamond preset'
        );
    }

    const rawOrigin: Point = opts.origin ?? { x: 0, y: 0 };
    // Finitezza PRIMA di interezza: Number.isInteger(NaN) e' false, quindi senza
    // questo ordine un'origine NaN cadrebbe nel ramo "non e' intera" e la
    // correzione suggerita sarebbe "arrotonda" — non e' una correzione per NaN.
    requireFinite(rawOrigin.x, 'origin.x');
    requireFinite(rawOrigin.y, 'origin.y');
    if (!Number.isInteger(rawOrigin.x) || !Number.isInteger(rawOrigin.y)) {
        throw new IsoConfigError(
            `origin must have integer components (got x=${rawOrigin.x} y=${rawOrigin.y})`,
            'round the origin: a fractional translation reintroduces exactly the rounding that the center convention eliminates'
        );
    }

    // UNA sola copia congelata, usata sia dalle closure sia dal campo pubblico.
    // Legare le closure all'oggetto del CHIAMANTE lo lascerebbe mutabile dopo la
    // costruzione: `p.origin` resterebbe fermo mentre `p.project()` cambierebbe
    // risultato, e un `o.x = 0.5` successivo aggirerebbe del tutto la validazione
    // dell'origine intera — che esiste proprio per proteggere la convenzione del
    // centro. Un Point e' un oggetto che un chiamante Phaser riusa e muta di
    // frame in frame: trattenerne il riferimento non e' un'ipotesi teorica.
    const origin = Object.freeze({ ...rawOrigin });

    function projectInto(out: Point, gx: number, gy: number, z = 0): Point {
        out.x = a * gx + c * gy + origin.x;
        out.y = b * gx + d * gy - z * elevationStep + origin.y;
        return out;
    }

    /**
     * L'inverso analitico della matrice 2x2. Con X = sx - ox e Y = sy - oy + z*e:
     *   gx = ( d*X - c*Y) / det
     *   gy = (-b*X + a*Y) / det
     * Sul preset diamond si riduce a gx = X/tw + Y/th, gy = -X/tw + Y/th, che
     * sostituito nella forma diretta da' l'identita' esatta.
     */
    function unprojectInto(out: Point, sx: number, sy: number, z = 0): Point {
        const X = sx - origin.x;
        const Y = sy - origin.y + z * elevationStep;
        out.x = (d * X - c * Y) / det;
        out.y = (-b * X + a * Y) / det;
        return out;
    }

    /**
     * I quattro vertici della faccia superiore, in ordine ORARIO dall'alto:
     * top, right, bottom, left.
     *
     * Gli scostamenti dal centro, in spazio griglia, sono (∓0.5, ∓0.5); passati
     * per la matrice diventano i quattro scostamenti schermo qui sotto. Sul
     * preset diamond danno (0,-th/2), (tw/2,0), (0,th/2), (-tw/2,0).
     *
     * Esiste perche' GetTileCorners di Phaser e' NOOP per ISOMETRIC.
     */
    const halfSum = { x: (a + c) / 2, y: (b + d) / 2 };
    const halfDiff = { x: (a - c) / 2, y: (b - d) / 2 };

    function cornersOf(gx: number, gy: number, z = 0): [Point, Point, Point, Point] {
        const cx = a * gx + c * gy + origin.x;
        const cy = b * gx + d * gy - z * elevationStep + origin.y;
        return [
            { x: cx - halfSum.x, y: cy - halfSum.y },
            { x: cx + halfDiff.x, y: cy + halfDiff.y },
            { x: cx + halfSum.x, y: cy + halfSum.y },
            { x: cx - halfDiff.x, y: cy - halfDiff.y }
        ];
    }

    return Object.freeze({
        a, b, c, d, det, elevationStep,
        origin,
        project(gx: number, gy: number, z = 0): Point {
            return projectInto({ x: 0, y: 0 }, gx, gy, z);
        },
        projectInto,
        unproject(sx: number, sy: number, z = 0): Point {
            return unprojectInto({ x: 0, y: 0 }, sx, sy, z);
        },
        unprojectInto,
        cornersOf
    });
}

/**
 * Recovers the tile size a `Projection` was built with — the inverse of the
 * diamond preset's own `a = tileWidth/2`, `d = tileHeight/2`.
 *
 * Only meaningful for a projection built from the `'diamond'` preset:
 * `Projection` does not retain `spec.type`, so calling this on a projection
 * built from a raw `'matrix'` spec returns a number shaped like a tile size
 * that isn't one. Callers that only ever build diamond projections (the
 * plugin's `makeDiamondHitArea`, which defaults a hit area's tile size from
 * the Scene's own projection) are exactly the case this is for.
 */
export function tileSizeOf(projection: Pick<Projection, 'a' | 'd'>): { tileWidth: number; tileHeight: number } {
    return { tileWidth: projection.a * 2, tileHeight: projection.d * 2 };
}
