import Phaser from 'phaser';
import { createDepthAssigner, createProjection, cullBounds, DEFAULT_BANDS, IsoConfigError, isRhombus, pick, tileSizeOf, worldBounds } from '@iso-internal/core';
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
import { applyCellHitArea, applyDiamondHitArea } from './hit-area';
import type { DiamondHitAreaOptions, HitAreaTarget } from './hit-area';
import { snapshotOf } from './snapshot';
import type { IsoSnapshot } from './snapshot';

/**
 * Guards a numeric input that no other validation sees. `projectInto`
 * validates nothing (by design — it is a hot path), so this is the only place
 * that stands between a caller's `NaN`/`Infinity` and a target that is
 * silently poisoned: Phaser never throws on a `NaN` position either, so
 * without this check the sprite would just vanish, or the camera would just
 * stop moving, with no error and no log.
 *
 * `api` is named in the message because the same guard now serves two entry
 * points, and "which call did this come from" is the first thing the reader
 * needs.
 *
 * `IsoConfigError`, not `IsoUsageError`: this is a bad VALUE, not a call made
 * in an order that cannot work — the same distinction the core already
 * draws for every constructor argument it validates.
 */
function requireFiniteInput(value: number, name: string, api: string): void {
    if (!Number.isFinite(value)) {
        throw new IsoConfigError(
            `${api}'s \`${name}\` is not a finite number (got ${String(value)})`,
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

// La firma della configurazione cotta dentro una sottoclasse da withDefaults.
// Serve a distinguere "la stessa configurazione installata due volte" da "un
// secondo Game che ne chiede una DIVERSA": withDefaults fabbrica una classe
// nuova a ogni chiamata, quindi il confronto per identita' direbbe "diversa"
// anche per due installazioni identiche. `Symbol.for` e non un Symbol privato:
// se due copie di questo modulo finiscono nello stesso bundle, la firma resta
// leggibile attraverso il confine.
const FIRMA_DEFAULTS = Symbol.for('phaser-isometric.defaults');

// JSON e non identita', per la ragione sopra. Una `strategy` di depth (una
// funzione) cade fuori dal JSON: al peggio due configurazioni che differiscono
// SOLO per quella non vengono distinte e l'avviso non parte — mai il contrario,
// cioe' mai un falso allarme.
function firmaDi(spec: ProjectionSpec, opts: IsoConfigureOptions): string {
    return JSON.stringify([spec, opts]);
}

function firmaDelPlugin(plugin: unknown): string {
    const firma = (plugin as Record<symbol, unknown> | null | undefined)?.[FIRMA_DEFAULTS];
    return typeof firma === 'string' ? firma : '';
}

/**
 * Warns when a second `Phaser.Game` would silently inherit the plugin the
 * FIRST one installed.
 *
 * `PluginManager.installScenePlugin` registers into `PluginCache` only
 * `if (!PluginCache.hasCore(key))`, and Phaser's own duplicate warning fires
 * only within a single `PluginManager`, so a second Game never trips it.
 * `addToScene` then instantiates from `PluginCache.getCore(key)` — the new
 * Game's own config entry is never consulted. A second Game asking for a
 * different projection, or a different `mapping`, therefore gets the first
 * one's: the whole world projects with the wrong tile size, and nothing is
 * logged. `PluginCache` is a module-level singleton, emptied only by
 * `game.destroy(removeCanvas, true)`.
 *
 * Reachable outside tests: Vite HMR, a game recreated on level change, two
 * canvases on one page.
 *
 * A warning, never a throw — a second Game is legitimate, and this must not
 * break it.
 */
function avvisaSeLaCacheHaAltro(mapping: string, plugin: unknown): void {
    // `getCore` e non `hasCore`: e' la STESSA lettura che PluginManager fa per
    // istanziare (`corePlugins[key]`, undefined a chiave assente), quindi un
    // controllo solo, e su cio' che conta davvero. Un `hasCore` in piu' sarebbe
    // un ramo che nessun test puo' distinguere da questo.
    const entry = Phaser.Plugins.PluginCache.getCore(ISO_PLUGIN_KEY) as
        { mapping?: unknown; plugin?: unknown } | null | undefined;
    if (!entry) return;

    if (entry.mapping === mapping && firmaDelPlugin(entry.plugin) === firmaDelPlugin(plugin)) return;

    console.warn(
        `[phaser-isometric] '${ISO_PLUGIN_KEY}' is already registered in Phaser's PluginCache with a ` +
        `different configuration (its mapping is ${JSON.stringify(entry.mapping)}), and PluginCache is a ` +
        'module-level singleton that survives game.destroy(). This entry will be IGNORED: a second Game ' +
        'reuses the first one\'s plugin class and mapping, so the world would project with the wrong tile ' +
        'size and nothing would be logged. Fix: destroy the previous game with game.destroy(true, true) ' +
        '(the SECOND argument is the one that empties the cache), or call ' +
        `Phaser.Plugins.PluginCache.remove('${ISO_PLUGIN_KEY}') before installing this one.`
    );
}

/**
 * Warns when this projection's axes run BACKWARDS for the default depth key.
 *
 * `keyFor` orders by `gx + gy`, which is a correct painter's order only while
 * advancing along either grid axis moves DOWN the screen — that is, while `b`
 * and `d` are both positive. The `'diamond'` preset sets both to `tileHeight/2`,
 * so the question never arises there, which is exactly why the precondition was
 * never written down anywhere until a review went looking for it.
 *
 * A warning, never a throw: the projection is perfectly valid and everything
 * else in the package handles it. It is the DEFAULT strategy that cannot serve
 * it, and `opts.depth.strategy` is the supported way out — so a caller who
 * brought their own is not warned at all.
 *
 * Here rather than in the core because the core's `createDepthAssigner` never
 * sees a projection: `configure()` is the single place both halves exist at
 * once. `buildDiagnosis` makes the same check for whoever runs the CLI instead.
 */
function avvisaSeGliAssiVannoIndietro(proiezione: Projection, opts: IsoConfigureOptions): void {
    // `< 0` e non `<= 0`: con b = 0 l'asse non muove in y, quindi due celle che
    // differiscono solo su quell'asse non possono occludersi e il loro ordine e'
    // indifferente. Avvisare li' sarebbe un falso allarme.
    if (proiezione.b >= 0 && proiezione.d >= 0) return;
    if (opts.depth?.strategy) return;

    console.warn(
        `[phaser-isometric] this projection has b=${proiezione.b} d=${proiezione.d}, but the default ` +
        'depth key orders by `gx + gy`, which assumes BOTH are positive. Advancing along the negative ' +
        'axis moves away from the camera, so nearer cells are drawn first and tall objects sort behind ' +
        'what they should cover — silently, since Phaser has no way to report a wrong sort. Fix: pass ' +
        'your own `depth.strategy` ordering by `b*gx + d*gy` (the real nearness for this matrix), or ' +
        'flip the sign of the offending column so both grid axes run forward. ' +
        'Run `npx phaser-isometric diagnose` for the same check outside the game.'
    );
}

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
        // Il sostantivo segue `what`: dire "has no projection" mentre il lettore
        // ha chiesto `depth` gli fa cercare la cosa sbagliata, in un progetto la
        // cui disciplina sugli errori e' che il messaggio nomini la correzione.
        `the isometric plugin has no ${what} yet, so \`this.iso.${what}\` cannot be read`,
        'call this.iso.configure(...) from your Scene\'s create(), or install it already configured with ' +
        'isoScenePlugin({ projection: { type: "diamond", tileWidth: 96, tileHeight: 48 } }) ' +
        '(equivalent to IsoPlugin.withDefaults(...) under the hood)'
    );
}

/**
 * Risolve la quota di un bersaglio di follow()/aggiornaProxy(): `elevation`
 * vince quando presente. `IsoSprite.setCell()` scrive `gx`/`gy`/`elevation`/
 * `band`/`sub`, mai `z` — ma ogni GameObject eredita comunque uno `z` da
 * `Phaser.GameObjects.Components.Transform`, inizializzato a 0 e che nulla in
 * questo pacchetto tocca. Leggere `target.z ?? 0` soddisfa quindi il tipo
 * strutturale anche per un IsoSprite, e insegue per sempre a quota zero senza
 * errore. Un'unica funzione, usata da entrambi i call-site, e' cio' che
 * impedisce che i due punti di lettura divergano.
 */
function quotaDi(target: { z?: number; elevation?: number }): number {
    return target.elevation ?? target.z ?? 0;
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
    private inseguito: { gx: number; gy: number; z?: number; elevation?: number } | null = null;

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
        const sottoclasse = class IsoPluginWithDefaults extends IsoPlugin {
            constructor(
                scene: Phaser.Scene,
                pluginManager: Phaser.Plugins.PluginManager,
                pluginKey: string
            ) {
                super(scene, pluginManager, pluginKey);
                this.configure(spec, opts);
            }
        };

        // Marchia la classe con cio' che le e' stato cotto dentro, cosi' che una
        // seconda installazione possa dire se e' la STESSA configurazione o una
        // diversa (vedi avvisaSeLaCacheHaAltro).
        (sottoclasse as unknown as Record<symbol, unknown>)[FIRMA_DEFAULTS] = firmaDi(spec, opts);

        return sottoclasse;
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
        avvisaSeGliAssiVannoIndietro(proiezione, opts);
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

    /**
     * The Scene this plugin belongs to.
     *
     * `ScenePlugin.scene` is `protected` and nullable, so anything outside the
     * class — the debug overlay, a host game's own tooling — cannot reach it
     * without a cast. Exposing it once, guarded, beats a cast at every call
     * site, each of which would be a place to get the null check wrong.
     */
    get graphicsScene(): Phaser.Scene {
        if (!this.scene) {
            throw new IsoUsageError(
                'this plugin is not attached to a Scene',
                'use the plugin from inside a Scene that is running, not after its shutdown'
            );
        }
        return this.scene;
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
     * All-or-nothing: every input is validated — `gx`/`gy`/`band`/`sub` by the
     * depth assigner, which throws on a non-integer cell or an out-of-range
     * band, and `z` by a finiteness check of its own — before anything is
     * written to `target`. A rejected call leaves `target.x`, `target.y`, and
     * its depth exactly as they were.
     *
     * `z` needs that separate check because it is the one input the depth key
     * does not depend on: without it a `NaN` elevation writes a `NaN` `y`
     * alongside a perfectly valid depth, the sprite vanishes, and nothing is
     * thrown or logged. On an `IsoSprite` the damage is permanent, since
     * `setCell` remembers the elevation it was last given.
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

        // Dopo keyFor, non prima: se il plugin non e' configurato, quello e'
        // l'errore da riportare per primo. `z` e' l'unico input che keyFor non
        // vede — la depth non dipende dall'elevazione — quindi senza questo
        // controllo un NaN scivolerebbe dritto in target.y accanto a una depth
        // valida. Un Number.isFinite per chiamata, su un placeCost misurato di
        // 0.015-0.052 ms ogni 500 place(): rumore.
        requireFiniteInput(z, 'z', 'place()');

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
     * Accepts both `elevation` and `z`; `elevation` wins when both are present.
     * `IsoSprite` names its own elevation `elevation`, not `z`, to avoid
     * colliding with the `z` that `Phaser.GameObjects.Components.Transform`
     * already owns (and initializes to 0, untouched by this package) — so
     * without this precedence, `follow(isoSprite)` would still compile (the
     * structural type is satisfied by Transform's own `z`) and would silently
     * follow at elevation 0 forever, no matter what `setCell()` actually placed
     * the sprite at.
     *
     * `roundPixels` is read before the call and passed back in. Phaser's
     * `startFollow(target)` sets it to `false` unconditionally and `stopFollow`
     * never restores it, which silently disables pixel rounding for a pixel-art
     * game the first time it follows anything.
     */
    follow(
        target: { gx: number; gy: number; z?: number; elevation?: number },
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
        const quota = quotaDi(target);
        requireFiniteInput(target.gx, 'gx', 'follow()');
        requireFiniteInput(target.gy, 'gy', 'follow()');
        // Il nome riportato e' quello che il chiamante ha davvero passato: se
        // ha scritto `elevation`, dire `z` lo manderebbe a cercare il campo
        // sbagliato.
        requireFiniteInput(quota, target.elevation !== undefined ? 'elevation' : 'z', 'follow()');
        requireFiniteInput(opts.lerp ?? 1, 'lerp', 'follow()');
        const roundPixels = camera.roundPixels;

        this.inseguito = target;
        proiezione.projectInto(this.proxy, target.gx, target.gy, quota);

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
     *
     * Throws on a grid with a non-positive width or height. The core returns
     * `{0,0,0,0}` there — a documented mathematical convention — but
     * `setBounds` would apply it and clamp the camera onto the origin
     * immediately, leaving a camera that will not move and nothing to search
     * for. The reachable path is ordinary: `cameraBounds(map.width,
     * map.height)` called before the tilemap finished loading. This is a setup
     * call, made once per level and not per frame, so it is a place where
     * throwing is the right answer.
     */
    cameraBounds(gridWidth: number, gridHeight: number, opts: { maxElevation?: number } = {}): this {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera to set bounds on',
                'call cameraBounds() from your Scene\'s create()'
            );
        }

        // Prima di worldBounds, ma DOPO nulla che scriva: una dimensione non
        // positiva la' dentro restituisce {0,0,0,0} per convenzione (con i suoi
        // test nel core, che non si toccano), e setBounds la applicherebbe
        // subito inchiodando la camera sull'origine, in silenzio. NaN non entra
        // in questo ramo (`NaN <= 0` e' falso) e cade su worldBounds, che lo
        // rifiuta con il messaggio giusto sulla finitezza: l'ordine e' voluto.
        if (gridWidth <= 0 || gridHeight <= 0) {
            throw new IsoConfigError(
                `cameraBounds() got a ${gridWidth}x${gridHeight} grid, which would pin the camera at the origin`,
                'call cameraBounds() after the map is loaded, with its real dimensions'
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
     * Gives a Game Object a hit area with the shape of one CELL under this
     * Scene's projection — a rhombus when the projection is one, a skewed
     * parallelogram otherwise.
     *
     * This is the general one, and the one to reach for. Under the `'diamond'`
     * preset it produces exactly what `makeDiamondHitArea` does; under any
     * other axonometry it is the only one of the two that is correct.
     */
    makeCellHitArea<T extends HitAreaTarget>(target: T): T {
        return applyCellHitArea(target, this.projection);
    }

    /**
     * Gives a Game Object a RHOMBUS hit area. Defaults to the projection's own
     * tile size.
     *
     * Throws when the size would have to be defaulted from a projection whose
     * cells are not rhombuses, because there is no tile size to default from:
     * `tileSizeOf` reads only `a` and `d` and would silently describe a shape
     * that is not the cell. Passing BOTH `tileWidth` and `tileHeight` says the
     * caller wants a rhombus of their own and is allowed on any projection.
     */
    makeDiamondHitArea<T extends HitAreaTarget>(target: T, opts: DiamondHitAreaOptions = {}): T {
        const proiezione = this.projection;

        // La guardia scatta SOLO quando almeno una delle due misure verrebbe
        // derivata da `tileSizeOf`. Chi le passa entrambe ha dichiarato la
        // forma che vuole — un rombo esplicito su una proiezione sghemba e' una
        // scelta legittima (una hit area piu' generosa della cella, per
        // esempio) — e su quel percorso il valore di `tileSizeOf` non viene mai
        // usato. Cio' che non e' legittimo e' DEDURLO in silenzio da una
        // matrice che non ne ha uno: e' il difetto che questa guardia chiude.
        //
        // `== null` e non `=== undefined`: il default sotto e' `??`, il cui
        // dominio e' {null, undefined}. Con `=== undefined` un `tileWidth: null`
        // scavalcherebbe la guardia e poi verrebbe dedotto lo stesso — il buco
        // e' largo un solo valore, ma e' proprio quello che la guardia deve
        // coprire, e la condizione va scritta sul dominio dell'operatore che
        // decide davvero.
        //
        // `a <= 0 || d <= 0` chiude il rombo SPECCHIATO: `isRhombus` non guarda
        // i segni, quindi (a=-48, b=24, c=48, d=24) la supera, e `tileSizeOf`
        // restituirebbe tileWidth = -96 facendo lanciare `requirePositive` con
        // «pass a positive tileWidth» a chi non ha passato nessun tileWidth.
        // La cella li' e' davvero un rombo: cio' che manca e' una MISURA, ed e'
        // questo l'errore da nominare.
        const misuraDaDedurre = opts.tileWidth == null || opts.tileHeight == null;
        if (misuraDaDedurre && (!isRhombus(proiezione) || proiezione.a <= 0 || proiezione.d <= 0)) {
            throw new IsoConfigError(
                'this projection is not in the diamond preset\'s form ' +
                `(a=${proiezione.a} b=${proiezione.b} c=${proiezione.c} d=${proiezione.d}: a is not -c, ` +
                'or b is not d, or a and d are not both positive), so there is no tile size to default a ' +
                'diamond hit area from',
                'call makeCellHitArea(target) instead — it builds the cell\'s real shape from the same ' +
                'projection; or, if you deliberately want a rhombus of your own, pass BOTH tileWidth and ' +
                'tileHeight to makeDiamondHitArea'
            );
        }

        // `tileSizeOf` lives in the core: it's the inverse of the diamond
        // preset's own a = tw/2, d = th/2, and the shell has no maths of its
        // own — it only calls into the core, same as everywhere else.
        const tile = tileSizeOf(proiezione);
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
        // `quotaDi`, non `t.z ?? 0`: e' la stessa risoluzione di follow(), cosi'
        // la camera non parte alla quota giusta per poi derivare a ogni frame.
        this.projection.projectInto(this.proxy, t.gx, t.gy, quotaDi(t));
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
 * It also `console.warn`s — never throws — when Phaser's `PluginCache`
 * already holds a DIFFERENT isometric configuration under the same key, which
 * is the shape a second `Phaser.Game` silently inherits. See
 * `game.destroy(true, true)` and `Phaser.Plugins.PluginCache.remove()` for the
 * two ways out; the warning names both.
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
    const plugin = projection ? IsoPlugin.withDefaults(projection, resto) : IsoPlugin;

    // Qui e non altrove: questa funzione gira PRIMA che il Game esista, ed e'
    // l'unico punto in cui la configurazione richiesta e quella gia' in cache
    // sono entrambe visibili.
    avvisaSeLaCacheHaAltro(mapping, plugin);

    return { key: ISO_PLUGIN_KEY, plugin, mapping };
}
