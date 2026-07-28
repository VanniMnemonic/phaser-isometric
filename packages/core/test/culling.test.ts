import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { cullBounds } from '../src/culling';
import type { Rect } from '../src/types';

const proj = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
const NO_PAD = { above: 0, below: 0, sides: 0 };

/**
 * Piu' viste, non una. Una vista "generica" NON esercita il bordo: floor/ceil da
 * soli arrotondano gia' abbastanza, e il margine di mezza cella sembrerebbe
 * inutile. Sono le viste ALLINEATE alla griglia a romperlo — misurato: senza
 * margine ne mancano 4 celle ciascuna, con margine zero.
 */
const VISTE: ReadonlyArray<Rect> = [
    { x: -200, y: -100, width: 400, height: 300 },   // generica
    { x: 0, y: 0, width: 96, height: 48 },           // esattamente il bbox di un tile
    { x: -48, y: -24, width: 192, height: 96 }       // allineata, due tile
];

function tocca(view: Rect, corners: ReadonlyArray<{ x: number; y: number }>): boolean {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return maxX >= view.x && minX <= view.x + view.width
        && maxY >= view.y && minY <= view.y + view.height;
}

describe('cullBounds', () => {
    it('una vista che contiene una sola cella restituisce quella cella', () => {
        const c = proj.project(4, 4, 0);
        const b = cullBounds(proj, { x: c.x - 1, y: c.y - 1, width: 2, height: 2 }, NO_PAD);
        expect(b.minX).toBeLessThanOrEqual(4);
        expect(b.maxX).toBeGreaterThanOrEqual(4);
        expect(b.minY).toBeLessThanOrEqual(4);
        expect(b.maxY).toBeGreaterThanOrEqual(4);
    });

    it('e\' conservativo: contiene OGNI cella il cui rombo tocca la vista', () => {
        // Il test che conta. Si confronta il risultato O(1) contro una scansione
        // a forza bruta di tutte le celle: nessuna cella visibile puo' restare
        // fuori. Un culling che sbaglia per difetto fa sparire pezzi di mondo,
        // ed e' il difetto piu' difficile da vedere.
        for (const view of VISTE) {
            const b = cullBounds(proj, view, NO_PAD);
            for (let gx = -40; gx <= 40; gx++) {
                for (let gy = -40; gy <= 40; gy++) {
                    if (!tocca(view, proj.cornersOf(gx, gy, 0))) continue;
                    const etichetta = `vista ${JSON.stringify(view)} cella ${gx},${gy}`;
                    expect(gx >= b.minX && gx <= b.maxX, `${etichetta} fuori da minX/maxX`).toBe(true);
                    expect(gy >= b.minY && gy <= b.maxY, `${etichetta} fuori da minY/maxY`).toBe(true);
                }
            }
        }
    });

    it('e\' conservativo anche con elevazione, tramite il padding above', () => {
        const maxElevation = 6;
        const pad = { above: maxElevation * proj.elevationStep, below: 0, sides: 0 };
        for (const view of VISTE) {
            const b = cullBounds(proj, view, pad);
            for (let gx = -40; gx <= 40; gx++) {
                for (let gy = -40; gy <= 40; gy++) {
                    for (let z = 0; z <= maxElevation; z++) {
                        if (!tocca(view, proj.cornersOf(gx, gy, z))) continue;
                        const etichetta = `vista ${JSON.stringify(view)} cella ${gx},${gy} a z=${z}`;
                        expect(gx >= b.minX && gx <= b.maxX, etichetta).toBe(true);
                        expect(gy >= b.minY && gy <= b.maxY, etichetta).toBe(true);
                    }
                }
            }
        }
    });

    it('non degenera: una vista piccola non restituisce l\'intera mappa', () => {
        // Un culling conservativo che restituisce sempre tutto passerebbe i due
        // test qui sopra senza cullare niente.
        const c = proj.project(0, 0, 0);
        const b = cullBounds(proj, { x: c.x - 50, y: c.y - 25, width: 100, height: 50 }, NO_PAD);
        const celle = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
        expect(celle).toBeLessThan(40);
    });

    it('il padding allarga i bounds', () => {
        const view = { x: 0, y: 0, width: 200, height: 200 };
        const stretto = cullBounds(proj, view, NO_PAD);
        const largo = cullBounds(proj, view, { above: 200, below: 50, sides: 100 });
        expect(largo.maxX - largo.minX).toBeGreaterThan(stretto.maxX - stretto.minX);
        expect(largo.maxY - largo.minY).toBeGreaterThan(stretto.maxY - stretto.minY);
    });

    it('tiene conto dell\'origine della proiezione', () => {
        const traslata = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 1000, y: 1000 } }
        );
        const c = traslata.project(5, 5, 0);
        const b = cullBounds(traslata, { x: c.x - 10, y: c.y - 10, width: 20, height: 20 }, NO_PAD);
        expect(b.minX).toBeLessThanOrEqual(5);
        expect(b.maxX).toBeGreaterThanOrEqual(5);
    });
});
