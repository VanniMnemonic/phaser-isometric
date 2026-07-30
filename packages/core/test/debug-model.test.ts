import { describe, expect, it } from 'vitest';
import { createProjection } from '../src/projection';
import { createDepthAssigner, DEFAULT_BANDS } from '../src/depth';
import { createHeightGrid } from '../src/height-grid';
import { buildDebugModel } from '../src/debug-model';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

describe('buildDebugModel', () => {
    it('produce un rombo chiuso per ogni cella dell area', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 0, maxX: 1, minY: 0, maxY: 1 } });

        // 2x2 celle, ognuna 4 vertici = 8 numeri
        expect(model.diamonds).toHaveLength(4);
        for (const d of model.diamonds) expect(d).toHaveLength(8);
        expect(model.cellsRequested).toBe(4);
        expect(model.cellsDrawn).toBe(4);
    });

    it('mette i vertici del rombo esattamente dove cornersOf dice', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 3, maxX: 3, minY: 5, maxY: 5 } });
        const corners = p.cornersOf(3, 5, 0);
        const atteso = corners.flatMap(c => [c.x, c.y]);

        // Se il modello ricalcolasse i vertici per conto suo invece di
        // chiamare cornersOf, una divergenza di mezzo pixel passerebbe
        // inosservata a schermo e questo confronto la prenderebbe.
        expect(model.diamonds[0]).toEqual(atteso);
    });

    it('salta le celle senza terreno e lo dice nel conteggio', () => {
        const p = createProjection(DIAMOND);
        const heights = createHeightGrid(4, 4, 0);
        heights.setHeight(1, 1, null);
        const model = buildDebugModel(p, { area: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, heights });

        // "nessuna cella da disegnare" e "quattro celle, una senza terreno"
        // devono essere distinguibili: un 3 nudo non lo direbbe.
        expect(model.cellsRequested).toBe(4);
        expect(model.cellsDrawn).toBe(3);
        expect(model.diamonds).toHaveLength(3);
    });

    it('disegna ogni cella alla PROPRIA quota, non a zero', () => {
        const p = createProjection(DIAMOND);
        const heights = createHeightGrid(4, 4, 0);
        heights.setHeight(2, 2, 3);
        const model = buildDebugModel(p, { area: { minX: 2, maxX: 2, minY: 2, maxY: 2 }, heights });

        // A quota 3 il rombo sta 3 * elevationStep piu in ALTO (y minore).
        // Con tileHeight 48 lo step di default e 24, quindi 72px.
        const aTerra = p.cornersOf(2, 2, 0);
        const inQuota = p.cornersOf(2, 2, 3);
        expect(inQuota[0].y).toBeLessThan(aTerra[0].y);
        expect(model.diamonds[0]).toEqual(inQuota.flatMap(c => [c.x, c.y]));
    });

    it('etichetta coordinate, quota e chiave di depth solo quando richiesto', () => {
        const p = createProjection(DIAMOND);
        const depth = createDepthAssigner();
        const heights = createHeightGrid(4, 4, 0);
        heights.setHeight(2, 2, 3);

        const nudo = buildDebugModel(p, { area: { minX: 2, maxX: 2, minY: 2, maxY: 2 }, heights });
        expect(nudo.labels).toEqual([]);

        const pieno = buildDebugModel(p, {
            area: { minX: 2, maxX: 2, minY: 2, maxY: 2 },
            heights,
            depth,
            band: DEFAULT_BANDS.floor,
            show: { coords: true, elevation: true, depthKeys: true }
        });
        const testi = pieno.labels.map(l => l.text);
        expect(testi).toContain('2,2');
        expect(testi).toContain('z3');
        expect(testi).toContain(`#${depth.keyFor(2, 2, DEFAULT_BANDS.floor)}`);
    });

    it('lancia se si chiedono le chiavi di depth senza un DepthAssigner', () => {
        const p = createProjection(DIAMOND);
        expect(() => buildDebugModel(p, {
            area: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            show: { depthKeys: true }
        })).toThrow(/depthKeys/);
    });

    it('restituisce i bounds in pixel di cio che ha davvero disegnato', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 0, maxX: 1, minY: 0, maxY: 1 } });
        const xs = model.diamonds.flatMap(d => d.filter((_, i) => i % 2 === 0));
        const ys = model.diamonds.flatMap(d => d.filter((_, i) => i % 2 === 1));

        expect(model.bounds.x).toBe(Math.min(...xs));
        expect(model.bounds.y).toBe(Math.min(...ys));
        expect(model.bounds.width).toBe(Math.max(...xs) - Math.min(...xs));
        expect(model.bounds.height).toBe(Math.max(...ys) - Math.min(...ys));
    });

    it('su un area vuota restituisce un modello vuoto, non null', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 5, maxX: 4, minY: 0, maxY: 0 } });
        expect(model.cellsRequested).toBe(0);
        expect(model.cellsDrawn).toBe(0);
        expect(model.diamonds).toEqual([]);
        expect(model.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});
