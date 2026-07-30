# phaser-isometric

An isometric plugin for [Phaser](https://phaser.io) 4, in TypeScript: projection,
elevation-aware picking, deterministic depth ordering, view culling and correct
world bounds for a diamond-grid game.

## Why this exists

There is no isometric plugin for Phaser 4 on npm. The two historic ones are dead:
`phaser-plugin-isometric` (lewster32) is stuck on Phaser 2 and declares itself
unmaintained in its own README; the fork made for Phaser 3 has its unprojection
**broken** — it reads `this.game.world`, which does not exist in Phaser 4, and
`this.game` is never even assigned in the constructor. There is no reference
implementation to read. The gap is real, and nobody has closed it.

Phaser 4 already covers a large part of the isometric domain on its own — the two
first-party diamond projections, the full Tiled parser, batched tile drawing, a
stable depth sort, polygonal hit-testing, the camera. What it does not cover, and
what every isometric game ends up rewriting from scratch, is what this package
provides: per-cell elevation, a depth key that can never tie, picking that agrees
with a real click to the pixel, and the view culling Phaser 4 performs none of.

## Install

```bash
npm install phaser-isometric phaser
```

`phaser` `^4.0.0` is a peer dependency declared **optional**, which is exactly the
flag that stops npm 7+ and pnpm from installing it for you — name it explicitly,
or the first `import Phaser from 'phaser'` in your game fails to resolve. It is
optional because a program that imports only `phaser-isometric/core` needs
neither Phaser nor a DOM.

## Quick Start

<!-- BEGIN quickstart -->
```ts
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
```
<!-- END quickstart -->

## Three entry points

| Import | What it is | When |
|---|---|---|
| `phaser-isometric` | The plugin — `isoScenePlugin`, `IsoPlugin`, `IsoSprite` — plus the core's projection, depth, height-grid, picking, culling, bounds and hit-area exports re-exported | In a Scene |
| `phaser-isometric/core` | The pure maths. Zero Phaser imports, runs in Node. | Level generators, unit tests, a server that validates moves |
| `phaser-isometric/debug` | `createIsoDebug` — the ready-made cell-outline overlay | While developing; it stays out of a production bundle unless imported on purpose |

## Check a configuration without running the game

```sh
npx phaser-isometric diagnose --tile 96x48 --grid 24x24
```

One card with the matrix and its determinant, how far that matrix sits from singular, the
depth layout together with the exact row at which keys stop being distinguishable, the world
bounds for that grid, and the round-trip error. One call instead of five, and no browser.

The command lives **inside the package**, which is the point: it is by construction the
version you installed, so there is no second artifact that can quietly disagree with your
code. `--json` returns the same facts as data; `--strict` turns warnings into a non-zero exit
for CI, and without it the exit code stays 0. A configuration the library would reject prints
the symptom and the correction as two separate fields rather than one glued sentence.

`npx phaser-isometric help` lists every flag.

## For agents

The package ships its own agent-facing documentation at `skills/phaser-isometric/SKILL.md`
— that path is relative to the installed package root, i.e.
`node_modules/phaser-isometric/skills/phaser-isometric/SKILL.md` after `npm install` —
in the same format as the skills Phaser 4 itself ships inside its own npm package. An
agent that has indexed `node_modules/phaser/skills/` finds this one at the same
place, in the same shape — read it before writing isometric code against this
plugin. Browsable on GitHub at
https://github.com/VanniMnemonic/phaser-isometric/blob/main/packages/plugin/skills/phaser-isometric/SKILL.md.

## Performance

Conditions, which travel with every number below: Apple M1 Max laptop, not CI;
Chromium headless, WebGL through SwiftShader software rendering.

Driving 500 simultaneously active `IsoSprite`s — each re-projected and re-depth-sorted
every single frame across a 100x100-cell world, with a following camera and view culling
keeping 23-59 of them on screen at any instant — phaser-isometric held the browser's own
frame cadence at the median: an 8.3 ms median frame period, at least 2x inside the
16.6 ms / 60 fps budget (a handful of single-frame outliers up to 34 ms also appeared —
this is a median claim, not a claim that every frame met budget). That median reproduced
**identically in all eighteen runs of two separate campaigns**, two days apart, on an
otherwise idle machine.
Measured directly — bracketing the plugin's own main-thread update-and-render-submission
work, which excludes GPU rasterisation happening asynchronously outside that bracket —
per-frame CPU-side cost averaged 0.17-0.25 ms at 500 active entities against a
~0.05-0.07 ms baseline for the same page with none: roughly 2.5-5x the baseline (a range,
not a constant, since both terms sit near the browser's ~100 us timing floor, and the
second campaign extended both ends downward without moving the ratio).

**"500 active" is not "500 drawn on screen"** — culling kept 23-59 of them visible, and
the drawn-count claim was never measured. The clause travels with the number always:
without it, the number promises something that was never measured.

## Non-goals of v1

Pathfinding · movement and collisions · occlusion and fade · Tiled import · physics ·
multi-level structures (bridges, tunnels, multi-storey buildings).

None of these are precluded: `HeightSource`, the depth bands and the replaceable sort
key are the joints a game (or a future package) hangs them from. They simply do not
enter this kernel — the package is a *view*, not a game framework.

## A note on the version number

**`0.1.0` means the API can still move.** No real game has exercised it yet, and below
`1.0.0` semver allows a breaking change inside a minor release. Saying so here is more
honest than a consumer discovering it the hard way.

## License

[MIT](LICENSE) © 2026 Alessandro Vanni
