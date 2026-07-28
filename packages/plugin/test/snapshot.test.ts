// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';
import type { IsoSnapshot } from '../src/snapshot';
import { createHeightGrid } from '@iso-internal/core';
import type { HeightSource } from '@iso-internal/core';
import type { IsoSprite } from '../src/iso-sprite';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` and `scene.add.isoSprite` are not part of Phaser's own types —
 * that global augmentation is Task 10's deliverable, not this task's. Until
 * it lands, every direct property access in this file goes through this
 * local, test-only widening instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & {
    iso: IsoPlugin;
    add: Phaser.GameObjects.GameObjectFactory & {
        isoSprite(gx: number, gy: number, texture: string, frame?: string | number): IsoSprite;
    };
};

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(extra: Record<string, unknown> = {}): Promise<SceneWithIso> {
    return bootGame({
        plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] },
        ...extra
    }) as Promise<SceneWithIso>;
}

describe('snapshot() — round-trip JSON', () => {
    it('non lancia e fa round-trip identico: e il test che prende un riferimento a Phaser sfuggito', async () => {
        const scene = await conIso();

        scene.cameras.main.setZoom(1.5);
        scene.cameras.main.setScroll(37, -19);
        scene.iso.setHeights(createHeightGrid(5, 5, 0));
        scene.iso.follow({ gx: 1, gy: 1 });
        scene.add.isoSprite(0, 0, '__DEFAULT');
        scene.add.sprite(0, 0, '__DEFAULT');

        const snap = scene.iso.snapshot();

        let json = '';
        expect(() => { json = JSON.stringify(snap); }).not.toThrow();
        expect(JSON.parse(json)).toEqual(snap);

        // La guardia che il round-trip da solo non darebbe: JSON.stringify(-0)
        // e' "0", quindi un -0 nascosto in un campo calcolato per sottrazione
        // (camera.view) tornerebbe indistinguibile da 0 dopo il giro JSON.
        expect(Object.is(snap.camera?.view.x, -0)).toBe(false);
        expect(Object.is(snap.camera?.view.y, -0)).toBe(false);
    });
});

describe('snapshot() — plugin non configurato', () => {
    it('configured false, projection/depth null, nessun throw', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        }) as SceneWithIso;

        let snap: IsoSnapshot | undefined;
        expect(() => { snap = scene.iso.snapshot(); }).not.toThrow();

        expect(snap?.configured).toBe(false);
        expect(snap?.projection).toBeNull();
        expect(snap?.depth).toBeNull();
    });
});

describe('snapshot() — mapping', () => {
    it('riporta il mapping reale, e riporta null quando il plugin e installato senza (il caso scene["null"])', async () => {
        const conMapping = await conIso();
        expect(conMapping.iso.snapshot().mapping).toBe('iso');

        // Obbligatorio fra i due boot di QUESTO test: la PluginCache e' un
        // singleton di modulo (vedi helper.ts). Senza dimenticare la entry
        // 'iso' del primo boot, il secondo bootGame() la troverebbe gia'
        // registrata e salterebbe la propria (nessun mapping) in silenzio —
        // scene['null'] resterebbe undefined per il motivo sbagliato.
        forgetScenePlugin(ISO_PLUGIN_KEY);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const scene = await bootGame({
            plugins: {
                // La forma ESATTA dell'@example ufficiale di Phaser, gia' usata in
                // install.test.ts: nessun `mapping`, quindi il plugin finisce su
                // scene["null"].
                scene: [{ key: ISO_PLUGIN_KEY, plugin: IsoPlugin, systemKey: 'isoSys', sceneKey: 'iso' }]
            }
        });
        warn.mockRestore();

        const plugin = (scene as unknown as Record<string, unknown>)['null'] as IsoPlugin;
        expect(plugin.snapshot().mapping).toBeNull();
    });
});

describe('snapshot() — camera.view', () => {
    it('coincide con iso.view()', async () => {
        const scene = await conIso();
        scene.cameras.main.setZoom(2);
        scene.cameras.main.setScroll(100, 50);

        const snap = scene.iso.snapshot();
        expect(snap.camera?.view).toEqual(scene.iso.view());
    });
});

describe('snapshot() — heights', () => {
    it('passa da none a grid dopo setHeights(createHeightGrid(...)), e a custom con una sorgente scritta a mano', async () => {
        const scene = await conIso();

        expect(scene.iso.snapshot().heights).toEqual({ kind: 'none' });

        scene.iso.setHeights(createHeightGrid(4, 3, 0));
        expect(scene.iso.snapshot().heights).toEqual({ kind: 'grid', width: 4, height: 3, maxElevation: 0 });

        const fattaAMano: HeightSource = { heightAt: () => 5 };
        scene.iso.setHeights(fattaAMano);
        expect(scene.iso.snapshot().heights).toEqual({ kind: 'custom', maxElevation: null });
    });
});

describe('snapshot() — isoSprites', () => {
    it('conta solo gli IsoSprite, non gli Sprite normali', async () => {
        const scene = await conIso();

        scene.add.sprite(0, 0, '__DEFAULT');
        scene.add.sprite(0, 0, '__DEFAULT');
        scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(scene.iso.snapshot().isoSprites).toBe(1);
    });
});

describe('snapshot() — dopo destroy()', () => {
    it('booted false e camera null, sempre senza lanciare', async () => {
        const scene = await conIso();
        const plugin = scene.iso;

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);

        let snap: IsoSnapshot | undefined;
        expect(() => { snap = plugin.snapshot(); }).not.toThrow();
        expect(snap?.booted).toBe(false);
        expect(snap?.camera).toBeNull();

        // mappingValido va rilasciato in destroy() come proiezione/assegnatore/
        // sorgenteQuote: altrimenti questo stesso snapshot riporterebbe un
        // mapping ancora valido mentre booted/camera sono gia' null — due
        // momenti diversi nello stesso oggetto.
        expect(snap?.mapping).toBeNull();
    });
});
