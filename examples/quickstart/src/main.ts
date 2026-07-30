import Phaser from 'phaser';
import { isoScenePlugin, createHeightGrid } from 'phaser-isometric';

const GRID = 24;

class Level extends Phaser.Scene {
    create(): void {
        // The projection was set once, in the game config below, so every
        // Scene shares it. For a per-Scene projection instead, drop it there
        // and call `this.iso.configure({ ... })` here.

        // The heightmap is where elevation lives: one integer per cell, and
        // `null` for a cell with no ground at all.
        const heights = createHeightGrid(GRID, GRID, 0);
        heights.setHeight(6, 6, 2);
        heights.setHeight(20, 20, null);
        this.iso.setHeights(heights);

        // Isometric world bounds are NOT the orthogonal ones: the world is
        // (W+H) tiles wide and starts at a NEGATIVE x.
        this.iso.cameraBounds(GRID, GRID);

        // A flat 96x48 texture, so the example needs no asset files.
        const g = this.add.graphics();
        g.fillStyle(0x3d5a80, 1).fillRect(0, 0, 96, 48);
        g.generateTexture('tile', 96, 48);
        g.destroy();

        for (let gy = 0; gy < GRID; gy += 1) {
            for (let gx = 0; gx < GRID; gx += 1) {
                const z = heights.heightAt(gx, gy);
                if (z === null) continue;
                const tile = this.add.isoSprite(gx, gy, 'tile');
                tile.setCell(gx, gy, z, this.iso.bands.floor);
                // The default hit area is a rectangle over the whole frame,
                // which on a diamond over-covers by roughly double and steals
                // clicks from its neighbours.
                this.iso.makeDiamondHitArea(tile);
            }
        }

        const hero = this.add.isoSprite(3, 3, 'tile');
        hero.setCell(3, 3, 0, this.iso.bands.hero);
        this.iso.follow(hero);

        // `pick` respects elevation, and is independent of what was rendered
        // last frame - unlike Phaser's own object hit-testing.
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            const cell = this.iso.pick(p.worldX, p.worldY);
            if (cell) hero.setCell(cell.gx, cell.gy, cell.z, this.iso.bands.hero);
        });
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 960,
    height: 720,
    backgroundColor: '#11141a',
    // `isoScenePlugin` fills in the `mapping` for you, and `mapping` is
    // MANDATORY: without it Phaser silently mounts the plugin on
    // `scene["null"]` and every call above is a TypeError.
    plugins: {
        scene: [isoScenePlugin({
            projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 }
        })]
    },
    scene: [Level]
});
