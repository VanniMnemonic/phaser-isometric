import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { createHeightGrid } from '../src/height-grid';
import { pick } from '../src/picking';
import type { HeightSource } from '../src/types';

const proj = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

describe('pick su griglia piatta', () => {
    const flat = createHeightGrid(8, 8, 0);

    it('il centro di una cella restituisce quella cella', () => {
        const s = proj.project(3, 5, 0);
        expect(pick(proj, s.x, s.y, flat)).toEqual({ gx: 3, gy: 5, z: 0 });
    });

    it('ogni cella della griglia si ripesca da sola', () => {
        for (let gx = 0; gx < 8; gx++) {
            for (let gy = 0; gy < 8; gy++) {
                const s = proj.project(gx, gy, 0);
                expect(pick(proj, s.x, s.y, flat), `cella ${gx},${gy}`).toEqual({ gx, gy, z: 0 });
            }
        }
    });

    it('un punto spostato verso un vertice resta nella propria cella', () => {
        // Il caso che distingue round da floor: al centro esatto i due
        // coincidono, qui no. Con floor si finirebbe nella cella accanto.
        const c = proj.project(3, 5, 0);
        const left = proj.cornersOf(3, 5, 0)[3];
        const px = c.x + (left.x - c.x) * 0.9;
        const py = c.y + (left.y - c.y) * 0.9;
        expect(pick(proj, px, py, flat)).toEqual({ gx: 3, gy: 5, z: 0 });
    });

    it('una griglia piatta con maxElevation generoso pesca comunque la cella giusta', () => {
        // Il confronto deve essere con la quota ESATTA: con un `!== null` si
        // pescherebbe una cella qualsiasi alla quota piu' alta provata.
        const s = proj.project(5, 5, 0);
        expect(pick(proj, s.x, s.y, flat, { maxElevation: 3 })).toEqual({ gx: 5, gy: 5, z: 0 });
    });

    it('fuori dalla griglia restituisce null, non lancia', () => {
        const s = proj.project(50, 50, 0);
        expect(pick(proj, s.x, s.y, flat)).toBeNull();
    });

    it('un punto sull\'abisso restituisce null', () => {
        const holed = createHeightGrid(8, 8, 0);
        holed.setHeight(4, 4, null);
        const s = proj.project(4, 4, 0);
        expect(pick(proj, s.x, s.y, holed)).toBeNull();
    });
});

describe('pick con elevazione', () => {
    it('la cima di una colonna si ripesca alla propria quota', () => {
        const g = createHeightGrid(8, 8, 0);
        g.setHeight(2, 2, 3);
        const s = proj.project(2, 2, 3);
        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 2, gy: 2, z: 3 });
    });

    it('a parita\' di pixel vince la superficie piu\' AVANTI, cioe\' la quota MAGGIORE', () => {
        // Su questo pixel esistono due superfici: la cima della colonna (4,4) a
        // quota 2, riga 8, e il pavimento (3,3) a quota 0, riga 6. La colonna e'
        // piu' avanti, quindi e' disegnata dopo e si vede lei.
        const g = createHeightGrid(12, 12, 0);
        g.setHeight(4, 4, 2);
        const s = proj.project(4, 4, 2);

        const basso = proj.unproject(s.x, s.y, 0);
        const bx = Math.round(basso.x);
        const by = Math.round(basso.y);
        expect(g.heightAt(bx, by), 'il candidato a quota 0 deve esistere davvero').toBe(0);
        expect(bx + by, 'e deve stare piu\' indietro della colonna').toBeLessThan(4 + 4);

        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 4, gy: 4, z: 2 });
    });

    it('tolta la colonna, sullo stesso pixel vince il pavimento dietro', () => {
        const g = createHeightGrid(12, 12, 0);
        g.setHeight(4, 4, 2);
        const s = proj.project(4, 4, 2);
        g.setHeight(4, 4, null);
        // maxElevation resta 2 (monotono), quindi le quote alte vengono comunque provate.
        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 3, gy: 3, z: 0 });
    });

    it('maxElevation limita quante quote vengono provate', () => {
        const g = createHeightGrid(8, 8, null);
        g.setHeight(1, 1, 9);
        const s = proj.project(1, 1, 9);
        expect(pick(proj, s.x, s.y, g, { maxElevation: 4 })).toBeNull();
        expect(pick(proj, s.x, s.y, g, { maxElevation: 9 })).toEqual({ gx: 1, gy: 1, z: 9 });
    });

    it('usa maxElevation della sorgente quando l\'opzione e\' omessa', () => {
        const g = createHeightGrid(8, 8, 0);
        g.setHeight(1, 1, 6);
        const s = proj.project(1, 1, 6);
        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 1, gy: 1, z: 6 });
    });

    it('una sorgente che non dichiara maxElevation sonda solo il pavimento', () => {
        // La capability e' opzionale, e la sua assenza ha una conseguenza
        // DOCUMENTATA invece che una sorpresa: senza il campo e senza
        // opts.maxElevation il limite e' 0, quindi tutto cio' che e' elevato e'
        // impescabile. Passando il limite esplicitamente, si ritrova.
        const g = createHeightGrid(8, 8, 0);
        g.setHeight(1, 1, 4);
        const nuda: HeightSource = { heightAt: (gx, gy) => g.heightAt(gx, gy) };
        const s = proj.project(1, 1, 4);
        expect(pick(proj, s.x, s.y, nuda)).toBeNull();
        expect(pick(proj, s.x, s.y, nuda, { maxElevation: 4 })).toEqual({ gx: 1, gy: 1, z: 4 });
    });
});

describe('pick con limiti non finiti (Finding 1)', () => {
    // Percorso caldo, quindi la guardia non deve MAI lanciare: deve fallire
    // restituendo null. Non si esegue mai il loop non protetto qui: con
    // maxElevation = Infinity, `Infinity - 1 === Infinity`, quindi
    // `for (z = maxElevation; z >= 0; z--)` non termina mai. La prova
    // dell'hang pre-fix e' stata raccolta fuori dalla suite (processo ucciso
    // dopo un timeout di 8s), non qui: un test che appende non finisce mai
    // sarebbe peggio di nessun test.
    const flat = createHeightGrid(4, 4, 0);

    it('un opts.maxElevation non finito restituisce null invece di entrare in loop', () => {
        const s = proj.project(1, 1, 0);
        expect(pick(proj, s.x, s.y, flat, { maxElevation: Number.POSITIVE_INFINITY })).toBeNull();
        expect(pick(proj, s.x, s.y, flat, { maxElevation: Number.NEGATIVE_INFINITY })).toBeNull();
        expect(pick(proj, s.x, s.y, flat, { maxElevation: Number.NaN })).toBeNull();
    });

    it('un opts.minElevation non finito restituisce null invece di entrare in loop', () => {
        // Simmetrico a maxElevation: con minElevation = -Infinity, qualunque z
        // finito soddisfa sempre `z >= minElevation`, quindi il decremento non
        // raggiunge mai il limite.
        const s = proj.project(1, 1, 0);
        expect(pick(proj, s.x, s.y, flat, { minElevation: Number.NEGATIVE_INFINITY })).toBeNull();
        expect(pick(proj, s.x, s.y, flat, { minElevation: Number.NaN })).toBeNull();
    });

    it('una HeightSource di terze parti con maxElevation = Infinity non manda pick in loop', () => {
        // Lo scenario del finding: opts.maxElevation e' assente, quindi si
        // legge heights.maxElevation, che una sorgente scritta male puo'
        // dichiarare Infinity.
        const cattiva: HeightSource = { heightAt: () => 0, maxElevation: Number.POSITIVE_INFINITY };
        expect(pick(proj, 0, 0, cattiva)).toBeNull();
    });
});

describe('pick con minElevation (Finding 2)', () => {
    it('senza minElevation, una griglia riempita sotto zero resta impescabile ovunque', () => {
        // createHeightGrid(w, h, -1) porta maxElevation a -1: il loop
        // `for (z = maxElevation; z >= 0; z--)` con maxElevation = -1 non entra
        // mai nel corpo. Comportamento di default preservato: nessuna breaking
        // change per chi non passa minElevation.
        const sunk = createHeightGrid(4, 4, -1);
        const s = proj.project(1, 1, -1);
        expect(pick(proj, s.x, s.y, sunk)).toBeNull();
    });

    it('con minElevation abbassato, una zona sprofondata ridiventa pescabile', () => {
        const sunk = createHeightGrid(4, 4, -1);
        const s = proj.project(1, 1, -1);
        expect(pick(proj, s.x, s.y, sunk, { minElevation: -1 })).toEqual({ gx: 1, gy: 1, z: -1 });
    });

    it('minElevation limita quanto in basso si scende, come maxElevation limita quanto in alto si sale', () => {
        const sunk = createHeightGrid(4, 4, null);
        sunk.setHeight(2, 2, -3);
        const s = proj.project(2, 2, -3);
        expect(pick(proj, s.x, s.y, sunk, { minElevation: -1 })).toBeNull();
        expect(pick(proj, s.x, s.y, sunk, { minElevation: -3 })).toEqual({ gx: 2, gy: 2, z: -3 });
    });
});

describe('pick non restituisce -0 (Finding 7)', () => {
    it('un punto nella meta\' sinistra della cella (0,0) restituisce gx: 0, non gx: -0', () => {
        // round(-0.4) === -0 in JS. Object.is distingue -0 da +0, e alcune
        // asserzioni (Object.is, alcune varianti di toEqual) fallirebbero su un
        // risultato matematicamente corretto ma "negativo zero".
        const flat = createHeightGrid(4, 4, 0);
        const c = proj.project(0, 0, 0);
        const left = proj.cornersOf(0, 0, 0)[3];
        // Un punto vicino al vertice sinistro ma dentro la cella: sposta round(x)
        // verso un -0, mentre y resta 0 esatto (positivo).
        const px = c.x + (left.x - c.x) * 0.1;
        const py = c.y;
        const result = pick(proj, px, py, flat);
        expect(result).toEqual({ gx: 0, gy: 0, z: 0 });
        expect(Object.is(result?.gx, -0)).toBe(false);
        expect(Object.is(result?.gx, 0)).toBe(true);
    });
});
