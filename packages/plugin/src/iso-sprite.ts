import Phaser from 'phaser';
import { DEFAULT_BANDS } from '@iso-internal/core';
import type { Band } from '@iso-internal/core';
import { ISO_SYS_KEY } from './plugin';
import type { IsoPlugin } from './plugin';
import { IsoUsageError } from './errors';

/** Finds the isometric plugin belonging to a Scene, whatever `mapping` it uses. */
function isoOf(scene: Phaser.Scene): IsoPlugin {
    const plugin = (scene.sys as unknown as Record<string, unknown>)[ISO_SYS_KEY];

    if (!plugin) {
        throw new IsoUsageError(
            'this Scene has no isometric plugin, so an IsoSprite cannot be positioned',
            'add isoScenePlugin({ ... }) to plugins.scene in your game config. ' +
            'If you did, check that this Scene does not declare its own `plugins: [...]` ' +
            'array, which replaces the default list and drops the plugin entirely'
        );
    }

    return plugin as IsoPlugin;
}

/**
 * A Sprite that knows which grid cell it occupies.
 *
 * It holds the cell, not the maths: every move goes through `IsoPlugin.place()`,
 * so position and depth come from the same code path as everything else.
 */
export class IsoSprite extends Phaser.GameObjects.Sprite {
    /**
     * `declare` emits NO code — it only tells TypeScript this member exists on
     * the base class. It matters because `depth` is an ACCESSOR on Phaser's
     * prototype (`Depth.js:45`, backed by `_depth`), and under
     * `useDefineForClassFields: true` — the default in most projects, including
     * both of our reference codebases — a plain class field of the same name
     * emits `defineProperty` and SHADOWS the setter. The value then reads back
     * correctly while the renderer keeps sorting on a `_depth` that never moved.
     * TypeScript does not warn, because `phaser.d.ts` declares `depth` as a flat
     * property. Anyone subclassing IsoSprite inherits this hazard.
     */
    declare depth: number;

    /** Grid column. */
    gx = 0;
    /** Grid row. */
    gy = 0;
    /**
     * Elevation, in whole steps.
     *
     * NOT called `z`: `Phaser.GameObjects.Components.Transform` already defines
     * a `z` data property, documented as free for your own use and ignored by
     * the renderer. Quietly repurposing it would break anyone relying on that.
     */
    elevation = 0;
    /** Depth band. Defaults to `prop`. */
    band: Band = DEFAULT_BANDS.prop;
    /** Tie-break slot within the same cell and band. */
    sub = 0;

    /** Moves this sprite to a cell, re-projecting and re-depthing it. */
    setCell(
        gx: number,
        gy: number,
        elevation: number = this.elevation,
        band: Band = this.band,
        sub: number = this.sub
    ): this {
        // Validate BEFORE mutating: `place()` computes the depth key first and
        // throws on an invalid `gx`/`gy`/`band`/`sub` before writing anything to
        // `this`. Calling it before touching the cell fields means a rejected
        // `setCell()` leaves gx/gy/elevation/band/sub — and x/y/depth, via
        // `place()`'s own atomicity — exactly as they were. Writing the cell
        // fields first would corrupt them on a throw, and a later
        // `setCell(gx, gy)` with omitted band/sub would then default to that
        // corrupted value and throw again for a reason the caller never gave.
        isoOf(this.scene).place(this, gx, gy, elevation, band, sub);

        this.gx = gx;
        this.gy = gy;
        this.elevation = elevation;
        this.band = band;
        this.sub = sub;

        return this;
    }
}

/**
 * Registers `this.add.isoSprite(...)`.
 *
 * Called from the plugin's constructor, which runs once per Scene — including
 * Phaser's hidden `__SYSTEM` Scene. That is safe without a guard of our own:
 * `GameObjectFactory.register` is itself wrapped in a `hasOwnProperty` check, so
 * the first registration wins and every later one is a no-op. The flip side,
 * worth documenting: if the consumer registered their own `isoSprite` first,
 * ours is silently ignored.
 */
export function registerIsoSprite(pluginManager: Phaser.Plugins.PluginManager): void {
    pluginManager.registerGameObject(
        'isoSprite',
        function (
            this: Phaser.GameObjects.GameObjectFactory,
            gx: number,
            gy: number,
            texture: string | Phaser.Textures.Texture,
            frame?: string | number
        ): IsoSprite {
            const sprite = new IsoSprite(this.scene, 0, 0, texture, frame);

            // Validate BEFORE mutating: `setCell` can throw on an invalid
            // gx/gy. Doing it before `displayList.add()` means a rejected call
            // leaves NOTHING behind in the Scene — no half-initialised sprite
            // orphaned in the display list that the caller never got a
            // reference to.
            sprite.setCell(gx, gy);

            // ONLY the display list, exactly like the built-in Sprite factory.
            // `Sprite.addedToScene()` subscribes itself to the update list, and
            // `displayList.add` is what triggers it: doing it here too would
            // enroll it twice, and animations would advance at double speed.
            this.displayList.add(sprite);

            return sprite;
        }
    );
}
