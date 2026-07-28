// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { IsoUsageError } from '../src/errors';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(): Promise<Phaser.Scene> {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
}

describe('place()', () => {
    it('mette l oggetto sul CENTRO della cella', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(s, 1, 0);

        // Il centro della cella (1,0) sul preset diamond 96x48.
        expect(s.x).toBe(48);
        expect(s.y).toBe(24);
    });

    it('l elevazione ALZA l oggetto sullo schermo', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(s, 0, 0, 2);

        // elevationStep di default = tileHeight / 2 = 24. Due quote = 48 px in SU,
        // cioe' y NEGATIVO: e' il segno che si sbaglia per primo.
        expect(s.y).toBe(-48);
    });

    it('assegna la chiave di depth calcolata dal core', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(s, 3, 4, 0, scene.iso.bands.actor);

        expect(s.depth).toBe(scene.iso.depth.keyFor(3, 4, scene.iso.bands.actor, 0));
        expect(s.depth).toBe((3 + 4) * 4096 + 4 * 256);
    });

    it('una cella piu avanti vince sempre su una banda piu alta', async () => {
        const scene = await conIso();
        const dietro = scene.add.sprite(0, 0, '__DEFAULT');
        const davanti = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(dietro, 0, 0, 0, scene.iso.bands.overlay);
        scene.iso.place(davanti, 1, 0, 0, scene.iso.bands.floor);

        // E' la garanzia che il layout di depth del core compra: la riga domina
        // la banda. Se questa cade, rowStride e' stato manomesso.
        expect(davanti.depth).toBeGreaterThan(dietro.depth);
    });

    it('N place() producono UN SOLO sort per frame', async () => {
        const scene = await conIso();
        const dl = scene.sys.displayList;
        const spia = vi.spyOn(dl, 'depthSort');

        const sprites = Array.from({ length: 20 }, () => scene.add.sprite(0, 0, '__DEFAULT'));
        sprites.forEach((s, i) => scene.iso.place(s, i, 0));

        // setDepth alza un singolo booleano (sortChildrenFlag); il sort vero
        // avviene una volta, in fase di render. Questo test e' la ragione per cui
        // NON scriviamo `_depth` a mano e NON esiste un commitDepths().
        expect(spia).not.toHaveBeenCalled();
        expect(dl.sortChildrenFlag).toBe(true);

        // Sotto HEADLESS il sort non parte da solo: `Systems#render` non gira.
        // Si pompa dall'API pubblica, non chiamando dl.depthSort() direttamente.
        scene.sys.depthSort();
        expect(spia).toHaveBeenCalledTimes(1);
        expect(dl.sortChildrenFlag).toBe(false);
    });

    it('restituisce l oggetto, cosi si concatena', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');
        expect(scene.iso.place(s, 0, 0)).toBe(s);
    });

    it('place() prima di configure() lancia IsoUsageError', async () => {
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin()] } });
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        expect(() => scene.iso.place(s, 0, 0)).toThrow(IsoUsageError);
    });

    it('una coordinata frazionaria viene rifiutata dal core, non arrotondata in silenzio', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        // La garanzia "la riga domina la banda" vale solo su gx/gy interi.
        expect(() => scene.iso.place(s, 1.5, 0)).toThrow();
    });
});

describe('place() e atomico: valida prima di mutare', () => {
    // In tutti e tre questi test, gx/gy validi da soli farebbero comunque
    // GIRARE projectInto senza errori (non controlla gx/gy, e non vede affatto
    // band/sub). Solo `keyFor` puo' rifiutare la chiamata. Se venisse chiamato
    // DOPO aver scritto target.x/y (il vecchio ordine), il target risulterebbe
    // spostato con una posizione "buona" ma nessuna depth aggiornata — uno
    // stato a meta'. Ogni test qui parte da una posizione/depth distinguibile
    // (non zero) apposta per rendere "intatto" un confronto vero, non un
    // confronto con il valore di default.

    it('gx frazionario lancia e lascia il target intatto (nessuna scrittura parziale)', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');
        s.x = 111;
        s.y = 222;
        s.setDepth(333);

        expect(() => scene.iso.place(s, 1.5, 0)).toThrow();

        expect(s.x).toBe(111);
        expect(s.y).toBe(222);
        expect(s.depth).toBe(333);
    });

    it('una band fuori range lancia e lascia il target intatto', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');
        s.x = 111;
        s.y = 222;
        s.setDepth(333);

        // band = 99 e' fuori da maxBands (16 di default). gx/gy sono validi:
        // solo keyFor puo' accorgersi che la chiamata e' da rifiutare.
        expect(() => scene.iso.place(s, 1, 1, 0, 99)).toThrow();

        expect(s.x).toBe(111);
        expect(s.y).toBe(222);
        expect(s.depth).toBe(333);
    });

    it('un sub fuori range lancia e lascia il target intatto', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');
        s.x = 111;
        s.y = 222;
        s.setDepth(333);

        // sub = 256 e' fuori da subCapacity (256 di default, range 0..255).
        expect(() => scene.iso.place(s, 1, 1, 0, scene.iso.bands.prop, 256)).toThrow();

        expect(s.x).toBe(111);
        expect(s.y).toBe(222);
        expect(s.depth).toBe(333);
    });
});
