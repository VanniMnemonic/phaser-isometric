// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

/**
 * Questi test leggono l'output di `pnpm build:js`. Se dist non c'e', devono
 * FALLIRE con un messaggio che lo dice — non essere saltati: un `it.skipIf`
 * qui renderebbe verde una suite che non ha verificato la build.
 */
describe('output della build', () => {
    beforeAll(() => {
        expect(
            existsSync(DIST),
            'packages/plugin/dist non esiste: esegui `pnpm build:js` prima della suite'
        ).toBe(true);
    });

    it('emette le tre entry', () => {
        const files = readdirSync(DIST);
        expect(files).toContain('index.js');
        expect(files).toContain('core.js');
        expect(files).toContain('debug.js');
    });

    it('lascia phaser esterno in ogni entry che lo usa', () => {
        const index = readFileSync(join(DIST, 'index.js'), 'utf8');
        expect(index).toMatch(/from\s*["']phaser["']/);
        // Se Phaser fosse stato inlinato, il file peserebbe megabyte e
        // conterrebbe la sua stringa di versione.
        expect(index).not.toContain('PhaserGlobal');
        expect(index.length).toBeLessThan(400_000);
    });

    it('non lascia specifier interni da risolvere al consumatore', () => {
        for (const f of readdirSync(DIST).filter(n => n.endsWith('.js'))) {
            const src = readFileSync(join(DIST, f), 'utf8');
            expect(src, `${f} nomina ancora il pacchetto interno`).not.toContain('@iso-internal/core');
        }
    });

    it('core.js non tira dentro phaser', () => {
        const core = readFileSync(join(DIST, 'core.js'), 'utf8');
        // Il core gira in Node: e' l'intera ragione per cui esiste come
        // sottopath, ed e' cio' che l'oracolo MCP del Piano 4 importera'.
        expect(core).not.toMatch(/from\s*["']phaser["']/);
    });

    it('le entry condividono UNA sola istanza del core', async () => {
        const dalPlugin = await import(join(DIST, 'index.js'));
        const dalCore = await import(join(DIST, 'core.js'));
        // Stessa identita' di classe, non solo stesso nome: se Rollup avesse
        // duplicato il core in due bundle, un IsoConfigError lanciato dal
        // plugin fallirebbe un `instanceof` fatto contro quello del core, e
        // il fallimento arriverebbe al consumatore, non a noi.
        expect(dalPlugin.IsoConfigError).toBe(dalCore.IsoConfigError);
    });
});
