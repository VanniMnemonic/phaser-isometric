import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

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
 * Analizza il file come albero sintattico reale (compiler API di TypeScript),
 * non come testo. Un commento o una stringa letterale che contengono la parola
 * "phaser" non sono nodi dell'AST: non serve piu' rimuoverli a mano prima di
 * cercare, e un `await import('phaser')` dinamico e' un nodo (CallExpression
 * la cui `expression` e' la keyword `import`) tanto quanto un
 * `import ... from 'phaser'` statico — una ricerca testuale sulla parola
 * chiave `from` non lo vedrebbe mai.
 */
function parse(file: string, src: string): ts.SourceFile {
    return ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
}

/**
 * Ogni specifier di modulo importato o ri-esportato, statico o dinamico:
 * `import x from '...'`, `export { x } from '...'`, `export * from '...'`,
 * `await import('...')`.
 */
function importSpecifiers(sourceFile: ts.SourceFile): string[] {
    const out: string[] = [];
    function visit(node: ts.Node): void {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            out.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [arg] = node.arguments;
            if (arg && ts.isStringLiteral(arg)) out.push(arg.text);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return out;
}

/** Vero se il modulo referenzia il namespace globale `Phaser.qualcosa`. */
function usesPhaserNamespace(sourceFile: ts.SourceFile): boolean {
    let found = false;
    function visit(node: ts.Node): void {
        if (found) return;
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'Phaser'
        ) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return found;
}

describe('vincolo architetturale: il core e\' puro', () => {
    it('esiste almeno un modulo nel core', () => {
        expect(
            collect(SRC).length,
            'nessun modulo trovato in packages/core/src: il test non sta verificando niente'
        ).toBeGreaterThan(0);
    });

    it('nessun modulo importa Phaser, ne\' staticamente ne\' dinamicamente', () => {
        for (const file of collect(SRC)) {
            const sourceFile = parse(file, readFileSync(file, 'utf8'));
            expect(importSpecifiers(sourceFile).includes('phaser'), `${file} importa Phaser`).toBe(false);
            expect(usesPhaserNamespace(sourceFile), `${file} usa il namespace Phaser`).toBe(false);
        }
    });

    it('ogni import e\' relativo e risolve dentro il core', () => {
        // Il vincolo vero e' sul GRAFO, non sul testo: un modulo che importa un
        // pacchetto esterno passerebbe il test qui sopra e si porterebbe dietro
        // una dipendenza lo stesso — statico o dinamico.
        for (const file of collect(SRC)) {
            const sourceFile = parse(file, readFileSync(file, 'utf8'));
            for (const spec of importSpecifiers(sourceFile)) {
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
