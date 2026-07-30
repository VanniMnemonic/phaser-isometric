import type { DiagnosisInput } from '@iso-internal/core';

/**
 * Argument parsing for the `phaser-isometric` command, kept apart from the
 * entry point so it can be tested without spawning a process.
 *
 * Everything here is pure: it takes an argument list and returns a value. It
 * never reads `process`, never writes a stream, and never exits.
 */

export interface DiagnoseCommand {
    readonly kind: 'diagnose';
    readonly input: DiagnosisInput;
    readonly json: boolean;
    /** Exit 2 when the dossier carries warnings, instead of the usual 0. */
    readonly strict: boolean;
}

export interface UsageError {
    readonly kind: 'usage-error';
    readonly symptom: string;
    readonly fix: string;
}

export type Command =
    | DiagnoseCommand
    | UsageError
    | { readonly kind: 'help' }
    | { readonly kind: 'version' }
    | { readonly kind: 'no-command' };

/** Flags that consume the next argument. Anything else starting with `-` is
 *  rejected by name rather than ignored: a typo must never yield a default
 *  dossier, which is the quietest way an oracle can be wrong. */
const CON_VALORE = new Set([
    '--tile', '--matrix', '--elevation-step', '--origin',
    '--grid', '--max-elevation', '--max-row'
]);

const SENZA_VALORE = new Set(['--json', '--strict']);

function erroreUso(symptom: string, fix: string): UsageError {
    return { kind: 'usage-error', symptom, fix };
}

/** Splits `96x48` or `1,2,3,4` and requires exactly `attesi` finite numbers. */
function numeri(grezzo: string, separatore: string, attesi: number, flag: string): number[] | UsageError {
    const parti = grezzo.split(separatore);
    if (parti.length !== attesi) {
        return erroreUso(
            `${flag} needs ${attesi} numbers separated by "${separatore}" (got "${grezzo}")`,
            `write it as ${flag} ${attesi === 2 ? `10${separatore}20` : `1${separatore}2${separatore}3${separatore}4`}`
        );
    }
    const out: number[] = [];
    for (const parte of parti) {
        const n = Number(parte);
        // `Number('')` is 0 and `Number(' ')` is 0, so an empty part would slip
        // through a bare isFinite check and become a silent zero.
        if (parte.trim() === '' || !Number.isFinite(n)) {
            return erroreUso(
                `${flag} contains something that is not a number ("${parte}")`,
                `pass finite numbers to ${flag}`
            );
        }
        out.push(n);
    }
    return out;
}

function numero(grezzo: string, flag: string): number | UsageError {
    const n = Number(grezzo);
    if (grezzo.trim() === '' || !Number.isFinite(n)) {
        return erroreUso(
            `${flag} needs a number (got "${grezzo}")`,
            `pass a finite number to ${flag}, for example ${flag} 3`
        );
    }
    return n;
}

function eErrore(v: unknown): v is UsageError {
    return typeof v === 'object' && v !== null && (v as UsageError).kind === 'usage-error';
}

/**
 * Parses the arguments after the command name.
 *
 * @param args `process.argv.slice(2)` — the command and its options, with the
 *             node binary and the script path already removed.
 */
export function parseArgv(args: readonly string[]): Command {
    if (args.length === 0) return { kind: 'no-command' };

    const primo = args[0] as string;
    if (primo === 'help' || primo === '--help' || primo === '-h') return { kind: 'help' };
    if (primo === 'version' || primo === '--version' || primo === '-v') return { kind: 'version' };
    if (primo !== 'diagnose') {
        return erroreUso(
            `unknown command "${primo}"`,
            'the only command is "diagnose"; run "phaser-isometric help" for the options'
        );
    }

    let tile: number[] | undefined;
    let matrice: number[] | undefined;
    let elevationStep: number | undefined;
    let origin: { x: number; y: number } | undefined;
    let grid: { width: number; height: number } | undefined;
    let maxElevation: number | undefined;
    let maxRow: number | undefined;
    let json = false;
    let strict = false;
    let posizionale: string | undefined;

    for (let i = 1; i < args.length; i += 1) {
        const arg = args[i] as string;

        if (arg === '--help' || arg === '-h') return { kind: 'help' };

        if (SENZA_VALORE.has(arg)) {
            if (arg === '--json') json = true;
            else strict = true;
            continue;
        }

        if (CON_VALORE.has(arg)) {
            const valore = args[i + 1];
            if (valore === undefined || valore.startsWith('-')) {
                return erroreUso(
                    `${arg} needs a value`,
                    `pass one, for example ${arg} ${arg === '--tile' || arg === '--grid' ? '96x48' : '3'}`
                );
            }
            i += 1;

            if (arg === '--tile') {
                const v = numeri(valore, 'x', 2, arg);
                if (eErrore(v)) return v;
                tile = v;
            } else if (arg === '--matrix') {
                const v = numeri(valore, ',', 4, arg);
                if (eErrore(v)) return v;
                matrice = v;
            } else if (arg === '--origin') {
                const v = numeri(valore, ',', 2, arg);
                if (eErrore(v)) return v;
                origin = { x: v[0] as number, y: v[1] as number };
            } else if (arg === '--grid') {
                const v = numeri(valore, 'x', 2, arg);
                if (eErrore(v)) return v;
                grid = { width: v[0] as number, height: v[1] as number };
            } else {
                const v = numero(valore, arg);
                if (eErrore(v)) return v;
                if (arg === '--elevation-step') elevationStep = v;
                else if (arg === '--max-elevation') maxElevation = v;
                else maxRow = v;
            }
            continue;
        }

        if (arg.startsWith('-')) {
            return erroreUso(
                `unknown option "${arg}"`,
                'run "phaser-isometric help" for the list of options'
            );
        }

        if (posizionale !== undefined) {
            return erroreUso(
                `unexpected extra argument "${arg}"`,
                'diagnose takes at most one JSON argument'
            );
        }
        posizionale = arg;
    }

    if (posizionale !== undefined) {
        if (tile || matrice || elevationStep !== undefined || origin || grid
            || maxElevation !== undefined || maxRow !== undefined) {
            return erroreUso(
                'options cannot be combined with a JSON argument',
                'use either the flags or one JSON object describing the whole input, not both'
            );
        }
        let letto: unknown;
        try {
            letto = JSON.parse(posizionale);
        } catch {
            return erroreUso(
                'the JSON argument does not parse',
                'pass one JSON object, quoted so the shell keeps it in one piece'
            );
        }
        if (typeof letto !== 'object' || letto === null || !('projection' in letto)) {
            return erroreUso(
                'the JSON argument has no "projection" key',
                'wrap the spec: {"projection":{"type":"diamond","tileWidth":96,"tileHeight":48}}'
            );
        }
        return { kind: 'diagnose', input: letto as DiagnosisInput, json, strict };
    }

    if (tile && matrice) {
        return erroreUso(
            '--tile and --matrix describe the same thing two different ways',
            'pass only one of them'
        );
    }

    if (!tile && !matrice) {
        return erroreUso(
            'diagnose needs a projection',
            'pass --tile 96x48, or --matrix a,b,c,d, or one JSON argument'
        );
    }

    const input: DiagnosisInput = {
        projection: tile
            ? {
                type: 'diamond',
                tileWidth: tile[0] as number,
                tileHeight: tile[1] as number,
                ...(elevationStep === undefined ? {} : { elevationStep })
            }
            : {
                type: 'matrix',
                a: (matrice as number[])[0] as number,
                b: (matrice as number[])[1] as number,
                c: (matrice as number[])[2] as number,
                d: (matrice as number[])[3] as number,
                ...(elevationStep === undefined ? {} : { elevationStep })
            },
        ...(origin ? { origin } : {}),
        ...(grid ? { grid } : {}),
        ...(maxElevation === undefined ? {} : { maxElevation }),
        ...(maxRow === undefined ? {} : { depth: { maxRow } })
    };

    return { kind: 'diagnose', input, json, strict };
}
