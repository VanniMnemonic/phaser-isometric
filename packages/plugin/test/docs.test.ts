import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiagnosis, IsoConfigError } from '@iso-internal/core';
import { renderError } from '../src/cli-render';

const SKILL = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../skills/phaser-isometric/SKILL.md'),
    'utf8'
);

const LLMS = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../llms.txt'),
    'utf8'
);

describe('SKILL.md', () => {
    it('ha il frontmatter nel formato delle skill di Phaser', () => {
        expect(SKILL.startsWith('---\n')).toBe(true);
        expect(SKILL).toMatch(/\nname: phaser-isometric\n/);
        expect(SKILL).toMatch(/\ndescription: "Use this skill when [^"]*Triggers on: [^"]*"\n/);
    });

    it('porta le intestazioni che un agente cerca', () => {
        for (const h of ['## Quick Start', '## Core Concepts', '## Common Patterns', '## Gotchas and Common Mistakes']) {
            expect(SKILL, h).toContain(h);
        }
        expect(SKILL).toContain('**Key source paths:**');
        expect(SKILL).toContain('**Related skills:**');
    });

    it('mette le quattro trappole PRIMA di Core Concepts', () => {
        const trappole = SKILL.indexOf('useDefineForClassFields');
        const concetti = SKILL.indexOf('## Core Concepts');
        // Non e' pedanteria: sono i fallimenti che un agente riproduce se non
        // li legge per primi, e un agente legge dall'alto.
        expect(trappole).toBeGreaterThan(-1);
        expect(trappole).toBeLessThan(concetti);
        for (const t of ['declare global', 'mapping', 'sideEffects']) {
            expect(SKILL.indexOf(t), t).toBeLessThan(concetti);
        }
    });

    it('nomina cio che senza un nome evapora', () => {
        for (const s of [
            'skipLibCheck',
            'phaser-isometric/core',
            'phaser-isometric/debug',
            'setRoundPixels',
            'PluginCache',
            'snapshot().version'
        ]) {
            expect(SKILL, s).toContain(s);
        }
    });

    it('non promette prestazioni senza la clausola che le limita', () => {
        // La promessa e' misurata su 500 entita ATTIVE, di cui solo una parte
        // e a schermo. Il numero senza la clausola e' una promessa diversa da
        // quella che e stata misurata.
        const promessa = SKILL.includes('500');
        expect(promessa).toBe(true);
        expect(SKILL.toLowerCase()).toContain('cull');
    });

    it('e in inglese: nessuna delle parole italiane che ricorrono nei commenti interni', () => {
        // Il documento attraversa il confine del pacchetto, quindi la regola
        // della lingua si applica per intero. Questo controllo e' grezzo per
        // scelta: prende le parole che compaiono davvero nei commenti di
        // questo repo, non l'italiano in generale.
        for (const parola of [' perche', ' quindi ', ' invece ', ' cioe', ' senza il quale ']) {
            expect(SKILL.toLowerCase(), parola).not.toContain(parola);
        }
    });
});

describe('non-divergenza della documentazione', () => {
    it('rigenerare non produce alcun diff', () => {
        const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
        // Se questo fallisce, qualcuno ha modificato un artefatto generato a
        // mano invece della sua sorgente: llms.txt, il README del pacchetto o
        // il Quick Start dentro la SKILL.md.
        expect(() => execFileSync('node', ['scripts/build-docs.mjs', '--check'], { cwd: root }))
            .not.toThrow();
    });

    it('il Quick Start dentro la SKILL.md e quello che il progetto compila', () => {
        const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
        const sorgente = readFileSync(join(root, 'examples/quickstart/src/main.ts'), 'utf8').trimEnd();
        // Non basta che il blocco esista: deve essere IL file, quello che
        // `pnpm --filter quickstart build` compila. Altrimenti il Quick Start
        // torna a essere prosa che invecchia.
        expect(SKILL).toContain(sorgente);
        expect(sorgente.length).toBeGreaterThan(400);
    });

    it('la scheda ERROR documentata e quella che il codice produce davvero', () => {
        // Stesso accoppiamento del Quick Start, applicato all'output: la
        // scheda nella SKILL.md non e' prosa scritta a mano, e' cio' che
        // renderError produce a partire dall'errore che createProjection lancia
        // davvero. Cambiare il testo di quel `fix` nel core rende rossa la
        // documentazione finche' non viene aggiornata.
        let errore: unknown;
        try {
            buildDiagnosis({ projection: { type: 'matrix', a: 1, b: 1, c: 1, d: 1 } });
        } catch (e) {
            errore = e;
        }
        expect(errore).toBeInstanceOf(IsoConfigError);
        const err = errore as IsoConfigError;
        expect(SKILL).toContain(renderError('IsoConfigError', err.symptom, err.fix));
    });

    it('il comando sopravvive dentro llms.txt, non solo dentro SKILL.md', () => {
        // build-docs.mjs sostituisce con un puntatore ogni fence piu' lungo di
        // 12 righe fuori dal Quick Start. Far crescere l'esempio della CLI
        // oltre quella soglia lo farebbe sparire dai documenti spediti, e
        // `docs:check` non se ne accorgerebbe: rigenererebbe coerentemente la
        // versione senza comando.
        // Una sonda per fence, e ognuna deve essere UNICA del proprio.
        // La prima stesura asseriva 'npx phaser-isometric diagnose', che
        // compare in entrambi: il preflight l'ha uccisa gonfiando il primo
        // fence oltre la soglia e trovando il test ancora verde, perche' la
        // stringa sopravviveva nel secondo. Un'asserzione soddisfatta da un
        // pezzo di documento diverso da quello che protegge non protegge
        // niente.
        expect(LLMS, 'il fence del comando e sparito da llms.txt')
            .toContain('npx phaser-isometric diagnose --tile 96x48 --grid 24x24');
        expect(LLMS, 'il fence della scheda ERROR e sparito da llms.txt')
            .toContain('kind=IsoConfigError');
    });
});

describe('CHANGELOG.md', () => {
    const CHANGELOG = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../CHANGELOG.md'),
        'utf8'
    );

    it('ogni sezione di versione ha la propria definizione di link', () => {
        // In Keep a Changelog i titoli sono link di RIFERIMENTO: `## [0.3.0]`
        // senza una riga `[0.3.0]: <url>` in fondo non e' un link rotto, e'
        // testo grezzo con le parentesi quadre in mezzo — e non lo vede nessuno
        // finche' qualcuno non apre la pagina su GitHub. E' successo aggiungendo
        // proprio la sezione 0.3.0: la sezione c'era, la definizione no.
        const titoli = [...CHANGELOG.matchAll(/^## \[([^\]]+)\]/gm)].map(m => m[1]);
        const definiti = new Set([...CHANGELOG.matchAll(/^\[([^\]]+)\]:/gm)].map(m => m[1]));

        expect(titoli.length).toBeGreaterThan(1);
        for (const titolo of titoli) {
            expect(definiti, `## [${titolo}] non ha una definizione di link`).toContain(titolo);
        }
    });

    it('il confronto di [Unreleased] parte dalla versione piu recente', () => {
        // L'altra meta' dello stesso difetto, e quella che sopravvive piu' a
        // lungo: la definizione esiste ma punta ancora al tag precedente,
        // quindi «cosa e' cambiato da allora» mostra anche cio' che e' gia'
        // stato rilasciato. Il primo titolo dopo [Unreleased] e' la versione da
        // cui il confronto deve partire.
        const versioni = [...CHANGELOG.matchAll(/^## \[([^\]]+)\]/gm)]
            .map(m => m[1])
            .filter(v => v !== 'Unreleased');
        const piuRecente = versioni[0];
        const riga = CHANGELOG.match(/^\[Unreleased\]: .*$/m)?.[0] ?? '';

        expect(piuRecente).toBeTruthy();
        expect(riga, riga).toContain(`compare/v${piuRecente}...HEAD`);
    });

    it('la versione in testa al CHANGELOG e quella del manifest pubblicato', () => {
        // Due sorgenti che devono dire la stessa cosa e che nessuno rilegge
        // insieme: la sezione datata in cima e il `version` che finisce sul
        // registry. Divergono in silenzio ogni volta che si alza l'una e non
        // l'altra, e la scoperta arriva a pubblicazione fatta.
        const manifest = JSON.parse(readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'
        )) as { version: string };
        const versioni = [...CHANGELOG.matchAll(/^## \[([^\]]+)\]/gm)]
            .map(m => m[1])
            .filter(v => v !== 'Unreleased');

        expect(versioni[0]).toBe(manifest.version);
    });
});

describe('llms.txt porta il significato, non solo la struttura', () => {
    it('pinna le frasi che un filtro strutturale perderebbe in silenzio', () => {
        // Un filtro che tiene fence/tabelle/liste e butta la prosa perde
        // proprio i punti dove il significato vive SOLO nella prosa: un
        // limite dichiarato, il razionale di una scelta, il perche' un
        // percorso caldo non valida. Ogni frase qui e' presa verbatim da
        // una di quelle sezioni, abbastanza specifica da non comparire per
        // caso e abbastanza corta da non rompersi a ogni riformulazione.
        for (const frase of [
            // Culling: non e' un'ottimizzazione sopra qualcosa che esiste
            // gia', e iso.view() non e' camera.worldView.
            'no per-sprite culling',
            'is not an optimisation layered on an existing one',
            'is not `camera.worldView`',
            // Picking: il limite alle sole facce superiori.
            'top faces only',
            // Projection: le due funzioni di Phaser si contraddicono, e
            // l'origine deve avere componenti intere.
            'Phaser contradicts itself',
            'must have integer components',
            // Depth: il razionale del tie-break, e rowOffset per le
            // coordinate negative.
            'display-list comparator is exactly',
            'raise `rowOffset` so',
            // Errors: perche' i percorsi caldi non validano.
            'Hot paths never throw on per-frame input',
            // La clausola sul culling che deve viaggiare col numero.
            '"500 active" is not "500 drawn on screen"',
            // Il limite che questa suite non ha visto per due versioni: fuori
            // dai 45 gradi la cella non e' un rombo, e una hit area a rombo e'
            // sbagliata di FORMA. Ancorato qui perche' e' prosa — nessun test
            // di comportamento puo' accorgersi che la frase e' sparita dai
            // documenti spediti, ed e' l'unico posto in cui chi legge lo
            // scopre prima di contare i click.
            'a cell is not a rhombus',
            'wrong shape and not merely the wrong size',
            // E il fatto che l'assonometria generale sia supportata: senza
            // questa riga il `matrix` spec torna a sembrare un dettaglio
            // interno, che e' come e' rimasto invisibile finora.
            'it is a **general axonometry**',
            // Il solo limite di espressivita' del modello.
            'The one thing that cannot be expressed is roll'
        ]) {
            expect(LLMS, frase).toContain(frase);
        }
    });
});
