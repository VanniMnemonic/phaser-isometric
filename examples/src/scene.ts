import Phaser from 'phaser';
import { createHeightGrid } from 'phaser-isometric';
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
const TOWER_CELL = { gx: 12, gy: 4, elevation: 3 };

/** The one cell with NO ground — `heightAt` returns `null` here, not `0`. */
const ABYSS_CELL = { gx: 2, gy: 12 };

/** Same cell, three bands — isolates the depth tie-break from the row term. */
const TIEBREAK_CELL = { gx: 3, gy: 10 };

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
const OVERLAP_BACK = { gx: 7, gy: 7 };
const OVERLAP_FRONT = { gx: 8, gy: 7 };

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;

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

        // One IsoSprite per cell, minus the abyss: there is nothing to stand
        // on there, which is the entire point of `null` in a HeightSource.
        for (let gy = 0; gy < GRID_SIZE; gy += 1) {
            for (let gx = 0; gx < GRID_SIZE; gx += 1) {
                const h = heights.heightAt(gx, gy);
                if (h === null) continue;
                this.add.isoSprite(gx, gy, 'floor').setCell(gx, gy, h, this.iso.bands.floor);
            }
        }

        // The tower: a taller prop at the one cell with a known non-zero
        // elevation, useful for both `pick()` and `cameraBounds()` checks.
        this.add.isoSprite(TOWER_CELL.gx, TOWER_CELL.gy, 'tower')
            .setCell(TOWER_CELL.gx, TOWER_CELL.gy, TOWER_CELL.elevation, this.iso.bands.prop);

        // Tie-break trio: same cell, three different bands, fully overlapping
        // on screen (same projected point). `hero` (band 5) is the highest
        // of the three, so it must be the one fully visible on top.
        this.add.isoSprite(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 'band-decal')
            .setCell(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 0, this.iso.bands.decal);
        this.add.isoSprite(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 'band-actor')
            .setCell(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 0, this.iso.bands.actor);
        const hero = this.add.isoSprite(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 'band-hero')
            .setCell(TIEBREAK_CELL.gx, TIEBREAK_CELL.gy, 0, this.iso.bands.hero);

        // The overlap pair the draw-order gate measures — see the module
        // comment above for the arithmetic proving they overlap on screen.
        this.add.isoSprite(OVERLAP_BACK.gx, OVERLAP_BACK.gy, 'back')
            .setCell(OVERLAP_BACK.gx, OVERLAP_BACK.gy, 0, this.iso.bands.actor);
        this.add.isoSprite(OVERLAP_FRONT.gx, OVERLAP_FRONT.gy, 'front')
            .setCell(OVERLAP_FRONT.gx, OVERLAP_FRONT.gy, 0, this.iso.bands.actor);

        // A real, clickable diamond hit area. `camera.renderList` stays empty
        // under HEADLESS and `input.hitTest` does not exist in Phaser 4, so
        // this is provably not testable without an actual pointer event in a
        // real browser.
        this.iso.makeDiamondHitArea(hero);
        hero.on('pointerdown', () => {
            this.clickCount += 1;
            hero.setTint(0x00ff00);
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

    /** Wires the `#zoom-toggle` DOM button to alternate the main camera
     *  between zoom 1 and 1.5 — the case `roundPixels` actually matters for,
     *  since at zoom 1 every screen position is already a whole pixel. */
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

export { CANVAS_WIDTH, CANVAS_HEIGHT };
