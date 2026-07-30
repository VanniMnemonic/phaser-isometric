// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import * as debugApi from '../src/debug';

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

describe('la superficie di phaser-isometric/debug', () => {
    // Congelata come le altre due entry. `IsoDebugOptions` e `IsoDebugOverlay`
    // sono interfacce, quindi non compaiono a runtime: qui c'e' tutto cio' che
    // il sottopath esporta come VALORE, ed e' uguaglianza per la stessa ragione
    // scritta nel gemello del core — un export in piu' e' un impegno preso
    // senza accorgersene, uno in meno e' un breaking change silenzioso.
    it('e esattamente createIsoDebug', () => {
        expect(new Set(Object.keys(debugApi))).toEqual(new Set(['createIsoDebug']));
    });

    it('e createIsoDebug e davvero una funzione', () => {
        expect(typeof debugApi.createIsoDebug).toBe('function');
    });
});
