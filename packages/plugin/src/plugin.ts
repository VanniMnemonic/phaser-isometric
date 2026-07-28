import Phaser from 'phaser';
import { createDepthAssigner, createProjection, DEFAULT_BANDS } from '@iso-internal/core';
import type {
    Band,
    DepthAssigner,
    DepthAssignerOptions,
    Point,
    Projection,
    ProjectionOptions,
    ProjectionSpec
} from '@iso-internal/core';
import { IsoUsageError } from './errors';

/**
 * The key this plugin occupies in Phaser's PluginCache.
 *
 * Not the same thing as the `mapping`, which is the property name on the
 * Scene. The key is global and must not collide with a built-in: 'ScenePlugin'
 * for instance is already taken by `Phaser.Scenes.ScenePlugin`, a completely
 * different class.
 */
export const ISO_PLUGIN_KEY = 'IsoPlugin';

export interface IsoConfigureOptions extends ProjectionOptions {
    /** Options forwarded to the core's depth assigner. */
    depth?: DepthAssignerOptions;
}

export interface IsoScenePluginOptions extends IsoConfigureOptions {
    /** The property this plugin gets on the Scene — `this.iso`. Defaults to `'iso'`. */
    mapping?: string;
    /** The projection every Scene starts with. Omit it to configure per Scene. */
    projection?: ProjectionSpec;
}

function notConfigured(what: string): IsoUsageError {
    return new IsoUsageError(
        `the isometric plugin has no projection yet, so \`${what}\` cannot be read`,
        'call this.iso.configure(...) from your Scene\'s create(), or install it already configured with ' +
        'isoScenePlugin({ projection: { type: "diamond", tileWidth: 96, tileHeight: 48 } }) ' +
        '(equivalent to IsoPlugin.withDefaults(...) under the hood)'
    );
}

/**
 * What `place()` needs from its target: a position and a depth setter.
 *
 * Deliberately structural rather than `Phaser.GameObjects.GameObject`. Not
 * every Game Object has `x`/`y` (a Group does not), and asking for exactly the
 * three members we touch means `place()` can be exercised with a plain object.
 */
export type Placeable = {
    x: number;
    y: number;
    setDepth(value: number): unknown;
};

export class IsoPlugin extends Phaser.Plugins.ScenePlugin {
    // `useDefineForClassFields: false` (vedi tsconfig.base.json) e' cio' che
    // rende questi campi assegnazioni normali nel costruttore invece di
    // defineProperty. Con `true` un campo che collide con un accessor della
    // classe base lo shadowerebbe. Qui non collide, ma la regola vale per
    // chiunque sottoclassi, ed e' la ragione per cui l'opzione e' fissata.
    private proiezione: Projection | null = null;
    private assegnatore: DepthAssigner | null = null;
    private vivo = false;

    // Riusato a ogni place(): con centinaia di entita' che si muovono ogni
    // frame, allocare un Point per chiamata darebbe al GC un lavoro che non
    // deve fare. `projectInto` esiste nel core esattamente per questo.
    private readonly appoggio: Point = { x: 0, y: 0 };

    constructor(
        scene: Phaser.Scene,
        pluginManager: Phaser.Plugins.PluginManager,
        pluginKey: string
    ) {
        super(scene, pluginManager, pluginKey);

        // La classe base ha gia' registrato `once(BOOT, this.boot, this)`, e
        // NIENT'ALTRO. START va agganciato qui, con `on` e non `once`: una Scene
        // si avvia una volta sola, ma puo' essere fermata e riavviata all'infinito.
        // E' lo schema identico di CameraManager, TweenManager e InputPlugin, che
        // sono i tre plugin di Phaser che fanno questo lavoro sul serio.
        scene.sys.events.on(Phaser.Scenes.Events.START, this.start, this);
    }

    /**
     * Bakes a projection into a subclass, so the plugin arrives already
     * configured.
     *
     * It exists because Phaser NEVER calls `init(data)` on a Scene plugin, and
     * DISCARDS the `data` field of a `plugins.scene` entry — measured on 4.2.1,
     * where the typedef advertises `data` and the code path never reads it.
     * Without this, a game-wide default projection would have no way to travel.
     */
    static withDefaults(spec: ProjectionSpec, opts: IsoConfigureOptions = {}): typeof IsoPlugin {
        return class IsoPluginWithDefaults extends IsoPlugin {
            constructor(
                scene: Phaser.Scene,
                pluginManager: Phaser.Plugins.PluginManager,
                pluginKey: string
            ) {
                super(scene, pluginManager, pluginKey);
                this.configure(spec, opts);
            }
        };
    }

    /**
     * Sets, or replaces, this Scene's projection. Returns `this`, so it reads
     * well from a Scene's `create()`.
     */
    configure(spec: ProjectionSpec, opts: IsoConfigureOptions = {}): this {
        // Costruire entrambi PRIMA di assegnare: se createDepthAssigner lancia
        // dopo che createProjection e' gia' andata a segno, un'assegnazione
        // precoce lascerebbe isConfigured true con una proiezione nuova ma
        // nessun depth assigner corrispondente (o, su una riconfigurazione,
        // un depth assigner VECCHIO abbinato a una proiezione nuova). Nessuna
        // delle due meta' si aggiorna finche' non sono valide entrambe.
        const proiezione = createProjection(spec, opts);
        const assegnatore = createDepthAssigner(opts.depth);
        this.proiezione = proiezione;
        this.assegnatore = assegnatore;
        return this;
    }

    /** Whether a projection has been set. Never throws — use it to branch. */
    get isConfigured(): boolean {
        return this.proiezione !== null;
    }

    /** The active projection. Throws if the plugin has not been configured. */
    get projection(): Projection {
        if (!this.proiezione) throw notConfigured('projection');
        return this.proiezione;
    }

    /** The active depth assigner. Throws if the plugin has not been configured. */
    get depth(): DepthAssigner {
        if (!this.assegnatore) throw notConfigured('depth');
        return this.assegnatore;
    }

    /** The seven default depth bands: floor, decal, prop, item, actor, hero, overlay. */
    get bands(): typeof DEFAULT_BANDS {
        return DEFAULT_BANDS;
    }

    /**
     * Projects a cell, moves the target to the CENTRE of that cell's top face,
     * and assigns its isometric depth.
     *
     * One code path for position and depth, so an object created through
     * `this.add.isoSprite(...)` and one placed by hand can never end up using
     * different conventions.
     *
     * Elevation moves the target UP the screen (negative y): a cell at z=2 with
     * the default `elevationStep` sits 48px above the same cell at z=0.
     *
     * All-or-nothing: every input is validated (via the depth assigner, which
     * throws on a non-integer `gx`/`gy` or an out-of-range `band`/`sub`) before
     * anything is written to `target`. A rejected call leaves `target.x`,
     * `target.y`, and its depth exactly as they were.
     */
    place<T extends Placeable>(
        target: T,
        gx: number,
        gy: number,
        z = 0,
        band: Band = DEFAULT_BANDS.prop,
        sub = 0
    ): T {
        // Valida PRIMA di mutare: `keyFor` e' l'unico dei due passi che puo'
        // lanciare (gx/gy non interi, band o sub fuori range — `projectInto`
        // non controlla nulla). Calcolarlo per primo, in una locale, significa
        // che una chiamata rifiutata non lascia il target ne' spostato ne'
        // ridatato: o riesce tutto, o non cambia nulla.
        const chiave = this.depth.keyFor(gx, gy, band, sub);

        // `projection` e `depth` lanciano entrambi se il plugin non e' stato
        // configurato, quindi anche in quel caso l'errore arriva qui, prima
        // che qualunque campo del target venga toccato.
        this.projection.projectInto(this.appoggio, gx, gy, z);

        target.x = this.appoggio.x;
        target.y = this.appoggio.y;

        // API pubblica, non `_depth`. Misurato: N setDepth alzano un solo
        // booleano, quindi Phaser coalesce comunque in un sort per frame.
        // Scrivere il campo privato risparmierebbe N assegnazioni booleane e
        // costerebbe la compatibilita' con ogni futura versione.
        target.setDepth(chiave);

        return target;
    }

    override boot(): void {
        // `pluginKey` is the MAPPING, not the key (measured on 4.2.1). Phaser's
        // .d.ts declares it `string`, but with `mapping` omitted it is `null` at
        // runtime and the plugin silently mounts on `scene["null"]`. This is the
        // only moment the mistake is still catchable, and it costs nothing.
        const mapping: unknown = this.pluginKey;

        if (typeof mapping !== 'string' || mapping.length === 0) {
            console.warn(
                '[phaser-isometric] installed without a `mapping`, so it is reachable only as ' +
                `\`scene[${JSON.stringify(mapping)}]\` and \`this.iso\` will be undefined. ` +
                'Fix: use isoScenePlugin({ mapping: "iso" }) in plugins.scene. ' +
                'Note that `systemKey` and `sceneKey`, which appear in Phaser\'s own documented ' +
                'example, are read only by the Loader and are ignored here.'
            );
        }

        this.vivo = true;

        // LA riga che la classe base non scrive. `ScenePlugin#destroy` promette
        // nel proprio JSDoc di essere chiamato automaticamente alla morte della
        // Scene: misurato falso. Systems.destroy azzera una lista cablata a mano
        // che non contiene il nostro mapping, SceneManager chiama solo
        // sys.destroy(), e PluginManager.destroy itera i plugin GLOBALI. Senza
        // questa riga il plugin trattiene Scene, Systems e listener per sempre.
        this.systems?.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    }

    /** True between `boot()` and `destroy()`. Never throws. */
    get isLive(): boolean {
        return this.vivo;
    }

    /**
     * Called on every (re)start of the Scene. Per-run wiring goes here, and
     * `shutdown()` must remove exactly what this adds.
     */
    start(): void {
        const events = this.systems?.events;
        if (!events) return;

        // `once`, non `on`: shutdown() lo stacca comunque, ma se una Scene viene
        // riavviata senza passare da SHUTDOWN — cosa che Phaser non fa, ma che un
        // test o un plugin di terze parti puo' fare — `once` impedisce comunque
        // che il conteggio cresca.
        events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    /**
     * Called when the Scene stops. Releases per-run state but KEEPS the
     * configuration: a stopped Scene can be restarted, and re-projecting a world
     * that never changed would be work for nothing.
     */
    shutdown(): void {
        const events = this.systems?.events;
        if (!events) return;

        events.off(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    /**
     * Called when the Scene is destroyed — but only because `boot()` subscribed
     * to it. Nothing in Phaser calls this on its own.
     */
    override destroy(): void {
        if (!this.vivo) return;   // idempotente: DESTROY puo' arrivare due volte
        this.vivo = false;

        this.shutdown();

        // Va staccato esplicitamente: e' l'unico listener registrato con `on`,
        // quindi e' l'unico che sopravvivrebbe.
        this.systems?.events.off(Phaser.Scenes.Events.START, this.start, this);

        this.proiezione = null;
        this.assegnatore = null;

        // Azzera scene/systems/game/pluginManager. Va per ultimo: tutto quello
        // che sta sopra ha bisogno di `this.systems`.
        super.destroy();
    }
}

/**
 * Builds the `plugins.scene` entry for you.
 *
 * Prefer this over writing the object by hand. Phaser's own documented example
 * for a scene plugin uses `systemKey` / `sceneKey`, which this code path never
 * reads; copying it yields a plugin mounted on `scene["null"]` with no warning.
 * This function cannot produce that shape.
 *
 * ```ts
 * new Phaser.Game({
 *   plugins: { scene: [ isoScenePlugin({
 *     projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 }
 *   }) ] }
 * });
 * // then, in any Scene: this.iso.projection.project(gx, gy)
 * ```
 */
export function isoScenePlugin(opts: IsoScenePluginOptions = {}): Phaser.Types.Core.PluginObjectItem {
    const { mapping = 'iso', projection, ...resto } = opts;

    return {
        key: ISO_PLUGIN_KEY,
        plugin: projection ? IsoPlugin.withDefaults(projection, resto) : IsoPlugin,
        mapping
    };
}
