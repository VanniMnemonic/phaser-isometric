/**
 * The half that `verify-tarball.mjs` and `verify-published.mjs` share: build a
 * Vite+TS project from scratch OUTSIDE this monorepo, and — once SOMEBODY has
 * installed `phaser-isometric` into it — check that the thing actually works.
 *
 * Outside the monorepo on purpose: inside it, pnpm resolves the package to the
 * workspace whatever the exports map says, so a packaging mistake would stay
 * invisible right up to the first user.
 *
 * It lives here, factored out, because the post-publish gate was hand-written
 * twice (for 0.1.0 and again for 0.2.0) and died with its session both times.
 * Two copies of "does the installed package draw?" would answer the question
 * differently the first time either one was touched — and the whole point of
 * these two gates is that the answer is the same one, asked of two different
 * artifacts: the tarball we are about to publish, and the tarball the registry
 * actually served.
 *
 * The only difference between the callers is the INSTALL step. Everything from
 * "is there a bin?" to "did pixels reach the canvas?" is here.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

export function run(cmd, args, cwd) {
    console.log(`\n$ ${cmd} ${args.join(' ')}   (${cwd})`);
    execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

/**
 * Creates the virgin project: manifest, tsconfig, index.html, the Quick Start
 * as its scene, and the entry that exercises the two subpaths.
 *
 * Returns the directory. The caller owns removing it — both gates do it in a
 * `finally`, because a failure at ANY step used to leave one behind (seven had
 * accumulated in /tmp before anyone noticed).
 */
export function creaProgettoVergine(root, etichetta) {
    const dir = mkdtempSync(join(tmpdir(), 'phaser-iso-virgin-'));

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
    const quickstart = readFileSync(join(root, 'examples/quickstart/src/main.ts'), 'utf8');
    cpSync(join(root, 'examples/quickstart/src/main.ts'), join(dir, 'src/main.ts'));

    // La scatola condivisa e' utile solo finche' descrive DAVVERO questa scena.
    // Senza questo controllo, cambiare il colore di sfondo del Quick Start
    // lascerebbe il conteggio pixel a misurare "non #11141a" su un canvas che
    // di #11141a non ha piu' un pixel: 100% fuori sfondo, verde che non
    // significa niente.
    const sfondo = JSON.parse(readFileSync(join(root, 'examples/scene-background.json'), 'utf8'));
    if (!quickstart.includes(`backgroundColor: '${sfondo.hex}'`)) {
        throw new Error(
            `examples/quickstart/src/main.ts non dichiara piu' backgroundColor: '${sfondo.hex}'. ` +
            'Aggiorna examples/scene-background.json, che e\' la sorgente condivisa con from-docs.spec.ts.'
        );
    }

    // Il Quick Start esercita SOLO la entry radice. `./core` e `./debug` sono
    // due sottopath della mappa exports che nessun altro passo toccherebbe: un
    // `types` sbagliato passerebbe la build e un `import` sbagliato passerebbe
    // il typecheck, ognuno invisibile all'altro. Questo file li importa entrambi
    // e ne usa il risultato a runtime, cosi' il typecheck E vite li verificano,
    // e il bundler non puo' eliderli prima.
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
        `console.log('${markerDi(etichetta)}');`,
        ''
    ].join('\n'));

    return dir;
}

/** Il marker che entry.ts stampa quando e' arrivato in fondo. Una funzione e
 *  non due letterali: il produttore e il consumatore devono non poter divergere. */
export function markerDi(etichetta) {
    return `[${etichetta}] sottopath /core e /debug risolti e funzionanti`;
}

export function installaDipendenzeDiContorno(dir) {
    run('npm', ['install', '--no-audit', '--no-fund', 'phaser@4.2.1', 'vite@^7.3.6', 'typescript@~5.7.2'], dir);
}

/**
 * Il bin risponde davvero, attraverso lo shim di npm.
 *
 * Prima del typecheck e molto prima del browser: un bin rotto deve fallire in
 * due secondi, non dopo un ciclo di build e un Chromium.
 */
export function verificaBin(dir, versioneAttesa) {
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
    if (versioneVista !== versioneAttesa) {
        throw new Error(`npx phaser-isometric version dice ${versioneVista}, atteso ${versioneAttesa}`);
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
}

/**
 * Typecheck, build, e poi la domanda che nessun'altra asserzione pone: sono
 * arrivati dei pixel sul canvas?
 *
 * Restituisce il processo `vite preview`, che il chiamante deve uccidere.
 */
export async function verificaDisegna(dir, root, etichetta, porta) {
    console.log('  typecheck e build');
    run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], dir);
    run('npx', ['vite', 'build'], dir);

    console.log('  disegna davvero?');
    const preview = spawn(
        'npx', ['vite', 'preview', '--port', String(porta), '--strictPort'],
        { cwd: dir, stdio: 'ignore', detached: false }
    );

    try {
        const browser = await chromium.launch();
        const page = await browser.newPage();

        // Il controllo dei sottopath in entry.ts NON puo' essere lasciato al suo
        // `throw`: gli import ESM sono hoisted, quindi `./main` viene valutato
        // PRIMA del corpo di entry.ts. Se il round trip fallisse, il gioco Phaser
        // sarebbe gia' partito e il conteggio pixel passerebbe lo stesso — il gate
        // direbbe verde per un motivo che non ha verificato. L'unica prova che quel
        // codice sia arrivato in fondo e' il suo marker.
        const marker = markerDi(etichetta);
        const consoleLog = [];
        const erroriPagina = [];
        page.on('console', m => consoleLog.push(m.text()));
        page.on('pageerror', e => erroriPagina.push(e.message));

        let ok = false;
        for (let tentativo = 0; tentativo < 30 && !ok; tentativo += 1) {
            try { await page.goto(`http://localhost:${porta}/`, { timeout: 1000 }); ok = true; }
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

        const sfondo = JSON.parse(readFileSync(join(root, 'examples/scene-background.json'), 'utf8'));

        // La lettura dei pixel DEVE avvenire nello stesso callback rAF che
        // aspetta il render: il canvas WebGL di Phaser ha preserveDrawingBuffer
        // false per default, quindi il drawing buffer viene svuotato dal browser
        // subito dopo ogni compositing. Una seconda chiamata separata a
        // page.evaluate() dopo l'attesa arriva un frame (o piu') piu' tardi e
        // legge un buffer gia' ripulito, azzerando sistematicamente il conteggio
        // anche quando il pacchetto disegna correttamente — un falso negativo del
        // gate stesso, non del pacchetto installato. Non toccarla.
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

                    // Uno sfondo LETTERALE, non inferito dal canvas. Il dominante
                    // per superficie e' il colore del TILE, che copre l'85% del
                    // canvas: contare "diverso dal dominante" leggerebbe la
                    // domanda al contrario, e una scena che disegna PIU'
                    // pavimento diventerebbe rossa.
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
        }), sfondo.box);

        await browser.close();

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
        // produrrebbe un "non ha disegnato" sicuro di se' su un pacchetto
        // perfetto. Se tocchi GRID, rimisura questa frazione prima di fidarti del
        // rosso.
        const SOGLIA_FRAZIONE = 0.10;
        const frazione = fuoriSfondo / totale;
        console.log(
            `\n${fuoriSfondo}/${totale} pixel fuori dallo sfondo ${sfondo.hex} (${(frazione * 100).toFixed(3)}%), ` +
            `soglia ${(SOGLIA_FRAZIONE * 100)}%`
        );
        if (frazione < SOGLIA_FRAZIONE) {
            throw new Error(
                `solo ${(frazione * 100).toFixed(3)}% di pixel fuori dallo sfondo ` +
                `(soglia ${(SOGLIA_FRAZIONE * 100)}%): non ha disegnato`
            );
        }
        console.log(`\nGATE PASSATO — ${fuoriSfondo}/${totale} pixel fuori dallo sfondo (${(frazione * 100).toFixed(2)}%)`);
    } finally {
        preview.kill('SIGTERM');
    }
}
