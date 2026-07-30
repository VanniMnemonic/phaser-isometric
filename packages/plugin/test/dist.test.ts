// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

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

    it('emette le tre entry', () => {
        const files = readdirSync(DIST);
        expect(files).toContain('index.js');
        expect(files).toContain('core.js');
        expect(files).toContain('debug.js');
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
        // condiviso e `index.js` da solo e' rimasto piccolo. Il pacchetto
        // reale oggi pesa poche decine di kB in totale; 300_000 lascia un
        // ordine di grandezza per crescere e coglie comunque Phaser con un
        // fattore ~18.
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
