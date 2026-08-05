import { describe, expect, it } from 'vitest';
import { buildDiagnosis } from '../src/diagnosis';
import { IsoConfigError } from '../src/errors';
import type { DiagnosisInput } from '../src/diagnosis';

const DIAMANTE_96x48: DiagnosisInput = {
    projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 }
};

const CON_GRIGLIA: DiagnosisInput = {
    projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 },
    grid: { width: 24, height: 24 }
};

/** I codici, nell'ordine in cui sono stati emessi. La scheda resa viene
 *  confrontata verbatim, quindi l'ordine e' contratto, non dettaglio. */
function codici(input: DiagnosisInput): string[] {
    return buildDiagnosis(input).warnings.map(w => w.code);
}

describe('buildDiagnosis: la proiezione', () => {
    it('riporta il determinante, non un prodotto qualunque', () => {
        // 48*24 - 24*(-48). Un `a*d` da solo darebbe 1152.
        expect(buildDiagnosis(DIAMANTE_96x48).projection.det).toBe(2304);
    });

    it('il condizionamento e esattamente 1 per un diamante 2:1', () => {
        expect(buildDiagnosis(DIAMANTE_96x48).projection.conditioning).toBe(1);
    });

    it('il condizionamento scende con un tile piu schiacciato', () => {
        // 96x48 da solo NON coglierebbe un Math.min al posto di Math.max: li'
        // max=48 e min=24, e l'errore sarebbe 4x invece di 1x, cioe' un numero
        // sbagliato che nessuna asserzione su 96x48 distingue da un altro
        // numero sbagliato. Con 96x8 il rapporto e' 1/6 con max e 2/3 con min.
        const d = buildDiagnosis({ projection: { type: 'diamond', tileWidth: 96, tileHeight: 8 } });
        expect(d.projection.conditioning).toBeCloseTo(1 / 6, 10);
    });

    it('riporta il tipo e la misura del tile, che una Projection non conserva', () => {
        const diamante = buildDiagnosis(DIAMANTE_96x48).projection;
        expect(diamante.type).toBe('diamond');
        expect(diamante.tileWidth).toBe(96);
        expect(diamante.tileHeight).toBe(48);

        // Una matrice grezza non ha una misura di tile da riportare, e `na` e'
        // una risposta migliore di un numero inventato dalla matrice.
        const matrice = buildDiagnosis({
            projection: { type: 'matrix', a: 48, b: 24, c: -48, d: 24 }
        }).projection;
        expect(matrice.type).toBe('matrix');
        expect(matrice.tileWidth).toBeNull();
        expect(matrice.tileHeight).toBeNull();
    });

    it('lancia, invece di avvisare, su cio che il costruttore gia rifiuta', () => {
        let errore: unknown;
        try {
            buildDiagnosis({ projection: { type: 'diamond', tileWidth: 0, tileHeight: 48 } });
        } catch (e) {
            errore = e;
        }
        expect(errore).toBeInstanceOf(IsoConfigError);
        // Il campo `fix` non e' decorativo: e' l'unica parte del messaggio che
        // dice cosa fare. Un errore che lo lasciasse vuoto sarebbe un sintomo
        // travestito da diagnosi.
        expect((errore as IsoConfigError).fix.length).toBeGreaterThan(10);
    });
});

describe('buildDiagnosis: il layout di depth', () => {
    it('il massimo dentro una riga e 4095, uno sotto rowStride', () => {
        // (16-1)*256 + (256-1). Un `maxBands*bandStride + subCapacity` darebbe
        // 4352, cioe' sopra rowStride: le bande sborderebbero nella riga dopo.
        expect(buildDiagnosis(DIAMANTE_96x48).depth.maxWithinRow).toBe(4095);
    });

    it('l headroom dentro la riga e esattamente zero sul layout di default', () => {
        // 4096 - 1 - 4095. E' zero DI PROGETTO: il default riempie la riga
        // esatta. Un `rowStride - maxWithinRow` darebbe 1, e con quell'errore
        // la guardia di depth.ts smetterebbe di combaciare col limite vero.
        expect(buildDiagnosis(DIAMANTE_96x48).depth.withinRowHeadroom).toBe(0);
    });

    it('la riga massima sicura tiene conto di rowOffset', () => {
        // Fixture con rowOffset 7 di PROPOSITO: col default a 0 il termine
        // `- rowOffset` e' invisibile e il test non isolerebbe niente.
        const conOffset = buildDiagnosis({
            ...DIAMANTE_96x48,
            depth: { layout: { rowOffset: 7 } }
        }).depth;
        expect(conOffset.maxSafeRow).toBe(2199023255544);

        const default_ = buildDiagnosis(DIAMANTE_96x48).depth;
        expect(default_.maxSafeRow).toBe(2199023255551);
    });

    it('la chiave peggiore alla riga dichiarata', () => {
        const d = buildDiagnosis(DIAMANTE_96x48).depth;
        expect(d.declaredMaxRow).toBe(4096);
        expect(d.worstKey).toBe(16781311);
    });
});

describe('buildDiagnosis: la griglia', () => {
    it('e assente finche nessuno la chiede', () => {
        // Non un oggetto vuoto: una sezione GRID su una griglia che nessuno ha
        // nominato sarebbe un numero inventato che si legge come misura.
        expect(buildDiagnosis(DIAMANTE_96x48).grid).toBeNull();
    });

    it('l ultima riga e (w-1)+(h-1), non w+h', () => {
        expect(buildDiagnosis(CON_GRIGLIA).grid?.maxRow).toBe(46);
    });

    it('la chiave peggiore DENTRO la griglia, non quella del layout', () => {
        // 46*4096 + 4095. Usare declaredMaxRow darebbe 16781311, cioe' la
        // risposta a una domanda diversa da quella che la chiave pone.
        expect(buildDiagnosis(CON_GRIGLIA).grid?.worstKeyInGrid).toBe(192511);
    });

    it('i world bounds combaciano con un letterale calcolato a mano', () => {
        // Letterale di proposito. Ricalcolare `worldBounds(...)` qui dentro
        // sarebbe uno specchio: l'atteso verrebbe dalla stessa funzione sotto
        // esame, e qualunque difetto si rifletterebbe indietro come verde.
        expect(buildDiagnosis(CON_GRIGLIA).grid?.bounds)
            .toEqual({ x: -1152, y: -24, width: 2304, height: 1152 });
    });

    it('celle e sollevamento in pixel', () => {
        const d = buildDiagnosis({ ...CON_GRIGLIA, maxElevation: 3 }).grid;
        expect(d?.cells).toBe(576);
        expect(d?.elevationLiftPx).toBe(72);
    });
});

describe('buildDiagnosis: il round trip', () => {
    it('conta le sonde, e ne aggiunge quando c e elevazione', () => {
        // Il numero finisce nel dossier proprio perche' un errore massimo di 0
        // su zero sonde non e' una prova di niente.
        expect(buildDiagnosis(CON_GRIGLIA).roundTrip.probes).toBe(5);
        expect(buildDiagnosis({ ...CON_GRIGLIA, maxElevation: 3 }).roundTrip.probes).toBe(10);
    });

    it('e esatto, e lo dice con zero e non con un epsilon', () => {
        const rt = buildDiagnosis(CON_GRIGLIA).roundTrip;
        expect(rt.maxGridError).toBe(0);
        expect(rt.exact).toBe(true);
    });

    it('senza errore non nomina nessuna cella peggiore', () => {
        // Restituire la prima sonda invece di null direbbe "il caso peggiore e
        // (0,0)" su una proiezione che non ha casi peggiori.
        expect(buildDiagnosis(CON_GRIGLIA).roundTrip.worstCell).toBeNull();
    });
});

describe('buildDiagnosis: i warning', () => {
    it('coglie i centri frazionari, che una misura intera del tile nasconde', () => {
        // 97 E' un intero: un controllo su tileWidth non vedrebbe niente. La
        // condizione e' sul CENTRO, a=48.5, che e' dove il mezzo pixel nasce.
        expect(codici({ projection: { type: 'diamond', tileWidth: 97, tileHeight: 48 } }))
            .toContain('fractional-tile-centres');
        expect(codici(DIAMANTE_96x48)).not.toContain('fractional-tile-centres');
    });

    it('coglie l elevationStep a zero che il ramo matrix regala in silenzio', () => {
        expect(codici({ projection: { type: 'matrix', a: 48, b: 24, c: -48, d: 24 } }))
            .toContain('elevation-step-zero');
        // Il preset diamante lo calcola da solo, quindi non deve avvisare.
        expect(codici(DIAMANTE_96x48)).not.toContain('elevation-step-zero');
    });

    it('coglie una matrice quasi singolare, e NON una solo schiacciata', () => {
        // Le due meta' insieme rendono la soglia reale: la prima da sola e'
        // soddisfatta da una soglia enorme, la seconda da una minuscola.
        expect(codici({ projection: { type: 'matrix', a: 1, b: 1, c: 1, d: 1.0001 } }))
            .toContain('near-singular-matrix');
        expect(codici({ projection: { type: 'diamond', tileWidth: 96, tileHeight: 8 } }))
            .not.toContain('near-singular-matrix');
    });

    it('coglie una scala implausibile prima che il formattatore ceda', () => {
        expect(codici({ projection: { type: 'matrix', a: 1e6, b: 0, c: 0, d: 1e6 } }))
            .toContain('implausible-tile-scale');
        expect(codici(DIAMANTE_96x48)).not.toContain('implausible-tile-scale');
    });

    it('coglie una griglia oltre la riga per cui il layout e stato validato', () => {
        expect(codici({
            projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            grid: { width: 100, height: 100 },
            depth: { maxRow: 50 }
        })).toContain('grid-exceeds-declared-max-row');
        expect(codici(CON_GRIGLIA)).not.toContain('grid-exceeds-declared-max-row');
    });

    it('coglie un asse che va INDIETRO, che romperebbe la chiave di profondita di default', () => {
        // `keyFor` ordina per gx+gy: e' un ordine di pittore valido solo se
        // avanzare su entrambi gli assi avvicina alla camera, cioe' se b e d
        // sono positivi. Il preset diamond li mette entrambi a th/2, quindi la
        // precondizione non si vede mai — ed e' per questo che non era scritta
        // da nessuna parte.
        expect(codici({ projection: { type: 'matrix', a: 48, b: -24, c: -48, d: 48, elevationStep: 24 } }))
            .toContain('depth-key-assumes-forward-axes');
        expect(codici({ projection: { type: 'matrix', a: 48, b: 24, c: -48, d: -48, elevationStep: 24 } }))
            .toContain('depth-key-assumes-forward-axes');
        expect(codici(DIAMANTE_96x48)).not.toContain('depth-key-assumes-forward-axes');
    });

    it('NON avvisa su un asse piatto (b = 0): li nessuna occlusione e possibile', () => {
        // La meta' che rende reale la soglia `< 0` invece di `<= 0`. Con b = 0
        // l'asse gx non muove in y, quindi due celle che differiscono solo per
        // gx non si sovrappongono mai e il loro ordine e' indifferente:
        // avvisare sarebbe un falso allarme, e `--strict` lo farebbe uscire 2
        // su una configurazione sana.
        expect(codici({ projection: { type: 'matrix', a: 48, b: 0, c: -48, d: 24, elevationStep: 24 } }))
            .not.toContain('depth-key-assumes-forward-axes');
    });

    it('TACE quando il chiamante ha portato la propria strategy', () => {
        // Con una strategy custom `gx + gy` non viene mai calcolato, quindi
        // l'assunzione non e' piu' in gioco e l'avviso sarebbe rumore. Senza
        // questa meta', chi ha gia' risolto il problema nel modo supportato si
        // vedrebbe avvisare comunque — e con `--strict`, fallire la CI.
        expect(codici({
            projection: { type: 'matrix', a: 48, b: -24, c: -48, d: 48, elevationStep: 24 },
            depth: { strategy: (gx, gy) => gx - gy }
        })).not.toContain('depth-key-assumes-forward-axes');
    });

    it('emette i codici in ordine fisso, non nell ordine di un Set', () => {
        // 97x1: centri frazionari (a=48.5), elevationStep frazionario (0.5) e
        // matrice quasi singolare (conditioning 2/97). Tre insieme, e l'ordine
        // e' contratto perche' la scheda viene diffata verbatim.
        expect(codici({ projection: { type: 'diamond', tileWidth: 97, tileHeight: 1 } }))
            .toEqual(['fractional-tile-centres', 'elevation-step-fractional', 'near-singular-matrix']);
    });

    it('una configurazione sana non avvisa di niente', () => {
        expect(buildDiagnosis(CON_GRIGLIA).warnings).toEqual([]);
    });
});

describe('buildDiagnosis: lo schema', () => {
    it('dichiara la forma di questa struttura, non la versione del pacchetto', () => {
        expect(buildDiagnosis(DIAMANTE_96x48).schema).toBe(1);
    });
});
