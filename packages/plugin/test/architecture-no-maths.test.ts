// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

/**
 * Files allowed to contain a binary `*`/`/`, each for a reason that is NOT
 * isometric maths reimplemented in the shell — "if it needs a computation,
 * call the core; if the core doesn't have it, add it to the core with its
 * own `node` test" is the rule this guard enforces.
 *
 * - `camera.ts`: `viewOf` is the plan's one explicitly sanctioned exception —
 *   Phaser-shaped arithmetic about Phaser's own camera (dividing by zoom,
 *   halving width/height to center a view), not isometric maths.
 * - `hit-area.ts`: the two divisions convert Phaser's pixel `displayOrigin`
 *   into the normalised origin the core's `diamondPoints` expects — adapter
 *   arithmetic between two representations, not geometry.
 */
const ALLOWLIST = new Set(['camera.ts', 'hit-area.ts']);

/**
 * Binary multiply/divide, in either plain or compound-assignment form.
 * Deliberately NOT `**`/`**=` (exponentiation): nothing in this package uses
 * it today, and it is not what this guard was asked to catch — scoping it
 * beyond `*`/`/` risks flagging something nobody asked to forbid.
 */
const FLAGGED_OPERATORS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken
]);

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
 * non come testo — stesso schema di `packages/core/test/purity.test.ts`. Un
 * asterisco dentro un commento JSDoc, uno `/` dentro un letterale regex o
 * dentro una stringa non sono nodi `BinaryExpression`: un parser vero li
 * salta gratis, mentre una scansione testuale dovrebbe escluderli a mano uno
 * per uno e potrebbe comunque sbagliare.
 */
function parse(file: string, src: string): ts.SourceFile {
    return ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
}

/** Ogni `*`/`/` binario nel file (incluse le forme `*=`/`/=`), come numeri di
 *  riga 1-based. */
function flaggedOperatorLines(sourceFile: ts.SourceFile): number[] {
    const lines: number[] = [];
    function visit(node: ts.Node): void {
        if (ts.isBinaryExpression(node) && FLAGGED_OPERATORS.has(node.operatorToken.kind)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart(sourceFile));
            lines.push(line + 1);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return lines;
}

describe('vincolo architetturale: lo shell non fa matematica isometrica', () => {
    const files = collect(SRC);
    const checked = files.filter(f => !ALLOWLIST.has(basename(f)));

    it('ci sono moduli fuori allowlist da controllare', () => {
        // Se questo scendesse a zero — perche' SRC si svuota o perche' ogni
        // file finisce in allowlist — il test sotto passerebbe per il motivo
        // sbagliato: nessun file controllato, quindi nessuna violazione
        // trovata. Questo assert e' la guardia contro quel falso verde.
        expect(
            checked.length,
            'nessun modulo fuori allowlist: la guardia sotto non starebbe verificando niente'
        ).toBeGreaterThan(0);
    });

    it('nessun modulo fuori allowlist contiene una moltiplicazione o una divisione binaria', () => {
        for (const file of checked) {
            const sourceFile = parse(file, readFileSync(file, 'utf8'));
            const lines = flaggedOperatorLines(sourceFile);
            expect(
                lines,
                `${file} contiene * o / alle righe: ${lines.join(', ')} — se e' matematica ` +
                'isometrica va spostata nel core (con un suo test in ambiente node) e lo shell ' +
                'deve limitarsi a chiamarla; se e\' un\'eccezione legittima va nell\'allowlist ' +
                'con un commento che spiega perche\' non e\' matematica isometrica'
            ).toEqual([]);
        }
    });
});
