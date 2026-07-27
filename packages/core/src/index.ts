/**
 * Il nucleo matematico puro di phaser-isometric.
 *
 * Zero import di Phaser: gira in Node. Lo stesso codice alimenta il plugin, i
 * test e i tool dell'oracolo MCP — due implementazioni della stessa proiezione
 * divergerebbero, sempre.
 *
 * CONVENZIONE, valida per ogni funzione: `project` restituisce il CENTRO della
 * faccia superiore della cella.
 */

export { createProjection } from './projection';
export type { Projection } from './projection';

export { createDepthAssigner, DEFAULT_BANDS, DEFAULT_LAYOUT } from './depth';
export type { DepthAssigner, DepthAssignerOptions } from './depth';

export { createHeightGrid } from './height-grid';
export type { HeightGrid } from './height-grid';

export { pick } from './picking';
export type { PickOptions } from './picking';

export { cullBounds } from './culling';
export type { CullPadding } from './culling';

export { worldBounds, contentBounds } from './bounds';

export { IsoConfigError } from './errors';

export type {
    Point,
    Cell,
    Rect,
    GridRect,
    HeightSource,
    ProjectionSpec,
    ProjectionOptions,
    Band,
    DepthLayout,
    DepthStrategy
} from './types';
