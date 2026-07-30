import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
            '"500 active" is not "500 drawn on screen"'
        ]) {
            expect(LLMS, frase).toContain(frase);
        }
    });
});
