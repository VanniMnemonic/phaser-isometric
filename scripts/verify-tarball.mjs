/**
 * The stage-5 exit gate: pack the package, install the tarball into a Vite+TS
 * project created from scratch OUTSIDE this monorepo, typecheck it, bundle it,
 * and open the bundle in Chromium to check it actually draws.
 *
 * Outside the monorepo on purpose: inside it, pnpm resolves the package to the
 * workspace whatever the exports map says, so a packaging mistake would stay
 * invisible right up to the first user.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'packages/plugin');

function run(cmd, args, cwd) {
    console.log(`\n$ ${cmd} ${args.join(' ')}   (${cwd})`);
    execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// Fix round 1 — Finding 1: i sei passi corrono tutti dentro UN SOLO
// try/finally, cosi' un fallimento a un passo qualsiasi (non solo al 6/6,
// dove il preview parte) non lascia ne' il tarball di `pnpm pack` ne' la
// cartella temporanea del progetto vergine sul disco. `*.tgz` e' anche in
// .gitignore come difesa in profondita': niente deve poter finire in un
// commit nemmeno per errore umano.
let tarball;
let dir;
let preview;
try {
    console.log('1/6  build');
    run('pnpm', ['build'], ROOT);

    console.log('2/6  pack');
    run('pnpm', ['pack', '--pack-destination', PLUGIN], PLUGIN);
    tarball = readdirSync(PLUGIN).find(f => f.startsWith('phaser-isometric-') && f.endsWith('.tgz'));
    if (!tarball) throw new Error('pnpm pack non ha prodotto alcun tarball');

    dir = mkdtempSync(join(tmpdir(), 'phaser-iso-virgin-'));
    console.log(`3/6  progetto vergine in ${dir}`);

    writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'virgin', private: true, version: '0.0.0', type: 'module'
    }, null, 2));

    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            lib: ['ES2020', 'DOM'],
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            // Dichiarato per nome: i tipi di Phaser non typecheckano da soli, ne'
            // in 4.0.0 ne' in 4.2.1. Senza, il gate fallisce per colpa di Phaser.
            skipLibCheck: true,
            // Il default della maggior parte dei progetti reali, ed e' quello che
            // fa emergere la trappola numero uno.
            useDefineForClassFields: true
        },
        include: ['src']
    }, null, 2));

    writeFileSync(join(dir, 'index.html'),
        '<!doctype html><html><body style="margin:0"><div id="game"></div>' +
        '<script type="module" src="/src/main.ts"></script></body></html>');

    // La scena e' il Quick Start della documentazione, alla lettera: se il Quick
    // Start non compila o non disegna, questo gate diventa rosso. E' l'unico modo
    // per cui un esempio nella documentazione non puo' invecchiare in silenzio.
    mkdirSync(join(dir, 'src'));
    cpSync(join(ROOT, 'examples/quickstart/src/main.ts'), join(dir, 'src/main.ts'));

    console.log('4/6  install');
    run('npm', ['install', '--no-audit', '--no-fund', 'phaser@4.2.1', 'vite@^7.3.6', 'typescript@~5.7.2'], dir);
    run('npm', ['install', '--no-audit', '--no-fund', join(PLUGIN, tarball)], dir);

    console.log('5/6  typecheck e build');
    run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], dir);
    run('npx', ['vite', 'build'], dir);

    console.log('6/6  disegna davvero?');
    preview = spawn(
        'npx', ['vite', 'preview', '--port', '4319', '--strictPort'],
        { cwd: dir, stdio: 'ignore', detached: false }
    );

    const browser = await chromium.launch();
    const page = await browser.newPage();
    let ok = false;
    for (let tentativo = 0; tentativo < 30 && !ok; tentativo += 1) {
        try { await page.goto('http://localhost:4319/', { timeout: 1000 }); ok = true; }
        catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ok) throw new Error('vite preview non ha risposto');

    await page.waitForSelector('canvas', { timeout: 10_000 });

    // La lettura dei pixel DEVE avvenire nello stesso callback rAF che
    // aspetta il render: il canvas WebGL di Phaser ha preserveDrawingBuffer
    // false per default, quindi il drawing buffer viene svuotato dal
    // browser subito dopo ogni compositing. Una seconda chiamata separata a
    // page.evaluate() dopo l'attesa arriva un frame (o piu') più tardi e
    // legge un buffer gia' ripulito, azzerando sistematicamente il conteggio
    // anche quando il pacchetto disegna correttamente — un falso negativo
    // del gate stesso, non del pacchetto installato. Questa parte e' la
    // correzione gia' rivista e confermata: non toccarla.
    const { fuoriSfondo, totale } = await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const canvas = document.querySelector('canvas');
                const copia = document.createElement('canvas');
                copia.width = canvas.width; copia.height = canvas.height;
                const ctx = copia.getContext('2d');
                ctx.drawImage(canvas, 0, 0);
                const { width, height } = copia;
                const data = ctx.getImageData(0, 0, width, height).data;

                // Revisione finale — Finding F1. La stesura precedente
                // contava i pixel che si scostano dal colore DOMINANTE per
                // superficie occupata. Misurato sul Quick Start reale, quel
                // dominante e' rgb(61,90,128) = il colore del TILE, che
                // copre l'85% del canvas — non lo sfondo. L'asserzione
                // leggeva quindi "almeno l'1% del canvas non e' tile-
                // colored", ed e' rovesciata: una scena che disegnasse PIU'
                // pavimento farebbe scendere la frazione di sfondo residuo,
                // e un pacchetto sano sopra il 99% di copertura diventerebbe
                // rosso. Lo strumento corretto e' quello gia' in uso su
                // questa stessa identica scena in
                // examples/e2e/from-docs.spec.ts: uno sfondo LETTERALE, non
                // inferito dal canvas. Il game config del Quick Start
                // (copiato pari pari da examples/quickstart/src/main.ts,
                // riga 60) fissa backgroundColor: '#11141a' = rgb(17,20,26);
                // il margine sotto assorbe compressione e antialiasing,
                // stessa scatola RGB del test Playwright gemello.
                const SFONDO = { rMax: 40, gMax: 45, bMax: 55 };
                let fuoriSfondo = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const dentroSfondo =
                        data[i] <= SFONDO.rMax &&
                        data[i + 1] <= SFONDO.gMax &&
                        data[i + 2] <= SFONDO.bMax;
                    if (!dentroSfondo) fuoriSfondo += 1;
                }
                resolve({ fuoriSfondo, totale: width * height });
            });
        });
    }));

    await browser.close();

    // La soglia e' una FRAZIONE dell'area disegnata SOPRA lo sfondo noto,
    // non lo scostamento da un colore inferito dal canvas stesso: misurato
    // sul Quick Start reale, il pavimento e gli sprite coprono circa l'85%
    // del canvas (vedi task-13-report.md), ben al di sopra della soglia
    // scelta qui sotto; un pacchetto che non disegna nulla lascia il canvas
    // interamente dentro la scatola di sfondo, 0% fuori.
    const SOGLIA_FRAZIONE = 0.10;
    const frazione = fuoriSfondo / totale;
    console.log(
        `\n${fuoriSfondo}/${totale} pixel fuori dallo sfondo #11141a (${(frazione * 100).toFixed(3)}%), ` +
        `soglia ${(SOGLIA_FRAZIONE * 100)}%`
    );
    if (frazione < SOGLIA_FRAZIONE) {
        throw new Error(
            `solo ${(frazione * 100).toFixed(3)}% di pixel fuori dallo sfondo ` +
            `(soglia ${(SOGLIA_FRAZIONE * 100)}%): non ha disegnato`
        );
    }
    console.log(`\nGATE PASSATO — ${fuoriSfondo}/${totale} pixel fuori dallo sfondo (${(frazione * 100).toFixed(2)}%), progetto in ${dir}`);
} finally {
    if (preview) preview.kill('SIGTERM');
    if (tarball) rmSync(join(PLUGIN, tarball), { force: true });
    // Fix round 1 — Minor: il reviewer ne ha trovate sette accumulate in
    // /tmp perche' nessuno la rimuoveva mai.
    if (dir) rmSync(dir, { recursive: true, force: true });
}
