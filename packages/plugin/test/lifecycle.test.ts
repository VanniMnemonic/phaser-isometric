// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` (and `Scene.sys.iso`) are not part of Phaser's own types —
 * that global augmentation is Task 10's deliverable, not this task's. Until
 * it lands, every direct property access in this file goes through this
 * local, test-only widening instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & { iso: IsoPlugin };

afterEach(() => {
    destroyGame();
    forgetScenePlugin(ISO_PLUGIN_KEY);
});

/** Conta i listener registrati su un evento di Scene, per nome di evento. */
function listenerCount(scene: Phaser.Scene, evento: string): number {
    return scene.sys.events.listenerCount(evento);
}

describe('il cablaggio del ciclo di vita', () => {
    it('boot() aggancia DESTROY, che la classe base non aggancia', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        }) as SceneWithIso;

        expect(scene.iso.isLive).toBe(true);
        expect(listenerCount(scene, Phaser.Scenes.Events.DESTROY)).toBeGreaterThan(0);
    });

    it('destroy() viene eseguito quando la Scene muore', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        }) as SceneWithIso;
        const plugin = scene.iso;

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);

        expect(plugin.isLive).toBe(false);
    });

    it('un riavvio della Scene non raddoppia i listener', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });

        const dopoIlPrimoStart = listenerCount(scene, Phaser.Scenes.Events.SHUTDOWN);

        // Il ciclo che Phaser percorre a ogni scene.restart(): SHUTDOWN poi START.
        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);
        scene.sys.events.emit(Phaser.Scenes.Events.START, scene.sys);
        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);
        scene.sys.events.emit(Phaser.Scenes.Events.START, scene.sys);

        // Questo e' il difetto che il test esiste per prendere: se start()
        // registra con `on` e shutdown() non stacca, il conteggio cresce a ogni
        // giro e ogni handler gira N volte per frame.
        expect(listenerCount(scene, Phaser.Scenes.Events.SHUTDOWN)).toBe(dopoIlPrimoStart);
    });

    it('dopo destroy() il plugin non trattiene piu la Scene', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        }) as SceneWithIso;
        const plugin = scene.iso;

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);

        // ScenePlugin.destroy() della classe base azzera questi quattro.
        expect((plugin as unknown as { scene: unknown }).scene).toBeNull();
        expect((plugin as unknown as { systems: unknown }).systems).toBeNull();
    });

    it('destroy() e idempotente: chiamarlo due volte non lancia ne ripete lo spegnimento', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        }) as SceneWithIso;
        const plugin = scene.iso;
        const shutdownSpy = vi.spyOn(plugin, 'shutdown');

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);
        expect(shutdownSpy).toHaveBeenCalledTimes(1);

        // "Non lancia" da solo non basta: super.destroy() e le off() con `?.`
        // sono gia' innocue su una seconda chiamata anche senza la guardia
        // `if (!this.vivo) return`. Cio' che la guardia garantisce davvero e'
        // che il SECONDO destroy() non rientri nel lavoro di spegnimento — se
        // la guardia sparisce, shutdown() viene richiamato una seconda volta.
        expect(() => plugin.destroy()).not.toThrow();
        expect(shutdownSpy).toHaveBeenCalledTimes(1);
    });

    it('la configurazione sopravvive a uno shutdown, che non e una distruzione', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        }) as SceneWithIso;

        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);

        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });
});
