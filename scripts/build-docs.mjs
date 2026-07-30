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
 * Derives llms.txt from SKILL.md: frontmatter dropped, headings and fenced
 * code kept, prose paragraphs dropped by default. What survives is the shape
 * an agent needs when it has the package but has not indexed the skill.
 *
 * One refinement on top of that plain rule: a heading whose entire body is
 * ordinary prose - no fence, no list, no table, no bold line - is not
 * shortened, it is emptied. A subsection that keeps its title but loses every
 * word under it is worse than one that was never split out, because the
 * title still promises content. So prose survives, but only inside a
 * heading's body that would otherwise come out completely empty; a body that
 * already kept a fence or a table drops its prose exactly as before.
 */
function llmsTxt(skill) {
    const senzaFrontmatter = skill.replace(/^---\n[\s\S]*?\n---\n/, '');
    const righe = senzaFrontmatter.split('\n');

    // Split into heading-delimited blocks first, fence-aware: a line that
    // merely starts with '#' inside a fenced code block (a shell comment,
    // say) is not a heading and must not fracture the block in two.
    const blocchi = [];
    let blocco = { heading: null, corpo: [] };
    let inFenceSplit = false;
    for (const riga of righe) {
        if (riga.startsWith('```')) inFenceSplit = !inFenceSplit;
        if (!inFenceSplit && riga.startsWith('#')) {
            blocchi.push(blocco);
            blocco = { heading: riga, corpo: [] };
            continue;
        }
        blocco.corpo.push(riga);
    }
    blocchi.push(blocco);

    /** The plain structural filter, applied within one block's body only. */
    function struttura(corpo) {
        const out = [];
        let inFence = false;
        for (const riga of corpo) {
            if (riga.startsWith('```')) { inFence = !inFence; out.push(riga); continue; }
            if (inFence) { out.push(riga); continue; }
            if (/^\s*[-*]\s|^\s*\d+\.\s|^\|/.test(riga)) { out.push(riga); continue; }
            if (riga.startsWith('**') || riga.startsWith('>')) { out.push(riga); continue; }
        }
        return out;
    }

    const out = [];
    for (const { heading, corpo } of blocchi) {
        if (heading !== null) out.push('', heading);
        const filtrato = struttura(corpo);
        const rimastoQualcosa = filtrato.some((riga) => riga.trim() !== '');
        out.push(...(rimastoQualcosa ? filtrato : corpo));
    }

    return `# phaser-isometric\n${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
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
