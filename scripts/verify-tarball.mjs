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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'packages/plugin');

// Condiviso con examples/e2e/from-docs.spec.ts: due gate che chiedono "ha
// disegnato qualcosa?" devono chiederlo nelle stesse unita'. Vedi il campo
// _purpose del file per il perche'.
const SFONDO_SCENA = JSON.parse(readFileSync(join(ROOT, 'examples/scene-background.json'), 'utf8'));

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
    console.log('1/7  build');
    run('pnpm', ['build'], ROOT);

    console.log('2/7  pack');
    run('pnpm', ['pack', '--pack-destination', PLUGIN], PLUGIN);
    tarball = readdirSync(PLUGIN).find(f => f.startsWith('phaser-isometric-') && f.endsWith('.tgz'));
    if (!tarball) throw new Error('pnpm pack non ha prodotto alcun tarball');

    dir = mkdtempSync(join(tmpdir(), 'phaser-iso-virgin-'));
    console.log(`3/7  progetto vergine in ${dir}`);

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
        '<script type="module" src="/src/entry.ts"></script></body></html>');

    // La scena e' il Quick Start della documentazione, alla lettera: se il Quick
    // Start non compila o non disegna, questo gate diventa rosso. E' l'unico modo
    // per cui un esempio nella documentazione non puo' invecchiare in silenzio.
    mkdirSync(join(dir, 'src'));
    const quickstart = readFileSync(join(ROOT, 'examples/quickstart/src/main.ts'), 'utf8');
    cpSync(join(ROOT, 'examples/quickstart/src/main.ts'), join(dir, 'src/main.ts'));

    // La scatola condivisa e' utile solo finche' descrive DAVVERO questa scena.
    // Senza questo controllo, cambiare il colore di sfondo del Quick Start
    // lascerebbe il gate del passo 6 a misurare "non #11141a" su un canvas che
    // di #11141a non ha piu' un pixel: 100% fuori sfondo, verde che non
    // significa niente.
    if (!quickstart.includes(`backgroundColor: '${SFONDO_SCENA.hex}'`)) {
        throw new Error(
            `examples/quickstart/src/main.ts non dichiara piu' backgroundColor: '${SFONDO_SCENA.hex}'. ` +
            'Aggiorna examples/scene-background.json, che e\' la sorgente condivisa con from-docs.spec.ts.'
        );
    }

    // Il Quick Start esercita SOLO la entry radice. `./core` e `./debug` sono
    // due sottopath della mappa exports che nessun altro passo di questo gate
    // toccherebbe: un `types` sbagliato passerebbe la build e un `import`
    // sbagliato passerebbe il typecheck, ognuno invisibile all'altro. Questo
    // file li importa entrambi e ne usa il risultato a runtime, cosi' il passo
    // 5 li verifica con tsc E con vite, e il bundler non puo' eliderli prima.
    writeFileSync(join(dir, 'src/entry.ts'), [
        "import { createProjection } from 'phaser-isometric/core';",
        "import { createIsoDebug } from 'phaser-isometric/debug';",
        "import './main';",
        '',
        "// Round trip esatto: e' la proprieta' portante del core, e usarla qui",
        '// prova che il chunk condiviso e\' arrivato integro nel pacchetto, non',
        '// solo che il file esiste.',
        "const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });",
        'const s = p.project(3, 5);',
        'const back = p.unproject(s.x, s.y);',
        'if (Math.abs(back.x - 3) > 1e-6 || Math.abs(back.y - 5) > 1e-6) {',
        '    throw new Error(`phaser-isometric/core: round trip 3,5 -> ${back.x},${back.y}`);',
        '}',
        "if (typeof createIsoDebug !== 'function') {",
        "    throw new Error('phaser-isometric/debug: createIsoDebug non e\\' una funzione');",
        '}',
        "console.log('[verify-tarball] sottopath /core e /debug risolti e funzionanti');",
        ''
    ].join('\n'));

    console.log('4/7  install');
    run('npm', ['install', '--no-audit', '--no-fund', 'phaser@4.2.1', 'vite@^7.3.6', 'typescript@~5.7.2'], dir);
    run('npm', ['install', '--no-audit', '--no-fund', join(PLUGIN, tarball)], dir);

    // Prima del typecheck e molto prima del browser: un bin rotto deve
    // fallire in due secondi, non dopo un ciclo di build e un Chromium.
    console.log('5/7  il bin risponde davvero, attraverso lo shim di npm');
    const BIN = join(dir, 'node_modules/.bin/phaser-isometric');

    // (a) Il campo bin e' sopravvissuto a pack, install e creazione del link.
    if (!existsSync(BIN)) {
        throw new Error(
            'npm non ha creato node_modules/.bin/phaser-isometric: il campo bin ' +
            'non e\' arrivato nel tarball, oppure punta a un file che non c\'e\''
        );
    }

    // (b) Il bit di esecuzione. Non lo mettiamo noi al pack: lo mette npm
    //     all'install (bin-links/fix-bin.js fa un chmod esplicito). Questo e'
    //     l'unico punto della pipeline in cui npm ha davvero girato su un
    //     tarball vero, quindi e' l'unico punto in cui quella frase si puo'
    //     MISURARE invece che assumere.
    if (process.platform !== 'win32') {
        const mode = statSync(BIN).mode;
        if ((mode & 0o111) === 0) {
            throw new Error(`il target del bin non e' eseguibile (mode ${mode.toString(8)})`);
        }
    }

    // (c) Eseguito ATTRAVERSO lo shim, non con `node`: la suite vitest lancia
    //     `node dist/cli.js`, che funziona anche senza shebang. Questo e'
    //     l'unico posto dove la riga `#!` viene davvero usata.
    const scheda = execFileSync(BIN, ['diagnose', '--tile', '96x48', '--grid', '24x24'],
        { cwd: dir, encoding: 'utf8' });
    for (const atteso of [
        '## PROJECTION', 'det=2304.0000', 'conditioning=1.000000',
        'boundsXYWH=-1152.0000,-24.0000,2304.0000,1152.0000', 'exact=yes'
    ]) {
        if (!scheda.includes(atteso)) {
            throw new Error(`il dossier del pacchetto installato non contiene "${atteso}":\n${scheda}`);
        }
    }

    // (d) La promessa "e' per costruzione la versione che hai installato",
    //     eseguita invece che scritta — e attraverso `npx`, cioe' la riga
    //     esatta che la documentazione mette davanti al lettore.
    const versioneVista = execFileSync('npx', ['phaser-isometric', 'version'],
        { cwd: dir, encoding: 'utf8' }).trim();
    const versioneAttesa = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).version;
    if (versioneVista !== versioneAttesa) {
        throw new Error(`npx phaser-isometric version dice ${versioneVista}, il manifest dice ${versioneAttesa}`);
    }

    // (e) L'exit code arriva davvero al chiamante. Un tile 97x48 ha i centri
    //     su mezzo pixel: warning, quindi 0 senza --strict e 2 con.
    let stato = 0;
    try {
        execFileSync(BIN, ['diagnose', '--tile', '97x48', '--strict'], { cwd: dir, stdio: 'pipe' });
    } catch (e) {
        stato = e.status;
    }
    if (stato !== 2) {
        throw new Error(`una configurazione con warning e --strict ha restituito exit ${stato}, atteso 2`);
    }
    console.log(`     bin ok: phaser-isometric@${versioneVista}, dossier reso, exit 2 su --strict`);

    console.log('6/7  typecheck e build');
    run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], dir);
    run('npx', ['vite', 'build'], dir);

    console.log('7/7  disegna davvero?');
    preview = spawn(
        'npx', ['vite', 'preview', '--port', '4319', '--strictPort'],
        { cwd: dir, stdio: 'ignore', detached: false }
    );

    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Il controllo dei sottopath in entry.ts NON puo' essere lasciato al suo
    // `throw`: gli import ESM sono hoisted, quindi `./main` viene valutato
    // PRIMA del corpo di entry.ts. Se il round trip fallisse, il gioco Phaser
    // sarebbe gia' partito e il conteggio pixel del passo 6 passerebbe lo
    // stesso — il gate direbbe verde per un motivo che non ha verificato.
    // L'unica prova che quel codice sia arrivato in fondo e' il suo marker.
    const marker = '[verify-tarball] sottopath /core e /debug risolti e funzionanti';
    const consoleLog = [];
    const erroriPagina = [];
    page.on('console', m => consoleLog.push(m.text()));
    page.on('pageerror', e => erroriPagina.push(e.message));

    let ok = false;
    for (let tentativo = 0; tentativo < 30 && !ok; tentativo += 1) {
        try { await page.goto('http://localhost:4319/', { timeout: 1000 }); ok = true; }
        catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ok) throw new Error('vite preview non ha risposto');

    await page.waitForSelector('canvas', { timeout: 10_000 });

    if (!consoleLog.includes(marker)) {
        throw new Error(
            'i sottopath /core e /debug non hanno confermato: entry.ts non e\' arrivato in fondo.\n' +
            `  console: ${consoleLog.length ? consoleLog.join(' | ') : '(vuota)'}\n` +
            `  errori di pagina: ${erroriPagina.length ? erroriPagina.join(' | ') : '(nessuno)'}`
        );
    }
    console.log(`\n${marker}`);

    // La lettura dei pixel DEVE avvenire nello stesso callback rAF che
    // aspetta il render: il canvas WebGL di Phaser ha preserveDrawingBuffer
    // false per default, quindi il drawing buffer viene svuotato dal
    // browser subito dopo ogni compositing. Una seconda chiamata separata a
    // page.evaluate() dopo l'attesa arriva un frame (o piu') più tardi e
    // legge un buffer gia' ripulito, azzerando sistematicamente il conteggio
    // anche quando il pacchetto disegna correttamente — un falso negativo
    // del gate stesso, non del pacchetto installato. Questa parte e' la
    // correzione gia' rivista e confermata: non toccarla.
    const { fuoriSfondo, totale } = await page.evaluate(SFONDO => new Promise(resolve => {
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
                // inferito dal canvas. La scatola arriva ora da
                // examples/scene-background.json — la stessa che usa il test
                // Playwright gemello, non piu' un letterale duplicato qui — e
                // il passo 3 sopra verifica che il Quick Start dichiari ancora
                // quel colore.
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
    }), SFONDO_SCENA.box);

    await browser.close();

    // La soglia e' una FRAZIONE dell'area disegnata SOPRA lo sfondo noto,
    // non lo scostamento da un colore inferito dal canvas stesso: misurato
    // sul Quick Start reale, il pavimento e gli sprite coprono circa l'85%
    // del canvas (vedi task-13-report.md), ben al di sopra della soglia
    // scelta qui sotto; un pacchetto che non disegna nulla lascia il canvas
    // interamente dentro la scatola di sfondo, 0% fuori.
    //
    // IL MARGINE, non il passaggio. Questo 10% ha 8,5x di margine OGGI, ma il
    // margine non e' una proprieta' del pacchetto: e' una proprieta' del
    // FOOTPRINT DISEGNATO dal Quick Start, che degrada col quadrato della
    // griglia. Misurato sullo stesso pacchetto sano riducendo solo la costante
    // GRID di examples/quickstart/src/main.ts:
    //
    //     GRID=24 -> 85%     GRID=8 -> 24%     GRID=4 -> 6,667%, ROSSO
    //
    // Rimpicciolire la griglia dell'esempio e' una modifica ordinaria che
    // qualcuno fara' per ragioni che non c'entrano niente con questo gate, e
    // produrrebbe un "non ha disegnato" sicuro di se' su un pacchetto perfetto.
    // Se tocchi GRID, rimisura questa frazione prima di fidarti del rosso.
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
