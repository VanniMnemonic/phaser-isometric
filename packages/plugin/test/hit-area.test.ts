// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import type { IsoSprite } from '../src/iso-sprite';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

/**
 * `Scene.iso` and `scene.add.isoSprite` are not part of Phaser's own types —
 * that global augmentation is Task 10's deliverable, not this task's. Until
 * it lands, every direct property access in this file goes through this
 * local, test-only widening instead of inventing that declaration here.
 */
type SceneWithIso = Phaser.Scene & {
    iso: import('../src/plugin').IsoPlugin;
    add: Phaser.GameObjects.GameObjectFactory & {
        isoSprite(gx: number, gy: number, texture: string, frame?: string | number): IsoSprite;
    };
};

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso() {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } }) as Promise<SceneWithIso>;
}

describe('makeDiamondHitArea', () => {
    it('installa un vero Phaser.Geom.Polygon, non un oggetto qualunque', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        expect(s.input).toBeTruthy();
        expect(s.input!.hitArea).toBeInstanceOf(Phaser.Geom.Polygon);
    });

    it('la callback e Polygon.Contains, usabile direttamente', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        expect(s.input!.hitAreaCallback).toBe(Phaser.Geom.Polygon.Contains);
    });

    it('il poligono coincide con diamondPoints per quel frame', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        const centro = { x: s.displayOriginX, y: s.displayOriginY };

        // Il centro e' dentro; i quattro punti a mezzo tile in diagonale sono fuori.
        expect(Phaser.Geom.Polygon.Contains(poly, centro.x, centro.y)).toBe(true);
        expect(Phaser.Geom.Polygon.Contains(poly, centro.x + 47, centro.y - 23)).toBe(false);
    });

    it('NON legge i punti come Vector2: sono letterali {x,y}', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        // Il .d.ts dichiara Vector2[]; a runtime sono letterali. Un .clone()
        // compilerebbe e poi lancerebbe.
        expect((poly.points[0] as unknown as { clone?: unknown }).clone).toBeUndefined();
        expect(typeof poly.points[0]!.x).toBe('number');
    });

    it('ri-chiamarla SOSTITUISCE la hit area invece di limitarsi a ri-abilitare', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);
        const primo = s.input!.hitArea as Phaser.Geom.Polygon;
        const primoAlto = primo.points[0]!.y;

        scene.iso.makeDiamondHitArea(s, { tileHeight: 96 });

        // setInteractive NON e' idempotente: una seconda chiamata si limita a
        // ri-abilitare e lascia la vecchia hit area. Questo test prende quel difetto.
        expect((s.input!.hitArea as Phaser.Geom.Polygon).points[0]!.y).not.toBe(primoAlto);
    });

    it('restituisce l oggetto', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        expect(scene.iso.makeDiamondHitArea(s)).toBe(s);
    });
});
