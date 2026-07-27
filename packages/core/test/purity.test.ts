import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const PKG = resolve(HERE, '../package.json');
const TSCONFIGS = [resolve(HERE, '../tsconfig.json'), resolve(HERE, '../tsconfig.test.json')];

function collect(dir: string): string[] {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out = out.concat(collect(full));
        else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
}

/**
 * Il sorgente senza commenti. Il nome `Phaser` compare legittimamente nei
 * commenti dei moduli puri — spiegare PERCHE' non si usa Phaser e' esattamente
 * il tipo di nota che merita di stare li'.
 *
 * L'ordine conta, e non e' quello che verrebbe naturale. Togliendo prima i
 * blocchi, una riga di commento che contiene un apri-blocco lascia in giro
 * quell'apertura, e la regex dei blocchi la insegue fino alla chiusura
 * successiva — quasi sempre ce n'e' una, perche' ogni funzione ha il suo JSDoc —
 * divorando il codice in mezzo e nascondendo un uso vero di Phaser. Togliendo
 * prima le righe, quell'apertura sparisce con la riga che la conteneva.
 */
function stripComments(src: string): string {
    return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function relativeImports(src: string): string[] {
    const out: string[] = [];
    const re = /\bfrom\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1] as string);
    return out;
}

describe('vincolo architetturale: il core e\' puro', () => {
    it('esiste almeno un modulo nel core', () => {
        expect(
            collect(SRC).length,
            'nessun modulo trovato in packages/core/src: il test non sta verificando niente'
        ).toBeGreaterThan(0);
    });

    it('nessun modulo importa Phaser', () => {
        for (const file of collect(SRC)) {
            const src = stripComments(readFileSync(file, 'utf8'));
            expect(/from\s+['"]phaser['"]/.test(src), `${file} importa Phaser`).toBe(false);
            expect(/\bPhaser\./.test(src), `${file} usa il namespace Phaser`).toBe(false);
        }
    });

    it('ogni import e\' relativo e risolve dentro il core', () => {
        // Il vincolo vero e' sul GRAFO, non sul testo: un modulo che importa un
        // pacchetto esterno passerebbe il test qui sopra e si porterebbe dietro
        // una dipendenza lo stesso.
        for (const file of collect(SRC)) {
            const src = stripComments(readFileSync(file, 'utf8'));
            for (const spec of relativeImports(src)) {
                expect(
                    spec.startsWith('.'),
                    `${file} importa "${spec}", che non e' un modulo relativo del core`
                ).toBe(true);
                const target = resolve(dirname(file), `${spec}.ts`);
                expect(
                    target.startsWith(SRC),
                    `${file} importa "${spec}", che esce da packages/core/src`
                ).toBe(true);
                let esiste = false;
                try { esiste = statSync(target).isFile(); } catch { esiste = false; }
                expect(esiste, `${file} importa "${spec}", che non risolve a un file del core`).toBe(true);
            }
        }
    });

    it('il package.json del core non nomina phaser', () => {
        expect(/phaser/i.test(readFileSync(PKG, 'utf8')), 'packages/core/package.json nomina phaser').toBe(false);
    });

    it('nessun tsconfig del core include i tipi di phaser', () => {
        for (const path of TSCONFIGS) {
            expect(/phaser/i.test(readFileSync(path, 'utf8')), `${path} nomina phaser`).toBe(false);
        }
    });
});
