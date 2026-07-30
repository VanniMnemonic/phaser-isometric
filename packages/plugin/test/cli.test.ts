import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEDA_96x48_24x24 } from './expected-card';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const CLI = join(DIST, 'cli.js');
const MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');

/**
 * Esegue la CLI COSTRUITA con `process.execPath`, non lanciandola direttamente.
 * Portabile, e indipendente dal bit di esecuzione — che infatti NON viene
 * esercitato qui: quello e lo shebang hanno le loro asserzioni sui byte piu'
 * sotto, e la loro prova reale in scripts/verify-tarball.mjs, che passa dallo
 * shim di npm.
 */
function esegui(args: string[], env: NodeJS.ProcessEnv = {}): { status: number; out: string; err: string } {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env }
    });
    return { status: r.status ?? -1, out: r.stdout, err: r.stderr };
}

describe('la CLI costruita', () => {
    beforeAll(() => {
        // Fallire, non saltare: un `it.skipIf` qui sarebbe una suite verde che
        // non ha verificato niente, che e' il difetto dominante di questo repo.
        expect(
            existsSync(CLI),
            'packages/plugin/dist/cli.js non esiste: esegui `pnpm build:js` prima della suite'
        ).toBe(true);
    });

    it('comincia esattamente con lo shebang, come primo byte del file', () => {
        expect(readFileSync(CLI, 'utf8').slice(0, 20)).toBe('#!/usr/bin/env node\n');
    });

    it('e nessun altro file di dist ne ha uno', () => {
        // Rollup riemette lo shebang solo sulla facade di una entry, quindi
        // questa e' una proprieta' strutturale. Passare a un `banner`
        // incondizionato la romperebbe su tutti e quattro i file insieme.
        const altri = readdirSync(DIST).filter(f => f.endsWith('.js') && f !== 'cli.js');
        expect(altri.length, 'nessun altro .js in dist: il controllo sotto non verificherebbe niente')
            .toBeGreaterThan(3);
        for (const f of altri) {
            expect(readFileSync(join(DIST, f), 'utf8'), `${f} ha uno shebang`).not.toContain('#!');
        }
    });

    it('importa solo chunk relativi, e non nomina nessun builtin di node', () => {
        const src = readFileSync(CLI, 'utf8');
        const importati = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]);
        expect(importati.length, 'nessun import trovato: il regex non sta leggendo niente')
            .toBeGreaterThan(0);
        for (const spec of importati) {
            expect(spec, `${spec} non e un chunk relativo`).toMatch(/^\.\/chunk-.+\.js$/);
        }
        // Vite in build client sostituisce un import `node:` con uno stub vuoto
        // e riesce comunque: senza questo controllo la rottura si vedrebbe solo
        // a runtime, e nominerebbe tutt'altro.
        expect(src).not.toContain('node:');
    });
});

describe('la CLI: il caso sano', () => {
    it('stampa la scheda su stdout, niente su stderr, ed esce 0', () => {
        const r = esegui(['diagnose', '--tile', '96x48', '--grid', '24x24']);
        expect(r.status).toBe(0);
        expect(r.out).toBe(SCHEDA_96x48_24x24);
        expect(r.err).toBe('');
    });

    it('due esecuzioni consecutive danno stdout identico byte per byte', () => {
        // Un timestamp, un process.uptime() o un Date.now() dentro META
        // renderebbero la scheda non diffabile, e un diff e' l'uso principale.
        const a = esegui(['diagnose', '--tile', '96x48', '--grid', '24x24']);
        const b = esegui(['diagnose', '--tile', '96x48', '--grid', '24x24']);
        expect(a.out).toBe(b.out);
    });

    it('non cambia sotto un locale diverso', () => {
        // `toLocaleString` renderebbe 2304 come "2.304" in de_DE, e il difetto
        // non si vedrebbe mai su questa macchina.
        const r = esegui(['diagnose', '--tile', '96x48', '--grid', '24x24'],
            { LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8' });
        expect(r.out).toBe(SCHEDA_96x48_24x24);
    });

    it('--json e JSON valido, senza una riga di scheda', () => {
        const r = esegui(['diagnose', '--tile', '96x48', '--grid', '24x24', '--json']);
        expect(r.status).toBe(0);
        expect(r.out).not.toContain('## ');
        const letto = JSON.parse(r.out) as { diagnosis: { schema: number; projection: { det: number } } };
        expect(letto.diagnosis.schema).toBe(1);
        expect(letto.diagnosis.projection.det).toBe(2304);
    });
});

describe('la CLI: i warning e --strict', () => {
    it('un warning NON fa fallire di default', () => {
        const r = esegui(['diagnose', '--tile', '97x48', '--grid', '24x24']);
        expect(r.status).toBe(0);
        expect(r.out).toContain('1.code=fractional-tile-centres');
    });

    it('ma con --strict esce 2', () => {
        const r = esegui(['diagnose', '--tile', '97x48', '--grid', '24x24', '--strict']);
        expect(r.status).toBe(2);
        // La scheda esce comunque: --strict cambia il codice, non l'output.
        expect(r.out).toContain('1.code=fractional-tile-centres');
    });

    it('e --strict su una configurazione sana resta 0', () => {
        // Senza questa meta', un `exitCode = 2` incondizionato passerebbe il
        // test qui sopra e nessuno se ne accorgerebbe.
        expect(esegui(['diagnose', '--tile', '96x48', '--strict']).status).toBe(0);
    });
});

describe('la CLI: gli errori', () => {
    it('una configurazione rifiutata esce 1, con la scheda ERROR su stderr', () => {
        const r = esegui(['diagnose', '--matrix', '1,1,1,1']);
        expect(r.status).toBe(1);
        expect(r.out).toBe('');
        expect(r.err).toContain('## ERROR');
        expect(r.err).toContain('kind=IsoConfigError');
        // Il `fix` e' l'unica parte che dice cosa fare: renderizzare
        // `err.message` lo farebbe sparire dentro il sintomo.
        expect(r.err).toContain('fix=columns (a,b) and (c,d) are collinear');
    });

    it('e non mostra mai uno stack trace', () => {
        const r = esegui(['diagnose', '--matrix', '1,1,1,1']);
        expect(r.err).not.toContain('\n    at ');
        expect(r.err).not.toContain('node_modules');
    });

    it('un flag sconosciuto esce 1 e lo nomina', () => {
        const r = esegui(['diagnose', '--tiles', '96x48']);
        expect(r.status).toBe(1);
        expect(r.err).toContain('--tiles');
    });

    it('senza argomenti esce 1 stampando l aiuto su stderr', () => {
        const r = esegui([]);
        expect(r.status).toBe(1);
        expect(r.err).toContain('Commands');
        expect(r.out).toBe('');
    });

    it('ma "help" chiesto esplicitamente esce 0, su stdout', () => {
        const r = esegui(['help']);
        expect(r.status).toBe(0);
        expect(r.out).toContain('Commands');
        expect(r.err).toBe('');
    });
});

describe('la CLI: la versione', () => {
    it('stampa quella del manifest, non una costante scritta a mano', () => {
        // E' questa asserzione a rendere vera la frase "e' per costruzione la
        // versione che hai installato": un letterale dentro cli.ts diventa
        // rosso qui il giorno stesso in cui il manifest si muove.
        const attesa = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { version: string }).version;
        expect(esegui(['version']).out.trim()).toBe(attesa);
    });
});
