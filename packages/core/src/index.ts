/**
 * The pure mathematical core of phaser-isometric.
 *
 * Zero Phaser imports: runs in Node. The same code powers the plugin, the
 * tests, and the MCP oracle's tools — two implementations of the same
 * projection would eventually diverge.
 *
 * CONVENTION, valid for every function: `project` returns the CENTER of the
 * cell's top face.
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
