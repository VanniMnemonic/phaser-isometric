/**
 * The PRE-publish gate: pack the package, install the tarball into a Vite+TS
 * project created from scratch OUTSIDE this monorepo, typecheck it, bundle it,
 * and open the bundle in Chromium to check it actually draws.
 *
 * Its twin is `verify-published.mjs`, which asks the same question of what the
 * REGISTRY actually served. Everything the two share lives in
 * `scripts/lib/virgin-project.mjs`: the only difference between them is where
 * the package comes from, and two copies of "does the installed package draw?"
 * would answer differently the first time either was touched.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    creaProgettoVergine, installaDipendenzeDiContorno, run, verificaBin, verificaDisegna
} from './lib/virgin-project.mjs';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'packages/plugin');
const ETICHETTA = 'verify-tarball';

// Fix round 1 — Finding 1: i passi corrono tutti dentro UN SOLO try/finally,
// cosi' un fallimento a un passo qualsiasi (non solo all'ultimo, dove il
// preview parte) non lascia ne' il tarball di `pnpm pack` ne' la cartella
// temporanea del progetto vergine sul disco. `*.tgz` e' anche in .gitignore
// come difesa in profondita': niente deve poter finire in un commit nemmeno
// per errore umano.
let tarball;
let dir;
try {
    console.log('1/7  build');
    run('pnpm', ['build'], ROOT);

    console.log('2/7  pack');
    run('pnpm', ['pack', '--pack-destination', PLUGIN], PLUGIN);
    tarball = readdirSync(PLUGIN).find(f => f.startsWith('phaser-isometric-') && f.endsWith('.tgz'));
    if (!tarball) throw new Error('pnpm pack non ha prodotto alcun tarball');

    // npm normalizza il manifest quando pubblica, e ogni riscrittura esce come
    // `npm warn publish`. Nessun altro passo di questo gate la vede: `pnpm pack`
    // non applica quella normalizzazione, quindi il tarball qui sopra puo'
    // essere perfetto mentre cio' che finisce sul registry ha un campo diverso
    // da quello che abbiamo scritto e testato.
    //
    // Il caso che ha motivato il controllo: un `bin` dichiarato `./dist/cli.js`
    // veniva riscritto in `dist/cli.js` con il messaggio «script name
    // dist/cli.js was invalid and removed». Il bin sopravviveva — il testo del
    // warning e' sbagliato, npm assegna il valore normalizzato invece di
    // rimuoverlo — ma per stabilirlo e' servito leggere il sorgente di npm a
    // pubblicazione interrotta a meta'. Qualunque riscrittura futura deve
    // fallire qui, dove c'e' tempo per leggerla, e non fra settanta righe di
    // elenco file durante il publish.
    //
    // Si legge lo STDERR, non l'exit code: `--dry-run` esce 0 anche riscrivendo.
    console.log('3/7  npm non riscrive il manifest in pubblicazione');
    const dryRun = spawnSync('npm', ['publish', '--dry-run'], { cwd: PLUGIN, encoding: 'utf8' });
    if (dryRun.status !== 0) {
        throw new Error(`npm publish --dry-run e' uscito con ${dryRun.status}:\n${dryRun.stderr}`);
    }
    const riscritture = (dryRun.stderr ?? '')
        .split('\n')
        .filter(riga => riga.includes('npm warn publish'));
    if (riscritture.length > 0) {
        throw new Error(
            'npm riscriverebbe il manifest pubblicato: cio che finisce sul registry non e\n'
            + 'cio che i test di packaging hanno verificato. Allinea package.json alla forma\n'
            + 'normalizzata ("npm pkg fix") invece di silenziare il warning.\n\n'
            + riscritture.join('\n')
        );
    }

    // Lo shasum che il dry-run calcola vive nel suo STDERR, che questo gate
    // cattura per cercarci le riscritture — quindi senza questa riga non lo
    // vedrebbe nessuno. E' il numero che `verify-published.mjs` ristampa
    // dal registry dopo la pubblicazione: se i due coincidono, cio' che e'
    // uscito e' bit per bit cio' che questo gate ha appena verificato.
    // Annotalo: il dry-run non lascia traccia su disco.
    const shasum = (dryRun.stderr ?? '').split('\n').find(riga => riga.includes('shasum:'));
    if (shasum) console.log(`     ${shasum.replace(/^npm notice\s*/, '').trim()}   <-- annotalo per verify:published`);

    dir = creaProgettoVergine(ROOT, ETICHETTA);
    console.log(`4/7  progetto vergine in ${dir}`);

    console.log('5/7  install');
    installaDipendenzeDiContorno(dir);
    run('npm', ['install', '--no-audit', '--no-fund', join(PLUGIN, tarball)], dir);

    console.log('6/7  il bin risponde davvero, attraverso lo shim di npm');
    const versione = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).version;
    verificaBin(dir, versione);

    console.log('7/7  typecheck, build, e disegna');
    await verificaDisegna(dir, ROOT, ETICHETTA, 4319);
    console.log(`\nprogetto in ${dir}`);
} finally {
    if (tarball) rmSync(join(PLUGIN, tarball), { force: true });
    // Fix round 1 — Minor: il reviewer ne ha trovate sette accumulate in /tmp
    // perche' nessuno la rimuoveva mai.
    if (dir) rmSync(dir, { recursive: true, force: true });
}
