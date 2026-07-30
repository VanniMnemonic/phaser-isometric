import { describe, it, expect } from 'vitest';
import { createProjection, tileSizeOf } from '../src/projection';
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
            expect(err.symptom).toContain('invertible');
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

    it('un\'origine non finita nomina la correzione giusta, non "arrotonda"', () => {
        // Number.isInteger(NaN) e' false, quindi senza un controllo di finitezza
        // PRIMA di quello di interezza, un'origine NaN cadrebbe nel ramo "non e'
        // intera" e la correzione suggerita sarebbe "arrotonda l'origine" — non
        // e' una correzione per un NaN.
        try {
            createProjection(
                { type: 'diamond', tileWidth: 96, tileHeight: 48 },
                { origin: { x: Number.NaN, y: 0 } }
            );
            expect.unreachable('doveva lanciare');
        } catch (e) {
            const err = e as IsoConfigError;
            expect(err.symptom).toContain('finite');
            expect(err.fix).toContain('finite');
            expect(err.fix).not.toContain('round the origin');
        }
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

describe('unproject', () => {
    it('inverte esattamente il preset diamond', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const s = p.project(3, 5, 0);
        const g = p.unproject(s.x, s.y, 0);
        expect(g.x).toBeCloseTo(3, 12);
        expect(g.y).toBeCloseTo(5, 12);
    });

    it('inverte tenendo conto della quota', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const s = p.project(2, 7, 4);
        const g = p.unproject(s.x, s.y, 4);
        expect(g.x).toBeCloseTo(2, 12);
        expect(g.y).toBeCloseTo(7, 12);
    });

    it('inverte tenendo conto dell\'origine', () => {
        const p = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 400, y: 300 } }
        );
        const s = p.project(6, 1, 2);
        const g = p.unproject(s.x, s.y, 2);
        expect(g.x).toBeCloseTo(6, 12);
        expect(g.y).toBeCloseTo(1, 12);
    });

    it('round-trip esatto su tutta una griglia, per ogni configurazione', () => {
        const specs: ReadonlyArray<Parameters<typeof createProjection>[0]> = [
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { type: 'diamond', tileWidth: 64, tileHeight: 64 },
            { type: 'diamond', tileWidth: 128, tileHeight: 32, elevationStep: 16 },
            { type: 'matrix', a: 40, b: 20, c: -30, d: 25, elevationStep: 12 }
        ];
        for (const spec of specs) {
            const p = createProjection(spec, { origin: { x: 7, y: -13 } });
            for (let gx = -8; gx <= 8; gx++) {
                for (let gy = -8; gy <= 8; gy++) {
                    for (let z = 0; z <= 3; z++) {
                        const s = p.project(gx, gy, z);
                        const g = p.unproject(s.x, s.y, z);
                        expect(Math.round(g.x)).toBe(gx);
                        expect(Math.round(g.y)).toBe(gy);
                        expect(g.x).toBeCloseTo(gx, 9);
                        expect(g.y).toBeCloseTo(gy, 9);
                    }
                }
            }
        }
    });

    it('arrotondare l\'inverso identifica ESATTAMENTE il rombo della cella', () => {
        // La rivendicazione forte della convenzione del centro. I punti interni
        // al rombo di (0,0) tornano (0,0); un punto appena oltre un vertice, o
        // oltre uno spigolo, no.
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const dentro = [
            { x: 0, y: 0 }, { x: 47, y: 0 }, { x: -47, y: 0 },
            { x: 0, y: 23 }, { x: 0, y: -23 }
        ];
        for (const pt of dentro) {
            const g = p.unproject(pt.x, pt.y, 0);
            // '===' (non 'toEqual') di proposito: alcuni di questi punti producono un
            // -0 legittimo in una coordinata (es. round(-0.4895...) === -0 in JS), che
            // e' matematicamente 0 ma fallirebbe un confronto per uguaglianza profonda
            // come 'toEqual([0, 0])', il quale distingue -0 da +0. '===' tratta -0 e 0
            // come uguali, che e' la semantica corretta qui.
            expect(
                Math.round(g.x) === 0 && Math.round(g.y) === 0,
                `${pt.x},${pt.y} dovrebbe cadere dentro la cella (0,0)`
            ).toBe(true);
        }
        const fuori = [
            { x: 49, y: 0 },     // oltre il vertice destro
            { x: 0, y: 25 },     // oltre il vertice inferiore
            { x: 25, y: 13 }     // oltre lo spigolo in basso a destra
        ];
        for (const pt of fuori) {
            const g = p.unproject(pt.x, pt.y, 0);
            expect(
                Math.round(g.x) === 0 && Math.round(g.y) === 0,
                `${pt.x},${pt.y} dovrebbe cadere fuori dalla cella (0,0)`
            ).toBe(false);
        }
    });

    it('unprojectInto scrive nel target e lo restituisce', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const out = { x: 0, y: 0 };
        const r = p.unprojectInto(out, 48, 24, 0);
        expect(r).toBe(out);
        expect(out.x).toBeCloseTo(1, 12);
        expect(out.y).toBeCloseTo(0, 12);
    });
});

describe('cornersOf', () => {
    const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

    it('restituisce i quattro vertici in ordine orario dall\'alto', () => {
        const [top, right, bottom, left] = p.cornersOf(0, 0, 0);
        expect(top).toEqual({ x: 0, y: -24 });
        expect(right).toEqual({ x: 48, y: 0 });
        expect(bottom).toEqual({ x: 0, y: 24 });
        expect(left).toEqual({ x: -48, y: 0 });
    });

    it('i vertici sono centrati sul punto proiettato', () => {
        const c = p.project(4, 2, 1);
        const corners = p.cornersOf(4, 2, 1);
        const meanX = corners.reduce((s, q) => s + q.x, 0) / 4;
        const meanY = corners.reduce((s, q) => s + q.y, 0) / 4;
        expect(meanX).toBeCloseTo(c.x, 12);
        expect(meanY).toBeCloseTo(c.y, 12);
    });

    it('ogni vertice sta sul bordo del rombo della propria cella', () => {
        // Tirando ogni vertice di un epsilon verso il centro, l'inverso
        // arrotondato deve dare la cella di partenza.
        const c = p.project(3, 6, 2);
        for (const corner of p.cornersOf(3, 6, 2)) {
            const inx = corner.x + (c.x - corner.x) * 0.02;
            const iny = corner.y + (c.y - corner.y) * 0.02;
            const g = p.unproject(inx, iny, 2);
            expect([Math.round(g.x), Math.round(g.y)]).toEqual([3, 6]);
        }
    });

    it('funziona su una matrice arbitraria', () => {
        const m = createProjection({ type: 'matrix', a: 40, b: 20, c: -30, d: 25 });
        const [top, right, bottom, left] = m.cornersOf(0, 0, 0);
        expect(top).toEqual({ x: -(40 - 30) / 2, y: -(20 + 25) / 2 });
        expect(right).toEqual({ x: (40 + 30) / 2, y: (20 - 25) / 2 });
        expect(bottom).toEqual({ x: (40 - 30) / 2, y: (20 + 25) / 2 });
        expect(left).toEqual({ x: -(40 + 30) / 2, y: -(20 - 25) / 2 });
    });
});

describe('tileSizeOf', () => {
    it('inverte il preset diamond: recupera tileWidth/tileHeight dalla matrice', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        expect(tileSizeOf(p)).toEqual({ tileWidth: 96, tileHeight: 48 });
    });

    it('funziona per qualunque coppia tileWidth/tileHeight, non solo il default', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 64, tileHeight: 128 });
        expect(tileSizeOf(p)).toEqual({ tileWidth: 64, tileHeight: 128 });
    });

    it('accetta qualunque oggetto strutturalmente compatibile, non solo un Projection vero', () => {
        // Firma deliberatamente ridotta a { a, d }: chi ha gia' un oggetto con
        // quei due campi non deve costruire un Projection completo solo per
        // chiamare questa funzione.
        expect(tileSizeOf({ a: 10, d: 5 })).toEqual({ tileWidth: 20, tileHeight: 10 });
    });
});
