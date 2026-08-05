/**
 * The POST-publish gate: install `phaser-isometric` FROM THE REGISTRY into a
 * Vite+TS project created from scratch outside this monorepo, and check that
 * what npm actually served typechecks, bundles, and draws.
 *
 * Its twin is `verify-tarball.mjs`, which asks the same question of the tarball
 * we are about to publish. Both share `scripts/lib/virgin-project.mjs`, so the
 * two answers cannot drift apart.
 *
 * **Why this exists as a separate gate at all.** The pre-publish one proves the
 * bytes we built are good. It cannot prove those are the bytes the registry has:
 * npm normalises the manifest at publish time, a publish can be interrupted
 * half-way, a version can be published from the wrong directory, and `latest`
 * can point somewhere else entirely. Between "the tarball is correct" and "the
 * user gets a correct tarball" there is a network and a service, and only this
 * script crosses them.
 *
 * **It lives in the repo on purpose.** It imports `@playwright/test`, which Node
 * resolves from the FILE's location and not from the cwd — run it from a scratch
 * directory and the import fails. This is the third time it has been written;
 * the two previous copies were authored ad hoc and died with their session.
 *
 *     node scripts/verify-published.mjs            # the version in the manifest
 *     node scripts/verify-published.mjs 0.2.0      # any published version
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    creaProgettoVergine, installaDipendenzeDiContorno, run, verificaBin, verificaDisegna
} from './lib/virgin-project.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'packages/plugin');
const ETICHETTA = 'verify-published';

const versione = process.argv[2] ?? JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).version;

let dir;
try {
    console.log(`1/5  il registry conosce phaser-isometric@${versione}?`);
    // `npm view` e non l'install: se la versione non e' ancora propagata, deve
    // fallire QUI, con un messaggio che lo dice, invece che dentro un install
    // che ripiega su un'altra versione e produce un gate verde sull'artefatto
    // sbagliato.
    let vista;
    try {
        vista = JSON.parse(execFileSync(
            'npm', ['view', `phaser-isometric@${versione}`, 'version', 'dist.shasum', 'dist.tarball', '--json'],
            { encoding: 'utf8' }
        ));
    } catch (e) {
        throw new Error(
            `il registry non serve phaser-isometric@${versione}. Se hai appena pubblicato, la ` +
            `propagazione richiede qualche secondo; se non hai pubblicato, questo gate non ha niente ` +
            `da verificare.\n${e.stderr ?? e.message}`
        );
    }
    // `npm view` con piu' campi restituisce un oggetto; con uno solo, il valore
    // nudo. Chiedendone tre siamo sempre nel primo caso, ma il controllo resta
    // perche' il giorno in cui qualcuno ne toglie due, il fallimento deve essere
    // questo e non un `undefined` piu' avanti.
    if (typeof vista !== 'object' || vista === null) {
        throw new Error(`npm view ha restituito ${JSON.stringify(vista)}, atteso un oggetto`);
    }
    console.log(`     ${vista.version}  shasum=${vista['dist.shasum']}`);
    console.log(`     ${vista['dist.tarball']}`);

    // La riga che rende il gate una PROVA e non un sondaggio: lo shasum del
    // tarball pubblicato, stampato qui, e' confrontabile con quello che
    // `npm publish --dry-run` ha mostrato prima di pubblicare. Se coincidono,
    // cio' che e' uscito e' bit per bit cio' che era stato verificato — ed e' un
    // confronto che va fatto a occhio adesso, perche' il dry-run non lascia
    // traccia su disco.
    console.log('     confrontalo con lo shasum del dry-run in RELEASING.md');

    dir = creaProgettoVergine(ROOT, ETICHETTA);
    console.log(`2/5  progetto vergine in ${dir}`);

    console.log('3/5  install DAL REGISTRY');
    installaDipendenzeDiContorno(dir);
    run('npm', ['install', '--no-audit', '--no-fund', `phaser-isometric@${versione}`], dir);

    // Non e' pedanteria: `npm install pkg@X` puo' risolvere altro se X e' un
    // range, e un typo in argv verrebbe accettato in silenzio. Il gate deve
    // dichiarare quale artefatto ha davvero misurato.
    const installata = JSON.parse(readFileSync(
        join(dir, 'node_modules/phaser-isometric/package.json'), 'utf8'
    )).version;
    if (installata !== versione) {
        throw new Error(`npm ha installato ${installata}, non ${versione}`);
    }

    console.log('4/5  il bin risponde davvero, attraverso lo shim di npm');
    verificaBin(dir, versione);

    console.log('5/5  typecheck, build, e disegna');
    // Porta diversa da quella di verify-tarball: i due gate possono girare
    // nella stessa sessione, e `--strictPort` fa fallire il secondo invece di
    // fargli misurare il preview del primo.
    await verificaDisegna(dir, ROOT, ETICHETTA, 4320);

    console.log(`\nphaser-isometric@${versione} dal registry: installa, typechecka, builda e disegna.`);
} finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
}
