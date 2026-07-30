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

console.log('1/6  build');
run('pnpm', ['build'], ROOT);

console.log('2/6  pack');
run('pnpm', ['pack', '--pack-destination', PLUGIN], PLUGIN);
const tarball = readdirSync(PLUGIN).find(f => f.startsWith('phaser-isometric-') && f.endsWith('.tgz'));
if (!tarball) throw new Error('pnpm pack non ha prodotto alcun tarball');

const dir = mkdtempSync(join(tmpdir(), 'phaser-iso-virgin-'));
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
const preview = spawn(
    'npx', ['vite', 'preview', '--port', '4319', '--strictPort'],
    { cwd: dir, stdio: 'ignore', detached: false }
);
try {
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
    // legge un buffer già ripulito, azzerando sistematicamente il conteggio
    // dei colori anche quando il pacchetto disegna correttamente — un falso
    // negativo del gate stesso, non del pacchetto installato.
    const distinti = await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const canvas = document.querySelector('canvas');
                const copia = document.createElement('canvas');
                copia.width = canvas.width; copia.height = canvas.height;
                const ctx = copia.getContext('2d');
                ctx.drawImage(canvas, 0, 0);
                const data = ctx.getImageData(0, 0, copia.width, copia.height).data;
                const colori = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    colori.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                resolve(colori.size);
            });
        });
    }));

    await browser.close();
    // Uno solo significa canvas uniforme: o non ha disegnato, o ha disegnato
    // lo sfondo. Due o piu' significa che sopra c'e' qualcosa.
    if (distinti < 2) throw new Error(`il canvas ha ${distinti} colore/i distinti: non ha disegnato`);
    console.log(`\nGATE PASSATO — ${distinti} colori distinti sul canvas, progetto in ${dir}`);
} finally {
    preview.kill('SIGTERM');
    rmSync(join(PLUGIN, tarball), { force: true });
}
