// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { createHeightGrid, tileSizeOf } from '@iso-internal/core';
import type { IsoSprite } from '../src/iso-sprite';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(): Promise<Phaser.Scene> {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
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

describe('il rombo vero e pick() concordano sul confine condiviso (Task 12 fix round 2)', () => {
    // I tre test aggiunti a picking.test.ts (Task 12 fix round 1) pinnano la
    // CONVENZIONE di pick() (-Math.round(-y)+0 su gy) ma non chiamano mai
    // Phaser: se la derivazione della meta' del rombo fosse stata al
    // contrario, quei test l'avrebbero pinnata comunque, felicemente
    // sbagliata. Qui si chiude il cerchio per davvero: si costruisce il
    // rombo con `makeDiamondHitArea` (lo stesso codice che gira in
    // produzione), si chiama `Phaser.Geom.Polygon.Contains` — non una sua
    // reimplementazione — e si confronta il suo verdetto con quello di
    // `iso.pick()` sullo STESSO punto esatto di confine.

    async function conCelleAdiacenti(): Promise<Phaser.Scene> {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(8, 8, 0));
        return scene;
    }

    function pescabile(scene: Phaser.Scene, gx: number, gy: number): IsoSprite {
        const s = scene.add.isoSprite(gx, gy, '__DEFAULT').setCell(gx, gy, 0, scene.iso.bands.floor);
        scene.iso.makeDiamondHitArea(s);
        return s;
    }

    /** Il punto MONDO nello spazio frame-locale che la hitAreaCallback riceve
     *  davvero: origine display gia' sommata (vedi hit-area.ts del core). */
    function frameLocale(s: IsoSprite, worldX: number, worldY: number): { x: number; y: number } {
        return { x: (worldX - s.x) + s.displayOriginX, y: (worldY - s.y) + s.displayOriginY };
    }

    it('gy = n+0.5: il rombo E pick() concordano sulla cella n, non n+1', async () => {
        const scene = await conCelleAdiacenti();
        const bassa = pescabile(scene, 3, 5); // n
        const alta = pescabile(scene, 3, 6);  // n+1

        // project() non valida input frazionari: costruisce il punto esatto
        // del confine condiviso, non un'approssimazione.
        const confine = scene.iso.projection.project(3, 5.5, 0);

        const puntoInBassa = frameLocale(bassa, confine.x, confine.y);
        const puntoInAlta = frameLocale(alta, confine.x, confine.y);

        expect(Phaser.Geom.Polygon.Contains(bassa.input!.hitArea as Phaser.Geom.Polygon, puntoInBassa.x, puntoInBassa.y)).toBe(true);
        expect(Phaser.Geom.Polygon.Contains(alta.input!.hitArea as Phaser.Geom.Polygon, puntoInAlta.x, puntoInAlta.y)).toBe(false);

        // Lo stesso punto, passato a pick(): deve nominare la STESSA cella
        // che il rombo vero ha appena rivendicato sopra.
        expect(scene.iso.pick(confine.x, confine.y)).toEqual({ gx: 3, gy: 5, z: 0 });
    });

    it('gx = n+0.5: il rombo E pick() concordano sulla cella n+1 (asse invariato, non toccato dal fix)', async () => {
        const scene = await conCelleAdiacenti();
        const sinistra = pescabile(scene, 3, 5); // n
        const destra = pescabile(scene, 4, 5);   // n+1

        const confine = scene.iso.projection.project(3.5, 5, 0);

        const puntoInSinistra = frameLocale(sinistra, confine.x, confine.y);
        const puntoInDestra = frameLocale(destra, confine.x, confine.y);

        expect(Phaser.Geom.Polygon.Contains(sinistra.input!.hitArea as Phaser.Geom.Polygon, puntoInSinistra.x, puntoInSinistra.y)).toBe(false);
        expect(Phaser.Geom.Polygon.Contains(destra.input!.hitArea as Phaser.Geom.Polygon, puntoInDestra.x, puntoInDestra.y)).toBe(true);

        expect(scene.iso.pick(confine.x, confine.y)).toEqual({ gx: 4, gy: 5, z: 0 });
    });

    it('dei quattro vertici del rombo, solo quello sinistro appartiene al proprio rombo', async () => {
        // Un vertice e' un pareggio su ENTRAMBI gli assi insieme (un angolo a
        // 4 vie fra celle), un caso piu' composto dei confini a un solo asse
        // sopra. Verificato con l'algoritmo pnpoly reale di Phaser prima di
        // scrivere questo test (non assunto): dei quattro vertici del rombo
        // (alto, destro, basso, sinistro), SOLO il sinistro risulta dentro il
        // proprio poligono — l'asimmetria che una derivazione futura
        // potrebbe rompere senza accorgersene, se nulla la pinna.
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        const { tileWidth, tileHeight } = tileSizeOf(scene.iso.projection);
        const hw = tileWidth / 2;
        const hh = tileHeight / 2;
        const cx = s.displayOriginX;
        const cy = s.displayOriginY;

        const alto = { x: cx, y: cy - hh };
        const destro = { x: cx + hw, y: cy };
        const basso = { x: cx, y: cy + hh };
        const sinistro = { x: cx - hw, y: cy };

        expect(Phaser.Geom.Polygon.Contains(poly, alto.x, alto.y)).toBe(false);
        expect(Phaser.Geom.Polygon.Contains(poly, destro.x, destro.y)).toBe(false);
        expect(Phaser.Geom.Polygon.Contains(poly, basso.x, basso.y)).toBe(false);
        expect(Phaser.Geom.Polygon.Contains(poly, sinistro.x, sinistro.y)).toBe(true);
    });
});
