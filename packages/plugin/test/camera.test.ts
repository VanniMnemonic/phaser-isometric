// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';
import { viewOf } from '../src/camera';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` is not part of Phaser's own types — that global augmentation
 * is Task 10's deliverable, not this task's. Until it lands, every direct
 * property access in this file goes through this local, test-only widening
 * instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & { iso: IsoPlugin };

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(extra: Record<string, unknown> = {}): Promise<SceneWithIso> {
    return bootGame({
        plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] },
        ...extra
    }) as Promise<SceneWithIso>;
}

describe('viewOf — pura, nessun Phaser richiesto', () => {
    it('ricostruisce la vista da scalari vivi', () => {
        const finta = { width: 800, height: 600, zoomX: 1, zoomY: 1, scrollX: 0, scrollY: 0 };
        expect(viewOf(finta)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    });

    it('lo zoom RESTRINGE la vista e la tiene centrata', () => {
        const finta = { width: 800, height: 600, zoomX: 2, zoomY: 2, scrollX: 0, scrollY: 0 };
        // A zoom 2 si vede meta' mondo, centrato sullo stesso punto.
        expect(viewOf(finta)).toEqual({ x: 200, y: 150, width: 400, height: 300 });
    });

    it('lo scroll trasla la vista senza cambiarne la misura', () => {
        const finta = { width: 800, height: 600, zoomX: 1, zoomY: 1, scrollX: 100, scrollY: -50 };
        expect(viewOf(finta)).toEqual({ x: 100, y: -50, width: 800, height: 600 });
    });
});

describe('follow()', () => {
    it('NON spegne roundPixels quando la config lo voleva acceso', async () => {
        const scene = await conIso({ render: { roundPixels: true } });
        expect(scene.cameras.main.roundPixels).toBe(true);

        scene.iso.follow({ gx: 0, gy: 0 });

        // startFollow(target) da solo lo azzera: e' il difetto che questo test
        // esiste per prendere, e sembra un problema di filtraggio delle texture.
        expect(scene.cameras.main.roundPixels).toBe(true);
    });

    it('non lo ACCENDE se la config non lo voleva', async () => {
        const scene = await conIso({ render: { roundPixels: false } });
        scene.iso.follow({ gx: 0, gy: 0 });
        expect(scene.cameras.main.roundPixels).toBe(false);
    });

    it('segue un bersaglio in coordinate di GRIGLIA, proiettandolo', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 2, gy: 0 };

        scene.iso.follow(bersaglio);
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        const atteso = scene.iso.projection.project(2, 0);
        const proxy = (scene.cameras.main as unknown as { _follow: { x: number; y: number } })._follow;
        expect(proxy.x).toBe(atteso.x);
        expect(proxy.y).toBe(atteso.y);
    });

    it('muta il proxy SUL POSTO: l identita non cambia mai', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 0, gy: 0 };
        scene.iso.follow(bersaglio);

        const cam = scene.cameras.main as unknown as { _follow: object };
        const primaIdentita = cam._follow;

        bersaglio.gx = 5;
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        // Riassegnare un oggetto nuovo romperebbe il riferimento _follow e la
        // camera resterebbe ferma per sempre, senza errori.
        expect(cam._follow).toBe(primaIdentita);
        expect((cam._follow as { x: number }).x).toBe(scene.iso.projection.project(5, 0).x);
    });

    it('stopFollow smette di aggiornare', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 0, gy: 0 };
        scene.iso.follow(bersaglio);
        scene.iso.stopFollow();

        bersaglio.gx = 9;
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        expect((scene.cameras.main as unknown as { _follow: unknown })._follow).toBeNull();
    });

    it('smette di aggiornare dopo lo shutdown della Scene', async () => {
        const scene = await conIso();
        scene.iso.follow({ gx: 0, gy: 0 });

        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);

        // Se il listener PRE_UPDATE sopravvive allo shutdown, continua a girare
        // su una camera che la Scene sta smontando.
        expect(scene.sys.events.listenerCount(Phaser.Scenes.Events.PRE_UPDATE)).toBe(0);
    });
});

describe('cameraBounds()', () => {
    it('usa la formula isometrica, non quella ortogonale', async () => {
        const scene = await conIso();

        scene.iso.cameraBounds(10, 10);

        const b = scene.cameras.main.getBounds();
        // (W+H)*tw/2 = 20*48 = 960 di larghezza, e la x parte NEGATIVA.
        // La formula ortogonale darebbe 10*96 = 960 con x = 0: stessa larghezza,
        // origine sbagliata. E' esattamente il difetto di map.widthInPixels.
        expect(b.width).toBe(960);
        expect(b.x).toBeLessThan(0);
    });
});
