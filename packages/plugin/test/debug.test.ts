// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { createIsoDebug } from '../src/debug';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

async function scenaConfigurata() {
    const scene = await bootGame({ plugins: { scene: [isoScenePlugin()] } });
    scene.iso.configure(DIAMOND);
    return scene;
}

describe('createIsoDebug', () => {
    it('lancia se il plugin non e configurato, prima di creare qualunque oggetto nella Scene', async () => {
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin()] } });
        const prima = scene.children.length;

        // Non e una svista: senza proiezione non c e nulla da disegnare, e un
        // overlay vuoto e indistinguibile da un overlay rotto.
        //
        // La regex punta al testo SPECIFICO della guardia di createIsoDebug
        // ("nothing to draw a debug overlay for"), non a una sottostringa
        // generica come "configure": iso.projection, letto piu' sotto dentro
        // draw(), lancia anch'esso un errore che nomina "configure" (il suo
        // notConfigured('projection')). Un test che si fermasse a /configure/
        // non saprebbe distinguere "la mia guardia ha funzionato" da "un
        // getter a valle ha lanciato per conto suo" — e quindi resterebbe
        // verde anche se questa guardia venisse cancellata per intero.
        expect(() => createIsoDebug(scene.iso)).toThrow(/nothing to draw a debug overlay for/);

        // Se la guardia in testa a createIsoDebug sparisse, il throw
        // arriverebbe comunque — ma piu' tardi, da dentro draw(), quando
        // iso.projection lancia il SUO errore. A quel punto pero'
        // scene.add.graphics() e' gia' stato eseguito: un Graphics orfano
        // resterebbe nella Scene. Questo assert e' cio' che pinna davvero
        // "valida PRIMA di mutare" — una chiamata rifiutata non deve lasciare
        // nulla a meta' nella Scene.
        expect(scene.children.length).toBe(prima);
    });

    it('disegna un rombo per cella nell area richiesta', async () => {
        const scene = await scenaConfigurata();
        const overlay = createIsoDebug(scene.iso, { area: { minX: 0, maxX: 2, minY: 0, maxY: 2 } });

        expect(overlay.cellsDrawn).toBe(9);
        expect(overlay.graphics.scene).toBe(scene);
    });

    it('non lascia niente nella Scene dopo destroy', async () => {
        const scene = await scenaConfigurata();
        const prima = scene.children.length;

        const overlay = createIsoDebug(scene.iso, {
            area: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
            show: { coords: true }
        });
        expect(scene.children.length).toBeGreaterThan(prima);

        overlay.destroy();
        // Se destroy() dimenticasse i Text e distruggesse solo il Graphics,
        // questo conteggio resterebbe alto e un redraw ripetuto accumulerebbe
        // oggetti a ogni frame.
        expect(scene.children.length).toBe(prima);
    });

    it('redraw sostituisce le etichette invece di accumularle', async () => {
        const scene = await scenaConfigurata();
        const overlay = createIsoDebug(scene.iso, {
            area: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
            show: { coords: true }
        });
        const dopoIlPrimo = scene.children.length;

        overlay.redraw();
        overlay.redraw();

        expect(scene.children.length).toBe(dopoIlPrimo);
        overlay.destroy();
    });

    it('setArea cambia cosa viene disegnato', async () => {
        const scene = await scenaConfigurata();
        const overlay = createIsoDebug(scene.iso, { area: { minX: 0, maxX: 0, minY: 0, maxY: 0 } });
        expect(overlay.cellsDrawn).toBe(1);

        overlay.setArea({ minX: 0, maxX: 3, minY: 0, maxY: 3 });
        expect(overlay.cellsDrawn).toBe(16);
        overlay.destroy();
    });

    it('senza area esplicita usa quella che il culling dichiara visibile', async () => {
        const scene = await scenaConfigurata();
        const visibile = scene.iso.cull({ above: 0, below: 0, sides: 0 });
        const attese = (visibile.maxX - visibile.minX + 1) * (visibile.maxY - visibile.minY + 1);

        const overlay = createIsoDebug(scene.iso);
        // Vale come test solo perche il default NON e una costante: se
        // createIsoDebug ignorasse cull() e usasse un'area fissa, questo
        // confronto la prenderebbe.
        expect(overlay.cellsDrawn).toBe(attese);
        expect(attese).toBeGreaterThan(0);
        overlay.destroy();
    });
});
