import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(
    readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')
) as Record<string, any>;

/** Every file under `dir`, recursively, as paths relative to `dir` itself. */
function elencoRicorsivo(dir: string): string[] {
    const risultato: string[] = [];
    for (const voce of readdirSync(dir)) {
        const percorsoAssoluto = join(dir, voce);
        if (statSync(percorsoAssoluto).isDirectory()) {
            for (const figlio of elencoRicorsivo(percorsoAssoluto)) risultato.push(join(voce, figlio));
        } else {
            risultato.push(voce);
        }
    }
    return risultato;
}

describe('manifest di pubblicazione', () => {
    it('e pubblicabile', () => {
        expect(PKG.private).toBeUndefined();
        expect(PKG.version).toBe('0.2.0');
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

    it('il campo files espone solo dist, skills e llms.txt', () => {
        expect(new Set(PKG.files)).toEqual(new Set(['dist', 'skills', 'llms.txt']));
    });

    it('il bin si chiama come il pacchetto e vive dentro dist', () => {
        // Il nome e' cio' che `npx phaser-isometric` risolve: rinominarlo
        // rompe la riga che la documentazione promette, in silenzio.
        //
        // Il target NON porta il `./` che ogni voce di `exports` qui sopra ha
        // invece per obbligo. L'asimmetria e' voluta, ed e' stata misurata:
        // npm normalizza il bin in fase di publish
        // (@npmcli/package-json/lib/normalize.js, normalizePackageBin) e
        // riscrive `./dist/cli.js` in `dist/cli.js`. La riscrittura e' innocua
        // - il bin sopravvive, verificato eseguendo quel normalizzatore sul
        // nostro manifest - ma emette
        //     "bin[phaser-isometric]" script name dist/cli.js was invalid and removed
        // e quel messaggio e' una menzogna: la riga subito dopo il push del
        // warning fa `pkg.bin[base] = binTarget`, cioe' ASSEGNA. Nessuno lo
        // legge cosi' al primo colpo, e ha gia' fatto interrompere una
        // pubblicazione per capire se il pacchetto stesse uscendo senza CLI.
        // Tenendo il manifest gia' nella forma normalizzata, il warning non
        // scatta e cio' che pubblichiamo coincide con cio' che scriviamo.
        expect(PKG.bin).toEqual({ 'phaser-isometric': 'dist/cli.js' });

        // E deve stare DENTRO dist, perche' `files` qui sopra e' congelato a
        // tre voci: un bin in ./bin/ verrebbe dichiarato nel manifest e non
        // spedito nel tarball, e npm creerebbe un link penzolante all'install.
        // Questa e' l'asserzione che lega i due campi fra loro.
        for (const target of Object.values(PKG.bin as Record<string, string>)) {
            expect(target.startsWith('dist/'), `${target} e fuori da files`).toBe(true);
            expect(existsSync(resolve(PKG_DIR, target)), `${target} non esiste`).toBe(true);
        }
    });

    it('non spedisce file .ts, ma i sourcemap si\' - per scelta, non per svista', () => {
        // Task F6: questo test si chiamava "non spedisce sorgenti" ma
        // asseriva solo sul campo `files` sopra, mai sul contenuto reale di
        // `dist/`. Misurato: dist/*.js.map pesa 121.743 byte (42% del
        // tarball scompattato) e OGNI mappa porta il sorgente TypeScript
        // completo, verbatim, in `sourcesContent`. Spedire sourcemap per una
        // libreria e' una scelta legittima che questo repo mantiene di
        // proposito - uno stack trace dentro il gioco di qualcun altro vale
        // piu' dei byte che costa - ma deve essere una decisione registrata,
        // non un effetto collaterale, e il test non puo' affermare il
        // contrario di cio' che il tarball contiene davvero.
        const fileDist = elencoRicorsivo(resolve(PKG_DIR, 'dist'));

        const sorgentiTs = fileDist.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
        expect(sorgentiTs).toEqual([]);

        const sourcemap = fileDist.filter(f => f.endsWith('.js.map'));
        expect(sourcemap.length).toBeGreaterThan(0);
        for (const mappa of sourcemap) {
            const contenuto = JSON.parse(readFileSync(resolve(PKG_DIR, 'dist', mappa), 'utf8'));
            if (contenuto.sources.length > 0) {
                expect(Array.isArray(contenuto.sourcesContent), mappa).toBe(true);
                expect(contenuto.sourcesContent.length, mappa).toBe(contenuto.sources.length);
            }
        }
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
        // Task F7: il pacchetto vive in packages/plugin dentro il repo, non
        // alla radice. Senza `directory`, il link "Repository" che npm mostra
        // sulla pagina del pacchetto punta alla radice del monorepo invece
        // che alla sottocartella reale.
        expect(PKG.repository.directory).toBe('packages/plugin');
        expect(PKG.bugs.url).toContain('/issues');
        expect(PKG.homepage).toContain('github.com');
        expect(PKG.description.length).toBeGreaterThan(40);
        expect(PKG.keywords).toContain('phaser');
        expect(PKG.keywords).toContain('isometric');
    });
});
