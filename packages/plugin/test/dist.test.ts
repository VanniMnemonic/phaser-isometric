// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const PLUGIN_ROOT = resolve(DIST, '..');
const REPO_ROOT = resolve(DIST, '../../..');
const TSC_BIN = join(REPO_ROOT, 'node_modules/.bin/tsc');

/**
 * Riconosce un import ESM di "phaser", esterno o interno che sia. NON ancorato
 * a "from": `index.ts` importa il default binding (`import Phaser from
 * "phaser"`), ma `debug.ts` usa `Phaser` solo come TIPO — nessun binding e'
 * referenziato a runtime — quindi Rollup lo emette come import di solo
 * effetto collaterale, `import "phaser";`, senza la parola "from". Un regex
 * ancorato a "from" perderebbe silenziosamente questa forma, sia per
 * confermarne la presenza sia per escluderla.
 *
 * ANCORATO a inizio riga (`^` con flag `m`): senza questo, la stessa regex
 * corrisponde anche dentro un commento (`// import "phaser" is external`) o
 * dentro un letterale di stringa (`'you must import "phaser" yourself'`) — e
 * la build usa `minify: false` apposta perche' gli stack trace restino
 * leggibili, quindi i commenti JSDoc sopravvivono per davvero in dist/. Un
 * refactor che togliesse l'import vero lasciando in giro un commento o un
 * messaggio con quella sottostringa renderebbe l'asserzione verde su una
 * build sbagliata. Nell'output ESM non minificato di Rollup un import vero
 * sta sempre a inizio riga; un commento comincia con `//` o `*`, un
 * letterale con un apice — l'ancora esclude tutti e tre.
 */
const EXTERNAL_PHASER_IMPORT = /^import\s*(?:[\w*{},\s]*\sfrom\s*)?["']phaser["']/m;

/**
 * Concatena il sorgente di una entry e di ogni chunk che raggiunge, seguendo
 * gli import relativi. Serve a chiedere "questa entry PAGA quel codice?", una
 * domanda che leggere il solo file di entry non puo' rispondere: Rollup mette
 * il grosso nei chunk condivisi, quindi una entry piccola non e' una entry
 * economica.
 */
function grafo(entry: string): { testo: string; files: string[] } {
    const visti = new Set<string>();
    const pezzi: string[] = [];
    const cammina = (nome: string): void => {
        if (visti.has(nome)) return;
        visti.add(nome);
        const src = readFileSync(join(DIST, nome), 'utf8');
        pezzi.push(src);
        for (const m of src.matchAll(/from\s*"(\.\/[^"]+)"/g)) {
            cammina((m[1] as string).slice(2));
        }
    };
    cammina(entry);
    // `files` non e' diagnostica: e' cio' che rende verificabile che la
    // camminata sia avvenuta. Senza, un'asserzione negativa sul testo e' vera
    // anche quando il walker non ha seguito un solo import.
    return { testo: pezzi.join('\n'), files: [...visti] };
}

/**
 * Questi test leggono l'output di `pnpm build:js`. Se dist non c'e', devono
 * FALLIRE con un messaggio che lo dice — non essere saltati: un `it.skipIf`
 * qui renderebbe verde una suite che non ha verificato la build.
 */
describe('output della build', () => {
    beforeAll(() => {
        expect(
            existsSync(DIST),
            'packages/plugin/dist non esiste: esegui `pnpm build:js` prima della suite'
        ).toBe(true);
    });

    it('emette le quattro entry', () => {
        const files = readdirSync(DIST);
        expect(files).toContain('index.js');
        expect(files).toContain('core.js');
        expect(files).toContain('debug.js');
        // cli.js non ha un sottopath in exports: e' il target di `bin`, e il
        // suo unico modo di esistere per un consumatore e' questo file.
        expect(files).toContain('cli.js');
    });

    it('cli.js non tira dentro phaser', () => {
        // Il peer e' `optional`, quindi "installato senza phaser" e' un caso
        // normale, non un incidente: una CLI che importasse phaser fallirebbe
        // proprio li'. E il dossier e' matematica pura, non ne ha bisogno.
        expect(readFileSync(join(DIST, 'cli.js'), 'utf8')).not.toMatch(EXTERNAL_PHASER_IMPORT);
    });

    it('lascia phaser esterno in ogni entry che lo usa', () => {
        // core.js non deve nominare phaser affatto: quel caso ha un test suo
        // sotto ("core.js non tira dentro phaser"), qui restano le due entry
        // che phaser lo usano davvero.
        for (const name of ['index.js', 'debug.js']) {
            const src = readFileSync(join(DIST, name), 'utf8');
            expect(src, `${name} non importa phaser come modulo esterno`).toMatch(EXTERNAL_PHASER_IMPORT);
        }

        // Un marcatore letterale (una stringa di versione, un simbolo interno
        // come 'PhaserGlobal') smette di corrispondere al primo refactor o
        // bump di Phaser, e a quel punto un `not.toContain` torna vero per
        // costruzione senza dirlo a nessuno. La dimensione totale non ha
        // questo problema, e coglie Phaser ovunque finisca — entry o chunk
        // condiviso, come ha dimostrato il preflight di mutazione: senza
        // `external`, Rollup ha spostato i ~5.4 MB di Phaser in un chunk
        // condiviso e `index.js` da solo e' rimasto piccolo.
        //
        // MISURATO il 2026-07-31, dieci file: 57.326 byte in totale, di cui
        // 11.974 la CLI aggiunta in 0.2.0 e 22.398 index.js. Margine 5,2x
        // contro questo budget, e ~94x sotto i 5,4 MB di Phaser: il numero
        // resta lo stesso, cambia solo il margine, e va rimisurato invece che
        // riscritto a parole ogni volta che si aggiunge una entry.
        const totalBytes = readdirSync(DIST)
            .filter(f => f.endsWith('.js'))
            .reduce((sum, f) => sum + readFileSync(join(DIST, f), 'utf8').length, 0);
        expect(totalBytes).toBeLessThan(300_000);
    });

    it('non lascia specifier interni da risolvere al consumatore', () => {
        for (const f of readdirSync(DIST).filter(n => n.endsWith('.js'))) {
            const src = readFileSync(join(DIST, f), 'utf8');
            expect(src, `${f} nomina ancora il pacchetto interno`).not.toContain('@iso-internal/core');
        }
    });

    it('core.js non tira dentro phaser', () => {
        const core = readFileSync(join(DIST, 'core.js'), 'utf8');
        // Il core gira in Node: e' l'intera ragione per cui esiste come
        // sottopath, ed e' cio' che l'oracolo MCP del Piano 4 importera'.
        expect(core).not.toMatch(EXTERNAL_PHASER_IMPORT);
    });

    it('il bundle che ogni gioco impacchetta non paga la CLI', () => {
        const daIndex = grafo('index.js');
        const daCli = grafo('cli.js');

        // ANTI-VACUITA' PRIMA, e non come coda. La prima stesura di questo
        // test metteva la meta' positiva in fondo e usava `buildDiagnosis`
        // come sonda: il preflight l'ha uccisa. Rompendo la regex del walker
        // restavano dodici test verdi, perche' `grafo` legge comunque il file
        // di partenza e `cli.js` nomina `buildDiagnosis` nella propria riga di
        // import — la positiva passava senza che si fosse camminato di un
        // passo, e con lei la negativa qui sotto.
        expect(daIndex.files.length, 'il walker non ha seguito nessun import da index.js')
            .toBeGreaterThan(1);
        expect(daCli.files, 'il walker non ha raggiunto il chunk della diagnosi')
            .toContain('chunk-diagnosis.js');

        // La sonda vive SOLO dentro chunk-diagnosis.js, quindi trovarla e'
        // possibile unicamente avendo attraversato il grafo.
        //
        // Il fatto verificato: `buildDiagnosis` sta nel core e NON e'
        // ri-esportato da src/index.ts, come gia' buildDebugModel. Se qualcuno
        // lo aggiungesse, ogni gioco comincerebbe a spedire nel proprio bundle
        // un dossier che serve solo alla riga di comando.
        expect(daIndex.testo).not.toContain('fractional-tile-centres');
        expect(daCli.testo).toContain('fractional-tile-centres');
    });

    it('le entry condividono UNA sola istanza del core', async () => {
        const dalPlugin = await import(join(DIST, 'index.js'));
        const dalCore = await import(join(DIST, 'core.js'));
        // Stessa identita' di classe, non solo stesso nome: se Rollup avesse
        // duplicato il core in due bundle, un IsoConfigError lanciato dal
        // plugin fallirebbe un `instanceof` fatto contro quello del core, e
        // il fallimento arriverebbe al consumatore, non a noi.
        expect(dalPlugin.IsoConfigError).toBe(dalCore.IsoConfigError);
    });
});

/**
 * Stessa ragione del `beforeAll` di "output della build", per l'altra meta'
 * dell'artefatto: senza dist/types questi test fallirebbero comunque, ma con
 * un ENOENT da readFileSync che nomina un percorso temporaneo invece del
 * comando da eseguire. Un rosso che non dice cosa fare costa lo stesso tempo
 * di un rosso silenzioso.
 */
function esigiTipiEmessi(T: string): void {
    expect(
        existsSync(T),
        `${T} non esiste: esegui \`pnpm build:types\` (o \`pnpm build\`) prima della suite`
    ).toBe(true);
}

describe('tipi pubblicati', () => {
    const T = join(DIST, 'types');

    beforeAll(() => esigiTipiEmessi(T));

    it('emette le tre dichiarazioni di entry', () => {
        expect(existsSync(join(T, 'plugin/index.d.ts'))).toBe(true);
        expect(existsSync(join(T, 'plugin/debug.d.ts'))).toBe(true);
        expect(existsSync(join(T, 'core/index.d.ts'))).toBe(true);
    });

    it('porta con se l augmentation globale, non solo il riferimento', () => {
        const index = readFileSync(join(T, 'plugin/index.d.ts'), 'utf8');
        expect(index).toContain('phaser-augment.d.ts');
        // Il riferimento senza il file e' peggio del file senza il
        // riferimento: compila, e ogni `this.iso` del consumatore diventa un
        // TS2339 senza che nulla dica perche'.
        expect(existsSync(join(T, 'plugin/phaser-augment.d.ts'))).toBe(true);
        const aug = readFileSync(join(T, 'plugin/phaser-augment.d.ts'), 'utf8');
        expect(aug).toContain('declare global');
        expect(aug).not.toContain("declare module 'phaser'");
    });

    it('non lascia specifier interni nei tipi', () => {
        for (const f of allDts(T)) {
            expect(readFileSync(f, 'utf8'), `${f}`).not.toContain('@iso-internal/core');
        }
    });
});

/**
 * Il test precedente ("porta con se l augmentation globale") fa un
 * `toContain('phaser-augment.d.ts')`: verifica che la sottostringa compaia da
 * qualche parte nel file, non che compaia come direttiva triple-slash IN
 * CIMA. TypeScript onora `/// <reference path=... />` SOLO se precede
 * qualunque altra istruzione — una riga identica spostata in fondo al file,
 * dopo gli `export`, e' testo morto: la sottostringa c'e' ancora (quel test
 * resterebbe verde), ma il compilatore di un consumatore non la processa piu'
 * e l'augmentation smette di raggiungerlo. Da qui i due test sotto: uno
 * strutturale e veloce che pinna la POSIZIONE esatta, uno funzionale che
 * pinna l'EFFETTO compilando una sonda vera.
 */
describe('la direttiva del reference funziona, non solo compare', () => {
    const T = join(DIST, 'types');

    beforeAll(() => esigiTipiEmessi(T));

    it('la riga di reference e la prima riga esatta di index.d.ts', () => {
        const index = readFileSync(join(T, 'plugin/index.d.ts'), 'utf8');
        const firstLine = index.split('\n')[0];
        expect(firstLine).toBe('/// <reference path="./phaser-augment.d.ts" />');
    });

    it('un consumatore vero compila this.iso e this.add.isoSprite senza errori', () => {
        // Sonda TypeScript reale, in una cartella temporanea sotto
        // packages/plugin (cosi' la risoluzione dei moduli, che risale
        // l'albero delle directory, trova "phaser" nello stesso node_modules
        // che vedrebbe un consumatore vero — non serve mappare anche quello).
        // "phaser-isometric" e' invece mappato a mano sui .d.ts EMESSI: e'
        // quello il pacchetto che vogliamo verificare, non i sorgenti.
        const probeDir = mkdtempSync(join(PLUGIN_ROOT, '.typecheck-probe-'));
        try {
            const packageEntry = relative(probeDir, join(T, 'plugin/index')).replace(/\\/g, '/');

            writeFileSync(
                join(probeDir, 'tsconfig.json'),
                JSON.stringify(
                    {
                        compilerOptions: {
                            target: 'ES2020',
                            module: 'ESNext',
                            moduleResolution: 'bundler',
                            strict: true,
                            noEmit: true,
                            // I tipi di Phaser non superano da soli uno
                            // skipLibCheck: false, ne' in 4.0.0 ne' in 4.2.1:
                            // qui vogliamo verificare LA NOSTRA augmentation,
                            // non fare da linter ai tipi di una dipendenza.
                            skipLibCheck: true,
                            baseUrl: '.',
                            paths: { 'phaser-isometric': [packageEntry] }
                        },
                        include: ['probe.ts']
                    },
                    null,
                    2
                )
            );

            // Esercita ENTRAMBE le meta' dell'augmentation: sono due
            // dichiarazioni distinte (Phaser.Scene.iso e
            // Phaser.GameObjects.GameObjectFactory.isoSprite) e una puo'
            // rompersi senza l'altra.
            writeFileSync(
                join(probeDir, 'probe.ts'),
                [
                    "import Phaser from 'phaser';",
                    "import type { IsoPlugin, IsoSprite } from 'phaser-isometric';",
                    '',
                    'class ProbeScene extends Phaser.Scene {',
                    '    checkScenePlugin(): IsoPlugin {',
                    '        return this.iso;',
                    '    }',
                    '',
                    '    checkFactory(): IsoSprite {',
                    "        return this.add.isoSprite(0, 0, 'tex');",
                    '    }',
                    '}',
                    '',
                    'void ProbeScene;',
                    ''
                ].join('\n')
            );

            const result = spawnSync(TSC_BIN, ['--noEmit', '-p', probeDir], {
                cwd: PLUGIN_ROOT,
                encoding: 'utf8'
            });

            expect(result.status, `tsc contro la sonda:\n${result.stdout}${result.stderr}`).toBe(0);
        } finally {
            rmSync(probeDir, { recursive: true, force: true });
        }
    });
});

function allDts(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...allDts(full));
        else if (full.endsWith('.d.ts')) out.push(full);
    }
    return out;
}
