import { IsoConfigError, requireFinite, requirePositive } from './errors';
import type { Point, ProjectionSpec, ProjectionOptions } from './types';

/**
 * An isometric projection.
 *
 * CONVENTION, single and non-negotiable: `project` returns the CENTER of the
 * cell's top face. That is the choice that makes the rounding exact instead
 * of approximate — the set of points with round(gx)=0 and round(gy)=0 is the
 * unit square centered on the origin, which the matrix maps EXACTLY onto the
 * cell's diamond. This is precisely where Phaser contradicts itself:
 * IsometricTileToWorldXY returns the bounding-box corner while
 * IsometricWorldToTileXY assumes the diamond's vertex, so the round-trip
 * comes out shifted by half a cell.
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
