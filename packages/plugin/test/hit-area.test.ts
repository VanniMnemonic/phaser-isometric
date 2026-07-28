// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import type { IsoSprite } from '../src/iso-sprite';

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

describe('makeDiamondHitArea', () => {
    it('installa un vero Phaser.Geom.Polygon, non un oggetto qualunque', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        expect(s.input).toBeTruthy();
        expect(s.input!.hitArea).toBeInstanceOf(Phaser.Geom.Polygon);
    });

    it('la callback e Polygon.Contains, usabile direttamente', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        expect(s.input!.hitAreaCallback).toBe(Phaser.Geom.Polygon.Contains);
    });

    it('il poligono coincide con diamondPoints per quel frame', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        const centro = { x: s.displayOriginX, y: s.displayOriginY };

        // Il centro e' dentro; i quattro punti a mezzo tile in diagonale sono fuori.
        expect(Phaser.Geom.Polygon.Contains(poly, centro.x, centro.y)).toBe(true);
        expect(Phaser.Geom.Polygon.Contains(poly, centro.x + 47, centro.y - 23)).toBe(false);
    });

    it('NON legge i punti come Vector2: sono letterali {x,y}', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        // Il .d.ts dichiara Vector2[]; a runtime sono letterali. Un .clone()
        // compilerebbe e poi lancerebbe.
        expect((poly.points[0] as unknown as { clone?: unknown }).clone).toBeUndefined();
        expect(typeof poly.points[0]!.x).toBe('number');
    });

    it('ri-chiamarla sostituisce la hit area SUL POSTO, senza spegnere l input', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        // Avanza un frame vero (emette lo stesso evento che Systems.step emette
        // ogni frame): e' il momento in cui InputPlugin.preUpdate svuota
        // _pendingInsertion dentro _list. Senza questo passo il test
        // osserverebbe solo la finestra BREVE prima del difetto che il
        // reviewer ha trovato empiricamente: chiamare la seconda volta prima
        // che l'oggetto sia davvero entrato in _list nasconde il problema,
        // perche' la rimozione differita di InputPlugin.preUpdate non trova
        // nulla da spliciare.
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        const primo = s.input!.hitArea as Phaser.Geom.Polygon;
        const primoAlto = primo.points[0]!.y;

        scene.iso.makeDiamondHitArea(s, { tileHeight: 96 });

        // Ancora un frame vero: e' ESATTAMENTE il momento in cui il pattern
        // remove-then-set (removeInteractive() poi setInteractive()) si
        // romperebbe. removeInteractive() chiama solo InputPlugin.clear, che
        // mette l'oggetto in coda per la rimozione (_pendingRemoval) senza
        // toglierlo subito da _list; il setInteractive() che segue lo trova
        // ancora in _list e quindi non lo rimette in coda per l'inserimento.
        // A QUESTO preUpdate, l'oggetto risulterebbe sia in _pendingRemoval
        // sia in _list: verrebbe spliciato via e clear() scatterebbe una
        // SECONDA volta, questa volta sul nuovo InteractiveObject appena
        // installato, azzerando target.input per sempre.
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        // Prima meta': la hit area e' davvero cambiata (non solo riabilitata).
        expect((s.input!.hitArea as Phaser.Geom.Polygon).points[0]!.y).not.toBe(primoAlto);

        // Seconda meta', quella che il pattern rotto avrebbe fatto fallire in
        // silenzio un frame dopo: l'oggetto e' ancora interattivo per davvero,
        // non solo con un poligono nuovo ma vivo nella lista interna
        // dell'InputPlugin. _list e' privato (nessun accessor pubblico), da
        // qui il cast — lo stesso schema gia' usato altrove in questo
        // pacchetto per leggere campi interni di Phaser (vedi `_depth` in
        // iso-sprite.test.ts).
        expect(s.input).not.toBeNull();
        const lista = (scene.input as unknown as { _list: unknown[] })._list;
        expect(lista).toContain(s);
    });

    it('restituisce l oggetto', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        expect(scene.iso.makeDiamondHitArea(s)).toBe(s);
    });
});
