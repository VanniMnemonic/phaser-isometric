import { describe, it, expect } from 'vitest';
import { createHeightGrid } from '../src/height-grid';

describe('createHeightGrid', () => {
    it('riempie di quota 0 per default', () => {
        const g = createHeightGrid(4, 3);
        expect(g.width).toBe(4);
        expect(g.height).toBe(3);
        expect(g.heightAt(0, 0)).toBe(0);
        expect(g.heightAt(3, 2)).toBe(0);
    });

    it('distingue quota 0 da abisso', () => {
        // Il difetto classico di ogni heightmap sparsa: 0 e' terreno valido,
        // null e' assenza di terreno. Un `if (!h)` li confonde entrambi.
        const g = createHeightGrid(2, 2, null);
        expect(g.heightAt(0, 0)).toBeNull();
        g.setHeight(0, 0, 0);
        expect(g.heightAt(0, 0)).toBe(0);
        expect(g.heightAt(0, 0)).not.toBeNull();
    });

    it('fuori dai bordi restituisce null, non lancia', () => {
        const g = createHeightGrid(2, 2);
        expect(g.heightAt(-1, 0)).toBeNull();
        expect(g.heightAt(0, -1)).toBeNull();
        expect(g.heightAt(2, 0)).toBeNull();
        expect(g.heightAt(0, 2)).toBeNull();
    });

    it('coordinate frazionarie restituiscono null invece di indicizzare a caso', () => {
        const g = createHeightGrid(4, 4);
        expect(g.heightAt(1.5, 2)).toBeNull();
    });

    it('setHeight alza maxElevation', () => {
        const g = createHeightGrid(4, 4);
        expect(g.maxElevation).toBe(0);
        g.setHeight(1, 1, 5);
        expect(g.maxElevation).toBe(5);
        g.setHeight(2, 2, 3);
        expect(g.maxElevation).toBe(5);
    });

    it('maxElevation e\' MONOTONO: non scende quando una cella viene abbassata', () => {
        // Scelta dichiarata: ricalcolare il massimo a ogni scrittura costerebbe
        // O(W*H). Il valore resta un limite SUPERIORE valido, che e' tutto cio'
        // di cui il picking ha bisogno.
        const g = createHeightGrid(4, 4);
        g.setHeight(1, 1, 5);
        g.setHeight(1, 1, null);
        expect(g.maxElevation).toBe(5);
    });

    it('maxElevation vale 0 su una griglia interamente abisso', () => {
        expect(createHeightGrid(3, 3, null).maxElevation).toBe(0);
    });

    it('setHeight fuori dai bordi e\' un no-op silenzioso', () => {
        const g = createHeightGrid(2, 2);
        expect(() => g.setHeight(9, 9, 3)).not.toThrow();
        expect(g.maxElevation).toBe(0);
    });
});
