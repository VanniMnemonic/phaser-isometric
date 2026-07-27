import { describe, it, expect } from 'vitest';
import { IsoConfigError } from '../src/errors';

describe('IsoConfigError', () => {
    it('include sintomo e correzione nel messaggio', () => {
        const err = new IsoConfigError(
            'la matrice non e\' invertibile (det = 0)',
            'usa tileWidth e tileHeight maggiori di zero'
        );
        expect(err.message).toContain('la matrice non e\' invertibile');
        expect(err.message).toContain('usa tileWidth e tileHeight maggiori di zero');
    });

    it('e\' un Error con un name riconoscibile', () => {
        const err = new IsoConfigError('sintomo', 'correzione');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('IsoConfigError');
    });

    it('espone sintomo e correzione come campi separati', () => {
        // Serve all'MCP: iso_diagnose rende i due pezzi in celle distinte.
        const err = new IsoConfigError('sintomo', 'correzione');
        expect(err.symptom).toBe('sintomo');
        expect(err.fix).toBe('correzione');
    });
});
