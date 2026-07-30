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
    const { fuoriModa, totale, dominante } = await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const canvas = document.querySelector('canvas');
                const copia = document.createElement('canvas');
                copia.width = canvas.width; copia.height = canvas.height;
                const ctx = copia.getContext('2d');
                ctx.drawImage(canvas, 0, 0);
                const { width, height } = copia;
                const data = ctx.getImageData(0, 0, width, height).data;

                // Fix round 1 — Finding 2, seconda stesura. La prima stesura
                // stabiliva lo sfondo dai quattro angoli del canvas; misurato
                // a mano sul Quick Start reale, e' falso per questa stessa
                // scena: la telecamera inquadra il pavimento isometrico fin
                // dentro due dei quattro angoli (angoli in alto rgb(17,20,26)
                // = sfondo, angoli in basso rgb(61,90,128) = tile), quindi la
                // media dei quattro angoli produce un grigio-blu (39,55,77)
                // che non e' il colore di nessun pixel reale, e ogni pixel
                // vero (sfondo o tile) se ne discosta: il conteggio saliva al
                // 100% per il motivo sbagliato. Il colore DOMINANTE per
                // superficie occupata regge qualunque inquadratura, non solo
                // questa: e' quello che davvero rappresenta "non e' successo
                // niente qui" quando il canvas e' per lo piu' uniforme.
                const conteggi = new Map();
                for (let i = 0; i < data.length; i += 4) {
                    const chiave = `${data[i]},${data[i + 1]},${data[i + 2]}`;
                    conteggi.set(chiave, (conteggi.get(chiave) ?? 0) + 1);
                }
                let dominante = null;
                let dominanteConteggio = -1;
                for (const [chiave, n] of conteggi) {
                    if (n > dominanteConteggio) {
                        dominante = chiave.split(',').map(Number);
                        dominanteConteggio = n;
                    }
                }

                // Non "esiste un secondo valore RGB" — un solo pixel
                // antialiasato basterebbe a produrne uno e farebbe passare
                // il gate anche su un pacchetto rotto. Si conta quanti pixel
                // si scostano davvero dal colore dominante, su almeno un
                // canale, oltre una soglia che una sfumatura di compressione
                // o antialiasing non supera.
                const DELTA = 20;
                let fuoriModa = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const dr = Math.abs(data[i] - dominante[0]);
                    const dg = Math.abs(data[i + 1] - dominante[1]);
                    const db = Math.abs(data[i + 2] - dominante[2]);
                    if (dr > DELTA || dg > DELTA || db > DELTA) fuoriModa += 1;
                }
                resolve({ fuoriModa, totale: width * height, dominante });
            });
        });
    }));

    await browser.close();

    // La soglia e' una FRAZIONE dell'area disegnata, non l'esistenza di un
    // secondo valore RGB qualsiasi: un bordo antialiasato futuro resta ben
    // sotto l'uno per cento del canvas, mentre un pacchetto che disegna
    // davvero il Quick Start lo supera con ampio margine (numero misurato
    // in task-12-report.md).
    const SOGLIA_FRAZIONE = 0.01;
    const frazione = fuoriModa / totale;
    console.log(
        `\n${fuoriModa}/${totale} pixel fuori dal colore dominante (${(frazione * 100).toFixed(3)}%), ` +
        `dominante rilevato rgb(${dominante.join(',')}), soglia ${(SOGLIA_FRAZIONE * 100)}%`
    );
    if (frazione < SOGLIA_FRAZIONE) {
        throw new Error(
            `solo ${(frazione * 100).toFixed(3)}% di pixel fuori dal colore dominante ` +
            `(soglia ${(SOGLIA_FRAZIONE * 100)}%): non ha disegnato`
        );
    }
    console.log(`\nGATE PASSATO — ${fuoriModa}/${totale} pixel fuori dal colore dominante (${(frazione * 100).toFixed(2)}%), progetto in ${dir}`);
} finally {
    if (preview) preview.kill('SIGTERM');
    if (tarball) rmSync(join(PLUGIN, tarball), { force: true });
    // Fix round 1 — Minor: il reviewer ne ha trovate sette accumulate in
    // /tmp perche' nessuno la rimuoveva mai.
    if (dir) rmSync(dir, { recursive: true, force: true });
}
