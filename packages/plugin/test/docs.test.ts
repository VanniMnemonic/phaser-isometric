import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../skills/phaser-isometric/SKILL.md'),
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
