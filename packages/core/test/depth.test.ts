import { describe, it, expect } from 'vitest';
import { createDepthAssigner, DEFAULT_BANDS, DEFAULT_LAYOUT } from '../src/depth';
import { IsoConfigError } from '../src/errors';

describe('layout di default', () => {
    it('le bande di una riga non possono invadere la riga successiva', () => {
        const { rowStride, bandStride, maxBands, subCapacity } = DEFAULT_LAYOUT;
        expect((maxBands - 1) * bandStride + (subCapacity - 1)).toBeLessThan(rowStride);
    });
});

describe('createDepthAssigner', () => {
    const d = createDepthAssigner();

    it('una riga piu\' avanti vince SEMPRE, qualunque banda e qualunque sub', () => {
        // L'invariante portante: la riga domina la banda.
        const dietro = d.keyFor(2, 2, DEFAULT_BANDS.overlay, 255);
        const avanti = d.keyFor(3, 2, DEFAULT_BANDS.floor, 0);
        expect(avanti).toBeGreaterThan(dietro);
    });

    it('nella stessa riga, le bande sono ordinate', () => {
        const floor = d.keyFor(3, 3, DEFAULT_BANDS.floor);
        const prop = d.keyFor(3, 3, DEFAULT_BANDS.prop);
        const hero = d.keyFor(2, 4, DEFAULT_BANDS.hero);
        expect(prop).toBeGreaterThan(floor);
        expect(hero).toBeGreaterThan(prop);
    });

    it('celle diverse sulla stessa riga condividono la chiave a parita\' di banda e sub', () => {
        // Conseguenza dichiarata del modello: l'ordine dipende da gx+gy. Due celle
        // sulla stessa diagonale non si sovrappongono mai a schermo, quindi il
        // pareggio e' innocuo — ma va reso esplicito, non scoperto.
        expect(d.keyFor(1, 3, DEFAULT_BANDS.prop)).toBe(d.keyFor(3, 1, DEFAULT_BANDS.prop));
    });

    it('sub distinti danno chiavi distinte e consecutive', () => {
        const a = d.keyFor(4, 4, DEFAULT_BANDS.actor, 0);
        const b = d.keyFor(4, 4, DEFAULT_BANDS.actor, 1);
        expect(b - a).toBe(1);
    });

    it('due chiavi uguali implicano SEMPRE stessa riga e stessa banda', () => {
        // La garanzia vera: nessuna collisione fra combinazioni diverse di
        // (riga, banda). Le uniche collisioni ammesse sono fra celle della
        // stessa riga, gia' dichiarate innocue dal test qui sopra.
        const byKey = new Map<number, string>();
        const bands = Object.values(DEFAULT_BANDS);
        for (let gx = 0; gx < 30; gx++) {
            for (let gy = 0; gy < 30; gy++) {
                for (const band of bands) {
                    const key = d.keyFor(gx, gy, band, 0);
                    const identita = `riga${gx + gy}:banda${band}`;
                    const prima = byKey.get(key);
                    if (prima === undefined) byKey.set(key, identita);
                    else expect(prima, `chiave ${key} condivisa da identita' diverse`).toBe(identita);
                }
            }
        }
        // righe 0..58 = 59 valori, per 7 bande
        expect(byKey.size).toBe(59 * bands.length);
    });

    it('tutte le chiavi restano interi esatti', () => {
        for (let gx = 0; gx < 50; gx++) {
            for (let gy = 0; gy < 50; gy++) {
                expect(Number.isSafeInteger(d.keyFor(gx, gy, DEFAULT_BANDS.hero, 7))).toBe(true);
            }
        }
    });

    it('rowOffset permette coordinate negative senza chiavi negative', () => {
        const neg = createDepthAssigner({ layout: { rowOffset: 64 } });
        expect(neg.keyFor(-20, -20, DEFAULT_BANDS.floor)).toBeGreaterThanOrEqual(0);
    });

    it('rifiuta una banda fuori dal layout, nominando la correzione', () => {
        expect(() => d.keyFor(0, 0, DEFAULT_LAYOUT.maxBands)).toThrow(IsoConfigError);
        try {
            d.keyFor(0, 0, DEFAULT_LAYOUT.maxBands);
            expect.unreachable('doveva lanciare');
        } catch (e) {
            expect((e as IsoConfigError).fix).toContain('maxBands');
        }
    });

    it('rifiuta un sub oltre la capacita\'', () => {
        expect(() => d.keyFor(0, 0, DEFAULT_BANDS.actor, DEFAULT_LAYOUT.subCapacity))
            .toThrow(IsoConfigError);
    });

    it('rifiuta gx/gy non interi, altrimenti la riga non domina piu\' la banda (Finding 3)', () => {
        // Con gx = 3.9 e banda overlay (6): 3.9*4096 + 6*256 = 17510.4, che
        // SUPERA 16384, la chiave di un pavimento in riga 4 (4*4096). "La riga
        // domina la banda" richiede gx/gy interi tanto quanto richiede banda/sub
        // interi: un attore a meta' passo fra due celle e' l'input piu' plausibile
        // che un consumatore possa passare senza accorgersene.
        expect(() => d.keyFor(3.9, 0, DEFAULT_BANDS.overlay)).toThrow(IsoConfigError);
        expect(() => d.keyFor(0, 3.9, DEFAULT_BANDS.overlay)).toThrow(IsoConfigError);
        try {
            d.keyFor(3.9, 0, DEFAULT_BANDS.overlay);
            expect.unreachable('doveva lanciare');
        } catch (e) {
            expect((e as IsoConfigError).fix).toContain('round');
        }
    });

    it('rifiuta alla costruzione uno stride o una capacita\' non intera o non positiva', () => {
        // L'unico ramo di validazione del costruttore rimasto scoperto: gli altri
        // due throw della costruzione (trabocco di riga, bande che invadono la
        // riga) sono gia' testati sopra e sotto.
        expect(() => createDepthAssigner({ layout: { rowStride: 0 } })).toThrow(IsoConfigError);
        expect(() => createDepthAssigner({ layout: { bandStride: -1 } })).toThrow(IsoConfigError);
        expect(() => createDepthAssigner({ layout: { subCapacity: 2.5 } })).toThrow(IsoConfigError);
        expect(() => createDepthAssigner({ layout: { maxBands: Number.NaN } })).toThrow(IsoConfigError);
    });

    it('rifiuta alla COSTRUZIONE un layout che potrebbe traboccare', () => {
        // La validazione deve avvenire una volta sola, non a ogni chiamata.
        expect(() => createDepthAssigner({
            layout: { rowStride: 2 ** 40 },
            maxRow: 2 ** 20
        })).toThrow(IsoConfigError);
    });

    it('rifiuta alla costruzione un layout in cui le bande invadono la riga', () => {
        expect(() => createDepthAssigner({ layout: { bandStride: 4096 } })).toThrow(IsoConfigError);
    });

    it('una strategy custom sostituisce interamente la formula', () => {
        const custom = createDepthAssigner({
            strategy: (gx, gy, band, sub) => -(gx + gy) * 10 + band + sub
        });
        expect(custom.keyFor(1, 1, 3, 2)).toBe(-20 + 3 + 2);
    });
});
