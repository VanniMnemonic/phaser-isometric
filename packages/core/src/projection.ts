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

    const origin: Point = opts.origin ?? { x: 0, y: 0 };
    if (!Number.isInteger(origin.x) || !Number.isInteger(origin.y)) {
        throw new IsoConfigError(
            `l'origine deve avere componenti intere (vale x=${origin.x} y=${origin.y})`,
            'arrotonda l\'origine: una traslazione frazionaria reintroduce l\'arrotondamento che la convenzione del centro elimina'
        );
    }

    function projectInto(out: Point, gx: number, gy: number, z = 0): Point {
        out.x = a * gx + c * gy + origin.x;
        out.y = b * gx + d * gy - z * elevationStep + origin.y;
        return out;
    }

    return Object.freeze({
        a, b, c, d, det, elevationStep,
        origin: Object.freeze({ ...origin }),
        project(gx: number, gy: number, z = 0): Point {
            return projectInto({ x: 0, y: 0 }, gx, gy, z);
        },
        projectInto
    });
}
