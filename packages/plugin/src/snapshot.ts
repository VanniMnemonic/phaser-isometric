import type { DepthLayout, HeightSource, Rect } from '@iso-internal/core';

/**
 * A flat, serialisable, read-only view of the plugin's state.
 *
 * Everything here is a number, a string, a boolean or null — no Phaser objects,
 * no functions, no live references. `JSON.stringify(snapshot)` must always
 * succeed, because this is what a debug overlay draws, what an integration test
 * asserts on, and what a bug report can be asked to paste.
 */
export interface IsoSnapshot {
    /** Bumped when a field changes meaning. Consumers should check it. */
    readonly version: 1;
    /** The Scene property the plugin is reachable as, or null when misinstalled. */
    readonly mapping: string | null;
    readonly booted: boolean;
    readonly configured: boolean;
    readonly projection: {
        readonly a: number; readonly b: number; readonly c: number; readonly d: number;
        readonly det: number;
        readonly elevationStep: number;
        readonly origin: { readonly x: number; readonly y: number };
    } | null;
    readonly depth: DepthLayout | null;
    readonly camera: {
        readonly scrollX: number; readonly scrollY: number;
        readonly zoomX: number; readonly zoomY: number;
        readonly roundPixels: boolean;
        readonly following: boolean;
        readonly view: Rect;
    } | null;
    readonly heights:
        | { readonly kind: 'none' }
        | { readonly kind: 'grid'; readonly width: number; readonly height: number; readonly maxElevation: number }
        | { readonly kind: 'custom'; readonly maxElevation: number | null };
    /** How many IsoSprites are currently in the Scene's display list. */
    readonly isoSprites: number;
}

/**
 * The data `snapshotOf` needs, ALREADY extracted from a live plugin/Scene.
 *
 * Structural, the same split `CameraScalars`/`viewOf` already draws in
 * `camera.ts`: naming exactly the fields the computation touches keeps
 * `snapshotOf` pure and exercisable with a plain object — no Scene, no
 * Phaser Camera, no live `IsoPlugin` required. `IsoPlugin#snapshot` is the
 * only caller that has to reach into Phaser at all.
 */
export interface SnapshotSource {
    readonly mapping: string | null;
    readonly booted: boolean;
    readonly projection: IsoSnapshot['projection'];
    readonly depth: DepthLayout | null;
    readonly camera: IsoSnapshot['camera'];
    /** `null` when no `setHeights()` has ever been called. */
    readonly heightsSource: HeightSource | null;
    readonly isoSpriteCount: number;
}

/**
 * Distinguishes the bundled `HeightGrid` (from `createHeightGrid`) from a
 * hand-written `HeightSource`, structurally: `HeightGrid` is the only shape
 * in the core that carries `width`/`height`/`maxElevation` all as numbers,
 * alongside `heightAt`. Checking for those three, rather than an `instanceof`
 * on a concrete class, keeps `snapshotOf` from having to import a specific
 * implementation just to classify what was handed to it — matching the
 * core's own stance that `HeightSource` is an interface, bring your own
 * data. Requiring all three (not just `width`/`height`) matters: a
 * hand-written source that happens to expose `width`/`height` for its own
 * reasons, but not `maxElevation`, must fall through to 'custom' rather than
 * produce a 'grid' snapshot with `maxElevation: undefined` — a value JSON
 * would silently drop, breaking the round-trip contract.
 */
function isHeightGrid(source: HeightSource): source is HeightSource & { width: number; height: number; maxElevation: number } {
    const candidate = source as { width?: unknown; height?: unknown; maxElevation?: unknown };
    return typeof candidate.width === 'number' && typeof candidate.height === 'number' && typeof candidate.maxElevation === 'number';
}

function heightsOf(source: HeightSource | null): IsoSnapshot['heights'] {
    if (!source) return { kind: 'none' };

    if (isHeightGrid(source)) {
        return { kind: 'grid', width: source.width, height: source.height, maxElevation: source.maxElevation };
    }

    // `maxElevation` is OPTIONAL on `HeightSource`: `?? null` turns "the field
    // was never declared" into the same `null` the type promises, instead of
    // an `undefined` that `JSON.stringify` would silently drop from the
    // round-trip.
    return { kind: 'custom', maxElevation: source.maxElevation ?? null };
}

/**
 * Assembles an `IsoSnapshot` from already-extracted data.
 *
 * Pure: unlike `IsoPlugin#snapshot`, it never reaches into a Scene or a
 * Phaser object itself, so it can be exercised directly with a plain
 * `SnapshotSource` — no Game, no Scene, no boot sequence.
 */
export function snapshotOf(source: SnapshotSource): IsoSnapshot {
    return {
        version: 1,
        mapping: source.mapping,
        booted: source.booted,
        // Derived, not duplicated: `configure()` sets projection and depth
        // together, atomically, so one can never be null while the other
        // isn't — reading `configured` off `projection` alone cannot drift
        // from a `configured` field passed in separately.
        configured: source.projection !== null,
        projection: source.projection,
        depth: source.depth,
        camera: source.camera,
        heights: heightsOf(source.heightsSource),
        isoSprites: source.isoSpriteCount
    };
}
