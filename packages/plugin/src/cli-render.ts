import type { Diagnosis } from '@iso-internal/core';

/**
 * Turns a {@link Diagnosis} into the text the command prints.
 *
 * Kept apart from the entry point for two reasons. It can be tested against
 * hand-built objects — including ones the core would never produce, such as a
 * `NaN` or a value past the formatter's cliff, which is the only way to test
 * the `na` sentinel at all. And it contains no arithmetic, which the shell is
 * forbidden from doing: every number arrives already computed.
 *
 * If the MCP server the design doc describes is ever built, this file is the
 * one to promote into the core: it is the only piece a second consumer would
 * want to share.
 */

/**
 * Past this magnitude `toFixed` switches to scientific notation, which the
 * output contract forbids. Measured: `(1e21).toFixed(4)` is `"1e+21"`.
 * `buildDiagnosis` warns about implausible scales long before this, so a bare
 * `na` never arrives unannounced.
 */
const CLIFF = 1e21;

/** Formats a number for the card, or `na` when no honest digits exist. */
function num(v: number, cifre: number): string {
    if (!Number.isFinite(v) || Math.abs(v) >= CLIFF) return 'na';
    const reso = v.toFixed(cifre);
    // Measured: `(-0.00001).toFixed(4)` is `"-0.0000"`. A minus sign in front
    // of zeroes reads as a direction that is not there.
    return /^-0(\.0+)?$/.test(reso) ? reso.slice(1) : reso;
}

/** Integers print with no separators: `toLocaleString` would make the output
 *  depend on the machine's locale, and this text is diffed. */
function intero(v: number): string {
    return Number.isFinite(v) ? String(v) : 'na';
}

function sino(v: boolean): string {
    return v ? 'yes' : 'no';
}

function sezione(titolo: string, righe: readonly string[]): string[] {
    // A header with nothing under it is worse than silence: it reads as "we
    // looked and found nothing" when in fact nobody asked.
    return righe.length === 0 ? [] : [`## ${titolo}`, ...righe, ''];
}

export interface RenderMeta {
    readonly tool: string;
    readonly version: string;
    readonly command: string;
}

/** The sectioned card. Deterministic: the same input always renders the same
 *  bytes, so two runs can be compared and a diff means something. */
export function renderDiagnosis(d: Diagnosis, meta: RenderMeta): string {
    const p = d.projection;
    const g = d.grid;
    const rt = d.roundTrip;

    const righe: string[] = [
        ...sezione('META', [
            `tool=${meta.tool}`,
            `version=${meta.version}`,
            `schema=${intero(d.schema)}`,
            `command=${meta.command}`,
            `warnings=${intero(d.warnings.length)}`
        ]),
        ...sezione('PROJECTION', [
            `type=${p.type}`,
            `tileWidth=${p.tileWidth === null ? 'na' : intero(p.tileWidth)}`,
            `tileHeight=${p.tileHeight === null ? 'na' : intero(p.tileHeight)}`,
            `a=${num(p.a, 4)}`,
            `b=${num(p.b, 4)}`,
            `c=${num(p.c, 4)}`,
            `d=${num(p.d, 4)}`,
            `det=${num(p.det, 4)}`,
            `conditioning=${num(p.conditioning, 6)}`,
            `elevationStep=${num(p.elevationStep, 4)}`,
            `originXY=${num(p.origin.x, 0)},${num(p.origin.y, 0)}`
        ]),
        ...sezione('DEPTH', [
            `rowStride=${intero(d.depth.layout.rowStride)}`,
            `bandStride=${intero(d.depth.layout.bandStride)}`,
            `subCapacity=${intero(d.depth.layout.subCapacity)}`,
            `maxBands=${intero(d.depth.layout.maxBands)}`,
            `rowOffset=${intero(d.depth.layout.rowOffset)}`,
            `maxWithinRow=${intero(d.depth.maxWithinRow)}`,
            `withinRowHeadroom=${intero(d.depth.withinRowHeadroom)}`,
            `declaredMaxRow=${intero(d.depth.declaredMaxRow)}`,
            `worstKey=${intero(d.depth.worstKey)}`,
            `maxSafeRow=${intero(d.depth.maxSafeRow)}`,
            `safeRowHeadroom=${intero(d.depth.safeRowHeadroom)}`
        ]),
        ...sezione('GRID', g === null ? [] : [
            `width=${intero(g.width)}`,
            `height=${intero(g.height)}`,
            `cells=${intero(g.cells)}`,
            `maxRow=${intero(g.maxRow)}`,
            `maxElevation=${intero(g.maxElevation)}`,
            `worstKeyInGrid=${intero(g.worstKeyInGrid)}`,
            `boundsXYWH=${num(g.bounds.x, 4)},${num(g.bounds.y, 4)},${num(g.bounds.width, 4)},${num(g.bounds.height, 4)}`,
            `elevationLiftPx=${num(g.elevationLiftPx, 4)}`
        ]),
        ...sezione('ROUNDTRIP', [
            `probes=${intero(rt.probes)}`,
            `maxGridError=${num(rt.maxGridError, 12)}`,
            `maxScreenError=${num(rt.maxScreenError, 12)}`,
            `worstCellXYZ=${rt.worstCell === null
                ? 'na'
                : `${intero(rt.worstCell.gx)},${intero(rt.worstCell.gy)},${intero(rt.worstCell.z)}`}`,
            `exact=${sino(rt.exact)}`
        ]),
        ...sezione('WARNINGS', d.warnings.flatMap((w, i) => [
            // Numbered from 1: a reader counting warnings out loud starts at
            // one, and the count in META is a cardinal, not an index.
            `${i + 1}.code=${w.code}`,
            `${i + 1}.symptom=${w.symptom}`,
            `${i + 1}.fix=${w.fix}`
        ]))
    ];

    return righe.join('\n');
}

/** The error card. `symptom` and `fix` stay two separate keys: the `Error`
 *  message glues them with ". Fix: ", and a reader scanning for what to do
 *  should not have to find it inside a sentence. */
export function renderError(kind: string, symptom: string, fix: string): string {
    return ['## ERROR', `kind=${kind}`, `symptom=${symptom}`, `fix=${fix}`, ''].join('\n');
}

export function renderJson(d: Diagnosis, meta: RenderMeta): string {
    // Full precision on purpose: quantization belongs at the card's edge, not
    // in a payload something else will compute with.
    return `${JSON.stringify({ ...meta, diagnosis: d }, null, 2)}\n`;
}

export function renderHelp(): string {
    return `phaser-isometric <command> [options]

Commands
  diagnose [spec-json]   Print a projection + depth dossier
  help                   Print this text
  version                Print the package version

diagnose options
  --tile WxH             Diamond preset, for example 96x48
  --matrix a,b,c,d       Raw matrix instead of --tile
  --elevation-step N     Screen pixels lifted per elevation unit
  --origin X,Y           Integer screen translation (default 0,0)
  --grid WxH             Grid extent; adds the GRID section and world bounds
  --max-elevation N      Highest elevation the grid reaches (default 0)
  --max-row N            Row (gx+gy) the depth layout must stay safe up to
  --strict               Exit 2 when the dossier carries warnings
  --json                 Emit the raw Diagnosis as JSON instead of the card

[spec-json] is the same configuration as one JSON object, for anything the
flags do not cover, such as a full depth layout. Flags and [spec-json] cannot
be mixed. Input is read from arguments only; this command does not read stdin.

Output is "## SECTION" headers with key=value lines. A section with nothing to
report is dropped entirely. "na" means the value does not apply.

Exit codes
  0  the dossier was printed
  1  the configuration was rejected; see the ERROR section on stderr
  2  the dossier was printed and carries warnings, with --strict

Examples
  npx phaser-isometric diagnose --tile 96x48 --grid 24x24
  npx phaser-isometric diagnose --tile 128x64 --max-elevation 6 --json
`;
}
