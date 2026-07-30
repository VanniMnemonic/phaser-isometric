import { describe, expect, it } from 'vitest';
import { buildDiagnosis } from '@iso-internal/core';
import { renderDiagnosis, renderError, renderHelp, renderJson } from '../src/cli-render';
import { SCHEDA_96x48_24x24 } from './expected-card';
import type { Diagnosis } from '@iso-internal/core';
import type { RenderMeta } from '../src/cli-render';

const META: RenderMeta = { tool: 'phaser-isometric', version: '0.2.0', command: 'diagnose' };

const SANO = buildDiagnosis({
    projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 },
    grid: { width: 24, height: 24 }
});


/** Un Diagnosis costruito a mano, per esercitare valori che il core non
 *  produrrebbe MAI. E' l'unico modo di testare il sentinella `na`: se il
 *  renderer stesse dentro cli.ts, questi casi sarebbero irraggiungibili. */
function impossibile(patch: Partial<Diagnosis['projection']>): Diagnosis {
    return { ...SANO, projection: { ...SANO.projection, ...patch } };
}

describe('renderDiagnosis', () => {
    it('rende la scheda esattamente cosi', () => {
        expect(renderDiagnosis(SANO, META)).toBe(SCHEDA_96x48_24x24);
    });

    it('omette del tutto una sezione che non ha niente da dire', () => {
        // Non un'intestazione vuota: quella si legge come "abbiamo guardato e
        // non c'era niente", quando invece nessuno aveva chiesto.
        const senzaGriglia = buildDiagnosis({ projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 } });
        const reso = renderDiagnosis(senzaGriglia, META);
        expect(reso).not.toContain('## GRID');
        expect(reso).not.toContain('## WARNINGS');
        expect(reso).toContain('## DEPTH');
    });

    it('numera i warning da 1, uno per riga per campo', () => {
        const conWarning = buildDiagnosis({ projection: { type: 'diamond', tileWidth: 97, tileHeight: 48 } });
        const reso = renderDiagnosis(conWarning, META);
        expect(reso).toContain('## WARNINGS');
        expect(reso).toContain('1.code=fractional-tile-centres');
        expect(reso).toContain('1.symptom=');
        expect(reso).toContain('1.fix=');
        expect(reso).not.toContain('0.code=');
        expect(reso).toContain('warnings=1');
    });
});

describe('renderDiagnosis: i numeri', () => {
    it('non lascia MAI sfuggire la notazione scientifica', () => {
        // Serve una fixture che arrivi davvero alla soglia: nessuna misura di
        // tile plausibile la raggiunge, quindi senza questo valore impossibile
        // l'asserzione sarebbe soddisfatta senza aver verificato niente.
        const reso = renderDiagnosis(impossibile({ det: 1e40 }), META);
        expect(reso).not.toMatch(/e[+-]\d/);
        expect(reso).toContain('det=na');
    });

    it('rende na, non NaN, per un valore che non e un numero', () => {
        expect(renderDiagnosis(impossibile({ conditioning: NaN }), META)).toContain('conditioning=na');
        expect(renderDiagnosis(impossibile({ det: Infinity }), META)).toContain('det=na');
    });

    it('non stampa uno zero col segno meno davanti', () => {
        // Misurato: (-0.00001).toFixed(4) da' "-0.0000". Un meno davanti a
        // degli zeri si legge come una direzione che non c'e'.
        expect(renderDiagnosis(impossibile({ elevationStep: -0.00001 }), META))
            .toContain('elevationStep=0.0000');
    });

    it('e deterministico: due rese consecutive sono identiche byte per byte', () => {
        expect(renderDiagnosis(SANO, META)).toBe(renderDiagnosis(SANO, META));
    });
});

describe('renderError', () => {
    it('tiene symptom e fix in due celle distinte', () => {
        // Il messaggio dell'Error li incolla con ". Fix: ". Chi cerca cosa
        // fare non deve doverlo estrarre da dentro una frase.
        const reso = renderError('IsoConfigError', 'the matrix is not invertible', 'change a column');
        expect(reso).toContain('symptom=the matrix is not invertible');
        expect(reso).toContain('fix=change a column');
        expect(reso).not.toContain('. Fix: ');
    });
});

describe('renderJson', () => {
    it('avvolge il dossier senza toccarne la precisione', () => {
        const letto = JSON.parse(renderJson(SANO, META)) as { tool: string; diagnosis: Diagnosis };
        expect(letto.tool).toBe('phaser-isometric');
        expect(letto.diagnosis.schema).toBe(1);
        // Piena precisione: la quantizzazione appartiene al bordo della
        // scheda, non a un payload su cui qualcosa calcolera'.
        expect(letto.diagnosis.projection.det).toBe(2304);
    });
});

describe('renderHelp', () => {
    it('documenta ogni flag che il parser accetta', () => {
        const testo = renderHelp();
        for (const flag of ['--tile', '--matrix', '--elevation-step', '--origin',
            '--grid', '--max-elevation', '--max-row', '--strict', '--json']) {
            expect(testo, `${flag} non e documentato`).toContain(flag);
        }
    });

    it('dichiara i tre exit code e che non legge stdin', () => {
        const testo = renderHelp();
        expect(testo).toContain('Exit codes');
        expect(testo).toContain('does not read stdin');
    });
});
