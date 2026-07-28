import Phaser from 'phaser';
import { createHeightGrid, IsoSprite } from 'phaser-isometric';
import type { IsoPlugin, IsoSnapshot } from 'phaser-isometric';

/**
 * Everything a Playwright test needs to interrogate the running game,
 * without screenshot-driven testing. Assigned onto `window.__iso` at the
 * end of `create()`.
 */
export interface IsoPlaygroundHook {
    readonly scene: Phaser.Scene;
    readonly iso: IsoPlugin;
    snapshot: () => IsoSnapshot;
}

declare global {
    interface Window {
        __iso?: IsoPlaygroundHook;
    }
}

const GRID_SIZE = 16;
const TILE_WIDTH = 96;
const TILE_HEIGHT = 48;

/** The one cell with a non-zero, known elevation — the "tower". */
export const TOWER_CELL = { gx: 12, gy: 4, elevation: 3 };

/** The one cell with NO ground — `heightAt` returns `null` here, not `0`. */
export const ABYSS_CELL = { gx: 2, gy: 12 };

/** Same cell, three bands — isolates the depth tie-break from the row term. */
export const TIEBREAK_CELL = { gx: 3, gy: 10 };

/**
 * The pair the draw-order gate measures. Adjacent along `gx`, chosen because
 * their on-screen bounding boxes provably overlap at this tile size:
 *
 *   projection: a=48 b=24 c=-48 d=24 (tileWidth/2, tileHeight/2), origin (0,0)
 *   project(gx,gy,0) = (48*gx - 48*gy, 24*gx + 24*gy)
 *
 *   BACK  (7,7) -> screen (0, 336)   row = gx+gy = 14
 *   FRONT (8,7) -> screen (48, 360)  row = gx+gy = 15
 *
 * Both textures are 64x64 with the default (0.5, 0.5) origin, so each
 * sprite's AABB extends 32px on every side of its projected centre:
 *
 *   BACK  AABB:  x in [-32, 32],  y in [304, 368]
 *   FRONT AABB:  x in [16, 80],   y in [328, 392]
 *   overlap:     x in [16, 32]  (16px),  y in [328, 368]  (40px)  -- non-empty
 *
 * `row` dominates the depth key by construction (rowStride=4096 vs. a single
 * band+sub never exceeding a few hundred), so FRONT's depth key is always
 * greater than BACK's regardless of band/sub. Phaser sorts ascending, so
 * BACK paints first and FRONT paints over it: inside the overlap rectangle
 * above, a correct renderer shows FRONT's colour, never BACK's.
 */
export const OVERLAP_BACK = { gx: 7, gy: 7 };
export const OVERLAP_FRONT = { gx: 8, gy: 7 };

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 720;

function makeSolidTexture(scene: Phaser.Scene, key: string, width: number, height: number, color: number): void {
    const g = scene.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, width, height);
    g.generateTexture(key, width, height);
    g.destroy();
}

/**
 * The test bench for the browser gate (draw order, `roundPixels` at a
 * non-integer zoom, and a real click on a diamond hit area) and for the
 * benchmark. Built for observability, not for looks.
 */
export class PlaygroundScene extends Phaser.Scene {
    /** Incremented by the diamond-hit-area click handler. Read via
     *  `window.__iso.scene.clickCount` — this is what proves a real pointer
     *  event landed on the polygon, not just anywhere on the sprite's frame. */
    clickCount = 0;

    /** Incremented on every `pointerdown`, hit or miss — unlike `clickCount`,
     *  which only counts hits on `hero`. Compare against `lastClickedCell`
     *  to tell "no click happened yet" apart from "the most recent click
     *  missed", both of which otherwise read as `lastClickedCell === null`. */
    pointerDownCount = 0;

    /** The cell of whichever `IsoSprite` was under the pointer on the MOST
     *  RECENT `pointerdown`, or `null` if that click hit nothing.
     *  Recomputed from scratch on every click (see `create()`), so it never
     *  carries over a previous click's hit: a genuine miss reliably reads
     *  back as `null`, not as whatever was clicked before. Compare against
     *  `iso.pick(worldX, worldY)` at the same point to check that Phaser's
     *  own hit-testing and this plugin's picking agree. */
    lastClickedCell: { gx: number; gy: number } | null = null;

    create(): void {
        this.iso.configure({ type: 'diamond', tileWidth: TILE_WIDTH, tileHeight: TILE_HEIGHT });

        const heights = createHeightGrid(GRID_SIZE, GRID_SIZE, 0);
        heights.setHeight(TOWER_CELL.gx, TOWER_CELL.gy, TOWER_CELL.elevation);
        heights.setHeight(ABYSS_CELL.gx, ABYSS_CELL.gy, null);
        this.iso.setHeights(heights);
        this.iso.cameraBounds(GRID_SIZE, GRID_SIZE, { maxElevation: TOWER_CELL.elevation });

        makeSolidTexture(this, 'floor', TILE_WIDTH, TILE_HEIGHT, 0x3d5a80);
        makeSolidTexture(this, 'tower', 48, 96, 0xee6c4d);
        makeSolidTexture(this, 'back', 64, 64, 0xd7263d);
        makeSolidTexture(this, 'front', 64, 64, 0x1b998b);
        makeSolidTexture(this, 'band-decal', 32, 32, 0x8ecae6);
        makeSolidTexture(this, 'band-actor', 32, 32, 0xffb703);
        makeSolidTexture(this, 'band-hero', 32, 32, 0xfb8500);

        // Un IsoSprite per cella, meno l'abisso: lì non c'è nulla su cui
        // stare in piedi, che è esattamente il senso di `null` in una
        // HeightSource. Ogni tile riceve anche la propria area di hit a
        // diamante: è la superficie cliccabile su cui il Task 12 confronta,
        // per venti punti pseudo-casuali, la cella riportata dall'handler di
        // Phaser con quella di `iso.pick()` — senza hit area sui tile, la
        // stragrande maggioranza di quei punti non avrebbe nulla da
        // riportare, e il confronto sarebbe teatro.
        for (let gy = 0; gy < GRID_SIZE; gy += 1) {
            for (let gx = 0; gx < GRID_SIZE; gx += 1) {
                const h = heights.heightAt(gx, gy);
                if (h === null) continue;
                const tile = this.add.isoSprite(gx, gy, 'floor').setCell(gx, gy, h, this.iso.bands.floor);
                this.iso.makeDiamondHitArea(tile);
            }
        }

        // La torre: un prop più alto sull'unica cella con una quota nota e
        // non nulla, utile sia per `pick()` sia per i controlli di
        // `cameraBounds()`. Anche lei riceve un'area di hit a diamante.
        // CORREZIONE (fix round 2): questo commento diceva che senza
        // quell'area un click sulla cima "non avrebbe nulla da riportare" —
        // falso. Il tile pavimento su questa stessa cella e' piazzato alla
        // SUA quota (`h = heights.heightAt(gx, gy)` nel loop qui sopra, non
        // un fisso z=0), quindi possiede gia' un'area di hit esattamente
        // nella stessa posizione a schermo della cima della torre: un click
        // li' ha SEMPRE riportato {12,4}, con o senza quest'area propria.
        // L'area di hit della torre resta comunque corretta da avere (rende
        // la torre cliccabile come se stessa, non solo tramite il pavimento
        // sotto), ed e' quella che Task 12's Proof 4 usa per dimostrare che
        // `iso.pick()` percorre per intero il ciclo delle quote — non che
        // il click altrimenti non troverebbe nulla. `place()` proietta il
        // centro dello sprite esattamente su `project(gx,gy,elevation)`
        // (origine 0.5,0.5 di default), quindi il diamante di default —
        // stesso punto, stessa dimensione della proiezione — cade esattamente
        // dove `pick()` risolve a quella quota, non dove serve indovinare.
        const tower = this.add.isoSprite(TOWER_CELL.gx, TOWER_CELL.gy, 'tower')
            .setCell(TOWER_CELL.gx, TOWER_CELL.gy, TOWER_CELL.elevation, this.iso.bands.prop);
        this.iso.makeDiamondHitArea(tower);

        // Terzetto per il tie-break: stessa cella, tre bande diverse,
        // completamente sovrapposti a schermo (stesso punto proiettato).
        // `hero` (banda 5) è la più alta delle tre, quindi deve essere
        // l'unica pienamente visibile sopra le altre.
        this.add.isoSprite(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 'band-decal')
            .setCell(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 0, this.iso.bands.decal);
        this.add.isoSprite(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 'band-actor')
            .setCell(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 0, this.iso.bands.actor);
        const hero = this.add.isoSprite(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 'band-hero')
            .setCell(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 0, this.iso.bands.hero);

        // La coppia di sovrapposizione su cui il gate misura l'ordine di
        // disegno — vedi il commento del modulo sopra per l'aritmetica che
        // dimostra la sovrapposizione a schermo.
        this.add.isoSprite(OVERLAP_BACK.gx, OVERLAP_BACK.gy, 'back')
            .setCell(OVERLAP_BACK.gx, OVERLAP_BACK.gy, 0, this.iso.bands.actor);
        this.add.isoSprite(OVERLAP_FRONT.gx, OVERLAP_FRONT.gy, 'front')
            .setCell(OVERLAP_FRONT.gx, OVERLAP_FRONT.gy, 0, this.iso.bands.actor);

        // Un'area di hit a diamante realmente cliccabile su `hero`.
        // `camera.renderList` resta vuota sotto HEADLESS e `input.hitTest`
        // non esiste in Phaser 4, quindi questo non è dimostrabilmente
        // testabile senza un vero evento di puntatore in un browser reale.
        this.iso.makeDiamondHitArea(hero);

        // POINTER_DOWN, non GAMEOBJECT_DOWN — verificato nel sorgente di
        // Phaser (4.2.1, InputPlugin#processDownEvents): il ciclo su
        // `currentlyOver` emette GAMEOBJECT_DOWN per ciascun oggetto
        // colpito, e SOLO DOPO, fuori dal ciclo, arriva
        // `this.emit(POINTER_DOWN, pointer, currentlyOver)` — la gerarchia
        // documentata (GAMEOBJECT_POINTER_DOWN, poi GAMEOBJECT_DOWN, poi
        // POINTER_DOWN) è quindi anche l'ordine reale di dispaccio, non solo
        // quello dichiarato. `currentlyOver` è il secondo argomento di
        // POINTER_DOWN: la lista (vuota se non si è colpito nulla) degli
        // oggetti interattivi sotto il puntatore in QUESTO click. Un solo
        // handler che legge quella lista — invece di azzerare in un handler
        // e scrivere in un altro — evita ogni dipendenza dall'ordine
        // relativo fra due eventi separati: il valore corretto si calcola
        // per intero a ogni click, quindi un click che non colpisce nulla
        // resetta `lastClickedCell` a `null` invece di lasciarci la cella
        // del click precedente. `hero` in più incrementa clickCount e si
        // tinge di verde: è la prova specifica del click reale sull'area a
        // diamante, distinta dal confronto generico pick()-vs-click sopra.
        this.input.on(Phaser.Input.Events.POINTER_DOWN, (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
            this.pointerDownCount += 1;

            const hit = currentlyOver.find((obj): obj is IsoSprite => obj instanceof IsoSprite);
            this.lastClickedCell = hit ? { gx: hit.gx, gy: hit.gy } : null;

            if (hit === hero) {
                this.clickCount += 1;
                hero.setTint(0x00ff00);
            }
        });

        this.cameras.main.setRoundPixels(true);
        const center = this.iso.projection.project(GRID_SIZE / 2, GRID_SIZE / 2, 0);
        this.cameras.main.centerOn(center.x, center.y);

        this.wireZoomToggle();

        window.__iso = {
            scene: this,
            iso: this.iso,
            snapshot: () => this.iso.snapshot()
        };
    }

    /** Collega il pulsante DOM `#zoom-toggle` per alternare la camera
     *  principale fra zoom 1 e 1.5 — il caso in cui `roundPixels` conta
     *  davvero, dato che a zoom 1 ogni posizione a schermo è già un pixel
     *  intero. */
    private wireZoomToggle(): void {
        const button = document.getElementById('zoom-toggle');
        if (!button) return;

        button.addEventListener('click', () => {
            const next = this.cameras.main.zoom === 1 ? 1.5 : 1;
            this.cameras.main.setZoom(next);
            button.textContent = `zoom: ${next}`;
        });
    }
}
