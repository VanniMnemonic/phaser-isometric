import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { waitFrames, countPixels } from './helpers';
// `with { type: 'json' }` non e' decorativo: Playwright esegue le spec come
// ESM vero attraverso Node, e Node RIFIUTA un import JSON senza attributo con
// `needs an import attribute of "type: json"`. tsc da solo non lo pretende, e
// senza questa riga il typecheck passa e il gate si spegne al primo import.
import background from '../scene-background.json' with { type: 'json' };

/** The background box is shared with the tarball gate — see
 *  examples/scene-background.json for why it is not a literal here.
 *  Anything falling OUTSIDE this box is something the scene drew on top. */
const BACKGROUND = background.box;

const SCENE_SOURCE = fileURLToPath(new URL('../from-docs/src/main.ts', import.meta.url));

test.describe('the scene written from SKILL.md alone', () => {
    test('measures against the background this scene actually declares', () => {
        // The shared constant is only worth having if it still describes this
        // scene. Without this check, changing the scene's background colour
        // would leave the gate below measuring "not #11141a" on a canvas that
        // no longer contains any #11141a — every pixel outside the box, and a
        // green that means nothing.
        const src = readFileSync(SCENE_SOURCE, 'utf8');
        expect(src, `${SCENE_SOURCE} must declare backgroundColor: '${background.hex}'`)
            .toContain(`backgroundColor: '${background.hex}'`);
    });

    test('draws something that is not the background', async ({ page }) => {
        await page.goto('http://localhost:4322/');
        const canvas = page.locator('canvas');
        await canvas.waitFor({ state: 'visible', timeout: 15_000 });
        await waitFrames(page, 5);

        const png = await canvas.screenshot();
        // Not "the canvas exists" — that is true even of a page that never
        // drew anything. The question is whether there is something on top
        // of the background.
        const notBackground = await countPixels(page, png, BACKGROUND, { outside: true });
        expect(notBackground).toBeGreaterThan(10_000);

        await canvas.screenshot({ path: 'examples/e2e/artifacts/proof6-from-docs.png' });
    });
});
