import Phaser from 'phaser';
import { isoScenePlugin, createHeightGrid } from 'phaser-isometric';
import { createIsoDebug } from 'phaser-isometric/debug';

const GRID = 12;

/**
 * Deliberately not the Quick Start: a 12x12 grid with a stepped plateau
 * (elevations 0, 1, 2 and a single peak at 3) plus one abyss cell, the
 * debug overlay switched on, and a click that `pick()`s a cell and moves
 * the actor onto it.
 */
class FromDocsScene extends Phaser.Scene {
    create(): void {
        const heights = createHeightGrid(GRID, GRID, 0);

        // A stepped plateau: elevations 1 and 2 rising out of the 0 floor,
        // one single peak cell at 3.
        for (let gy = 4; gy <= 7; gy += 1) {
            for (let gx = 4; gx <= 7; gx += 1) {
                heights.setHeight(gx, gy, 1);
            }
        }
        for (let gy = 5; gy <= 6; gy += 1) {
            for (let gx = 5; gx <= 6; gx += 1) {
                heights.setHeight(gx, gy, 2);
            }
        }
        heights.setHeight(5, 5, 3);

        // One abyss cell: no ground at all, distinct from elevation 0.
        heights.setHeight(0, 0, null);

        this.iso.setHeights(heights);
        this.iso.cameraBounds(GRID, GRID);

        const g = this.add.graphics();
        g.fillStyle(0x3d5a80, 1).fillRect(0, 0, 96, 48);
        g.generateTexture('tile', 96, 48);
        g.fillStyle(0xee6c4d, 1).fillRect(0, 0, 96, 48);
        g.generateTexture('actor', 96, 48);
        g.destroy();

        for (let gy = 0; gy < GRID; gy += 1) {
            for (let gx = 0; gx < GRID; gx += 1) {
                const z = heights.heightAt(gx, gy);
                if (z === null) continue;
                const tile = this.add.isoSprite(gx, gy, 'tile');
                tile.setCell(gx, gy, z, this.iso.bands.floor);
                // The default hit area over-covers a diamond by roughly
                // double and steals clicks from neighbouring cells.
                this.iso.makeDiamondHitArea(tile);
            }
        }

        const hero = this.add.isoSprite(1, 1, 'actor');
        hero.setCell(1, 1, 0, this.iso.bands.hero);

        // `pick` respects elevation and agrees with a real click to the
        // pixel — unlike Phaser's own one-frame-stale object hit-testing.
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            const cell = this.iso.pick(p.worldX, p.worldY);
            if (cell) hero.setCell(cell.gx, cell.gy, cell.z, this.iso.bands.hero);
        });

        const overlay = createIsoDebug(this.iso, {
            pad: { above: 64, below: 0, sides: 48 },
            show: { coords: true, elevation: true, depthKeys: true }
        });
        overlay.redraw();
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 960,
    height: 720,
    backgroundColor: '#11141a',
    // `isoScenePlugin` fills in `mapping` for us; without it Phaser mounts
    // the plugin on `scene["null"]` with no warning at all.
    plugins: {
        scene: [isoScenePlugin({
            projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 }
        })]
    },
    scene: [FromDocsScene]
});
