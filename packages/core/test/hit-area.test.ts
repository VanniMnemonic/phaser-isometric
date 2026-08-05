import { describe, expect, it } from 'vitest';
import { cellPoints, diamondPoints } from '../src/hit-area';
import { createProjection } from '../src/projection';
import { IsoConfigError } from '../src/errors';

/** L'area di un poligono dai suoi vertici piatti, con la formula del laccio.
 *  Calcolata QUI e non letta dal codice sotto esame: e' la grandezza che
 *  distingue il parallelogramma vero (area |det|) dal rombo che
 *  `tileSizeOf` farebbe costruire (area 2*|a|*|d|), e sul preset diamond le
 *  due coincidono — che e' esattamente perche' il difetto e' rimasto invisibile
 *  finche' l'unica proiezione provata era il rombo. */
function areaDi(flat: readonly number[]): number {
    let somma = 0;
    for (let i = 0; i < flat.length; i += 2) {
        const j = (i + 2) % flat.length;
        somma += (flat[i] as number) * (flat[j + 1] as number)
            - (flat[j] as number) * (flat[i + 1] as number);
    }
    return Math.abs(somma) / 2;
}

describe('diamondPoints', () => {
    it('produce quattro vertici in ordine orario dall alto', () => {
        // Frame 96x96, rombo 96x48, origine al centro del frame.
        const p = diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 96, tileHeight: 48,
            originX: 0.5, originY: 0.5
        });

        expect(p).toEqual([
            48, 24,   // alto
            96, 48,   // destra
            48, 72,   // basso
            0, 48     // sinistra
        ]);
    });

    it('segue l origine dello sprite, che per un tile sta in basso', () => {
        // Un tile alto: il rombo e' alla BASE della grafica, non al centro.
        const p = diamondPoints({
            frameWidth: 96, frameHeight: 128,
            tileWidth: 96, tileHeight: 48,
            originX: 0.5, originY: 1
        });

        // centro del rombo a (48, 128): il vertice basso esce dal frame, ed e'
        // corretto — la hit area non e' obbligata a stare dentro la texture.
        expect(p).toEqual([48, 104, 96, 128, 48, 152, 0, 128]);
    });

    it('rifiuta una dimensione non finita alla costruzione', () => {
        expect(() => diamondPoints({
            frameWidth: NaN, frameHeight: 96,
            tileWidth: 96, tileHeight: 48, originX: 0.5, originY: 0.5
        })).toThrow();
    });

    it('rifiuta un tile non positivo', () => {
        expect(() => diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 0, tileHeight: 48, originX: 0.5, originY: 0.5
        })).toThrow();
    });

    it('rifiuta una dimensione del frame non positiva', () => {
        // Un frame a zero o negativo non e' un caso legittimo (un target senza
        // texture ancora assegnata): accettarlo produrrebbe in silenzio un
        // rombo mal centrato invece di segnalare il problema.
        expect(() => diamondPoints({
            frameWidth: 0, frameHeight: 96,
            tileWidth: 96, tileHeight: 48, originX: 0.5, originY: 0.5
        })).toThrow(IsoConfigError);
        expect(() => diamondPoints({
            frameWidth: 96, frameHeight: -10,
            tileWidth: 96, tileHeight: 48, originX: 0.5, originY: 0.5
        })).toThrow(IsoConfigError);
    });

    it('rifiuta un origine non finita', () => {
        expect(() => diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 96, tileHeight: 48, originX: NaN, originY: 0.5
        })).toThrow(IsoConfigError);
        expect(() => diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 96, tileHeight: 48, originX: 0.5, originY: Number.POSITIVE_INFINITY
        })).toThrow(IsoConfigError);
    });
});

describe('cellPoints', () => {
    // La matrice sghemba di riferimento: interi scelti perche' l'area del
    // laccio venga esatta (det = 100*70 - 20*(-40) = 7800), cosi' l'asserzione
    // sull'area non ha bisogno di tolleranza e non puo' passare per
    // arrotondamento.
    const SGHEMBA = createProjection({ type: 'matrix', a: 100, b: 20, c: -40, d: 70 });

    it('sul preset diamond produce ESATTAMENTE cio che produce diamondPoints', () => {
        // La generalizzazione non ha il diritto di cambiare il caso gia'
        // coperto: un rombo E' un parallelogramma, e le due funzioni devono
        // concordare bit per bit li' dove il dominio si sovrappone. Senza
        // questa asserzione, `makeCellHitArea` potrebbe diventare la
        // raccomandazione universale portandosi dietro una regressione
        // silenziosa su ogni gioco a rombi che esiste gia'.
        const rombo = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const daCella = cellPoints(rombo, {
            frameWidth: 96, frameHeight: 96, originX: 0.5, originY: 0.5
        });
        const daRombo = diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 96, tileHeight: 48, originX: 0.5, originY: 0.5
        });

        expect(daCella).toEqual(daRombo);
    });

    it('su una matrice sghemba produce il parallelogramma vero, non un rombo', () => {
        // Scostamenti dal centro: halfSum = ((a+c)/2, (b+d)/2) = (30, 45),
        // halfDiff = ((a-c)/2, (b-d)/2) = (70, -25). Centro del frame (48, 48).
        // Calcolati a mano, non letti dalla funzione sotto esame.
        expect(cellPoints(SGHEMBA, {
            frameWidth: 96, frameHeight: 96, originX: 0.5, originY: 0.5
        })).toEqual([18, 3, 118, 23, 78, 93, -22, 73]);
    });

    it('l area del poligono e |det|, mentre il rombo di tileSizeOf ne varrebbe 1.795 volte', () => {
        // L'asserzione che smaschera il difetto senza guardare la forma: il
        // parallelogramma di una cella ha area |det| per definizione della
        // matrice, mentre il rombo che `tileSizeOf` fa costruire ha area
        // 2*|a|*|d|. Le due coincidono SOLO sul rombo, che e' il motivo per cui
        // l'intera suite passava con la forma sbagliata.
        const punti = cellPoints(SGHEMBA, {
            frameWidth: 96, frameHeight: 96, originX: 0.5, originY: 0.5
        });

        expect(areaDi(punti)).toBe(Math.abs(SGHEMBA.det));
        // 7800 contro 14000: il rombo rivendicherebbe il 79,5% di area in piu'.
        expect(areaDi(punti)).not.toBe(2 * Math.abs(SGHEMBA.a * SGHEMBA.d));
    });

    it('sull assonometria vera a 30 gradi di elevazione e 15 di orientamento', () => {
        // I numeri del pannello di un editor vettoriale: E 30, O 15, scala 144.
        // a = 144*cos15, b = 144*sin15*sin30, c = -144*sin15, d = 144*cos15*sin30.
        const e = (30 * Math.PI) / 180;
        const o = (15 * Math.PI) / 180;
        const S = 144;
        const p = createProjection({
            type: 'matrix',
            a: S * Math.cos(o),
            b: S * Math.sin(o) * Math.sin(e),
            c: -S * Math.sin(o),
            d: S * Math.cos(o) * Math.sin(e),
            elevationStep: S * Math.cos(e)
        });

        const punti = cellPoints(p, {
            frameWidth: 256, frameHeight: 256, originX: 0.5, originY: 0.5
        });

        // Area = |det| = 10368, contro i 19346,95 del rombo di tileSizeOf:
        // il rapporto e' esattamente 2*cos^2(15 gradi) = 1,866025.
        expect(areaDi(punti)).toBeCloseTo(Math.abs(p.det), 6);
        expect(areaDi(punti)).toBeCloseTo(10368, 6);
        expect(2 * Math.abs(p.a * p.d) / areaDi(punti)).toBeCloseTo(2 * Math.cos(o) ** 2, 9);
    });

    it('segue l origine dello sprite, che per un tile sta in basso', () => {
        // Stesso contratto di diamondPoints: il centro della cella cade
        // sull'origine display, non al centro del frame.
        expect(cellPoints(SGHEMBA, {
            frameWidth: 96, frameHeight: 128, originX: 0.5, originY: 1
        })).toEqual([18, 83, 118, 103, 78, 173, -22, 153]);
    });

    it('rifiuta una dimensione del frame non positiva e un origine non finita', () => {
        expect(() => cellPoints(SGHEMBA, {
            frameWidth: 0, frameHeight: 96, originX: 0.5, originY: 0.5
        })).toThrow(IsoConfigError);
        expect(() => cellPoints(SGHEMBA, {
            frameWidth: 96, frameHeight: -10, originX: 0.5, originY: 0.5
        })).toThrow(IsoConfigError);
        expect(() => cellPoints(SGHEMBA, {
            frameWidth: 96, frameHeight: 96, originX: NaN, originY: 0.5
        })).toThrow(IsoConfigError);
        expect(() => cellPoints(SGHEMBA, {
            frameWidth: 96, frameHeight: 96, originX: 0.5, originY: Number.POSITIVE_INFINITY
        })).toThrow(IsoConfigError);
    });

    it('NON dipende dall origine della proiezione: la hit area vive nello spazio frame', () => {
        // Una proiezione traslata sposta ogni cella sullo schermo, ma la forma
        // della hit area attorno all'origine display e' la stessa. Se
        // l'implementazione dimenticasse di sottrarre la traslazione, ogni hit
        // area uscirebbe spostata di `origin` pixel e nessun click cadrebbe
        // dove ci si aspetta.
        const traslata = createProjection(
            { type: 'matrix', a: 100, b: 20, c: -40, d: 70 },
            { origin: { x: 640, y: 360 } }
        );

        expect(cellPoints(traslata, {
            frameWidth: 96, frameHeight: 96, originX: 0.5, originY: 0.5
        })).toEqual([18, 3, 118, 23, 78, 93, -22, 73]);
    });
});
