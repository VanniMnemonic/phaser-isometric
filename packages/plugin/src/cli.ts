#!/usr/bin/env node
import { buildDiagnosis, IsoConfigError } from '@iso-internal/core';
import { parseArgv } from './cli-args';
import { renderDiagnosis, renderError, renderHelp, renderJson } from './cli-render';

/**
 * The `phaser-isometric` command. Everything it does is here: read the
 * arguments, hand them to the pure parser, hand the result to the pure core,
 * hand that to the pure renderer, write. Parsing, computing and formatting all
 * live elsewhere so they can be tested without a subprocess.
 *
 * Two rules this file exists to keep:
 *
 * `process.exitCode = n`, never `process.exit(n)`. `process.exit` tears the
 * process down immediately and can truncate a write that has not drained yet,
 * which turns a large dossier into a half one with a success code. Setting the
 * code lets Node exit on its own once the streams are empty. There is no test
 * for this — the failure needs an output large enough and a pipe slow enough
 * that neither reproduces reliably here — so it is a rule with its reason
 * rather than a green test pretending to guard it.
 *
 * `process` is used as a global, never imported from `node:process`. Vite's
 * client build silently rewrites a `node:` import to an empty stub, so the
 * build would pass and `process.argv` would be `undefined` at runtime. The
 * config also lists `/^node:/` as external as a second line of defence.
 */

/** Injected at build time from the package manifest, so the version this
 *  prints cannot drift from the version that was installed. */
declare const __ISO_VERSION__: string;

const meta = { tool: 'phaser-isometric', version: __ISO_VERSION__, command: 'diagnose' };

const REPORT = 'this is a bug in phaser-isometric: please report it at '
    + 'https://github.com/VanniMnemonic/phaser-isometric/issues';

const comando = parseArgv(process.argv.slice(2));

switch (comando.kind) {
    case 'help':
        process.stdout.write(renderHelp());
        break;

    case 'version':
        process.stdout.write(`${__ISO_VERSION__}\n`);
        break;

    case 'no-command':
        // Help on stderr and a non-zero code: the command was asked for a
        // dossier and produced none, and exiting 0 would report success.
        process.stderr.write(renderHelp());
        process.exitCode = 1;
        break;

    case 'usage-error':
        process.stderr.write(renderError('usage', comando.symptom, comando.fix));
        process.exitCode = 1;
        break;

    case 'diagnose':
        try {
            const dossier = buildDiagnosis(comando.input);
            process.stdout.write(
                comando.json ? renderJson(dossier, meta) : renderDiagnosis(dossier, meta)
            );
            if (comando.strict && dossier.warnings.length > 0) process.exitCode = 2;
        } catch (errore) {
            // `symptom` and `fix` verbatim, never `.message`, which glues them
            // together and hides the correction inside a sentence.
            if (errore instanceof IsoConfigError) {
                process.stderr.write(renderError('IsoConfigError', errore.symptom, errore.fix));
            } else {
                // No stack trace ever reaches the user: it names our files,
                // not theirs, and there is nothing in it they can act on.
                process.stderr.write(renderError(
                    'internal',
                    errore instanceof Error ? errore.message : String(errore),
                    REPORT
                ));
            }
            process.exitCode = 1;
        }
        break;
}
