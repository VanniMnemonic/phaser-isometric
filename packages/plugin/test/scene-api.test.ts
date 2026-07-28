// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createHeightGrid } from '@iso-internal/core';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import type { IsoPlugin } from '../src/plugin';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` is not part of Phaser's own types — that global augmentation is
 * Task 10's deliverable, not this task's. Until it lands, every direct
 * property access in this file goes through this local, test-only widening
 * instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & { iso: IsoPlugin };

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(): Promise<SceneWithIso> {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } }) as Promise<SceneWithIso>;
}

describe('pick()', () => {
    it('senza heightmap restituisce null invece di lanciare', async () => {
        const scene = await conIso();
        expect(scene.iso.pick(0, 0)).toBeNull();
    });

    it('trova la cella sotto un punto del mondo', async () => {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(8, 8, 0));

        expect(scene.iso.pick(0, 0)).toEqual({ gx: 0, gy: 0, z: 0 });
        expect(scene.iso.pick(48, 24)).toEqual({ gx: 1, gy: 0, z: 0 });
    });

    it('rispetta l elevazione: una torre vicina copre il pavimento dietro', async () => {
        const scene = await conIso();
        const griglia = createHeightGrid(8, 8, 0);
        griglia.setHeight(2, 2, 3);
        scene.iso.setHeights(griglia);

        const cima = scene.iso.projection.project(2, 2, 3);
        expect(scene.iso.pick(cima.x, cima.y)).toEqual({ gx: 2, gy: 2, z: 3 });
    });

    it('fuori dalla griglia restituisce null, mai un errore', async () => {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(4, 4, 0));
        expect(scene.iso.pick(100000, 100000)).toBeNull();
    });

    it('un punto non finito restituisce null: il percorso caldo non lancia', async () => {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(4, 4, 0));
        expect(scene.iso.pick(NaN, 0)).toBeNull();
    });
});

describe('cull()', () => {
    it('restituisce un intervallo di celle dalla vista corrente', async () => {
        const scene = await conIso();
        const r = scene.iso.cull({ above: 0, below: 0, sides: 0 });

        expect(r.minX).toBeLessThanOrEqual(r.maxX);
        expect(r.minY).toBeLessThanOrEqual(r.maxY);
    });

    it('e conservativo: allargare il padding non puo restringere il risultato', async () => {
        const scene = await conIso();
        const stretto = scene.iso.cull({ above: 0, below: 0, sides: 0 });
        const largo = scene.iso.cull({ above: 200, below: 200, sides: 200 });

        expect(largo.minX).toBeLessThanOrEqual(stretto.minX);
        expect(largo.maxX).toBeGreaterThanOrEqual(stretto.maxX);
        expect(largo.minY).toBeLessThanOrEqual(stretto.minY);
        expect(largo.maxY).toBeGreaterThanOrEqual(stretto.maxY);
    });

    it('segue lo scroll della camera SENZA aspettare un frame', async () => {
        const scene = await conIso();
        const prima = scene.iso.cull({ above: 0, below: 0, sides: 0 });

        scene.cameras.main.setScroll(5000, 5000);

        // Nessun preRender, nessun frame: la vista si ricostruisce da scalari
        // vivi. Se leggessimo worldView, questo test vedrebbe il rettangolo
        // vecchio e passerebbe con il valore sbagliato.
        const dopo = scene.iso.cull({ above: 0, below: 0, sides: 0 });
        expect(dopo.minX).not.toBe(prima.minX);
    });
});
