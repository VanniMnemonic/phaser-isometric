// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { buildDiagnosis, createHeightGrid, IsoConfigError, tileSizeOf } from '@iso-internal/core';
import type { IsoSprite } from '../src/iso-sprite';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * L'assonometria del pannello di un editor vettoriale: elevazione 30 gradi,
 * orientamento 15, scala cubo 144. Le celle NON sono rombi — sono
 * parallelogrammi sghembi, e i quattro vertici veri cadono esattamente sui
 * lati del rombo che `tileSizeOf` farebbe costruire, che e' il motivo per cui
 * la forma sbagliata non si vede finche' non si contano i click.
 */
const E = (30 * Math.PI) / 180;
const O = (15 * Math.PI) / 180;
const SCALA = 144;
const SGHEMBA = {
    type: 'matrix',
    a: SCALA * Math.cos(O),
    b: SCALA * Math.sin(O) * Math.sin(E),
    c: -SCALA * Math.sin(O),
    d: SCALA * Math.cos(O) * Math.sin(E),
    elevationStep: SCALA * Math.cos(E)
} as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(): Promise<Phaser.Scene> {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
}

function conAssonometria(): Promise<Phaser.Scene> {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: SGHEMBA })] } });
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

describe('assonometria sghemba: la cella non e un rombo', () => {
    // Il buco che questa suite aveva: nessuno dei suoi file istanziava una
    // spec `matrix`, quindi il comportamento GIUSTO e quello SBAGLIATO
    // passavano entrambi invariati. Le celle di questa proiezione hanno area
    // |det| = 10368 px2 mentre il rombo di `tileSizeOf` ne varrebbe 19346,95:
    // il rapporto e' 2cos^2(15 gradi) = 1,866.

    /** Il punto MONDO nello spazio frame-locale che la hitAreaCallback riceve
     *  davvero: origine display gia' sommata. */
    function frameLocale(s: IsoSprite, worldX: number, worldY: number): { x: number; y: number } {
        return { x: (worldX - s.x) + s.displayOriginX, y: (worldY - s.y) + s.displayOriginY };
    }

    it('makeDiamondHitArea RIFIUTA di dedurre la misura da una matrice sghemba', async () => {
        const scene = await conAssonometria();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        // Il difetto originale era esattamente questo silenzio: la chiamata
        // riusciva e installava la forma sbagliata.
        expect(() => scene.iso.makeDiamondHitArea(s)).toThrow(IsoConfigError);
        expect(() => scene.iso.makeDiamondHitArea(s)).toThrow(/makeCellHitArea/);

        // E non ha toccato il bersaglio: rifiuto prima di mutare.
        expect(s.input).toBeNull();
    });

    it('rifiuta anche quando UNA sola delle due misure e omessa', async () => {
        const scene = await conAssonometria();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        // Meta' misura passata significa meta' misura DEDOTTA, che e' il caso
        // che la guardia esiste per prendere.
        expect(() => scene.iso.makeDiamondHitArea(s, { tileWidth: 200 })).toThrow(IsoConfigError);
        expect(() => scene.iso.makeDiamondHitArea(s, { tileHeight: 100 })).toThrow(IsoConfigError);
    });

    it('ACCETTA un rombo esplicito: chi passa entrambe le misure ha dichiarato la forma', async () => {
        // Zero falsi positivi: su questo percorso il valore di `tileSizeOf` non
        // viene mai usato (i due `??` lo scartano), quindi non c'e' niente di
        // disonesto da fermare.
        const scene = await conAssonometria();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(() => scene.iso.makeDiamondHitArea(s, { tileWidth: 200, tileHeight: 100 })).not.toThrow();
        expect(s.input!.hitArea).toBeInstanceOf(Phaser.Geom.Polygon);
    });

    it('makeDiamondHitArea resta intatta sul preset diamond', async () => {
        // La guardia non deve costare nulla a chi non e' mai stato colpito dal
        // difetto: un rombo e' un rombo e continua a funzionare come prima.
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(() => scene.iso.makeDiamondHitArea(s)).not.toThrow();
        expect(s.input!.hitArea).toBeInstanceOf(Phaser.Geom.Polygon);
    });

    it('makeCellHitArea installa il parallelogramma vero, di area |det|', async () => {
        const scene = await conAssonometria();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeCellHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        expect(poly).toBeInstanceOf(Phaser.Geom.Polygon);
        expect(s.input!.hitAreaCallback).toBe(Phaser.Geom.Polygon.Contains);

        // Area col laccio, calcolata qui: e' la grandezza che separa il
        // parallelogramma vero dal rombo (10368 contro 19346,95).
        const p = poly.points;
        let somma = 0;
        for (let i = 0; i < p.length; i++) {
            const q = p[(i + 1) % p.length]!;
            somma += p[i]!.x * q.y - q.x * p[i]!.y;
        }
        expect(Math.abs(somma) / 2).toBeCloseTo(Math.abs(scene.iso.projection.det), 6);
        expect(Math.abs(somma) / 2).toBeCloseTo(10368, 6);
    });

    it('le hit area di celle vicine TASSELLANO: nessun punto e rivendicato due volte', async () => {
        // La proprieta' che interessa davvero all'utente, misurata invece che
        // argomentata. Con il rombo di `tileSizeOf` questa stessa griglia di
        // sonde trova migliaia di punti contesi (l'86,6% dell'area di ogni
        // cella e' rivendicata da DUE hit area); col parallelogramma vero deve
        // essere esattamente zero.
        const scene = await conAssonometria();

        const celle: Array<{ gx: number; gy: number; s: IsoSprite }> = [];
        for (let gx = -1; gx <= 1; gx++) {
            for (let gy = -1; gy <= 1; gy++) {
                const s = scene.add.isoSprite(gx, gy, '__DEFAULT').setCell(gx, gy, 0, scene.iso.bands.floor);
                scene.iso.makeCellHitArea(s);
                celle.push({ gx, gy, s });
            }
        }

        // Sonde su tutta l'estensione della cella centrale, con un margine: e'
        // la zona in cui i vicini possono sovrapporsi.
        const proj = scene.iso.projection;
        const semiLarghezza = Math.abs(proj.a) + Math.abs(proj.c);
        const semiAltezza = Math.abs(proj.b) + Math.abs(proj.d);

        let contesi = 0;
        let rivendicatiUnaVolta = 0;
        const PASSI = 60;
        for (let i = 0; i <= PASSI; i++) {
            for (let j = 0; j <= PASSI; j++) {
                const wx = -semiLarghezza + (2 * semiLarghezza * i) / PASSI;
                const wy = -semiAltezza + (2 * semiAltezza * j) / PASSI;
                let quante = 0;
                for (const { s } of celle) {
                    const loc = frameLocale(s, wx, wy);
                    if (Phaser.Geom.Polygon.Contains(s.input!.hitArea as Phaser.Geom.Polygon, loc.x, loc.y)) {
                        quante++;
                    }
                }
                if (quante > 1) contesi++;
                if (quante === 1) rivendicatiUnaVolta++;
            }
        }

        expect(contesi).toBe(0);
        // Non vacuo: una misura che non trova niente non prova niente finche'
        // non le si e' visto trovare qualcosa. Il valore vero e' 3720 su 3721
        // sonde (una sola cade fuori da ogni cella). La soglia e' TARATA su
        // quel numero, non scelta larga: la cella meno popolosa delle nove ne
        // rivendica 307, quindi a 3700 la sparizione completa anche solo della
        // hit area angolare diventa rossa. Una soglia a 3000 — la prima
        // stesura — lasciava passare la scomparsa di QUALUNQUE delle nove,
        // centrale inclusa (il minimo sarebbe stato 3119).
        expect(rivendicatiUnaVolta).toBeGreaterThan(3700);
    });

    it('i quattro vertici cadono DOVE devono, non solo in una forma della giusta area', async () => {
        // Area e tassellatura sono entrambe invarianti per TRASLAZIONE: con i
        // poligoni spostati tutti di (40,40) px restano area |det| e zero
        // contesi. Servono quindi coordinate assolute, o la sostituzione delle
        // due divisioni `displayOriginX / width` con un 0.5 costante resterebbe
        // verde su ogni sprite di test (che ha origine 0,5 — un
        // delete-the-call-site da manuale).
        const scene = await conAssonometria();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        s.setOrigin(0.5, 1);          // ancorato ai PIEDI: sposta la hit area
        scene.iso.makeCellHitArea(s);

        const p = scene.iso.projection;
        // Calcolati qui dalla matrice, non letti da cornersOf: +/- halfSum e
        // +/- halfDiff attorno all'origine display.
        const hs = { x: (p.a + p.c) / 2, y: (p.b + p.d) / 2 };
        const hd = { x: (p.a - p.c) / 2, y: (p.b - p.d) / 2 };
        const cx = s.displayOriginX;
        const cy = s.displayOriginY;
        const attesi = [
            { x: cx - hs.x, y: cy - hs.y },
            { x: cx + hd.x, y: cy + hd.y },
            { x: cx + hs.x, y: cy + hs.y },
            { x: cx - hd.x, y: cy - hd.y }
        ];

        const punti = (s.input!.hitArea as Phaser.Geom.Polygon).points;
        expect(punti).toHaveLength(4);
        for (let i = 0; i < 4; i++) {
            expect(punti[i]!.x, `vertice ${i} x`).toBeCloseTo(attesi[i]!.x, 9);
            expect(punti[i]!.y, `vertice ${i} y`).toBeCloseTo(attesi[i]!.y, 9);
        }
        // E l'origine ai piedi ha DAVVERO spostato la forma: senza questo, un
        // 0.5 costante darebbe gli stessi numeri e il test non distinguerebbe.
        expect(cy).not.toBeCloseTo(s.height / 2, 6);
    });

    it('a 45 gradi makeDiamondHitArea NON lancia: quello e un rombo, per quanto i float non tornino', async () => {
        // La forma chiusa della documentazione a 45 gradi da' a e -c diversi di
        // un ulp. Con un confronto esatto la guardia lanciava su una
        // proiezione perfettamente legittima — un falso positivo raggiungibile
        // copiando l'esempio spedito.
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: {
                type: 'matrix',
                a: SCALA * Math.cos(Math.PI / 4), b: SCALA * Math.sin(Math.PI / 4) * Math.sin(E),
                c: -SCALA * Math.sin(Math.PI / 4), d: SCALA * Math.cos(Math.PI / 4) * Math.sin(E),
                elevationStep: SCALA * Math.cos(E)
            } })] }
        });
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(() => scene.iso.makeDiamondHitArea(s)).not.toThrow();
        expect(buildDiagnosis({ projection: { type: 'matrix',
            a: SCALA * Math.cos(Math.PI / 4), b: SCALA * Math.sin(Math.PI / 4) * Math.sin(E),
            c: -SCALA * Math.sin(Math.PI / 4), d: SCALA * Math.cos(Math.PI / 4) * Math.sin(E),
            elevationStep: SCALA * Math.cos(E)
        } }).warnings.map(w => w.code)).not.toContain('cell-is-not-a-rhombus');
    });

    it('un tileWidth null non scavalca la guardia: e il dominio di ??, non solo undefined', async () => {
        const scene = await conAssonometria();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        // `null ?? tile.tileWidth` deduce comunque da tileSizeOf, quindi un
        // controllo su `=== undefined` lascerebbe passare esattamente il caso
        // che la guardia esiste per chiudere.
        expect(() => scene.iso.makeDiamondHitArea(
            s, { tileWidth: null as unknown as number, tileHeight: null as unknown as number }
        )).toThrow(IsoConfigError);
    });

    it('un rombo SPECCHIATO non muore parlando di un tileWidth che nessuno ha passato', async () => {
        // (a=-48, b=24, c=48, d=24) supera isRhombus (i segni non li guarda) ma
        // tileSizeOf restituisce -96, e requirePositive rispondeva «pass a
        // positive tileWidth» a chi non ne aveva passato nessuno. La cella li'
        // E' un rombo: cio' che manca e' una misura, ed e' quello da nominare.
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({
                projection: { type: 'matrix', a: -48, b: 24, c: 48, d: 24, elevationStep: 24 }
            })] }
        });
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(() => scene.iso.makeDiamondHitArea(s)).toThrow(/makeCellHitArea/);
        // E la via d'uscita generale funziona davvero su quella proiezione.
        expect(() => scene.iso.makeCellHitArea(s)).not.toThrow();
    });

    it('diagnose avvisa che la cella non e un rombo, col numero', async () => {
        // L'oracolo che esiste per rispondere "la mia configurazione regge?"
        // deve nominare proprio questo, o l'utente lo scopre solo dai click.
        const d = buildDiagnosis({ projection: SGHEMBA });
        const avviso = d.warnings.find(w => w.code === 'cell-is-not-a-rhombus');

        expect(avviso).toBeDefined();
        expect(avviso!.symptom).toContain('1.866');
        expect(avviso!.fix).toContain('makeCellHitArea');
        // Mai notazione scientifica dentro una scheda: e' il contratto che il
        // sentinella `num()` del renderer garantisce sugli altri campi, ma
        // questo numero nasce nel core e li' non passa piu'.
        //
        // Su QUESTA matrice l'asserzione non distingue nulla — l'interpolazione
        // grezza darebbe 1.8660254037844388, che di `e` non ne ha — quindi
        // serve una matrice il cui rapporto sia abbastanza piccolo da far
        // scattare l'esponente: 2/9000000 esce `2.2222219753086693e-7` grezzo.
        // Senza questa seconda sonda, togliere il toFixed resterebbe verde.
        expect(avviso!.symptom).not.toMatch(/e[+-]\d/);
        const minuscolo = buildDiagnosis({
            projection: { type: 'matrix', a: 1, b: 3000, c: -3000, d: 1, elevationStep: 1 }
        }).warnings.find(w => w.code === 'cell-is-not-a-rhombus');
        expect(minuscolo).toBeDefined();
        expect(minuscolo!.symptom, minuscolo!.symptom).not.toMatch(/e[+-]\d/);

        // E NON scatta sul preset diamond, che quella forma ce l'ha davvero.
        expect(buildDiagnosis({ projection: DIAMOND }).warnings.map(w => w.code))
            .not.toContain('cell-is-not-a-rhombus');

        // Ne' su una spec MATRIX che soddisfa le due relazioni. Senza questa
        // sonda, sostituire `!isRhombus(p)` con `!diamante` — la variabile su
        // `spec.type`, gia' in scope due righe sopra — lascerebbe l'intera
        // suite verde, che e' precisamente l'errore che il JSDoc di isRhombus
        // dichiara di voler evitare.
        expect(buildDiagnosis({ projection: { type: 'matrix', a: 48, b: 24, c: -48, d: 24, elevationStep: 24 } })
            .warnings.map(w => w.code)).not.toContain('cell-is-not-a-rhombus');
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
