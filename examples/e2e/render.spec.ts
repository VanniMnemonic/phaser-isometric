import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { mulberry32, readyScene, samplePixels, toPage, waitFrames, type RGBA } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(here, 'artifacts');

// Il brief suggerisce di importare le costanti da examples/src/scene.ts
// piuttosto che ridigitare le coordinate. Provato per primo, e SCARTATO per
// un motivo scoperto solo eseguendo: scene.ts importa `phaser` a livello di
// modulo, e il bundle ESM di Phaser tocca `window` nel proprio init top-level
// — fuori da un browser. Playwright carica ogni file *.spec.ts in NODE (non
// nel browser) per la raccolta dei test, quindi un `import { CANVAS_WIDTH }
// from '../src/scene'` fa crashare l'intera raccolta con "window is not
// defined" prima ancora che un test parta — isolato con un file-sonda che
// importava solo quella singola costante, stesso crash. Le costanti sono
// quindi ridichiarate qui sotto, copiate 1:1 da examples/src/scene.ts (la
// cui derivazione geometrica resta commentata solo lì) — non un secondo
// calcolo indipendente, solo un secondo posto dove il valore deve vivere
// finché scene.ts non separa i dati puri dal codice che importa Phaser.
const ABYSS_CELL = { gx: 2, gy: 12 };
const TOWER_CELL = { gx: 12, gy: 4, elevation: 3 };
const TIEBREAK_CELL = { gx: 3, gy: 10 };
const OVERLAP_BACK = { gx: 7, gy: 7 };
const OVERLAP_FRONT = { gx: 8, gy: 7 };
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;
// Idem per DEFAULT_BANDS: 'phaser-isometric' re-esporta dal core, ma il
// pacchetto plugin importa comunque `phaser` a livello di modulo — stesso crash.
const BANDS = { floor: 0, decal: 1, prop: 2, item: 3, actor: 4, hero: 5, overlay: 6 };

/** Lo stato di click che la scena espone apposta per questo gate (Task 11). */
interface ClickState {
    lastClickedCell: { gx: number; gy: number } | null;
    pointerDownCount: number;
    clickCount: number;
}

async function readClickState(page: Page): Promise<ClickState> {
    return page.evaluate(() => {
        const scene = window.__iso!.scene as unknown as ClickState;
        return {
            lastClickedCell: scene.lastClickedCell,
            pointerDownCount: scene.pointerDownCount,
            clickCount: scene.clickCount
        };
    });
}

function range(from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = from; i <= to; i += 1) out.push(i);
    return out;
}

function closeTo(pixel: RGBA, color: { r: number; g: number; b: number }, tolerance = 6): boolean {
    return Math.abs(pixel.r - color.r) <= tolerance
        && Math.abs(pixel.g - color.g) <= tolerance
        && Math.abs(pixel.b - color.b) <= tolerance;
}

const FLOOR_COLOR = { r: 0x3d, g: 0x5a, b: 0x80 }; // 0x3d5a80
const BACK_COLOR = { r: 0xd7, g: 0x26, b: 0x3d };  // 0xd7263d

test.describe('Proof 1 — real draw order', () => {
    test('depth-sorted display list, and the overlap pixel', async ({ page }) => {
        const { box, canvas } = await readyScene(page);

        // Letta DOPO un frame vero (readyScene ha già aspettato 5 RAF): sotto
        // HEADLESS `list` resterebbe nell'ordine di inserimento a prescindere
        // da `.depth`, perché `depthSort()` gira solo da un vero `preRender`.
        const listState = await page.evaluate((args) => {
            const scene = window.__iso!.scene as unknown as {
                sys: { displayList: { list: Array<{ depth: number; gx: number; gy: number; band: number }> } };
            };
            const entries = scene.sys.displayList.list.map(o => ({ depth: o.depth, gx: o.gx, gy: o.gy, band: o.band }));

            const backIndex = entries.findIndex(e => e.gx === args.backGx && e.gy === args.backGy && e.band === args.actorBand);
            const frontIndex = entries.findIndex(e => e.gx === args.frontGx && e.gy === args.frontGy && e.band === args.actorBand);
            const decalIndex = entries.findIndex(e => e.gx === args.tieGx && e.gy === args.tieGy && e.band === args.decalBand);
            const tieActorIndex = entries.findIndex(e => e.gx === args.tieGx && e.gy === args.tieGy && e.band === args.actorBand);
            const heroIndex = entries.findIndex(e => e.gx === args.tieGx && e.gy === args.tieGy && e.band === args.heroBand);

            return {
                count: entries.length,
                depths: entries.map(e => e.depth),
                backIndex, frontIndex, decalIndex, tieActorIndex, heroIndex,
                backDepth: backIndex >= 0 ? entries[backIndex].depth : null,
                frontDepth: frontIndex >= 0 ? entries[frontIndex].depth : null
            };
        }, {
            backGx: OVERLAP_BACK.gx, backGy: OVERLAP_BACK.gy,
            frontGx: OVERLAP_FRONT.gx, frontGy: OVERLAP_FRONT.gy,
            tieGx: TIEBREAK_CELL.gx, tieGy: TIEBREAK_CELL.gy,
            actorBand: BANDS.actor, decalBand: BANDS.decal, heroBand: BANDS.hero
        });

        // Predizione A — l'intera lista non decrescente.
        const nonDecreasing = listState.depths.every((d, i) => i === 0 || d >= listState.depths[i - 1]);
        expect(nonDecreasing, `depths not sorted: ${JSON.stringify(listState.depths)}`).toBe(true);
        expect(listState.count).toBe(261); // 255 floor + 1 tower + 3 tie-break + 2 overlap

        // Predizione B — la coppia BACK/FRONT, per chiave e per posizione.
        expect(listState.backDepth).toBe(58368);
        expect(listState.frontDepth).toBe(62464);
        expect(listState.backIndex).toBeGreaterThanOrEqual(0);
        expect(listState.frontIndex).toBeGreaterThan(listState.backIndex);

        // Bonus — il terzetto di tie-break, stessa riga, ordinato per banda.
        expect(listState.decalIndex).toBeGreaterThanOrEqual(0);
        expect(listState.tieActorIndex).toBeGreaterThan(listState.decalIndex);
        expect(listState.heroIndex).toBeGreaterThan(listState.tieActorIndex);

        // Predizione C — il pixel. Punti in spazio SCHERMO (zoom 1, scrollX=-480,
        // scrollY=24): screenX = worldX+480, screenY = worldY-24.
        const fullShot = await canvas.screenshot({ path: path.join(ARTIFACTS, 'proof1-full-zoom1.png') });
        const [backOnly, frontOnly, overlap] = await samplePixels(page, fullShot, [
            { x: 480, y: 296 }, // world (0,320): solo dentro l'AABB di BACK
            { x: 544, y: 331 }, // world (64,355): solo dentro l'AABB di FRONT
            { x: 504, y: 324 }  // world (24,348): dentro entrambe — il punto che conta
        ]);

        expect([backOnly.r, backOnly.g, backOnly.b]).toEqual([0xd7, 0x26, 0x3d]);
        expect([frontOnly.r, frontOnly.g, frontOnly.b]).toEqual([0x1b, 0x99, 0x8b]);
        // La riga che prova tutto: nel punto di sovrapposizione il colore è
        // quello di FRONT, non di BACK — FRONT è stato disegnato sopra.
        expect([overlap.r, overlap.g, overlap.b]).toEqual([0x1b, 0x99, 0x8b]);

        await page.screenshot({
            path: path.join(ARTIFACTS, 'proof1-overlap-crop.png'),
            clip: { x: box.x + 494, y: box.y + 314, width: 20, height: 20 }
        });
    });
});

/**
 * FINDING (owned by this project, not just this test — Task 13 needs it):
 * **`setRoundPixels(true)` does not protect you at fractional zoom in Phaser
 * 4.2.1.** A `Sprite`'s default `vertexRoundMode` is `'safeAuto'`
 * (`GameObject.js`), whose gate is `onlyTranslate && camera.roundPixels`
 * (`phaser.esm.js:38579-38585`); `onlyTranslate` reads the COMBINED matrix
 * (camera ⊗ sprite) and is `false` whenever the camera's own zoom is anything
 * but `1`, because the camera's scale is baked into that matrix. So at zoom
 * `1.5` the explicit `Math.round()` step in `TransformerImage` never runs —
 * `camera.roundPixels` stays `true` the whole time, and it does nothing.
 * This scene's quads still land on integer pixels at zoom 1.5 anyway,
 * entirely because of its OWN numbers (tile size 96×48, canvas 960×720,
 * every texture's dimensions even) — even deltas × 1.5 are exact integers in
 * IEEE-754. That is a property of THIS scene, not a guarantee `roundPixels`
 * gives you. The two tests below show both halves: the gap (rounding
 * genuinely inert at zoom 1.5, yet clean by arithmetic) and the positive
 * control (rounding genuinely engaged at zoom 1 with a fractional scroll,
 * where toggling the flag visibly changes the rendered pixel).
 */
test.describe('Proof 2 — the roundPixels gap at fractional zoom', () => {
    test('quads land on integer screen pixels at zoom 1.5 — by scene arithmetic, not by Phaser rounding (which is inert here)', async ({ page }) => {
        const { box, canvas } = await readyScene(page);

        const readMatrix = () => page.evaluate(() => {
            const cam = window.__iso!.scene.cameras.main;
            const m = cam.matrixCombined;
            return {
                a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f,
                zoomX: cam.zoomX, zoomY: cam.zoomY, roundPixels: cam.roundPixels,
                scrollX: cam.scrollX, scrollY: cam.scrollY
            };
        });

        // --- zoom 1: la baseline, integrale per costruzione (nessun rounding necessario). ---
        const m1 = await readMatrix();
        expect(m1.roundPixels).toBe(true);
        expect(m1.zoomX).toBe(1);
        expect(m1.zoomY).toBe(1);
        expect(m1.scrollX).toBe(-480);
        expect(m1.scrollY).toBe(24);
        expect(m1.a).toBeCloseTo(1, 9);
        expect(m1.b).toBeCloseTo(0, 9);
        expect(m1.c).toBeCloseTo(0, 9);
        expect(m1.d).toBeCloseTo(1, 9);
        expect(m1.e).toBeCloseTo(480, 9);
        expect(m1.f).toBeCloseTo(-24, 9);

        // Bordo sinistro di BACK, mondo x=-32 -> screenX = -32+480 = 448.
        //
        // La riga di scansione NON è il centro verticale di BACK (mondo y=336,
        // screen y=312): un primo tentativo lì ha rivelato — eseguendo, non per
        // congettura — che BACK, come ogni sprite qui, è un rettangolo pieno
        // (le texture sono `g.fillRect`, il rombo è solo l'area di hit, non la
        // forma disegnata), e il rettangolo del tile pavimento (7,8) — riga 15,
        // depth 61440 > i 58368 di BACK — si estende ben oltre il proprio rombo
        // e dipinge sopra la metà inferiore di BACK esattamente come farebbe
        // sopra un pavimento vicino: comportamento corretto del row-dominance,
        // non un difetto, ma un punto di campionamento sbagliato da parte mia.
        // Il rettangolo di (7,8) parte da mondo y=336 in giù, quindi mondo
        // y=320 (lo stesso punto "solo BACK" già validato dalla Prova 1) resta
        // sempre pulito: screenY = 320-24 = 296.
        await canvas.screenshot({ path: path.join(ARTIFACTS, 'proof2-full-zoom1.png') });
        const zoom1Points = range(438, 458).map(x => ({ x, y: 296 }));
        const zoom1Shot = await canvas.screenshot();
        const zoom1Pixels = await samplePixels(page, zoom1Shot, zoom1Points);
        await page.screenshot({
            path: path.join(ARTIFACTS, 'proof2-edge-crop-zoom1.png'),
            clip: { x: box.x + 428, y: box.y + 276, width: 40, height: 40 }
        });

        // --- passa a zoom 1.5 ---
        await page.click('#zoom-toggle');
        await page.waitForFunction(() => window.__iso!.scene.cameras.main.zoomX === 1.5);
        await waitFrames(page, 5);

        const m15 = await readMatrix();
        expect(m15.roundPixels).toBe(true);
        expect(m15.zoomX).toBe(1.5);
        expect(m15.zoomY).toBe(1.5);
        // setZoom non tocca lo scroll (letto in Camera.setZoom, phaser.esm.js:10433):
        expect(m15.scrollX).toBe(-480);
        expect(m15.scrollY).toBe(24);
        expect(m15.a).toBeCloseTo(1.5, 9);
        expect(m15.b).toBeCloseTo(0, 9);
        expect(m15.c).toBeCloseTo(0, 9);
        expect(m15.d).toBeCloseTo(1.5, 9);
        // e = 480*(1-1.5) - 1.5*(-480) = -240+720 = 480; f = 360*(1-1.5) - 1.5*24 = -180-36 = -216.
        expect(m15.e).toBeCloseTo(480, 9);
        expect(m15.f).toBeCloseTo(-216, 9);

        // Quello che il brief chiede alla lettera: non la matrice della
        // camera (che e' sempre esatta, rounding o no — non e' lei a essere
        // arrotondata), ma le POSIZIONI SCHERMO CALCOLATE per sprite reali.
        // Stessa formula di TransformerImage.run (phaser.esm.js, RenderNodes):
        // corner_world = (sprite.x + lx, sprite.y + ly) con lx/ly gli offset
        // locali dal displayOrigin, poi cam.matrixCombined.transformPoint —
        // NESSUN Math.round applicato qui: se questi numeri sono interi lo
        // sono per l'aritmetica della scena, non perche' il test li abbia
        // arrotondati per farli combaciare.
        const corners = await page.evaluate((args) => {
            interface SpriteLike {
                gx: number; gy: number; band: number;
                x: number; y: number; width: number; height: number;
                displayOriginX: number; displayOriginY: number;
            }
            const scene = window.__iso!.scene as unknown as {
                sys: { displayList: { list: SpriteLike[] } };
            };
            const cam = window.__iso!.scene.cameras.main;
            const list = scene.sys.displayList.list;

            function cornersOf(o: SpriteLike): Array<{ x: number; y: number }> {
                const lxs = [-o.displayOriginX, o.width - o.displayOriginX];
                const lys = [-o.displayOriginY, o.height - o.displayOriginY];
                const pts: Array<{ x: number; y: number }> = [];
                for (const lx of lxs) {
                    for (const ly of lys) {
                        pts.push(cam.matrixCombined.transformPoint(o.x + lx, o.y + ly));
                    }
                }
                return pts;
            }

            const back = list.find(o => o.gx === args.backGx && o.gy === args.backGy && o.band === args.actorBand);
            const front = list.find(o => o.gx === args.frontGx && o.gy === args.frontGy && o.band === args.actorBand);
            const floor77 = list.find(o => o.gx === args.backGx && o.gy === args.backGy && o.band === 0);
            if (!back || !front || !floor77) throw new Error('sprite non trovato nel display list');

            return { back: cornersOf(back), front: cornersOf(front), floor77: cornersOf(floor77) };
        }, {
            backGx: OVERLAP_BACK.gx, backGy: OVERLAP_BACK.gy,
            frontGx: OVERLAP_FRONT.gx, frontGy: OVERLAP_FRONT.gy,
            actorBand: BANDS.actor
        });

        for (const [label, pts] of Object.entries(corners)) {
            for (const pt of pts) {
                expect(Number.isInteger(pt.x), `${label}: corner x=${pt.x} non intero a zoom 1.5`).toBe(true);
                expect(Number.isInteger(pt.y), `${label}: corner y=${pt.y} non intero a zoom 1.5`).toBe(true);
            }
        }

        // Stesso bordo e stesso punto mondo (x=-32,y=320) a zoom 1.5:
        // screenX = 1.5*(-32+480)-240 = 672-240 = 432 (bordo);
        // screenY = 1.5*(320-24)-180 = 444-180 = 264 (riga pulita, stessa scelta di sopra).
        await canvas.screenshot({ path: path.join(ARTIFACTS, 'proof2-full-zoom1.5.png') });
        const zoom15Points = range(417, 447).map(x => ({ x, y: 264 }));
        const zoom15Shot = await canvas.screenshot();
        const zoom15Pixels = await samplePixels(page, zoom15Shot, zoom15Points);
        await page.screenshot({
            path: path.join(ARTIFACTS, 'proof2-edge-crop-zoom1.5.png'),
            clip: { x: box.x + 412, y: box.y + 244, width: 40, height: 40 }
        });

        // Nessuna riga semi-trasparente a nessuno dei due zoom: ogni pixel
        // campionato deve essere O il pavimento O il rosso di BACK, mai un
        // terzo colore intermedio (la firma di un bordo non allineato al
        // pixel). Si verifica anche che la scansione abbia davvero
        // attraversato il bordo (altrimenti il controllo passerebbe a vuoto).
        for (const [label, pixels] of [['zoom1', zoom1Pixels], ['zoom1.5', zoom15Pixels]] as const) {
            let sawFloor = false;
            let sawBack = false;
            for (const pixel of pixels) {
                const isFloor = closeTo(pixel, FLOOR_COLOR);
                const isBack = closeTo(pixel, BACK_COLOR);
                if (isFloor) sawFloor = true;
                if (isBack) sawBack = true;
                expect(isFloor || isBack, `${label}: pixel semi-trasparente inatteso ${JSON.stringify(pixel)}`).toBe(true);
            }
            expect(sawFloor, `${label}: la scansione non ha mai visto il pavimento`).toBe(true);
            expect(sawBack, `${label}: la scansione non ha mai visto BACK`).toBe(true);
        }
    });

    test('positive control: at zoom 1 with a fractional scroll, rounding genuinely engages and toggling it changes the pixel', async ({ page }) => {
        // A zoom 1 la matrice ha scala 1 (nessuno zoom, nessuna rotazione):
        // onlyTranslate e' vero, quindi qui — a differenza del test sopra —
        // `willRoundVertices` dipende DAVVERO da `camera.roundPixels`. Sposto
        // scrollX di un valore non intero (0.3) cosi' il bordo sinistro di
        // BACK (mondo x=-32, prima a schermo 448 esatto) cade su un pixel
        // frazionario: screenX = -32 - (-480+0.3) = 447.7. Con il rounding
        // attivo Math.round lo riporta a 448 (nessun pareggio: 0.7 arrotonda
        // in su banalmente) — bordo netto, come prima. Con il rounding
        // disattivo il bordo resta a 447.7, e l'antialiasing di WebGL DEVE
        // produrre un pixel misto nella colonna 447 — questo e' il test che
        // il proof sopra non poteva dare da solo: la prova che il flag, dove
        // puo' agire, agisce davvero.
        const { box, canvas } = await readyScene(page);

        await page.evaluate(() => {
            window.__iso!.scene.cameras.main.scrollX = -480 + 0.3;
        });
        await waitFrames(page, 3);

        const scanPoints = range(438, 458).map(x => ({ x, y: 296 })); // stesso mondo y=320 "solo BACK" di sopra

        const withRounding = await page.evaluate(() => window.__iso!.scene.cameras.main.roundPixels);
        expect(withRounding, 'la scena parte con roundPixels:true').toBe(true);
        const roundedShot = await canvas.screenshot({ path: path.join(ARTIFACTS, 'proof2-control-rounded.png') });
        const roundedPixels = await samplePixels(page, roundedShot, scanPoints);

        await page.evaluate(() => { window.__iso!.scene.cameras.main.setRoundPixels(false); });
        await waitFrames(page, 3);
        const unroundedShot = await canvas.screenshot({ path: path.join(ARTIFACTS, 'proof2-control-unrounded.png') });
        const unroundedPixels = await samplePixels(page, unroundedShot, scanPoints);

        const isPureColor = (pixel: RGBA): boolean => closeTo(pixel, FLOOR_COLOR) || closeTo(pixel, BACK_COLOR);

        // Con il rounding attivo: nessun pixel misto, esattamente come nel
        // proof sopra (qui pero' e' un vero effetto del flag, non aritmetica).
        for (const pixel of roundedPixels) {
            expect(isPureColor(pixel), `roundPixels:true ma pixel misto inatteso ${JSON.stringify(pixel)}`).toBe(true);
        }

        // Con il rounding disattivo: DEVE comparire almeno un pixel misto —
        // se non compare, il flag non stava facendo nulla neanche qui, e il
        // controllo positivo non avrebbe dimostrato niente.
        const blendedWithoutRounding = unroundedPixels.some(pixel => !isPureColor(pixel));
        expect(blendedWithoutRounding, 'nessun pixel misto senza rounding: il controllo positivo non ha dimostrato che il flag agisce').toBe(true);

        await page.screenshot({
            path: path.join(ARTIFACTS, 'proof2-control-crop-unrounded.png'),
            clip: { x: box.x + 428, y: box.y + 276, width: 40, height: 40 }
        });
    });
});

test.describe('Proof 3 — the click on the diamond', () => {
    test('center hits the tile; the frame corner over the abyss neighbor misses', async ({ page }) => {
        const { box } = await readyScene(page);

        // Il tile bersaglio: il vicino "gx-1" di ABYSS_CELL, così che l'angolo
        // in alto a sinistra del suo frame (== centro del vicino gx-1) cada
        // esattamente sulla cella senza pavimento — vedi la derivazione nel
        // report prima di eseguire questo file.
        const targetCell = { gx: ABYSS_CELL.gx + 1, gy: ABYSS_CELL.gy };

        const before = await readClickState(page);
        expect(before.lastClickedCell).toBeNull();
        expect(before.pointerDownCount).toBe(0);

        // Centro di (3,12,0): project = (48*3-48*12, 24*3+24*12) = (-432,360) -> schermo (48,336).
        const hit = toPage(box, 48, 336);
        await page.mouse.click(hit.x, hit.y);
        const afterHit = await readClickState(page);
        expect(afterHit.lastClickedCell).toEqual(targetCell);
        expect(afterHit.pointerDownCount).toBe(1);

        // Angolo del frame di (3,12) == centro di ABYSS_CELL (2,12): project =
        // (48*2-48*12, 24*2+24*12) = (-480,336) -> schermo (0,312). Nessuno sprite lì.
        const miss = toPage(box, 0, 312);
        await page.mouse.click(miss.x, miss.y);
        const afterMiss = await readClickState(page);
        expect(afterMiss.lastClickedCell).toBeNull();
        expect(afterMiss.pointerDownCount).toBe(2);

        // Secondo testimone del miss, STRETTAMENTE interno al rettangolo del
        // frame — non sul suo angolo esatto. Il punto sopra funziona solo
        // perche' `Rectangle.Contains` di Phaser e' inclusivo sui bordi: con
        // un ipotetico `<` stretto (o una diversa libreria di hit-test)
        // quell'angolo esatto potrebbe risultare un falso "fuori dal
        // rettangolo" anche con un banale rombo rotto sostituito da un
        // rettangolo — un falso PASS che non proverebbe nulla sul rombo
        // vero. Schermo (10,316) -> mondo (10-480,316+24) = (-470,340):
        // dentro il rettangolo di (3,12) (world x in [-480,-384], y in
        // [336,384], entrambi con margine reale, non sul bordo) ma la sua
        // cella per arrotondamento e' (2,12) = ABYSS_CELL, senza sprite —
        // fuori dal rombo di (3,12) e senza alcun vicino che lo catturi.
        const interiorMiss = toPage(box, 10, 316);
        await page.mouse.click(interiorMiss.x, interiorMiss.y);
        const afterInteriorMiss = await readClickState(page);
        expect(afterInteriorMiss.lastClickedCell).toBeNull();
        expect(afterInteriorMiss.pointerDownCount).toBe(3);

        await page.screenshot({
            path: path.join(ARTIFACTS, 'proof3-target-and-abyss.png'),
            clip: { x: box.x, y: box.y + 288, width: 110, height: 96 }
        });
    });
});

test.describe('Proof 4 — iso.pick() vs. the real click, 20 points', () => {
    test('agree on all 20 pseudo-random points', async ({ page }) => {
        const { box } = await readyScene(page);

        // Il bottone #zoom-toggle è un overlay DOM (position:fixed) che
        // intercetta il click prima che arrivi al canvas: un punto casuale
        // lì sopra non produrrebbe alcun pointerdown su Phaser, e
        // lastClickedCell resterebbe quello del click PRECEDENTE — una falsa
        // divergenza che non ha nulla a che fare con pick()-vs-click.
        const buttonBox = await page.locator('#zoom-toggle').boundingBox();
        if (!buttonBox) throw new Error('#zoom-toggle has no bounding box');
        const exclude = {
            left: buttonBox.x - box.x - 4,
            top: buttonBox.y - box.y - 4,
            right: buttonBox.x - box.x + buttonBox.width + 4,
            bottom: buttonBox.y - box.y + buttonBox.height + 4
        };

        // Nessuna esclusione oltre al bottone: il pareggio geometrico esatto
        // (gy = n+0.5) che un round precedente escludeva era in realta' un
        // difetto del plugin, non del test — corretto allineando `pick()` al
        // click (packages/core/src/picking.ts, parita' half-down su gy). I
        // venti punti devono ora concordare senza alcuna eccezione.
        const rand = mulberry32(0xc0ffee);
        const points: Array<{ x: number; y: number }> = [];
        while (points.length < 20) {
            const x = Math.floor(rand() * CANVAS_WIDTH);
            const y = Math.floor(rand() * CANVAS_HEIGHT);
            if (x >= exclude.left && x <= exclude.right && y >= exclude.top && y <= exclude.bottom) continue;
            points.push({ x, y });
        }

        interface Row {
            x: number;
            y: number;
            worldX: number;
            worldY: number;
            pick: { gx: number; gy: number; z: number } | null;
            click: { gx: number; gy: number } | null;
        }
        const rows: Row[] = [];

        for (let i = 0; i < points.length; i += 1) {
            const p = points[i];
            // world via camera.getWorldPoint: lo STESSO metodo che
            // InputManager#hitTest usa per calcolare pointer.worldX/worldY
            // (phaser.esm.js:112812) — non una reinversione a mano che
            // potrebbe disaccordare per un bug tutto mio.
            const { worldX, worldY, pick } = await page.evaluate((point) => {
                const hook = window.__iso!;
                const world = hook.scene.cameras.main.getWorldPoint(point.x, point.y);
                const cell = hook.iso.pick(world.x, world.y);
                return { worldX: world.x, worldY: world.y, pick: cell };
            }, p);

            const pagePoint = toPage(box, p.x, p.y);
            await page.mouse.click(pagePoint.x, pagePoint.y);
            const state = await readClickState(page);
            // Un click che non registra (swallowed) lascerebbe lastClickedCell
            // fermo al valore del click PRECEDENTE, e il confronto leggerebbe
            // silenziosamente un dato stantio invece di accorgersene: per
            // questo pointerDownCount — che conta ogni pointerdown, hit o miss
            // — deve avanzare di uno a ogni iterazione, non solo essere > 0.
            expect(state.pointerDownCount, `click ${i} (screen ${p.x},${p.y}) non ha incrementato pointerDownCount`).toBe(i + 1);
            const click = state.lastClickedCell;

            rows.push({ x: p.x, y: p.y, worldX, worldY, pick, click: click ? { gx: click.gx, gy: click.gy } : null });
        }

        // La camera non si è mai mossa durante la corsa: le due classi
        // legittime di divergenza che il brief nomina (oggetto reso
        // interattivo nel frame corrente, camera mossa) sono entrambe escluse
        // per costruzione qui — zoom/scroll finali devono coincidere con
        // quelli iniziali.
        const finalCamera = await page.evaluate(() => {
            const cam = window.__iso!.scene.cameras.main;
            return { zoomX: cam.zoomX, scrollX: cam.scrollX, scrollY: cam.scrollY };
        });
        expect(finalCamera).toEqual({ zoomX: 1, scrollX: -480, scrollY: 24 });

        const key = (c: { gx: number; gy: number } | null): string => (c ? `${c.gx},${c.gy}` : 'null');
        const mismatches = rows.filter(r => key(r.pick) !== key(r.click));

        // Sempre in log, esito o no: la tabella dei 20 punti è la prova stessa,
        // non solo la diagnosi di un fallimento.
        console.log(JSON.stringify(rows, null, 2));

        if (mismatches.length > 0) {
            await page.screenshot({ path: path.join(ARTIFACTS, 'proof4-mismatch-state.png') });
        }

        expect(mismatches, JSON.stringify(rows, null, 2)).toEqual([]);
    });

    test('agree on the tower\'s own elevated top face, not just floor-level points', async ({ page }) => {
        // Il campione casuale di 20 punti non garantisce di toccare MAI la
        // torre (prima di questo fix nemmeno poteva: nessuna area di hit),
        // quindi l'assenza di una quarta classe di divergenza nella tabella
        // sopra sarebbe stata un incidente del campionamento, non un fatto —
        // questo test la esercita apposta. TOWER_CELL sta a quota 3: un click
        // sulla sua cima deve far percorrere DAVVERO a `iso.pick()` il ciclo
        // delle quote (z da maxElevation=3 in giu') fino a trovare la quota
        // giusta, e il click reale deve concordare.
        const { box } = await readyScene(page);

        // project(12,4,3) = (48*12-48*4, 24*12+24*4-3*24) = (384,312) -> schermo (864,288).
        const towerPoint = toPage(box, 864, 288);

        const { worldX, worldY, pick } = await page.evaluate((point) => {
            const hook = window.__iso!;
            const world = hook.scene.cameras.main.getWorldPoint(point.x, point.y);
            const cell = hook.iso.pick(world.x, world.y);
            return { worldX: world.x, worldY: world.y, pick: cell };
        }, { x: 864, y: 288 });

        expect({ worldX, worldY }).toEqual({ worldX: 384, worldY: 312 });
        expect(pick).toEqual({ gx: TOWER_CELL.gx, gy: TOWER_CELL.gy, z: TOWER_CELL.elevation });

        await page.mouse.click(towerPoint.x, towerPoint.y);
        const click = await readClickState(page);
        expect(click.lastClickedCell).toEqual({ gx: TOWER_CELL.gx, gy: TOWER_CELL.gy });
        expect(click.pointerDownCount).toBe(1);
    });
});
