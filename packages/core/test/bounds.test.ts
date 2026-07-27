import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { worldBounds, contentBounds } from '../src/bounds';

const proj = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

describe('worldBounds', () => {
    it('usa la formula isometrica, non quella ortogonale', () => {
        // Phaser calcolerebbe W*tw = 960 per H*th = 240. La verita' e'
        // (W+H)*tw/2 = 720 per (W+H)*th/2 = 360.
        const b = worldBounds(proj, 10, 5);
        expect(b.width).toBe((10 + 5) * 96 / 2);
        expect(b.height).toBe((10 + 5) * 48 / 2);
    });

    it('la x parte negativa', () => {
        // La cella (0, H-1) e' il vertice piu' a sinistra e sta a x negativa.
        expect(worldBounds(proj, 10, 5).x).toBeLessThan(0);
    });

    it('contiene OGNI cella della griglia', () => {
        const W = 6;
        const H = 8;
        const b = worldBounds(proj, W, H);
        for (let gx = 0; gx < W; gx++) {
            for (let gy = 0; gy < H; gy++) {
                for (const p of proj.cornersOf(gx, gy, 0)) {
                    expect(p.x >= b.x && p.x <= b.x + b.width, `cella ${gx},${gy}`).toBe(true);
                    expect(p.y >= b.y && p.y <= b.y + b.height, `cella ${gx},${gy}`).toBe(true);
                }
            }
        }
    });

    it('maxElevation estende i bounds verso l\'alto', () => {
        const piatto = worldBounds(proj, 6, 6);
        const alto = worldBounds(proj, 6, 6, { maxElevation: 4 });
        expect(alto.y).toBe(piatto.y - 4 * proj.elevationStep);
        expect(alto.height).toBe(piatto.height + 4 * proj.elevationStep);
    });

    it('tiene conto dell\'origine della proiezione', () => {
        const traslata = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 1000, y: 500 } }
        );
        const base = worldBounds(proj, 6, 6);
        const spostata = worldBounds(traslata, 6, 6);
        expect(spostata.x).toBe(base.x + 1000);
        expect(spostata.y).toBe(base.y + 500);
        expect(spostata.width).toBe(base.width);
    });

    it('una griglia vuota ha bounds a dimensione zero', () => {
        const b = worldBounds(proj, 0, 0);
        expect(b.width).toBe(0);
        expect(b.height).toBe(0);
    });
});

describe('contentBounds', () => {
    it('restituisce null su un insieme vuoto', () => {
        expect(contentBounds(proj, [])).toBeNull();
    });

    it('racchiude i rombi delle celle date', () => {
        const cells = [
            { gx: 2, gy: 2, z: 0 },
            { gx: 5, gy: 3, z: 1 }
        ];
        const b = contentBounds(proj, cells);
        expect(b).not.toBeNull();
        for (const c of cells) {
            for (const p of proj.cornersOf(c.gx, c.gy, c.z)) {
                expect(p.x >= b!.x && p.x <= b!.x + b!.width).toBe(true);
                expect(p.y >= b!.y && p.y <= b!.y + b!.height).toBe(true);
            }
        }
    });

    it('e\' piu\' stretto di worldBounds quando il contenuto e\' sparso', () => {
        const b = contentBounds(proj, [{ gx: 3, gy: 3, z: 0 }]);
        expect(b!.width).toBeLessThan(worldBounds(proj, 20, 20).width);
    });

    it('tiene conto della quota', () => {
        const basso = contentBounds(proj, [{ gx: 1, gy: 1, z: 0 }]);
        const alto = contentBounds(proj, [{ gx: 1, gy: 1, z: 3 }]);
        expect(alto!.y).toBeLessThan(basso!.y);
    });
});
