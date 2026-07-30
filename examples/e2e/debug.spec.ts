import { test, expect } from '@playwright/test';
import { readyScene, waitFrames, countPixels } from './helpers';

/** La firma del colore di default dell'overlay, 0x00ff88: verde dominante,
 *  rosso basso, blu intermedio. Nessuna texture del playground ci ricade —
 *  e' questo che rende il conteggio una prova invece di un rumore. */
const OVERLAY_GREEN = { rMax: 99, gMin: 181, bMin: 81, bMax: 179 };

test.describe('debug overlay', () => {
    test('draws outlines that are not there with the overlay off', async ({ page }) => {
        const { canvas } = await readyScene(page);

        // La prova NON e' "ci sono pixel verdi": e' "ci sono pixel verdi DOPO
        // e non PRIMA". Un conteggio assoluto passerebbe anche se l'overlay
        // fosse gia' acceso di suo, o se il verde venisse da una texture.
        const before = await countPixels(page, await canvas.screenshot(), OVERLAY_GREEN);

        await page.click('#debug-toggle');
        await page.waitForFunction(() => window.__iso?.debug() !== null);
        await waitFrames(page, 3);

        const after = await countPixels(page, await canvas.screenshot(), OVERLAY_GREEN);
        expect(before).toBe(0);
        expect(after).toBeGreaterThan(500);

        await canvas.screenshot({ path: 'examples/e2e/artifacts/proof5-debug-on.png' });
    });

    test('turning the overlay off restores the canvas to how it was', async ({ page }) => {
        const { canvas } = await readyScene(page);

        // Aspettare lo STATO, non un numero di frame. Il test gemello sopra lo
        // fa gia'; qui restavano due `waitFrames` nudi, che presumono che tre
        // frame bastino sempre. Su una macchina carica non bastano, e il modo
        // in cui fallisce e' il peggiore possibile: la seconda asserzione
        // ("dopo lo spegnimento il verde e' 0") sarebbe verde perche'
        // l'overlay non si e' ancora ACCESO, cioe' passerebbe senza aver mai
        // esercitato destroy(). Un'attesa sullo stato non ha quel modo.
        await page.click('#debug-toggle');
        await page.waitForFunction(() => window.__iso?.debug() !== null);
        await waitFrames(page, 3);
        expect(await countPixels(page, await canvas.screenshot(), OVERLAY_GREEN)).toBeGreaterThan(500);

        await page.click('#debug-toggle');
        await page.waitForFunction(() => window.__iso?.debug() === null);
        await waitFrames(page, 3);

        // Se destroy() lasciasse i Text nella Scene, questo resterebbe > 0.
        expect(await countPixels(page, await canvas.screenshot(), OVERLAY_GREEN)).toBe(0);
    });
});
