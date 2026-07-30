import { describe, it, expect } from 'vitest';
import * as api from '../src/index';

const SUPERFICIE_ATTESA = [
    'DEFAULT_BANDS',
    'DEFAULT_LAYOUT',
    'IsoConfigError',
    'buildDebugModel',
    'buildDiagnosis',
    'contentBounds',
    'createDepthAssigner',
    'createHeightGrid',
    'createProjection',
    'cullBounds',
    'diamondPoints',
    'pick',
    'tileSizeOf',
    'worldBounds'
].sort();

describe('superficie pubblica del core', () => {
    it('esporta esattamente cio\' che dichiara, ne\' piu\' ne\' meno', () => {
        // Uguaglianza, non inclusione: un export in piu' e' un impegno di
        // manutenzione preso senza accorgersene, uno in meno e' un breaking
        // change silenzioso.
        expect(Object.keys(api).sort()).toEqual(SUPERFICIE_ATTESA);
    });

    it('le funzioni portanti sono davvero funzioni', () => {
        for (const nome of ['createProjection', 'createDepthAssigner', 'createHeightGrid', 'pick', 'cullBounds', 'worldBounds', 'contentBounds', 'tileSizeOf'] as const) {
            expect(typeof (api as Record<string, unknown>)[nome], nome).toBe('function');
        }
    });
});
