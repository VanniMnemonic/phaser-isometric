import { describe, expect, it } from 'vitest';
import { parseArgv } from '../src/cli-args';
import type { Command, DiagnoseCommand, UsageError } from '../src/cli-args';

function diagnose(args: string[]): DiagnoseCommand {
    const c = parseArgv(args);
    expect(c.kind, `atteso diagnose, ottenuto ${c.kind}`).toBe('diagnose');
    return c as DiagnoseCommand;
}

function erroreUso(args: string[]): UsageError {
    const c: Command = parseArgv(args);
    expect(c.kind, `atteso usage-error, ottenuto ${c.kind}`).toBe('usage-error');
    return c as UsageError;
}

describe('parseArgv: i comandi', () => {
    it('senza argomenti non e help: e "non hai chiesto niente"', () => {
        // Distinti di proposito: `help` esce 0 perche' ha fatto cio' che gli e
        // stato chiesto, nessun argomento esce 1 perche' non ha prodotto il
        // dossier per cui esiste. Collassarli renderebbe verde un'invocazione
        // che non ha diagnosticato nulla.
        expect(parseArgv([]).kind).toBe('no-command');
        expect(parseArgv(['help']).kind).toBe('help');
    });

    it('riconosce help e version in tutte le forme', () => {
        for (const a of ['help', '--help', '-h']) expect(parseArgv([a]).kind).toBe('help');
        for (const a of ['version', '--version', '-v']) expect(parseArgv([a]).kind).toBe('version');
        // Anche in coda a diagnose: chi e' in difficolta' lo scrive li'.
        expect(parseArgv(['diagnose', '--tile', '96x48', '--help']).kind).toBe('help');
    });

    it('un comando sconosciuto e un errore che lo nomina', () => {
        expect(erroreUso(['diagnoze']).symptom).toContain('diagnoze');
    });
});

describe('parseArgv: i valori', () => {
    it('--tile 96x48 da larghezza 96 e altezza 48, in quest ordine', () => {
        const c = diagnose(['diagnose', '--tile', '96x48']);
        expect(c.input.projection).toEqual({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
    });

    it('--tile con un solo numero e un errore, non un NaN silenzioso', () => {
        // Senza il controllo di arita', `Number(undefined)` e' NaN e passerebbe
        // fino al core con un messaggio che parla d'altro.
        expect(erroreUso(['diagnose', '--tile', '96']).symptom).toContain('--tile');
        expect(erroreUso(['diagnose', '--tile', '96xfoo']).symptom).toContain('--tile');
        expect(erroreUso(['diagnose', '--tile', '96x']).symptom).toContain('--tile');
    });

    it('--origin vuole due componenti', () => {
        expect(diagnose(['diagnose', '--tile', '96x48', '--origin', '10,20']).input.origin)
            .toEqual({ x: 10, y: 20 });
        expect(erroreUso(['diagnose', '--tile', '96x48', '--origin', '10']).symptom).toContain('--origin');
    });

    it('--matrix vuole quattro componenti', () => {
        const c = diagnose(['diagnose', '--matrix', '48,24,-48,24']);
        expect(c.input.projection).toEqual({ type: 'matrix', a: 48, b: 24, c: -48, d: 24 });
        expect(erroreUso(['diagnose', '--matrix', '48,24,-48']).symptom).toContain('--matrix');
    });

    it('--max-row abc e un errore', () => {
        expect(erroreUso(['diagnose', '--tile', '96x48', '--max-row', 'abc']).symptom).toContain('--max-row');
    });

    it('un flag che vuole un valore non si mangia il flag successivo', () => {
        expect(erroreUso(['diagnose', '--tile', '--json']).symptom).toContain('--tile');
    });

    it('--strict e --json sono booleani, spenti di default', () => {
        const nudo = diagnose(['diagnose', '--tile', '96x48']);
        expect(nudo.strict).toBe(false);
        expect(nudo.json).toBe(false);
        const acceso = diagnose(['diagnose', '--tile', '96x48', '--strict', '--json']);
        expect(acceso.strict).toBe(true);
        expect(acceso.json).toBe(true);
    });

    it('senza --grid non inventa una griglia', () => {
        // Una sezione GRID su una griglia che nessuno ha nominato sarebbe un
        // numero inventato che si legge come misura.
        expect(diagnose(['diagnose', '--tile', '96x48']).input.grid).toBeUndefined();
        expect(diagnose(['diagnose', '--tile', '96x48', '--grid', '24x24']).input.grid)
            .toEqual({ width: 24, height: 24 });
    });
});

describe('parseArgv: cio che rifiuta', () => {
    it('un flag sconosciuto e un errore che LO NOMINA', () => {
        // Il modo piu' silenzioso in cui un oracolo puo' sbagliare: ignorare
        // un refuso e restituire con sicurezza un dossier di default.
        const e = erroreUso(['diagnose', '--tiles', '96x48']);
        expect(e.symptom).toContain('--tiles');
        expect(e.fix.length).toBeGreaterThan(10);
    });

    it('flag e JSON non si mescolano', () => {
        const e = erroreUso(['diagnose', '--tile', '96x48', '{"projection":{"type":"diamond","tileWidth":96,"tileHeight":48}}']);
        expect(e.symptom).toContain('cannot be combined');
    });

    it('un secondo posizionale e un errore', () => {
        expect(erroreUso(['diagnose', '{"projection":{}}', 'avanzo']).symptom).toContain('avanzo');
    });

    it('senza proiezione non c e diagnosi', () => {
        expect(erroreUso(['diagnose']).symptom).toContain('projection');
        expect(erroreUso(['diagnose', '--grid', '24x24']).symptom).toContain('projection');
    });

    it('--tile e --matrix insieme sono un errore', () => {
        expect(erroreUso(['diagnose', '--tile', '96x48', '--matrix', '1,2,3,4']).symptom).toContain('--matrix');
    });

    it('un JSON malformato, o senza projection, e un errore', () => {
        expect(erroreUso(['diagnose', '{non json}']).symptom).toContain('does not parse');
        expect(erroreUso(['diagnose', '{"tile":96}']).symptom).toContain('projection');
    });
});

describe('parseArgv: il JSON posizionale', () => {
    it('passa attraverso cio che i flag non coprono', () => {
        const grezzo = '{"projection":{"type":"diamond","tileWidth":96,"tileHeight":48},'
            + '"depth":{"layout":{"rowStride":8192}}}';
        const c = diagnose(['diagnose', grezzo]);
        expect(c.input.depth?.layout?.rowStride).toBe(8192);
    });
});
