import Phaser from 'phaser';
import { createDepthAssigner, createProjection, cullBounds, DEFAULT_BANDS, IsoConfigError, pick, tileSizeOf, worldBounds } from '@iso-internal/core';
import type {
    Band,
    Cell,
    CullPadding,
    DepthAssigner,
    DepthAssignerOptions,
    GridRect,
    HeightSource,
    PickOptions,
    Point,
    Projection,
    ProjectionOptions,
    ProjectionSpec,
    Rect
} from '@iso-internal/core';
import { IsoUsageError } from './errors';
import { IsoSprite, registerIsoSprite } from './iso-sprite';
import { viewOf } from './camera';
import { applyDiamondHitArea } from './hit-area';
import type { DiamondHitAreaOptions, DiamondTarget } from './hit-area';
import { snapshotOf } from './snapshot';
import type { IsoSnapshot } from './snapshot';

/**
 * Guards a numeric input to `follow()`. `projectInto` validates nothing (by
 * design — it is a hot path), so this is the only place that stands between
 * a caller's `NaN`/`Infinity` and a proxy that is silently poisoned forever:
 * Phaser's own `startFollow`/`Clamp` never throw either, so without this
 * check the camera would just stop moving, with no error and no log.
 *
 * `IsoConfigError`, not `IsoUsageError`: this is a bad VALUE, not a call made
 * in an order that cannot work — the same distinction the core already
 * draws for every constructor argument it validates.
 */
function requireFiniteFollowInput(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new IsoConfigError(
            `follow()'s \`${name}\` is not a finite number (got ${String(value)})`,
            `pass a finite number for ${name}`
        );
    }
}

/**
 * The key this plugin occupies in Phaser's PluginCache.
 *
 * Not the same thing as the `mapping`, which is the property name on the
 * Scene. The key is global and must not collide with a built-in: 'ScenePlugin'
 * for instance is already taken by `Phaser.Scenes.ScenePlugin`, a completely
 * different class.
 */
export const ISO_PLUGIN_KEY = 'IsoPlugin';

/**
 * Where the plugin also mounts itself on the Scene's Systems, independently of
 * the user's chosen `mapping`.
 *
 * The GameObject factory is registered on `GameObjectFactory.prototype`, which
 * is GLOBAL — one registration for the whole page, not one per Scene. So at
 * call time the factory function has to find the plugin belonging to the Scene
 * it was invoked on, and it cannot know what `mapping` that user picked. This
 * is that anchor. It is intentionally ugly-looking so nobody mistakes it for
 * public API.
 */
export const ISO_SYS_KEY = '__phaserIsometric';

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

    // Il mapping validato in boot(): resta null sia prima del boot sia nel
    // caso scene["null"] (nessun `mapping` fornito all'installazione). E'
    // esattamente cio' che snapshot() deve riportare, senza dover ripetere
    // la stessa validazione che boot() fa gia' per il proprio warning.
    private mappingValido: string | null = null;

    // Riusato a ogni place(): con centinaia di entita' che si muovono ogni
    // frame, allocare un Point per chiamata darebbe al GC un lavoro che non
    // deve fare. `projectInto` esiste nel core esattamente per questo.
    private readonly appoggio: Point = { x: 0, y: 0 };

    // Il bersaglio che la camera insegue, in coordinate di GRIGLIA. `null`
    // quando nessuno e' inseguito: e' anche la guardia che ferma
    // `aggiornaProxy` senza bisogno di staccare/riattaccare il listener a ogni
    // follow()/stopFollow().
    private inseguito: { gx: number; gy: number; z?: number } | null = null;

    // Mutato SUL POSTO a ogni PRE_UPDATE: e' l'oggetto che `Camera.startFollow`
    // trattiene come `_follow`. Riassegnarlo (invece di scrivere .x/.y) romperebbe
    // quel riferimento e la camera resterebbe ferma per sempre, senza errori.
    private readonly proxy: Point = { x: 0, y: 0 };

    // La sorgente di quote usata da pick(). `null` finche' nessuno la imposta:
    // e' quello che rende pick() sicuro da chiamare prima di setHeights(),
    // restituendo null invece di lanciare.
    private sorgenteQuote: HeightSource | null = null;

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

        registerIsoSprite(pluginManager);
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

    /**
     * Follows a target given in GRID coordinates.
     *
     * The camera is handed a private screen-space point that this plugin keeps
     * up to date, because `startFollow` reads nothing but `.x` and `.y` from its
     * target. All of Phaser's smoothing — lerp, deadzone, bounds clamping —
     * then works unmodified, in screen space, which is the space the player
     * actually sees.
     *
     * `roundPixels` is read before the call and passed back in. Phaser's
     * `startFollow(target)` sets it to `false` unconditionally and `stopFollow`
     * never restores it, which silently disables pixel rounding for a pixel-art
     * game the first time it follows anything.
     */
    follow(
        target: { gx: number; gy: number; z?: number },
        opts: { lerp?: number; offsetX?: number; offsetY?: number } = {}
    ): this {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera to follow with',
                'call follow() from your Scene\'s create(), not from its constructor'
            );
        }

        // Leggere la proiezione (lancia se non configurato), validare gli
        // input numerici, e leggere roundPixels: tutto PRIMA di mutare
        // qualunque stato. Una follow() rifiutata non deve lasciare
        // `inseguito` assegnato ne' il proxy proiettato a meta'.
        const proiezione = this.projection;
        requireFiniteFollowInput(target.gx, 'gx');
        requireFiniteFollowInput(target.gy, 'gy');
        requireFiniteFollowInput(target.z ?? 0, 'z');
        requireFiniteFollowInput(opts.lerp ?? 1, 'lerp');
        const roundPixels = camera.roundPixels;

        this.inseguito = target;
        proiezione.projectInto(this.proxy, target.gx, target.gy, target.z ?? 0);

        // Leggi PRIMA, passa DOPO: e' l'unico modo di non perdere la scelta
        // dell'utente. Nota che lerp e offset sono specchiati sui due assi da
        // Phaser stesso (lerpY = lerpX): e' una semantica che ereditiamo.
        camera.startFollow(
            this.proxy,
            roundPixels,
            opts.lerp ?? 1,
            opts.lerp ?? 1,
            opts.offsetX ?? 0,
            opts.offsetY ?? 0
        );

        return this;
    }

    /** Stops following. Leaves `roundPixels` exactly as it is. */
    stopFollow(): this {
        this.inseguito = null;
        this.systems?.cameras?.main?.stopFollow();
        return this;
    }

    /** The main camera's visible rectangle in world space, computed now. */
    view(): Rect {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera, so the view cannot be computed',
                'call this from create() or later, once the Scene has booted'
            );
        }
        return viewOf(camera);
    }

    /**
     * Sets the camera bounds to the screen-space extent of a grid.
     *
     * Uses the isometric formula — (W+H)·tw/2 wide, with x starting NEGATIVE
     * because cell (0, H-1) is the leftmost vertex. Phaser's own
     * `map.widthInPixels` is orthogonal, which is why
     * `camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)` is wrong
     * on an isometric map.
     */
    cameraBounds(gridWidth: number, gridHeight: number, opts: { maxElevation?: number } = {}): this {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera to set bounds on',
                'call cameraBounds() from your Scene\'s create()'
            );
        }

        // worldBounds valida (finitezza di gridWidth/gridHeight/maxElevation) e
        // calcola in un locale prima che camera.setBounds scriva alcunche'.
        const b = worldBounds(this.projection, gridWidth, gridHeight, opts);
        camera.setBounds(b.x, b.y, b.width, b.height);

        return this;
    }

    /**
     * Sets the elevation source used by `pick()`.
     *
     * `HeightSource` is an interface, not a class: bring your own data. The
     * bundled `createHeightGrid` is one implementation, not a requirement.
     */
    setHeights(source: HeightSource | null): this {
        this.sorgenteQuote = source;
        return this;
    }

    /** The elevation source currently set, or `null` if none was. */
    get heights(): HeightSource | null {
        return this.sorgenteQuote;
    }

    /**
     * The cell whose top face is visible at a WORLD point — pass
     * `pointer.worldX` / `pointer.worldY`, not `pointer.x` / `pointer.y`.
     *
     * Exact to the pixel and independent of the render list, unlike Phaser's
     * own input picking. Returns `null` when there is nothing there —
     * including when no `setHeights()` was ever called.
     *
     * This is a hot path, so `worldX`/`worldY`/`opts` get NO per-frame input
     * validation — call it every frame without worrying about the cost of
     * guarding against a stray `NaN`/`Infinity` (the core's `pick` already
     * treats those as "nothing there" instead of looping forever). It STILL
     * throws if the plugin has never been configured: that is not a per-frame
     * condition, it is a setup error that is either true or false for the
     * whole life of the Scene, and returning an empty result for it would
     * surface only as "nothing renders", with no clue why.
     */
    pick(worldX: number, worldY: number, opts: PickOptions = {}): Cell | null {
        if (!this.sorgenteQuote) return null;
        return pick(this.projection, worldX, worldY, this.sorgenteQuote, opts);
    }

    /**
     * The range of cells that can intersect the camera's view. Both ends
     * INCLUSIVE, and deliberately conservative: it can include a cell that is
     * not visible, never exclude one that is.
     *
     * Phaser 4 does NO per-sprite culling — `BaseCamera.cull()` is not called
     * from anywhere in the render path and `disableCull` is inert for Sprites —
     * so this is not an optimisation on top of an existing one. It is the only
     * one there is.
     *
     * A hot path, safe to call every frame: `pad` gets no per-frame
     * validation. It STILL throws if the plugin has never been configured, or
     * if the Scene has no main camera — both are setup errors, constant for
     * the whole life of the Scene, not something a frame can vary. Returning
     * an empty range for either would look like "nothing renders" with no
     * indication why, which is the failure mode this plugin's error messages
     * exist to prevent.
     */
    cull(pad: CullPadding): GridRect {
        return cullBounds(this.projection, this.view(), pad);
    }

    /**
     * Gives a Game Object a diamond hit area matching one cell. Defaults to the
     * projection's own tile size.
     */
    makeDiamondHitArea<T extends DiamondTarget>(target: T, opts: DiamondHitAreaOptions = {}): T {
        // `tileSizeOf` lives in the core: it's the inverse of the diamond
        // preset's own a = tw/2, d = th/2, and the shell has no maths of its
        // own — it only calls into the core, same as everywhere else.
        const tile = tileSizeOf(this.projection);
        return applyDiamondHitArea(
            target,
            opts.tileWidth ?? tile.tileWidth,
            opts.tileHeight ?? tile.tileHeight
        );
    }

    /**
     * A flat, serialisable, read-only picture of this plugin's state — no
     * Phaser objects, no functions, no getters that reach back into the
     * Scene. `JSON.stringify(plugin.snapshot())` always succeeds: this is
     * what a debug overlay draws, what an integration test asserts on, and
     * what a bug report can be asked to paste.
     *
     * Never throws, in ANY state — including after `destroy()`. It exists to
     * diagnose a plugin that may already be broken, so requiring the plugin
     * to be configured, booted, or even live first would make it useless
     * exactly when it is needed the most.
     */
    snapshot(): IsoSnapshot {
        const camera = this.systems?.cameras?.main ?? null;
        const displayList = this.systems?.displayList?.list ?? [];

        return snapshotOf({
            mapping: this.mappingValido,
            booted: this.vivo,
            projection: this.proiezione ? {
                a: this.proiezione.a,
                b: this.proiezione.b,
                c: this.proiezione.c,
                d: this.proiezione.d,
                det: this.proiezione.det,
                elevationStep: this.proiezione.elevationStep,
                origin: { x: this.proiezione.origin.x, y: this.proiezione.origin.y }
            } : null,
            depth: this.assegnatore?.layout ?? null,
            camera: camera ? {
                scrollX: camera.scrollX,
                scrollY: camera.scrollY,
                zoomX: camera.zoomX,
                zoomY: camera.zoomY,
                roundPixels: camera.roundPixels,
                following: this.inseguito !== null,
                view: viewOf(camera)
            } : null,
            heightsSource: this.sorgenteQuote,
            isoSpriteCount: displayList.filter(o => o instanceof IsoSprite).length
        });
    }

    /** Ricalcola il proxy dal bersaglio corrente. No-op se nessuno e' inseguito. */
    private aggiornaProxy(): void {
        if (!this.inseguito) return;
        const t = this.inseguito;
        // SUL POSTO. La camera trattiene il riferimento a questo oggetto.
        this.projection.projectInto(this.proxy, t.gx, t.gy, t.z ?? 0);
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
        } else {
            // Valido SOLO in questo ramo: e' l'unico in cui sappiamo che e'
            // una stringa non vuota. Altrimenti `mappingValido` resta null,
            // il valore che snapshot() deve riportare per il caso scene["null"].
            this.mappingValido = mapping;
        }

        this.vivo = true;

        // Ancoraggio indipendente dal mapping, per la factory globale.
        (this.systems as unknown as Record<string, unknown>)[ISO_SYS_KEY] = this;

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

        // PRE_UPDATE, perche' gira PRIMA di CameraManager.update (che sta su
        // UPDATE) e prima dell'update() della Scene: una sola scrittura, una
        // sola lettura, nessun ritardo di un frame.
        events.on(Phaser.Scenes.Events.PRE_UPDATE, this.aggiornaProxy, this);
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
        events.off(Phaser.Scenes.Events.PRE_UPDATE, this.aggiornaProxy, this);
        this.inseguito = null;
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
        // Senza questo, un pick() in arrivo in coda dopo il destroy (un evento
        // di input gia' schedulato mentre la Scene si smonta e' il caso
        // reale) non prenderebbe piu' l'uscita anticipata su sorgenteQuote
        // nulla: cadrebbe su `this.projection`, che lancia da plugin non
        // configurato. Rilasciare cio' che questa fase ha acquisito e' lo
        // stesso principio di proiezione/assegnatore appena sopra.
        this.sorgenteQuote = null;
        // Stesso principio ancora: acquisito in boot(), rilasciato qui. Senza
        // questo, snapshot() dopo destroy() riporterebbe un mapping ancora
        // valido mentre booted e camera sono gia' null — due momenti diversi
        // nello stesso oggetto, per una superficie che esiste apposta per
        // descriverne uno solo.
        this.mappingValido = null;

        if (this.systems) {
            delete (this.systems as unknown as Record<string, unknown>)[ISO_SYS_KEY];
        }

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
