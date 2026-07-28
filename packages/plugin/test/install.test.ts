// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';
import { IsoUsageError } from '../src/errors';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` (and `Scene.sys.iso`) are not part of Phaser's own types —
 * that global augmentation is Task 10's deliverable, not this task's. Until
 * it lands, every direct property access in this file goes through this
 * local, test-only widening instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & {
    iso: IsoPlugin;
    sys: Phaser.Scenes.Systems & { iso: IsoPlugin };
};

afterEach(() => {
    destroyGame();
    // Obbligatorio: la PluginCache e' un singleton di modulo che sopravvive a
    // game.destroy(). Senza questo, il test successivo eredita in silenzio il
    // mapping di questo.
    forgetScenePlugin(ISO_PLUGIN_KEY);
});

describe('dove finisce il plugin', () => {
    it('si monta su sys[mapping] E su scene[mapping]', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        }) as SceneWithIso;

        expect(scene.sys.iso).toBeInstanceOf(IsoPlugin);
        expect(scene.iso).toBeInstanceOf(IsoPlugin);
        expect(scene.iso).toBe(scene.sys.iso);
    });

    it('NON si monta sulla key: la key vive solo nella PluginCache', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        expect((scene.sys as unknown as Record<string, unknown>)[ISO_PLUGIN_KEY]).toBeUndefined();
        expect((scene as unknown as Record<string, unknown>)[ISO_PLUGIN_KEY]).toBeUndefined();
    });

    it('riceve il mapping come terzo argomento del costruttore', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        }) as SceneWithIso;

        expect(scene.iso.pluginKey).toBe('iso');
    });

    it('rispetta un mapping diverso da quello di default', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'griglia', projection: DIAMOND })] }
        });

        expect((scene as unknown as Record<string, unknown>).griglia).toBeInstanceOf(IsoPlugin);
        expect((scene as unknown as Record<string, unknown>).iso).toBeUndefined();
    });
});

describe('quante volte viene costruito', () => {
    it('una per Scene, __SYSTEM inclusa', async () => {
        const viste: string[] = [];

        class Contatore extends IsoPlugin {
            constructor(scene: Phaser.Scene, pm: Phaser.Plugins.PluginManager, key: string) {
                super(scene, pm, key);
                viste.push(scene.sys.settings.key);
            }
        }

        await bootGame({ plugins: { scene: [{ key: ISO_PLUGIN_KEY, plugin: Contatore, mapping: 'iso' }] } });

        // Phaser avvia una Scene di sistema nascosta (SceneManager.js:195) e il
        // plugin viene istanziato anche li'. Il conteggio e' N scene utente + 1,
        // non N: un test che si aspetta 1 fallisce per la ragione sbagliata.
        expect(viste).toEqual(['__SYSTEM', 'probe']);
    });

    it('non riceve mai init(), e `data` viene buttato via', async () => {
        const initChiamate: unknown[] = [];

        class Spia extends IsoPlugin {
            init(data?: unknown): void { initChiamate.push(data); }
        }

        await bootGame({
            plugins: {
                scene: [{ key: ISO_PLUGIN_KEY, plugin: Spia, mapping: 'iso', data: { ciao: 'mondo' } }]
            }
        });

        expect(initChiamate).toEqual([]);
    });
});

describe('configurazione', () => {
    it('withDefaults consegna un plugin gia configurato', async () => {
        const scene = await bootGame({
            plugins: { scene: [{ key: ISO_PLUGIN_KEY, plugin: IsoPlugin.withDefaults(DIAMOND), mapping: 'iso' }] }
        }) as SceneWithIso;

        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(0, 0)).toEqual({ x: 0, y: 0 });
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });

    it('configure() dalla create() della Scene fa lo stesso lavoro', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        }) as SceneWithIso;

        expect(scene.iso.isConfigured).toBe(false);
        expect(scene.iso.configure(DIAMOND)).toBe(scene.iso);
        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });

    it('leggere projection prima di configurare lancia, e il messaggio nomina la correzione', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        }) as SceneWithIso;

        expect(() => scene.iso.projection).toThrow(IsoUsageError);
        try {
            scene.iso.projection;
            expect.unreachable('avrebbe dovuto lanciare');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain('configure');
            expect(msg).toContain('withDefaults');
        }
    });

    it('bands espone le sette bande del core', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        }) as SceneWithIso;

        expect(scene.iso.bands.floor).toBe(0);
        expect(scene.iso.bands.overlay).toBe(6);
    });
});

describe('la factory di config', () => {
    it('produce una entry con mapping, e mai systemKey/sceneKey', () => {
        const entry = isoScenePlugin({ projection: DIAMOND });

        expect(entry.key).toBe(ISO_PLUGIN_KEY);
        expect(entry.mapping).toBe('iso');
        expect(entry).not.toHaveProperty('systemKey');
        expect(entry).not.toHaveProperty('sceneKey');
    });

    it('senza projection restituisce la classe nuda, non una sottoclasse', () => {
        expect(isoScenePlugin().plugin).toBe(IsoPlugin);
        expect(isoScenePlugin({ projection: DIAMOND }).plugin).not.toBe(IsoPlugin);
    });
});

describe('installazione sbagliata', () => {
    it('senza mapping avvisa, e l avviso nomina mapping', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // La forma ESATTA dell'@example ufficiale di Phaser.
        const scene = await bootGame({
            plugins: {
                scene: [{ key: ISO_PLUGIN_KEY, plugin: IsoPlugin, systemKey: 'isoSys', sceneKey: 'iso' }]
            }
        });

        // Cosi' finisce davvero: sulla proprieta' stringa "null".
        expect((scene as unknown as Record<string, unknown>)['null']).toBeInstanceOf(IsoPlugin);
        expect((scene as unknown as Record<string, unknown>).iso).toBeUndefined();

        const messaggi = warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(messaggi).toContain('mapping');
        warn.mockRestore();
    });
});
