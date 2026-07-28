import type { IsoPlugin } from './plugin';
import type { IsoSprite } from './iso-sprite';

// This file HAS a top-level import, so it IS a module — and that is exactly
// why `declare global` is needed: inside a module, `namespace Phaser` would
// create a local namespace that merges with nothing.
declare global {
    namespace Phaser {
        interface Scene {
            /**
             * The isometric plugin, when installed with the default `mapping`.
             *
             * Declared on EVERY Scene, including ones without the plugin: that is
             * the standard trade-off for a Phaser plugin's typings, and it is
             * deliberate. A Scene that did not install the plugin has `undefined`
             * here at runtime, and TypeScript will not warn you.
             */
            iso: IsoPlugin;
        }

        namespace GameObjects {
            interface GameObjectFactory {
                isoSprite(
                    gx: number,
                    gy: number,
                    texture: string | Phaser.Textures.Texture,
                    frame?: string | number
                ): IsoSprite;
            }
        }
    }
}

export {};
