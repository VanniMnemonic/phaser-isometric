// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';

const ATTESI = new Set([
    'IsoPlugin', 'isoScenePlugin', 'ISO_PLUGIN_KEY',
    'IsoSprite', 'viewOf', 'applyDiamondHitArea', 'IsoUsageError',
    'createProjection', 'createDepthAssigner', 'createHeightGrid',
    'pick', 'cullBounds', 'worldBounds', 'contentBounds', 'diamondPoints',
    'tileSizeOf',
    'DEFAULT_BANDS', 'DEFAULT_LAYOUT', 'IsoConfigError'
]);

describe('la superficie pubblica', () => {
    it('e esattamente questa', () => {
        expect(new Set(Object.keys(api))).toEqual(ATTESI);
    });
});
