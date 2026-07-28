import Phaser from 'phaser';
import { createDepthAssigner, createProjection, DEFAULT_BANDS } from '@iso-internal/core';
import type {
    DepthAssigner,
    DepthAssignerOptions,
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

export class IsoPlugin extends Phaser.Plugins.ScenePlugin {
    // `useDefineForClassFields: false` (vedi tsconfig.base.json) e' cio' che
    // rende questi campi assegnazioni normali nel costruttore invece di
    // defineProperty. Con `true` un campo che collide con un accessor della
    // classe base lo shadowerebbe. Qui non collide, ma la regola vale per
    // chiunque sottoclassi, ed e' la ragione per cui l'opzione e' fissata.
    private proiezione: Projection | null = null;
    private assegnatore: DepthAssigner | null = null;

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
