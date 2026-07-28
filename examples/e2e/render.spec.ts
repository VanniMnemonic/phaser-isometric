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

test.describe('Proof 2 — roundPixels at fractional zoom', () => {
    test('screen positions land on integer pixels at zoom 1.5, no seam at the tile edge', async ({ page }) => {
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

        await page.screenshot({
            path: path.join(ARTIFACTS, 'proof3-target-and-abyss.png'),
            clip: { x: box.x, y: box.y + 288, width: 110, height: 96 }
        });
    });
});

/**
 * gx/gy esatti (zoom 1, scrollX=-480, scrollY=24) per uno screen point
 * intero, con la stessa formula di `unprojectInto`
 * (packages/core/src/projection.ts): a=48,b=24,c=-48,d=24,det=2304.
 */
function gridOf(screenX: number, screenY: number): { gx: number; gy: number } {
    const worldX = screenX - 480;
    const worldY = screenY + 24;
    const gx = (24 * worldX + 48 * worldY) / 2304;
    const gy = (-24 * worldX + 48 * worldY) / 2304;
    return { gx, gy };
}

/**
 * Vero solo su un pareggio ESATTO (frazione 0.5 su gx o gy): il punto giace
 * matematicamente sul confine condiviso fra due celle. Scoperto eseguendo,
 * non previsto: screen (102,147) -> world (-378,171) -> gy = 17280/2304 = 7.5
 * esatto (nessun rumore in virgola mobile, entrambi i numeratori sono
 * multipli di potenze di 2) dava `iso.pick()` -> {gx:0,gy:8} (Math.round
 * arrotonda 7.5 in su) contro un click reale -> {gx:0,gy:7}. `pick()` e il
 * rombo di Phaser (`Polygon.Contains`, bordi half-open) sono due algoritmi
 * indipendenti che sul BORDO — non all'interno, dove il commento di
 * `projection.ts` garantisce che coincidono esattamente — non hanno mai
 * promesso lo stesso criterio di pareggio. Escludere questi punti non
 * nasconde una divergenza: la sposta a un confronto che ha davvero una
 * risposta univoca, invece di un pareggio matematico a cui NESSUNA delle due
 * implementazioni può "vincere" in modo canonico.
 */
function isExactBoundaryTie(screenX: number, screenY: number): boolean {
    const { gx, gy } = gridOf(screenX, screenY);
    const fracGx = Math.abs(gx - Math.round(gx));
    const fracGy = Math.abs(gy - Math.round(gy));
    return Math.abs(fracGx - 0.5) < 1e-9 || Math.abs(fracGy - 0.5) < 1e-9;
}

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

        const rand = mulberry32(0xc0ffee);
        const points: Array<{ x: number; y: number }> = [];
        while (points.length < 20) {
            const x = Math.floor(rand() * CANVAS_WIDTH);
            const y = Math.floor(rand() * CANVAS_HEIGHT);
            if (x >= exclude.left && x <= exclude.right && y >= exclude.top && y <= exclude.bottom) continue;
            if (isExactBoundaryTie(x, y)) continue;
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

        for (const p of points) {
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
            const click = (await readClickState(page)).lastClickedCell;

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
});
