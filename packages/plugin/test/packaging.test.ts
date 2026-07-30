import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(
    readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')
) as Record<string, any>;

describe('manifest di pubblicazione', () => {
    it('e pubblicabile', () => {
        expect(PKG.private).toBeUndefined();
        expect(PKG.version).toBe('0.1.0');
        expect(PKG.license).toBe('MIT');
        expect(PKG.type).toBe('module');
    });

    it('espone esattamente questi sottopath', () => {
        // Uguaglianza, non inclusione: la deriva della superficie e' un
        // cambio di contratto silenzioso per ogni progetto gia' installato.
        expect(new Set(Object.keys(PKG.exports))).toEqual(
            new Set(['.', './core', './debug', './package.json'])
        );
    });

    it('dichiara types per prima in ogni sottopath di codice', () => {
        for (const key of ['.', './core', './debug']) {
            const entry = PKG.exports[key];
            // L'ordine conta davvero: le condizioni si risolvono in ordine di
            // dichiarazione, e un `import` prima di `types` fa vincere il .js.
            expect(Object.keys(entry)[0], key).toBe('types');
            expect(entry.types, key).toMatch(/^\.\/dist\/types\/.+\.d\.ts$/);
            expect(entry.import, key).toMatch(/^\.\/dist\/.+\.js$/);
        }
    });

    it('congela l\'insieme delle condizioni, non solo il loro ordine', () => {
        // Il test sopra guarda solo la PRIMA chiave: una condizione intrusa
        // in coda (`require`, un formato CJS mai costruito) o una condizione
        // mancante gli sfugge del tutto. Qui l'insieme intero deve
        // coincidere, ne' piu' ne' meno.
        const CONDIZIONI_ATTESE = new Set(['types', 'import', 'default']);
        for (const key of ['.', './core', './debug']) {
            const entry = PKG.exports[key];
            expect(new Set(Object.keys(entry)), key).toEqual(CONDIZIONI_ATTESE);
        }
    });

    it('ogni percorso della mappa exports risolve a un file che esiste', () => {
        // Lega il manifest al disco: ogni altro controllo qui sopra guarda
        // solo la FORMA della stringa (l'ordine, l'estensione, il prefisso
        // ./dist/), mai il file che ci sta dietro. Un nome cablato male o
        // rinominato dopo un refactor della build passerebbe ogni test di
        // forma restando comunque rotto per un consumatore reale.
        for (const [key, value] of Object.entries(PKG.exports)) {
            if (typeof value === 'string') {
                expect(existsSync(resolve(PKG_DIR, value)), `${key} -> ${value}`).toBe(true);
                continue;
            }
            for (const [condizione, target] of Object.entries(value as Record<string, string>)) {
                expect(existsSync(resolve(PKG_DIR, target)), `${key}[${condizione}] -> ${target}`).toBe(true);
            }
        }
    });

    it('non spedisce sorgenti', () => {
        expect(new Set(PKG.files)).toEqual(new Set(['dist', 'skills', 'llms.txt']));
    });

    it('non lascia main o types come seconda via di risoluzione', () => {
        // Con `exports` presente, Node e i bundler moderni li ignorano
        // comunque, ma uno strumento che legge ancora `main`/`types` invece
        // di `exports` (o un vecchio bundler) risalirebbe fino a
        // `src/index.ts`: TypeScript non compilato spedito a chi non se lo
        // aspetta. L'unica via di risoluzione pubblicata deve restare
        // `exports`.
        expect(PKG.main).toBeUndefined();
        expect(PKG.types).toBeUndefined();
    });

    it('tiene phaser fuori dalle dipendenze installate', () => {
        // Una seconda copia di Phaser produce due set di classi distinte:
        // `instanceof` falso e la factory registrata su un prototype che il
        // gioco ospite non vede mai.
        expect(PKG.dependencies).toBeUndefined();
        expect(PKG.peerDependencies.phaser).toBe('^4.0.0');
        expect(PKG.peerDependenciesMeta.phaser.optional).toBe(true);
    });

    it('non lascia il pacchetto interno fra le dipendenze pubblicate', () => {
        // `workspace:*` non si risolve sulla macchina di nessun altro.
        const pubbliche = { ...(PKG.dependencies ?? {}), ...(PKG.optionalDependencies ?? {}) };
        expect(Object.keys(pubbliche)).not.toContain('@iso-internal/core');
    });

    it('dichiara sideEffects false, che e lecito solo grazie alla registrazione nel costruttore', () => {
        expect(PKG.sideEffects).toBe(false);
    });

    it('porta i campi che npm mostra su un pacchetto open source', () => {
        expect(PKG.repository.url).toContain('github.com/VanniMnemonic/phaser-isometric');
        expect(PKG.bugs.url).toContain('/issues');
        expect(PKG.homepage).toContain('github.com');
        expect(PKG.description.length).toBeGreaterThan(40);
        expect(PKG.keywords).toContain('phaser');
        expect(PKG.keywords).toContain('isometric');
    });
});
