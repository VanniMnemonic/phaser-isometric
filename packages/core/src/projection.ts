import { IsoConfigError } from './errors';
import type { Point, ProjectionSpec, ProjectionOptions } from './types';

/**
 * Una proiezione isometrica.
 *
 * CONVENZIONE, unica e non negoziabile: `project` restituisce il CENTRO della
 * faccia superiore della cella. E' la scelta che rende l'arrotondamento esatto
 * invece che approssimato — l'insieme dei punti con round(gx)=0 e round(gy)=0 e'
 * il quadrato di lato 1 centrato sull'origine, che attraverso la matrice e'
 * ESATTAMENTE il rombo della cella. Phaser si contraddice proprio qui:
 * IsometricTileToWorldXY restituisce l'angolo del bounding box mentre
 * IsometricWorldToTileXY assume il vertice del rombo, e il round-trip esce
 * sfasato di mezza cella.
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
    unproject(sx: number, sy: number, z?: number): Point;
    unprojectInto(out: Point, sx: number, sy: number, z?: number): Point;
}

function requireFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new IsoConfigError(
            `${name} non e' un numero finito (vale ${String(value)})`,
            `passa un numero finito per ${name}`
        );
    }
}

function requirePositive(value: number, name: string): void {
    requireFinite(value, name);
    if (value <= 0) {
        throw new IsoConfigError(
            `${name} deve essere maggiore di zero (vale ${value})`,
            `passa un ${name} positivo, per esempio 96`
        );
    }
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
            `la matrice di proiezione non e' invertibile (det = 0, a=${a} b=${b} c=${c} d=${d})`,
            'le colonne (a,b) e (c,d) sono collineari: cambiane una, oppure usa il preset diamond'
        );
    }

    const rawOrigin: Point = opts.origin ?? { x: 0, y: 0 };
    if (!Number.isInteger(rawOrigin.x) || !Number.isInteger(rawOrigin.y)) {
        throw new IsoConfigError(
            `l'origine deve avere componenti intere (vale x=${rawOrigin.x} y=${rawOrigin.y})`,
            'arrotonda l\'origine: una traslazione frazionaria reintroduce l\'arrotondamento che la convenzione del centro elimina'
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
        unprojectInto
    });
}
