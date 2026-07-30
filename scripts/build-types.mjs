/**
 * Emits the published type declarations.
 *
 * Three steps that must happen in this order: emit both packages, copy the
 * global augmentation that `tsc` refuses to re-emit, then rewrite the one
 * module specifier that would not resolve on a consumer's machine. The final
 * scan is the point of the whole script: it fails loudly rather than shipping
 * a `.d.ts` that only resolves inside this monorepo.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(ROOT, 'packages/plugin/dist/types');
const INTERNAL = '@iso-internal/core';

function tsc(project) {
    execFileSync('npx', ['tsc', '-p', project], { cwd: ROOT, stdio: 'inherit' });
}

function allFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...allFiles(full));
        else out.push(full);
    }
    return out;
}

tsc('packages/core/tsconfig.build.json');
tsc('packages/plugin/tsconfig.build.json');

// `tsc` non ri-emette i .d.ts di input: va copiato a mano perche' il
// consumatore lo trovi.
copyFileSync(
    join(ROOT, 'packages/plugin/src/phaser-augment.d.ts'),
    join(TYPES, 'plugin/phaser-augment.d.ts')
);

// Verificato empiricamente su TypeScript 5.7.3 (repro isolato, sia con le
// opzioni strict di questo progetto sia con un tsconfig minimo): il
// `/// <reference path="./phaser-augment.d.ts" />` di index.ts NON sopravvive
// nell'emissione, nemmeno spezzato — sparisce del tutto, perche' il file
// referenziato fa gia' parte della stessa compilazione e tsc non lo ritiene
// necessario per se stesso. Senza reinserirlo a mano qui, il file appena
// copiato sopra non verrebbe mai caricato dal compilatore del consumatore, e
// la copia sarebbe un file morto sul disco: l'augmentation non
// raggiungerebbe comunque nessuno.
const pluginIndexPath = join(TYPES, 'plugin/index.d.ts');
const pluginIndexSrc = readFileSync(pluginIndexPath, 'utf8');
if (!pluginIndexSrc.includes('phaser-augment.d.ts')) {
    writeFileSync(pluginIndexPath, `/// <reference path="./phaser-augment.d.ts" />\n${pluginIndexSrc}`);
}

const coreEntry = join(TYPES, 'core/index.d.ts');
for (const file of allFiles(join(TYPES, 'plugin'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes(INTERNAL)) continue;
    const rel = relative(dirname(file), coreEntry).replace(/\\/g, '/').replace(/\.d\.ts$/, '.js');
    const prefixed = rel.startsWith('.') ? rel : `./${rel}`;
    writeFileSync(file, src.split(INTERNAL).join(prefixed));
}

const superstiti = allFiles(TYPES).filter(f => readFileSync(f, 'utf8').includes(INTERNAL));
if (superstiti.length > 0) {
    console.error(`Lo specifier interno ${INTERNAL} sopravvive in:\n  ${superstiti.join('\n  ')}`);
    process.exit(1);
}

console.log(`Tipi emessi in ${relative(ROOT, TYPES)}`);
