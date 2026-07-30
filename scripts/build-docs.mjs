/**
 * Builds the shipped documentation from its single sources.
 *
 * Run with `--check` it writes nothing and exits non-zero when any target is
 * out of date. That mode is the whole point: it turns "the docs drifted" from
 * something a reader eventually notices into something the build refuses.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'packages/plugin');
const check = process.argv.includes('--check');

const BEGIN = '<!-- BEGIN quickstart -->';
const END = '<!-- END quickstart -->';

const quickstart = readFileSync(join(ROOT, 'examples/quickstart/src/main.ts'), 'utf8').trimEnd();
const blocco = `${BEGIN}\n\`\`\`ts\n${quickstart}\n\`\`\`\n${END}`;

/** Replaces whatever sits between the markers. Throws when they are missing,
 *  because a silent no-op here would ship an empty Quick Start. */
function inject(text, where) {
    const a = text.indexOf(BEGIN);
    const b = text.indexOf(END);
    if (a === -1 || b === -1 || b < a) {
        throw new Error(`${where}: marker del quickstart mancanti o invertiti`);
    }
    return text.slice(0, a) + blocco + text.slice(b + END.length);
}

/**
 * Derives llms.txt from SKILL.md: frontmatter dropped, everything else kept
 * by default - headings, prose, lists, tables, bold lines, blockquotes. An
 * agent that has the package but has not indexed the skill needs the meaning,
 * and meaning lives in prose at least as often as in a fence or a table; a
 * filter that strips prose to save lines strips traps, caveats and rationale
 * along with it, silently.
 *
 * The only compression is on length, and it targets exactly the place the
 * length is concentrated: long fenced code blocks. One declared, mechanical
 * rule - not a per-block judgment call - drives it: a fenced block strictly
 * longer than FENCE_MAX lines (open and close fence included) is replaced by
 * a one-line pointer naming its heading, UNLESS that heading is the Quick
 * Start, which stays in full because it is the single most useful block in
 * the file. Every other fence, short or long, is kept verbatim; so is every
 * word outside a fence.
 */
function llmsTxt(skill) {
    // Task F2: `**Related skills:**` in SKILL.md is written relative to
    // SKILL.md's OWN shipped location, skills/phaser-isometric/SKILL.md -
    // two directories below the package root, so `../../../` reaches
    // node_modules/phaser/skills/... from there. llms.txt ships two levels
    // shallower, AT the package root itself: the same three `../../../`
    // segments from there land one level above the consumer's whole
    // project, not at a sibling package. Rewrite just that line's paths for
    // the depth llms.txt actually ships at, before anything else runs.
    const conRelatedSkillsCorrette = skill.replace(
        /^(\*\*Related skills:\*\* ).+$/m,
        (riga) => riga.replace(/\.\.\/\.\.\/\.\.\//g, '../')
    );
    const senzaFrontmatter = conRelatedSkillsCorrette.replace(/^---\n[\s\S]*?\n---\n/, '');
    const righe = senzaFrontmatter.split('\n');

    const FENCE_MAX = 12;
    const QUICKSTART_HEADING = '## Quick Start';

    const out = [];
    let headingCorrente = '';
    let inFence = false;
    let bufferFence = [];

    for (const riga of righe) {
        if (riga.startsWith('```')) {
            if (!inFence) { inFence = true; bufferFence = [riga]; continue; }
            inFence = false;
            bufferFence.push(riga);
            const troppoLungo = bufferFence.length > FENCE_MAX;
            if (troppoLungo && headingCorrente !== QUICKSTART_HEADING) {
                const titolo = headingCorrente.replace(/^#+\s*/, '');
                out.push(`_Full example under "${titolo}" in skills/phaser-isometric/SKILL.md._`);
            } else {
                out.push(...bufferFence);
            }
            continue;
        }
        if (inFence) { bufferFence.push(riga); continue; }
        if (riga.startsWith('#')) headingCorrente = riga;
        out.push(riga);
    }

    // Task F8: no leading `# phaser-isometric` here — the source already
    // opens with its own H1 (`# Phaser Isometric`), and prepending a second
    // one produced two H1s in a row at the top of the shipped file.
    return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const targets = [];

const skillPath = join(PLUGIN, 'skills/phaser-isometric/SKILL.md');
const skill = inject(readFileSync(skillPath, 'utf8'), 'SKILL.md');
targets.push([skillPath, skill]);

const readmePath = join(ROOT, 'README.md');
const readme = inject(readFileSync(readmePath, 'utf8'), 'README.md');
targets.push([readmePath, readme]);

targets.push([join(PLUGIN, 'llms.txt'), llmsTxt(skill)]);
targets.push([join(PLUGIN, 'README.md'), readme]);
targets.push([join(PLUGIN, 'LICENSE'), readFileSync(join(ROOT, 'LICENSE'), 'utf8')]);

let sporchi = [];
for (const [path, atteso] of targets) {
    let attuale = null;
    try { attuale = readFileSync(path, 'utf8'); } catch { attuale = null; }
    if (attuale === atteso) continue;
    if (check) sporchi.push(path);
    else writeFileSync(path, atteso);
}

if (check && sporchi.length > 0) {
    console.error(`Documentazione non rigenerata:\n  ${sporchi.join('\n  ')}\nEsegui: pnpm docs:build`);
    process.exit(1);
}
console.log(check ? 'Documentazione allineata' : `Rigenerati ${targets.length} artefatti`);
