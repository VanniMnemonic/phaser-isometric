import { test, expect } from '@playwright/test';
import { waitFrames, countPixels } from './helpers';

/** The background is #11141a, i.e. r=17 g=20 b=26, with a generous margin
 *  for compression and antialiasing. Anything that falls OUTSIDE this box
 *  is something the scene drew on top of it. */
const BACKGROUND = { rMax: 40, gMax: 45, bMax: 55 };

test.describe('the scene written from SKILL.md alone', () => {
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
