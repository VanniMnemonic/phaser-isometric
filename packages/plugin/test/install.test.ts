// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';
import { IsoUsageError } from '../src/errors';
import { IsoConfigError } from '@iso-internal/core';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

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
        });

        // `Phaser.Scenes.Systems` does not get the `iso` augmentation — only
        // `Phaser.Scene` does (see phaser-augment.d.ts) — so this one access
        // still goes through the same internal-field cast used elsewhere in
        // this file (e.g. the ISO_PLUGIN_KEY checks below).
        expect((scene.sys as unknown as Record<string, unknown>).iso).toBeInstanceOf(IsoPlugin);
        expect(scene.iso).toBeInstanceOf(IsoPlugin);
        expect(scene.iso).toBe((scene.sys as unknown as Record<string, unknown>).iso);
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
        });

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
        });

        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(0, 0)).toEqual({ x: 0, y: 0 });
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });

    it('configure() dalla create() della Scene fa lo stesso lavoro', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        });

        expect(scene.iso.isConfigured).toBe(false);
        expect(scene.iso.configure(DIAMOND)).toBe(scene.iso);
        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });

    it('leggere projection prima di configurare lancia, e il messaggio nomina la correzione', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        });

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

    it('il messaggio nomina il sostantivo chiesto, non sempre `projection`', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        });

        // Leggere `depth` su un plugin non configurato non e' "non c'e' la
        // proiezione": e' "non c'e' il depth assigner". In un progetto la cui
        // disciplina sugli errori e' che il messaggio nomini la correzione,
        // mandare il lettore a cercare la proiezione e' mandarlo altrove.
        try {
            scene.iso.depth;
            expect.unreachable('avrebbe dovuto lanciare');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain('depth');
            expect(msg).not.toContain('no projection');
        }

        try {
            scene.iso.projection;
            expect.unreachable('avrebbe dovuto lanciare');
        } catch (e) {
            expect((e as Error).message).toContain('no projection');
        }
    });

    it('bands espone le sette bande del core', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        expect(scene.iso.bands.floor).toBe(0);
        expect(scene.iso.bands.overlay).toBe(6);
    });
});

describe('configure() e atomica', () => {
    it('un depth non valido lancia e lascia il plugin non configurato', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        });

        expect(() => scene.iso.configure(DIAMOND, { depth: { layout: { rowStride: -1 } } }))
            .toThrow(IsoConfigError);
        expect(scene.iso.isConfigured).toBe(false);
        expect(() => scene.iso.projection).toThrow(IsoUsageError);
        expect(() => scene.iso.depth).toThrow(IsoUsageError);
    });

    it('una riconfigurazione fallita non tocca la coppia proiezione/depth precedente', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        const projectionPrima = scene.iso.projection;
        const depthPrima = scene.iso.depth;

        expect(() => scene.iso.configure(
            { type: 'diamond', tileWidth: 64, tileHeight: 32 },
            { depth: { layout: { rowStride: -1 } } }
        )).toThrow(IsoConfigError);

        // Ne' la proiezione ne' il depth assigner cambiano: se createProjection
        // fosse assegnata prima che createDepthAssigner sia stata validata, qui
        // troveremmo la proiezione a 64/32 abbinata al VECCHIO depth assigner.
        expect(scene.iso.projection).toBe(projectionPrima);
        expect(scene.iso.depth).toBe(depthPrima);
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
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

describe('un secondo Game eredita in silenzio il plugin del primo', () => {
    // installScenePlugin registra nella PluginCache solo `if
    // (!PluginCache.hasCore(key))`, e l'avviso di duplicato di Phaser scatta
    // solo DENTRO lo stesso PluginManager: un secondo Game non lo fa mai
    // scattare. addToScene istanzia poi da PluginCache.getCore(key), e la voce
    // di config del Game corrente non viene mai letta. La cache e' un
    // singleton di modulo, svuotato solo da game.destroy(removeCanvas, true).
    // Casi reali: HMR di Vite, un game ricreato al cambio livello, due canvas
    // sulla stessa pagina.

    it('la stessa configurazione installata due volte non avvisa', async () => {
        await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // La cache tiene ancora la entry del primo Game: destroyGame() usa
        // game.destroy(true), che NON la svuota.
        isoScenePlugin({ projection: DIAMOND });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('una proiezione diversa avvisa, e l avviso nomina entrambe le vie d uscita', async () => {
        await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        isoScenePlugin({ projection: { type: 'diamond', tileWidth: 64, tileHeight: 32 } });

        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0]?.[0]);
        expect(msg).toContain('game.destroy(true, true)');
        expect(msg).toContain(`PluginCache.remove('${ISO_PLUGIN_KEY}')`);
        warn.mockRestore();
    });

    it('un mapping diverso avvisa anche a parita di proiezione', async () => {
        await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        isoScenePlugin({ mapping: 'griglia', projection: DIAMOND });

        expect(warn).toHaveBeenCalledTimes(1);
        // Il mapping GIA' in cache, non quello richiesto: e' quello che il
        // secondo Game si ritrovera' davvero.
        expect(String(warn.mock.calls[0]?.[0])).toContain('"iso"');
        warn.mockRestore();
    });

    it('a cache vuota non avvisa mai', () => {
        // forgetScenePlugin() dell afterEach precedente ha gia' svuotato: e' lo
        // stato del primissimo Game di una pagina, che non deve avvisare.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        isoScenePlugin({ projection: DIAMOND });
        isoScenePlugin({ mapping: 'griglia', projection: DIAMOND });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
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

describe('configure(): l avviso sugli assi che vanno indietro', () => {
    // La chiave di profondita' di default ordina per gx+gy, che e' un ordine di
    // pittore valido solo se avanzare su entrambi gli assi avvicina alla camera
    // — cioe' se b e d sono positivi. Il preset diamond li ha entrambi a th/2,
    // quindi nessun consumatore ci era mai arrivato, e la precondizione non era
    // scritta ne' controllata da nessuna parte. Un avviso e non un throw: la
    // proiezione e' valida, e' la strategia di DEFAULT a non servirla.
    const INDIETRO = { type: 'matrix', a: 48, b: -24, c: -48, d: 48, elevationStep: 24 } as const;

    it('avvisa, e nomina la via d uscita supportata', async () => {
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        scene.iso.configure(INDIETRO);

        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0]?.[0]);
        expect(msg).toContain('depth.strategy');
        expect(msg).toContain('b*gx + d*gy');
        warn.mockRestore();
    });

    it('NON avvisa quando il chiamante ha portato la propria strategy', async () => {
        // Chi ha gia' risolto il problema nel modo supportato non deve vedere
        // niente: li' gx+gy non viene mai calcolato.
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        scene.iso.configure(INDIETRO, { depth: { strategy: (gx, gy) => gx - gy } });

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('NON avvisa sul preset diamond ne su un asse piatto', async () => {
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        scene.iso.configure(DIAMOND);
        // b = 0: l'asse gx non muove in y, quindi due celle che differiscono
        // solo per gx non possono occludersi. Avvisare sarebbe un falso allarme.
        scene.iso.configure({ type: 'matrix', a: 48, b: 0, c: -48, d: 24, elevationStep: 24 });

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('non lancia: la proiezione resta configurata e usabile', async () => {
        // Il punto della scelta warn-invece-di-throw. Se lanciasse, una
        // proiezione legittima diventerebbe inutilizzabile per un difetto che
        // riguarda solo la strategia di default.
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(() => scene.iso.configure(INDIETRO)).not.toThrow();
        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.b).toBe(-24);
        warn.mockRestore();
    });
});
