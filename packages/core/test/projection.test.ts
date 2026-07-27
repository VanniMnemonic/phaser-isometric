import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { IsoConfigError } from '../src/errors';

describe('createProjection', () => {
    it('il preset diamond produce la matrice attesa', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        expect(p.a).toBe(48);
        expect(p.b).toBe(24);
        expect(p.c).toBe(-48);
        expect(p.d).toBe(24);
        expect(p.det).toBe(96 * 48 / 2);
    });

    it('elevationStep vale meta\' di tileHeight se omesso', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        expect(p.elevationStep).toBe(24);
    });

    it('elevationStep esplicito vince sul default', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48, elevationStep: 32 });
        expect(p.elevationStep).toBe(32);
    });

    it('rifiuta una matrice non invertibile nominando la correzione', () => {
        // Le colonne (2,1) e (4,2) sono collineari: det = 2*2 - 1*4 = 0.
        expect(() => createProjection({ type: 'matrix', a: 2, b: 1, c: 4, d: 2 }))
            .toThrow(IsoConfigError);
        try {
            createProjection({ type: 'matrix', a: 2, b: 1, c: 4, d: 2 });
            expect.unreachable('doveva lanciare');
        } catch (e) {
            const err = e as IsoConfigError;
            expect(err.symptom).toContain('invertibile');
            expect(err.fix.length).toBeGreaterThan(0);
        }
    });

    it('rifiuta tileWidth o tileHeight non positivi', () => {
        expect(() => createProjection({ type: 'diamond', tileWidth: 0, tileHeight: 48 }))
            .toThrow(IsoConfigError);
        expect(() => createProjection({ type: 'diamond', tileWidth: 96, tileHeight: -1 }))
            .toThrow(IsoConfigError);
    });

    it('rifiuta un\'origine frazionaria', () => {
        // Un'origine non intera reintrodurrebbe proprio l'arrotondamento che la
        // convenzione del centro elimina.
        expect(() => createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 0.5, y: 0 } }
        )).toThrow(IsoConfigError);
    });

    it('rifiuta valori non finiti', () => {
        expect(() => createProjection({ type: 'diamond', tileWidth: Number.NaN, tileHeight: 48 }))
            .toThrow(IsoConfigError);
        expect(() => createProjection({ type: 'matrix', a: 1, b: 0, c: 0, d: Number.POSITIVE_INFINITY }))
            .toThrow(IsoConfigError);
    });
});

describe('project', () => {
    const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

    it('la cella (0,0) a quota 0 e\' nell\'origine', () => {
        expect(p.project(0, 0, 0)).toEqual({ x: 0, y: 0 });
    });

    it('restituisce il CENTRO della faccia superiore', () => {
        // (1,0) e (0,1) sono simmetriche rispetto all'asse verticale e le loro y
        // coincidono: e' la firma della convenzione del centro.
        expect(p.project(1, 0, 0)).toEqual({ x: 48, y: 24 });
        expect(p.project(0, 1, 0)).toEqual({ x: -48, y: 24 });
    });

    it('la quota alza il punto sullo schermo', () => {
        expect(p.project(0, 0, 1)).toEqual({ x: 0, y: -24 });
        expect(p.project(0, 0, 2)).toEqual({ x: 0, y: -48 });
    });

    it('z vale 0 se omesso', () => {
        expect(p.project(3, 4)).toEqual(p.project(3, 4, 0));
    });

    it('l\'origine trasla il risultato', () => {
        const t = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 400, y: 300 } }
        );
        expect(t.project(0, 0, 0)).toEqual({ x: 400, y: 300 });
        expect(t.project(1, 0, 0)).toEqual({ x: 448, y: 324 });
    });

    it('projectInto scrive nel target e lo restituisce', () => {
        const out = { x: 0, y: 0 };
        const r = p.projectInto(out, 1, 0, 0);
        expect(r).toBe(out);
        expect(out).toEqual({ x: 48, y: 24 });
    });

    it('non aliasa l\'oggetto origine del chiamante', () => {
        // Se le closure catturassero l'oggetto del chiamante invece di una copia,
        // `origin` resterebbe fermo mentre `project()` cambierebbe risultato — due
        // fonti di verita' che divergono in silenzio. E un `o.x = 0.5` successivo
        // aggirerebbe la validazione dell'origine intera senza alcun errore.
        const o = { x: 400, y: 300 };
        const t = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 }, { origin: o });
        o.x = 999999;
        expect(t.origin).toEqual({ x: 400, y: 300 });
        expect(t.project(0, 0, 0)).toEqual({ x: 400, y: 300 });
    });
});
