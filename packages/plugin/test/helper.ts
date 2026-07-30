import PhaserNS from 'phaser';

/**
 * The Phaser namespace, imported once.
 *
 * Measured on 4.2.1: the ESM bundle's default export IS already the
 * namespace (`Phaser.Game` is a function, `Phaser.default` is undefined),
 * so no `?? .default` normalization is needed.
 */
export const Phaser = PhaserNS;

let currentGame: Phaser.Game | null = null;

/**
 * Boots a headless Game and resolves with the active Scene once `create()`
 * has been called.
 *
 * Idiom copied from `phaser/tests/helper.js`: HEADLESS, no banner, no audio.
 * `config` is merged on top, so a test can add `plugins`, `render`, or
 * replace `scene`.
 *
 * The timeout exists because the typical way to get this wrong isn't an
 * exception: it's a boot that never finishes (see the Image mock in the
 * vendored setup). A hanging Promise would time the test out with a
 * message that says nothing; this one says what happened.
 */
export function bootGame(config: Record<string, unknown> = {}): Promise<Phaser.Scene> {
    destroyGame();

    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('the game never reached create(): the boot sequence stalled')),
            8000
        );

        currentGame = new Phaser.Game({
            type: Phaser.HEADLESS,
            width: 800,
            height: 600,
            banner: false,
            audio: { noAudio: true },
            scene: {
                key: 'probe',
                create(this: Phaser.Scene) { clearTimeout(timer); resolve(this); }
            },
            ...config
        } as Phaser.Types.Core.GameConfig);
    });
}

/** Destroys the current Game. Idempotent: calling it with no active game
 *  is a no-op, so an unconditional `afterEach` is safe. */
export function destroyGame(): void {
    if (!currentGame) return;
    try { currentGame.destroy(true); } catch { /* un boot fallito puo' lasciare uno stato parziale */ }
    currentGame = null;
}

/**
 * Forgets a registered scene plugin, so the next Game starts clean.
 *
 * THIS IS ACTUALLY NEEDED, not luxury hygiene. `PluginCache` is a
 * MODULE-level singleton, and `game.destroy()` only empties it if
 * `game.noReturn` is true (PluginManager.destroy → destroyCorePlugins). So,
 * after the first Game, `installScenePlugin` finds
 * `PluginCache.hasCore(key) === true` and SKIPS re-registration: the second
 * Game silently inherits the first one's `mapping`. A test that installs the
 * same plugin with a different mapping would fail for a reason that has
 * nothing to do with what it's actually verifying.
 */
export function forgetScenePlugin(key: string): void {
    Phaser.Plugins.PluginCache.remove(key);
}
