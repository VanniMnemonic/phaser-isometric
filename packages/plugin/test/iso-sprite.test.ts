// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { IsoSprite } from '../src/iso-sprite';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` and `scene.add.isoSprite` are not part of Phaser's own types —
 * that global augmentation is Task 10's deliverable, not this task's. Until
 * it lands, every direct property access in this file goes through this
 * local, test-only widening instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & {
    iso: import('../src/plugin').IsoPlugin;
    add: Phaser.GameObjects.GameObjectFactory & {
        isoSprite(gx: number, gy: number, texture: string, frame?: string | number): IsoSprite;
    };
};

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso() {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } }) as Promise<SceneWithIso>;
}

describe('la factory', () => {
    it('rende this.add.isoSprite chiamabile', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(2, 1, '__DEFAULT');

        expect(s).toBeInstanceOf(IsoSprite);
        expect(s.gx).toBe(2);
        expect(s.gy).toBe(1);
    });

    it('posiziona e ordina passando da place(), non per conto proprio', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(1, 0, '__DEFAULT');

        expect(s.x).toBe(48);
        expect(s.y).toBe(24);
        expect(s.depth).toBe(scene.iso.depth.keyFor(1, 0, scene.iso.bands.prop, 0));
    });

    it('iscrive l oggetto al display list UNA volta, e all update list UNA volta', async () => {
        const scene = await conIso();
        // ProcessQueue (con checkQueue = true, impostato dal costruttore di
        // UpdateList) DEDUPLICA in silenzio un secondo add() dello stesso
        // riferimento, sia mentre e' ancora pending sia dopo che e' gia'
        // active — misurato: getActive().length resta 1 in entrambi i casi.
        // Contare la lista attiva quindi NON scopre un doppio add fatto a
        // mano dalla factory; serve una spia sulle CHIAMATE.
        const addSpy = vi.spyOn(scene.sys.updateList, 'add');

        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(scene.sys.displayList.list.filter(o => o === s)).toHaveLength(1);
        // Sprite.addedToScene() lo iscrive da solo: se la factory lo aggiunge
        // ANCHE lei a mano, qui si vedrebbero 2 chiamate.
        expect(addSpy).toHaveBeenCalledTimes(1);
        expect(addSpy).toHaveBeenCalledWith(s);

        // Sotto HEADLESS l'update non parte da solo (nessun tick e' passato):
        // va pompato a mano, come si fa con depthSort() per il display list.
        scene.sys.updateList.update();
        expect(scene.sys.updateList.getActive().filter(o => o === s)).toHaveLength(1);
    });

    it('sopravvive alla registrazione ripetuta su N+1 costruzioni', async () => {
        // Il costruttore del plugin gira per __SYSTEM e per la scena utente.
        // register() e' guardato da hasOwnProperty, quindi la seconda e' un no-op.
        const scene = await conIso();
        expect(typeof scene.add.isoSprite).toBe('function');
    });

    it('un add.isoSprite che fallisce non lascia nulla nel display list', async () => {
        const scene = await conIso();
        const lunghezzaPrima = scene.sys.displayList.list.length;

        // gx frazionario: solo keyFor() lo rifiuta dentro setCell(), projectInto
        // no. Se la factory chiamasse displayList.add() PRIMA di setCell(), uno
        // sprite mezzo inizializzato resterebbe orfano nella lista anche se la
        // chiamata a scene.add.isoSprite(...) lancia e non restituisce nulla.
        expect(() => scene.add.isoSprite(1.5, 0, '__DEFAULT')).toThrow();

        expect(scene.sys.displayList.list).toHaveLength(lunghezzaPrima);
    });
});

describe('IsoSprite', () => {
    it('setCell riposiziona e riordina', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setCell(2, 3);

        expect(s.gx).toBe(2);
        expect(s.gy).toBe(3);
        expect(s.x).toBe(scene.iso.projection.project(2, 3).x);
        expect(s.depth).toBe(scene.iso.depth.keyFor(2, 3, scene.iso.bands.prop, 0));
    });

    it('setCell conserva banda ed elevazione quando non gliele si passa', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setCell(0, 0, 3, scene.iso.bands.hero);
        s.setCell(1, 1);

        expect(s.elevation).toBe(3);
        expect(s.band).toBe(scene.iso.bands.hero);
        expect(s.depth).toBe(scene.iso.depth.keyFor(1, 1, scene.iso.bands.hero, 0));
    });

    it('NON si appropria di `z`, che resta la proprieta di Phaser', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setCell(0, 0, 5);

        expect(s.elevation).toBe(5);
        // Transform.z e' un campo dati che Phaser lascia all'utente e che non
        // controlla il rendering. Non lo tocchiamo.
        expect(s.z).toBe(0);
    });

    it('setDepth resta l accessor di Phaser, non un campo che lo shadowa', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setDepth(42);

        // Se un campo di classe shadowasse l'accessor `depth`, questo leggerebbe
        // ancora 42 ma `_depth` resterebbe fermo e il renderer ordinerebbe su
        // quello. Controlliamo entrambi.
        expect(s.depth).toBe(42);
        expect((s as unknown as { _depth: number })._depth).toBe(42);
    });

    it('setCell restituisce this', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        expect(s.setCell(1, 1)).toBe(s);
    });
});

describe('setCell() e atomico: valida prima di mutare', () => {
    it('un setCell che fallisce non lascia alcuno stato a meta', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        // Cella e posizione di partenza distinguibili (non zero, non default),
        // cosi' "intatto" qui sotto e' un confronto vero contro un valore
        // scelto apposta, non contro cio' che capiterebbe di default.
        s.setCell(2, 3, 5, scene.iso.bands.hero, 7);

        const gx = s.gx, gy = s.gy, elevation = s.elevation, band = s.band, sub = s.sub;
        const x = s.x, y = s.y, depth = s.depth;

        // band = 99 e' fuori da maxBands (16 di default): solo keyFor() dentro
        // place() lo scopre, projectInto no. Se setCell() scrivesse i campi
        // della cella PRIMA di chiamare place(), qui sotto gx/gy/band/sub
        // risulterebbero gia' corrotti nonostante il throw.
        expect(() => s.setCell(9, 9, 0, 99)).toThrow();

        expect(s.gx).toBe(gx);
        expect(s.gy).toBe(gy);
        expect(s.elevation).toBe(elevation);
        expect(s.band).toBe(band);
        expect(s.sub).toBe(sub);
        expect(s.x).toBe(x);
        expect(s.y).toBe(y);
        expect(s.depth).toBe(depth);
    });
});
