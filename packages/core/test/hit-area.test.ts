import { describe, expect, it } from 'vitest';
import { diamondPoints } from '../src/hit-area';

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
});
