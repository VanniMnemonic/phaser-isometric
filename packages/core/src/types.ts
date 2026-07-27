/** Un punto in coordinate schermo (pixel). */
export interface Point { x: number; y: number }

/** Una cella della griglia isometrica, con la sua quota. */
export interface Cell { gx: number; gy: number; z: number }

/** Un rettangolo in coordinate schermo. */
export interface Rect { x: number; y: number; width: number; height: number }

/** Un intervallo di celle, estremi INCLUSI. */
export interface GridRect { minX: number; maxX: number; minY: number; maxY: number }

/**
 * La sorgente delle quote. E' un'interfaccia, non una classe: e' il giunto con
 * cui si portano i propri dati. `null` significa abisso — cella non calpestabile
 * e non disegnata — ed e' distinto da quota 0, che e' terreno valido.
 */
export interface HeightSource {
    heightAt(gx: number, gy: number): number | null;

    /**
     * Capability OPZIONALE: un limite superiore alle quote presenti.
     *
     * Se la sorgente la espone, `pick` la usa come default per sapere fino a che
     * quota risalire. Se NON la espone, chi chiama `pick` DEVE passare
     * `opts.maxElevation`, altrimenti il default e' 0 e il picking sonda solo il
     * pavimento: tutto cio' che e' elevato diventa impescabile, in silenzio.
     *
     * E' dichiarata qui, e non letta con un cast strutturale, proprio perche' chi
     * implementa la propria sorgente la veda nell'interfaccia invece di scoprirla
     * da un risultato sbagliato.
     */
    readonly maxElevation?: number;
}

/** Come si costruisce una proiezione. Entrambe le forme producono la stessa matrice. */
export type ProjectionSpec =
    | { type: 'diamond'; tileWidth: number; tileHeight: number; elevationStep?: number }
    | { type: 'matrix'; a: number; b: number; c: number; d: number; elevationStep?: number };

export interface ProjectionOptions {
    /** Traslazione applicata dopo la proiezione. Deve essere INTERA: un'origine
     *  frazionaria reintrodurrebbe proprio l'arrotondamento che la convenzione
     *  del centro elimina. */
    origin?: Point;
}

/** L'indice di una banda di profondita'. */
export type Band = number;

export interface DepthLayout {
    rowStride: number;
    bandStride: number;
    subCapacity: number;
    maxBands: number;
    rowOffset: number;
}

/**
 * Sostituisce la formula chiusa della depth. Chi la fornisce si assume la
 * responsabilita' dell'assenza di pareggi: la garanzia del core vale solo per
 * l'implementazione di default.
 */
export type DepthStrategy = (gx: number, gy: number, band: Band, sub: number) => number;
