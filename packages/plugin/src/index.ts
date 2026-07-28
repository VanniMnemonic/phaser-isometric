import './phaser-augment.d.ts';

export { IsoPlugin, isoScenePlugin, ISO_PLUGIN_KEY, ISO_SYS_KEY } from './plugin';
export type { IsoConfigureOptions, IsoScenePluginOptions, Placeable } from './plugin';

export { IsoSprite } from './iso-sprite';

export { viewOf } from './camera';
export type { CameraScalars } from './camera';

export { applyDiamondHitArea } from './hit-area';
export type { DiamondHitAreaOptions, DiamondTarget } from './hit-area';

export type { IsoSnapshot } from './snapshot';

export { IsoUsageError } from './errors';

// Re-exported from the core: whoever uses the plugin should not need to know
// the core exists.
export {
    createProjection, createDepthAssigner, createHeightGrid,
    pick, cullBounds, worldBounds, contentBounds, diamondPoints,
    DEFAULT_BANDS, DEFAULT_LAYOUT, IsoConfigError
} from '@iso-internal/core';
export type {
    Projection, DepthAssigner, DepthAssignerOptions, HeightGrid, HeightSource,
    Point, Cell, Rect, GridRect, Band, DepthLayout, DepthStrategy,
    ProjectionSpec, ProjectionOptions, PickOptions, CullPadding, DiamondPointsOptions
} from '@iso-internal/core';
