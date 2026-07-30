# phaser-isometric — Piano 3: documentazione per agenti e pubblicazione v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portare `phaser-isometric` da monorepo privato a pacchetto npm installabile — con il sottopath `phaser-isometric/debug`, una SKILL.md per agenti nel formato delle 28 di Phaser, e un tarball provato in un progetto Vite+TS vergine fuori dal monorepo.

**Architecture:** il codice esiste già ed è provato (Piani 1-2). Questo piano aggiunge tre cose e ne collega due. Aggiunge: (a) il modello di debug nel core più il renderer nel guscio, (b) una build reale — Vite in library mode per il JS con Phaser esterno e il core inlinato, `tsc --emitDeclarationOnly` per i tipi, (c) la documentazione. Collega: il **Quick Start della SKILL.md è generato da un progetto Vite+TS reale** che la CI compila (`examples/quickstart`), e **quello stesso file è ciò che il gate del tarball installa e builda**. Un Quick Start sbagliato quindi non è un refuso: è una build rossa.

**Tech Stack:** TypeScript 5.7 · Vite 7 (library mode) · Rollup (via Vite) · vitest 3 · Playwright 1.62 · pnpm 11 · Node 26 · Phaser 4.2.1 (peer `^4.0.0`)

---

## Global Constraints

Ogni task eredita implicitamente questa sezione. Dove un blocco di codice di un task la contraddice, **vince questa sezione**.

1. **Lingua — la regola si ancora all'EXPORT, non alla spedizione.** È in **inglese** tutto ciò che attraversa il confine del pacchetto: nomi esportati, JSDoc su simboli esportati, **ogni messaggio di `throw`**, `SKILL.md`, `llms.txt`, `README.md`, `LICENSE`, i nomi degli step nel workflow CI. È in **italiano** solo il commento interno di un simbolo non esportato. Un commento italiano su un simbolo esportato è un difetto anche se non viene mai letto da un utente.
2. **Validare PRIMA di mutare.** Una funzione che valida e scrive deve completare **tutta** la validazione prima della prima scrittura. Una chiamata rifiutata non lascia nulla a metà.
3. **Un percorso caldo non valida i propri input a ogni frame.** Le eccezioni già decise nel Piano 2 (`pick()` e `cull()` lanciano se il plugin non è configurato) restano come sono: non riaprire quella discussione, è già stata chiusa con un emendamento datato.
4. **`tsc --noEmit` è uno step a sé, mai dietro una pipe.** Una pipeline restituisce l'exit code dell'**ultimo** comando: `tsc … | tail` maschera il fallimento. Vale per ogni gate su cui si dirama un commit.
5. **`lib: ES2020`.** Vietati `Array.prototype.at` (TS2550), `String.prototype.replaceAll`, `Object.groupBy`.
6. **Le due guardie architetturali restano verdi.** Zero import di Phaser nel core (`packages/core/test/purity.test.ts`); zero `*` o `/` binari in `packages/plugin/src/` fuori dall'allowlist (`packages/plugin/test/architecture-no-maths.test.ts`). **Se il debug ha bisogno di un calcolo, il calcolo va nel core** con il suo test in ambiente `node`, e il guscio si limita a chiamarlo. Allargare l'allowlist è l'ultima risorsa, non la prima.
7. **Preflight di mutazione prima di dichiarare verde una suite.** Rompi deliberatamente il codice che il test dovrebbe proteggere e verifica che **quel** test fallisca, nominato. Se non fallisce, il test non sta guardando niente.
8. **Un test che resta verde mentre non verifica niente è il difetto dominante di questo progetto** — sei occorrenze in tredici task nel Piano 2, ogni volta di forma diversa. Per ogni test nuovo, scrivi nel report **cosa si rompe se cancelli il call-site che il test esercita**. Se la risposta è "niente", il test non serve.
9. **Nessuna catena assoluta di numeri.** Ogni task dichiara quanti test aggiunge **lui**; il totale lo riporta il runner. **Il numero misurato vince sempre su quello scritto:** chi trova una discrepanza fra un numero in questo documento e uno misurato **si ferma e la segnala**, non aggiusta il conteggio.
10. **Mai `--no-verify`.** Se un hook fallisce, si corregge la causa e si fa un commit NUOVO.
11. **ESM-only, deliberato.** Nessun output CJS: il pubblico è Vite/Phaser 4, e la mappa `exports` con due formati raddoppia la superficie da congelare senza un consumatore che lo chieda. Da rivedere solo se qualcuno apre una issue.
12. **Versione del pacchetto `0.1.0`; `snapshot().version` resta `1`.** Sono due contratti diversi — uno è la stabilità dell'API, l'altro il formato di un dato — e la SKILL.md deve dirlo esplicitamente, perché il primo che li confonde ci perde un'ora.
13. **Messaggi di commit senza `()` e senza backtick.** In fish la sostituzione di comando avviene **anche dentro i doppi apici** e mangia il token in silenzio. Se un messaggio ne ha bisogno, scrivilo su file e usa `git commit -F <file>`.

---

## Decisioni prese prima di scrivere il piano (2026-07-30)

Quattro decisioni dell'utente, già prese. Non riaprirle:

| Asse | Decisione |
| --- | --- |
| Licenza | **MIT** — la stessa di Phaser e della quasi totalità dei suoi plugin. |
| Repository | **GitHub pubblico**, `https://github.com/VanniMnemonic/phaser-isometric`. Creato nel Task 13, a lavoro finito: non si pubblica un pacchetto a metà. |
| Perimetro | Il piano arriva **fino al tarball verificato**, non al `npm publish`. Il gate della spec — *«installazione pulita in un progetto Vite+TS vergine»* — viene provato su un tarball da `pnpm pack` installato fuori dal monorepo: stessa garanzia, zero irreversibilità. |
| Versione | **`0.1.0`.** Sotto 1.0.0 semver permette un breaking change in una minor, e nessun gioco reale ha ancora esercitato questa API. |

**`npm` non è autenticato** su questa macchina (`npm whoami` → `ENEEDAUTH`). Non è un blocco per questo piano, che si ferma prima: è una nota per il passo successivo, che richiederà `npm login` eseguito dall'utente in un terminale interattivo.

---

## Struttura dei file

### Nuovi

| File | Responsabilità |
| --- | --- |
| `packages/core/src/debug-model.ts` | `buildDebugModel()`: da proiezione + area a rombi, etichette e bounds. **Puro**: nessun Phaser, testabile in `node`. È qui che vive tutta l'aritmetica dell'overlay. |
| `packages/core/test/debug-model.test.ts` | Test del modello di debug. |
| `packages/plugin/src/debug.ts` | Entry del sottopath `phaser-isometric/debug`. Prende il modello e lo **disegna**: `Graphics.strokePoints` + `Text`. Zero aritmetica (guardia AST). |
| `packages/plugin/test/debug.test.ts` | Test jsdom dell'overlay. |
| `packages/plugin/vite.config.ts` | Build library mode, tre entry, `phaser` external, core inlinato. |
| `packages/plugin/tsconfig.build.json` | `emitDeclarationOnly` per il guscio → `dist/types/plugin/`. |
| `packages/core/tsconfig.build.json` | `emitDeclarationOnly` per il core → `packages/plugin/dist/types/core/`. |
| `scripts/build-types.mjs` | Orchestra i due `tsc`, copia `phaser-augment.d.ts`, riscrive lo specifier `@iso-internal/core`, e **fallisce se ne resta uno**. |
| `packages/plugin/test/packaging.test.ts` | Congela la mappa `exports`, i `files`, `sideEffects`, e l'assenza di `phaser` dalle `dependencies`. |
| `packages/plugin/test/dist.test.ts` | Verifica l'**output costruito**: `phaser` esterno, core inlinato, nessuno specifier interno superstite, identità di modulo fra `.` e `./core`. |
| `examples/quickstart/` | Progetto Vite+TS minimo: **la sorgente canonica del Quick Start**. Compilato dalla CI, letto dal generatore di docs, copiato dal gate del tarball. |
| `packages/plugin/skills/phaser-isometric/SKILL.md` | La documentazione per agenti, nel formato esatto delle 28 di Phaser. Spedita dentro il pacchetto npm. |
| `packages/plugin/llms.txt` | Digest compatto, **generato** dalla SKILL.md. |
| `scripts/build-docs.mjs` | Inietta il Quick Start nella SKILL.md, genera `llms.txt`, copia `README.md` e `LICENSE` dentro `packages/plugin/`. Modalità `--check` per la CI. |
| `packages/plugin/test/docs.test.ts` | Il gate di non-divergenza: rigenerare non deve produrre alcun diff. |
| `README.md` (root) | Il README pubblico. Copiato in `packages/plugin/` dal generatore. |
| `LICENSE` (root) | MIT. Copiato in `packages/plugin/` dal generatore. |
| `scripts/verify-tarball.mjs` | Il gate della tappa 5: pack → progetto vergine fuori dal monorepo → install → `tsc --noEmit` → `vite build` → controllo in Chromium che disegni davvero. |
| `examples/e2e/debug.spec.ts` | Prova nel browser che l'overlay disegna. |
| `.github/workflows/check.yml` | CI: build, test, typecheck, e2e **senza il benchmark**. |

### Modificati

| File | Modifica |
| --- | --- |
| `packages/plugin/src/index.ts` | Fuori `ISO_SYS_KEY`, dentro `tileSizeOf`. |
| `packages/plugin/test/public-api.test.ts` | La lista congelata si adegua. |
| `packages/plugin/package.json` | Da `private: true` a manifest di pubblicazione completo. |
| `packages/core/package.json` | Resta `private: true`. Nessuna modifica se non un commento di intento. |
| `package.json` (root) | Script `build`, `build:types`, `docs:check`, `e2e:ci`, `check`. |
| `.gitignore` | `packages/plugin/dist/`, `packages/plugin/README.md`, `packages/plugin/LICENSE` (copie generate). |
| `examples/e2e/bench.spec.ts` | Un tag `@bench` nel titolo del `describe`, così la CI può escluderlo. |

### Perché il modello di debug sta nel core

L'overlay disegna rombi, coordinate, quote, chiavi di depth e i bounds del culling. *Dove* disegnarli è geometria isometrica — cioè matematica, cioè core. *Come* disegnarli è Phaser. La guardia AST del Piano 2 rende questa separazione non negoziabile, e il beneficio è concreto: il modello di debug è testabile in `node` in millisecondi, e nel Piano 4 l'MCP potrà restituirlo senza toccare Phaser.

---

## Ordine e dipendenze

La spec elenca prima la tappa 4 (documentazione) e poi la 5 (pubblicazione). Questo piano **interleava**: la SKILL.md deve documentare la mappa `exports` e il sottopath `debug`, che non esistono finché il packaging non è fatto. L'ordine reale delle dipendenze è:

```
superficie congelata (1)
   └─ debug: core (2) → guscio (3) → prova browser (4)
        └─ build JS (5) → tipi (6) → manifest e exports (7)
             └─ quickstart (8) → SKILL.md (9) → generatore docs (10)
                  ├─ GATE tappa 4: scena scritta solo dai docs (11)
                  └─ GATE tappa 5: tarball in progetto vergine (12)
                       └─ repo pubblico + CI (13)
```

I due gate di uscita della spec restano distinti e in ordine: il Task 11 chiude la tappa 4, il Task 12 chiude la tappa 5.

**Attenzione al Task 7:** cambia la risoluzione di `phaser-isometric` da sorgente TypeScript a `dist/`. Da lì in poi `pnpm typecheck`, `pnpm e2e` e la build di `examples/` **richiedono un `pnpm build` prima**. Chi esegue il Task 7 deve rieseguire i test e2e del Task 4 per dimostrarlo.

---

## Task 1: Congelare la superficie pubblica prima di documentarla

Non si documenta una superficie che si muove ancora. Due residui del Piano 2 vanno chiusi ora, non dopo aver scritto il loro nome in tre file.

**Files:**
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/test/public-api.test.ts`

**Interfaces:**
- Consumes: `ISO_PLUGIN_KEY`, `ISO_SYS_KEY` da `./plugin`; `tileSizeOf` da `@iso-internal/core`.
- Produces: la superficie definitiva della v0.1.0. Ogni task successivo la cita e non la cambia.

Le due decisioni, già prese, da implementare così come sono:

- **`ISO_SYS_KEY` esce dalla superficie pubblica.** È la chiave nascosta con cui `IsoSprite` ritrova il plugin su `scene.sys` qualunque `mapping` sia stato scelto: un dettaglio interno. Resta esportata da `./plugin` per `iso-sprite.ts`, che la importa direttamente; sparisce solo da `index.ts`.
- **`ISO_PLUGIN_KEY` resta pubblica.** Non è simmetria: è la chiave che serve al consumatore per l'unica via d'uscita documentata dal limite dei due `Phaser.Game` sulla stessa pagina, `PluginCache.remove(ISO_PLUGIN_KEY)`. Una costante che compare in una procedura di recupero deve essere importabile.
- **`tileSizeOf` entra nella superficie pubblica del guscio.** È già pubblica nel core, e il blocco di re-export in `index.ts` esiste dichiaratamente perché *«chi usa il plugin non deve aver bisogno di sapere che il core esiste»*. Lasciarla fuori contraddice quella riga.

- [ ] **Step 1: aggiornare la lista congelata nel test**

In `packages/plugin/test/public-api.test.ts`, sostituire il set atteso:

```ts
const ATTESI = new Set([
    'IsoPlugin', 'isoScenePlugin', 'ISO_PLUGIN_KEY',
    'IsoSprite', 'viewOf', 'applyDiamondHitArea', 'IsoUsageError',
    'createProjection', 'createDepthAssigner', 'createHeightGrid',
    'pick', 'cullBounds', 'worldBounds', 'contentBounds', 'diamondPoints',
    'tileSizeOf',
    'DEFAULT_BANDS', 'DEFAULT_LAYOUT', 'IsoConfigError'
]);
```

- [ ] **Step 2: eseguire il test e verificarlo ROSSO**

```
pnpm vitest run packages/plugin/test/public-api.test.ts
```

Atteso: FAIL. Il diff deve mostrare `ISO_SYS_KEY` presente e `tileSizeOf` assente — cioè il test sta guardando la superficie reale, non una copia.

- [ ] **Step 3: aggiornare `packages/plugin/src/index.ts`**

```ts
export { IsoPlugin, isoScenePlugin, ISO_PLUGIN_KEY } from './plugin';
```

e nel blocco di re-export dal core aggiungere `tileSizeOf`:

```ts
export {
    createProjection, createDepthAssigner, createHeightGrid,
    pick, cullBounds, worldBounds, contentBounds, diamondPoints, tileSizeOf,
    DEFAULT_BANDS, DEFAULT_LAYOUT, IsoConfigError
} from '@iso-internal/core';
```

- [ ] **Step 4: eseguire l'intera suite**

```
pnpm test
```

Atteso: verde. Nessun altro file importa `ISO_SYS_KEY` da `../src/index` — è già stato verificato: gli unici consumatori sono `packages/plugin/src/iso-sprite.ts` (che importa da `./plugin`) e i test, che importano tutti da `../src/plugin`. Se il runner dice altro, **il runner ha ragione**: fermarsi e segnalare.

- [ ] **Step 5: typecheck**

```
pnpm typecheck
```

Atteso: 0 errori. Comando a sé, mai in pipe.

- [ ] **Step 6: commit**

```bash
git add packages/plugin/src/index.ts packages/plugin/test/public-api.test.ts
git commit -m "Piano 3 Task 1: congela la superficie pubblica della v0.1.0"
```

---

## Task 2: `buildDebugModel` nel core

Tutta l'aritmetica dell'overlay, pura e testabile in `node`.

**Files:**
- Create: `packages/core/src/debug-model.ts`
- Create: `packages/core/test/debug-model.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Projection` (con `project`, `cornersOf`), `DepthAssigner.keyFor`, `HeightSource.heightAt`, `GridRect`, `Rect`, `Band`, `DEFAULT_BANDS`.
- Produces: `buildDebugModel(projection, opts) => DebugModel`, e i tipi `DebugModelOptions`, `DebugModel`, `DebugLabel`. Il Task 3 li consuma.

- [ ] **Step 1: scrivere il test che fallisce**

Creare `packages/core/test/debug-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createProjection } from '../src/projection';
import { createDepthAssigner, DEFAULT_BANDS } from '../src/depth';
import { createHeightGrid } from '../src/height-grid';
import { buildDebugModel } from '../src/debug-model';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

describe('buildDebugModel', () => {
    it('produce un rombo chiuso per ogni cella dell area', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 0, maxX: 1, minY: 0, maxY: 1 } });

        // 2x2 celle, ognuna 4 vertici = 8 numeri
        expect(model.diamonds).toHaveLength(4);
        for (const d of model.diamonds) expect(d).toHaveLength(8);
        expect(model.cellsRequested).toBe(4);
        expect(model.cellsDrawn).toBe(4);
    });

    it('mette i vertici del rombo esattamente dove cornersOf dice', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 3, maxX: 3, minY: 5, maxY: 5 } });
        const corners = p.cornersOf(3, 5, 0);
        const atteso = corners.flatMap(c => [c.x, c.y]);

        // Se il modello ricalcolasse i vertici per conto suo invece di
        // chiamare cornersOf, una divergenza di mezzo pixel passerebbe
        // inosservata a schermo e questo confronto la prenderebbe.
        expect(model.diamonds[0]).toEqual(atteso);
    });

    it('salta le celle senza terreno e lo dice nel conteggio', () => {
        const p = createProjection(DIAMOND);
        const heights = createHeightGrid(4, 4, 0);
        heights.setHeight(1, 1, null);
        const model = buildDebugModel(p, { area: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, heights });

        // "nessuna cella da disegnare" e "quattro celle, una senza terreno"
        // devono essere distinguibili: un 3 nudo non lo direbbe.
        expect(model.cellsRequested).toBe(4);
        expect(model.cellsDrawn).toBe(3);
        expect(model.diamonds).toHaveLength(3);
    });

    it('disegna ogni cella alla PROPRIA quota, non a zero', () => {
        const p = createProjection(DIAMOND);
        const heights = createHeightGrid(4, 4, 0);
        heights.setHeight(2, 2, 3);
        const model = buildDebugModel(p, { area: { minX: 2, maxX: 2, minY: 2, maxY: 2 }, heights });

        // A quota 3 il rombo sta 3 * elevationStep piu in ALTO (y minore).
        // Con tileHeight 48 lo step di default e 24, quindi 72px.
        const aTerra = p.cornersOf(2, 2, 0);
        const inQuota = p.cornersOf(2, 2, 3);
        expect(inQuota[0].y).toBeLessThan(aTerra[0].y);
        expect(model.diamonds[0]).toEqual(inQuota.flatMap(c => [c.x, c.y]));
    });

    it('etichetta coordinate, quota e chiave di depth solo quando richiesto', () => {
        const p = createProjection(DIAMOND);
        const depth = createDepthAssigner();
        const heights = createHeightGrid(4, 4, 0);
        heights.setHeight(2, 2, 3);

        const nudo = buildDebugModel(p, { area: { minX: 2, maxX: 2, minY: 2, maxY: 2 }, heights });
        expect(nudo.labels).toEqual([]);

        const pieno = buildDebugModel(p, {
            area: { minX: 2, maxX: 2, minY: 2, maxY: 2 },
            heights,
            depth,
            band: DEFAULT_BANDS.floor,
            show: { coords: true, elevation: true, depthKeys: true }
        });
        const testi = pieno.labels.map(l => l.text);
        expect(testi).toContain('2,2');
        expect(testi).toContain('z3');
        expect(testi).toContain(`#${depth.keyFor(2, 2, DEFAULT_BANDS.floor)}`);
    });

    it('lancia se si chiedono le chiavi di depth senza un DepthAssigner', () => {
        const p = createProjection(DIAMOND);
        expect(() => buildDebugModel(p, {
            area: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
            show: { depthKeys: true }
        })).toThrow(/depthKeys/);
    });

    it('restituisce i bounds in pixel di cio che ha davvero disegnato', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 0, maxX: 1, minY: 0, maxY: 1 } });
        const xs = model.diamonds.flatMap(d => d.filter((_, i) => i % 2 === 0));
        const ys = model.diamonds.flatMap(d => d.filter((_, i) => i % 2 === 1));

        expect(model.bounds.x).toBe(Math.min(...xs));
        expect(model.bounds.y).toBe(Math.min(...ys));
        expect(model.bounds.width).toBe(Math.max(...xs) - Math.min(...xs));
        expect(model.bounds.height).toBe(Math.max(...ys) - Math.min(...ys));
    });

    it('su un area vuota restituisce un modello vuoto, non null', () => {
        const p = createProjection(DIAMOND);
        const model = buildDebugModel(p, { area: { minX: 5, maxX: 4, minY: 0, maxY: 0 } });
        expect(model.cellsRequested).toBe(0);
        expect(model.cellsDrawn).toBe(0);
        expect(model.diamonds).toEqual([]);
        expect(model.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});
```

Otto `it()` in questo file.

- [ ] **Step 2: eseguire e verificare che fallisca**

```
pnpm vitest run packages/core/test/debug-model.test.ts
```

Atteso: FAIL con un errore di risoluzione su `../src/debug-model`.

- [ ] **Step 3: implementare `packages/core/src/debug-model.ts`**

```ts
import { IsoConfigError } from './errors';
import { DEFAULT_BANDS } from './depth';
import type { DepthAssigner } from './depth';
import type { Projection } from './projection';
import type { Band, GridRect, HeightSource, Rect } from './types';

/** A single piece of text to draw, already positioned in world pixels. */
export interface DebugLabel {
    readonly x: number;
    readonly y: number;
    readonly text: string;
}

export interface DebugModelOptions {
    /** Inclusive grid range to draw. An empty range yields an empty model. */
    readonly area: GridRect;
    /**
     * Where each cell's elevation comes from. Omit it and every cell is drawn
     * at elevation 0; pass one and cells with no ground are skipped, which is
     * what makes the overlay show the abyss instead of paving over it.
     */
    readonly heights?: HeightSource | null;
    /** Which labels to build. All off by default: an outline-only overlay is
     *  the cheapest useful one, and text is what makes it unreadable. */
    readonly show?: {
        readonly coords?: boolean;
        readonly elevation?: boolean;
        readonly depthKeys?: boolean;
    };
    /** Required when `show.depthKeys` is on, and rejected as missing if not. */
    readonly depth?: DepthAssigner;
    /** Band used for the depth-key labels. Defaults to `floor`. */
    readonly band?: Band;
}

export interface DebugModel {
    /** One closed diamond per drawn cell: 8 numbers, x,y clockwise from the
     *  top vertex — the exact shape `Graphics.strokePoints` wants. */
    readonly diamonds: readonly (readonly number[])[];
    readonly labels: readonly DebugLabel[];
    /** AABB in world pixels of everything in `diamonds`. All zeros when
     *  nothing was drawn. */
    readonly bounds: Rect;
    /** How many cells the area covers. */
    readonly cellsRequested: number;
    /**
     * How many had ground and were drawn.
     *
     * Reported separately from `cellsRequested` on purpose: a bare `3` cannot
     * tell "the area held three cells" apart from "the area held four and one
     * is an abyss", and those two call for opposite reactions.
     */
    readonly cellsDrawn: number;
}

/** Vertical gap between stacked labels on the same cell, in pixels. */
const LABEL_LINE_HEIGHT = 12;

/**
 * Turns a grid area into the geometry a debug overlay draws.
 *
 * Pure and Phaser-free by design: this is where every coordinate of the
 * overlay is computed, so the renderer in the plugin shell has nothing left
 * to calculate — and so the whole overlay stays testable in Node.
 */
export function buildDebugModel(projection: Projection, opts: DebugModelOptions): DebugModel {
    const show = opts.show ?? {};

    if (show.depthKeys && !opts.depth) {
        throw new IsoConfigError(
            'show.depthKeys was requested but no depth assigner was given',
            'pass the plugin depth assigner as opts.depth, for example iso.depth'
        );
    }

    const band = opts.band ?? DEFAULT_BANDS.floor;
    const diamonds: number[][] = [];
    const labels: DebugLabel[] = [];

    let cellsRequested = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let gy = opts.area.minY; gy <= opts.area.maxY; gy += 1) {
        for (let gx = opts.area.minX; gx <= opts.area.maxX; gx += 1) {
            cellsRequested += 1;

            const z = opts.heights ? opts.heights.heightAt(gx, gy) : 0;
            if (z === null) continue;

            const flat: number[] = [];
            for (const corner of projection.cornersOf(gx, gy, z)) {
                flat.push(corner.x, corner.y);
                if (corner.x < minX) minX = corner.x;
                if (corner.x > maxX) maxX = corner.x;
                if (corner.y < minY) minY = corner.y;
                if (corner.y > maxY) maxY = corner.y;
            }
            diamonds.push(flat);

            if (!show.coords && !show.elevation && !show.depthKeys) continue;

            const centre = projection.project(gx, gy, z);
            let riga = centre.y;

            if (show.coords) {
                labels.push({ x: centre.x, y: riga, text: `${gx},${gy}` });
                riga += LABEL_LINE_HEIGHT;
            }
            if (show.elevation) {
                labels.push({ x: centre.x, y: riga, text: `z${z}` });
                riga += LABEL_LINE_HEIGHT;
            }
            if (show.depthKeys && opts.depth) {
                labels.push({ x: centre.x, y: riga, text: `#${opts.depth.keyFor(gx, gy, band)}` });
            }
        }
    }

    const bounds: Rect = diamonds.length === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    return { diamonds, labels, bounds, cellsRequested, cellsDrawn: diamonds.length };
}
```

- [ ] **Step 4: esportare dal core**

In `packages/core/src/index.ts`, dopo il blocco di `hit-area`:

```ts
export { buildDebugModel } from './debug-model';
export type { DebugModel, DebugModelOptions, DebugLabel } from './debug-model';
```

- [ ] **Step 5: eseguire i test**

```
pnpm vitest run packages/core/test/debug-model.test.ts
```

Atteso: PASS, otto test.

Poi la superficie del core: `packages/core/test/public-api.test.ts` congela anche lui la lista degli export. **Se fallisce, aggiornare quella lista** aggiungendo `buildDebugModel` — è il comportamento voluto, non un difetto.

- [ ] **Step 6: preflight di mutazione**

Tre mutazioni, una alla volta, ognuna ripristinata prima della successiva:

1. In `buildDebugModel`, sostituire `projection.cornersOf(gx, gy, z)` con `projection.cornersOf(gx, gy, 0)`.
   Atteso: fallisce *«disegna ogni cella alla PROPRIA quota, non a zero»*.
2. Sostituire `if (z === null) continue;` con `if (false) continue;`.
   Atteso: fallisce *«salta le celle senza terreno e lo dice nel conteggio»*.
3. Sostituire `cellsDrawn: diamonds.length` con `cellsDrawn: cellsRequested`.
   Atteso: fallisce lo stesso test di sopra.

Se una di queste **non** fa fallire nulla, il test corrispondente non sta guardando niente: si corregge il test, non la mutazione.

- [ ] **Step 7: suite intera e typecheck**

```
pnpm test
```
```
pnpm typecheck
```

Atteso: entrambi verdi. Le guardie architetturali comprese: `debug-model.ts` è nel core, dove la matematica è di casa, ma **non deve importare Phaser** — `purity.test.ts` lo verifica da solo.

- [ ] **Step 8: commit**

```bash
git add packages/core/src/debug-model.ts packages/core/test/debug-model.test.ts packages/core/src/index.ts packages/core/test/public-api.test.ts
git commit -m "Piano 3 Task 2: modello di debug puro nel core"
```

---

## Task 3: il sottopath `phaser-isometric/debug`

Il renderer. Prende il modello e lo disegna. **Zero aritmetica**: la guardia AST del Piano 2 fallisce su qualunque `*` o `/` binario in questo file, e in questo caso ha ragione per costruzione — tutte le coordinate arrivano già calcolate dal Task 2.

**Files:**
- Create: `packages/plugin/src/debug.ts`
- Create: `packages/plugin/test/debug.test.ts`

**Interfaces:**
- Consumes: `buildDebugModel`, `DebugModel`, `Band`, `GridRect`, `CullPadding` dal core; `IsoPlugin` (con `projection`, `depth`, `heights`, `cull`) da `./plugin`; `IsoUsageError` da `./errors`.
- Produces: `createIsoDebug(iso, opts) => IsoDebugOverlay`, `IsoDebugOptions`, `IsoDebugOverlay`. Il Task 4 e il Task 7 li consumano.

Nota su `CullPadding`: la forma reale è `{ above: number; below: number; sides: number }`, **non** `{ maxElevation, maxSpriteHeight }` come nella prosa della spec §4.5. La spec descrive l'intento; il codice è autorevole.

- [ ] **Step 1: scrivere il test che fallisce**

Creare `packages/plugin/test/debug.test.ts`. Usare lo stesso schema degli altri test jsdom del pacchetto — `bootGame`/`destroyGame`/`forgetScenePlugin` da `./helper`, docblock `// @vitest-environment jsdom` in cima:

```ts
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
    it('lancia se il plugin non e configurato', async () => {
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin()] } });
        // Non e una svista: senza proiezione non c e nulla da disegnare, e un
        // overlay vuoto e indistinguibile da un overlay rotto.
        expect(() => createIsoDebug(scene.iso)).toThrow(/configure/);
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
```

Sei `it()` in questo file.

- [ ] **Step 2: eseguire e verificare che fallisca**

```
pnpm vitest run packages/plugin/test/debug.test.ts
```

Atteso: FAIL, `../src/debug` non risolve.

- [ ] **Step 3: implementare `packages/plugin/src/debug.ts`**

```ts
import Phaser from 'phaser';
import { buildDebugModel } from '@iso-internal/core';
import type { Band, CullPadding, GridRect } from '@iso-internal/core';
import { IsoUsageError } from './errors';
import type { IsoPlugin } from './plugin';

export interface IsoDebugOptions {
    /** Cells to draw. Defaults to whatever `iso.cull(pad)` reports as visible,
     *  which is also the cheapest way to see the culling working. */
    area?: GridRect;
    /** Padding handed to `iso.cull()` when `area` is omitted. */
    pad?: CullPadding;
    show?: { coords?: boolean; elevation?: boolean; depthKeys?: boolean };
    /** Band used for the depth-key labels. */
    band?: Band;
    /** Outline colour, `0xRRGGBB`. */
    color?: number;
    /** Outline alpha, 0 to 1. */
    alpha?: number;
    /** Label colour, as a CSS string. */
    textColor?: string;
    /** Label size, as a CSS string. */
    fontSize?: string;
}

export interface IsoDebugOverlay {
    /** The Graphics object the outlines are stroked into. Exposed so the
     *  overlay can be re-parented, tinted or hidden by the host game. */
    readonly graphics: Phaser.GameObjects.Graphics;
    /** How many cells the last draw actually produced an outline for. */
    readonly cellsDrawn: number;
    /** Rebuilds the model from the plugin's CURRENT state and redraws. */
    redraw(): IsoDebugOverlay;
    /** Draws a different area from now on, and redraws immediately. */
    setArea(area: GridRect): IsoDebugOverlay;
    /** Removes the Graphics and every label from the Scene. */
    destroy(): void;
}

const DEFAULT_PAD: CullPadding = { above: 0, below: 0, sides: 0 };

/**
 * Draws the isometric debug overlay: cell outlines, and optionally grid
 * coordinates, elevations and depth keys.
 *
 * Lives behind the `phaser-isometric/debug` subpath so it never reaches a
 * production bundle unless it is imported on purpose. Phaser's own
 * `TilemapLayer.renderDebug` is a no-op for anything that is not orthogonal,
 * which is why this exists at all.
 *
 * Every coordinate it draws comes from the core's `buildDebugModel`: this
 * module decides colours and Phaser objects, never positions.
 */
export function createIsoDebug(iso: IsoPlugin, opts: IsoDebugOptions = {}): IsoDebugOverlay {
    if (!iso.isConfigured) {
        throw new IsoUsageError(
            'the isometric plugin has no projection yet, so there is nothing to draw a debug overlay for',
            'call iso.configure({ ... }) before createIsoDebug(iso), or install the plugin with isoScenePlugin({ ... })'
        );
    }

    const scene = iso.graphicsScene;
    const graphics = scene.add.graphics();
    graphics.setDepth(Number.MAX_SAFE_INTEGER);

    let area: GridRect | null = opts.area ?? null;
    let labels: Phaser.GameObjects.Text[] = [];
    let cellsDrawn = 0;

    const textStyle = {
        color: opts.textColor ?? '#ffffff',
        fontSize: opts.fontSize ?? '10px'
    };

    function clearLabels(): void {
        for (const label of labels) label.destroy();
        labels = [];
    }

    function draw(): void {
        const zona = area ?? iso.cull(opts.pad ?? DEFAULT_PAD);
        const model = buildDebugModel(iso.projection, {
            area: zona,
            heights: iso.heights,
            depth: iso.depth,
            band: opts.band,
            show: opts.show
        });

        graphics.clear();
        clearLabels();
        graphics.lineStyle(1, opts.color ?? 0x00ff88, opts.alpha ?? 0.6);

        for (const diamond of model.diamonds) {
            graphics.strokePoints(toPoints(diamond), true);
        }
        for (const label of model.labels) {
            const text = scene.add.text(label.x, label.y, label.text, textStyle);
            text.setOrigin(0.5, 0.5);
            text.setDepth(Number.MAX_SAFE_INTEGER);
            labels.push(text);
        }

        cellsDrawn = model.cellsDrawn;
    }

    // Il modello consegna coppie x,y piatte perche' e' la forma che non
    // costringe il core a conoscere Vector2; strokePoints vuole oggetti.
    // La conversione e' l'unico adattamento di forma che questo modulo fa.
    function toPoints(flat: readonly number[]): { x: number; y: number }[] {
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < flat.length; i += 2) {
            points.push({ x: flat[i] as number, y: flat[i + 1] as number });
        }
        return points;
    }

    draw();

    return {
        graphics,
        get cellsDrawn() { return cellsDrawn; },
        redraw() { draw(); return this; },
        setArea(next: GridRect) { area = next; draw(); return this; },
        destroy() { clearLabels(); graphics.destroy(); }
    };
}
```

**`iso.graphicsScene` non esiste ancora.** `IsoPlugin` estende `Phaser.Plugins.ScenePlugin`, la cui `scene` è `protected` **e** nullable. Aggiungere in `packages/plugin/src/plugin.ts` un accessore pubblico, con lo stesso stile degli altri getter già presenti:

```ts
    /**
     * The Scene this plugin belongs to.
     *
     * `ScenePlugin.scene` is `protected` and nullable, so anything outside the
     * class — the debug overlay, a host game's own tooling — cannot reach it
     * without a cast. Exposing it once, guarded, beats a cast at every call
     * site, each of which would be a place to get the null check wrong.
     */
    get graphicsScene(): Phaser.Scene {
        if (!this.scene) {
            throw new IsoUsageError(
                'this plugin is not attached to a Scene',
                'use the plugin from inside a Scene that is running, not after its shutdown'
            );
        }
        return this.scene;
    }
```

Nessun test del pacchetto enumera i membri di `IsoPlugin` — verificato: `scene-api.test.ts` non contiene alcun assert di uguaglianza su `Object.keys`. Aggiungere `graphicsScene` non rompe quindi nessuna lista congelata. Se il runner dice il contrario, **ha ragione lui**: fermarsi e segnalare.

- [ ] **Step 4: eseguire il test**

```
pnpm vitest run packages/plugin/test/debug.test.ts
```

Atteso: PASS, sei test.

- [ ] **Step 5: verificare la guardia architetturale**

```
pnpm vitest run packages/plugin/test/architecture-no-maths.test.ts
```

Atteso: PASS **senza toccare l'allowlist**. `debug.ts` contiene `i += 2` e `flat[i + 1]`, che sono addizioni: la guardia coglie solo `*`, `/`, `*=`, `/=`. Se qualcuno ha introdotto una moltiplicazione, la risposta corretta è spostare il calcolo nel core, non allargare l'allowlist.

- [ ] **Step 6: preflight di mutazione**

1. In `draw()`, sostituire `clearLabels();` con una riga vuota.
   Atteso: fallisce *«redraw sostituisce le etichette invece di accumularle»*.
2. In `destroy()`, togliere `clearLabels();`.
   Atteso: fallisce *«non lascia niente nella Scene dopo destroy»*.
3. Sostituire `area ?? iso.cull(...)` con `area ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 }`.
   Atteso: fallisce *«senza area esplicita usa quella che il culling dichiara visibile»*.

- [ ] **Step 7: suite intera e typecheck**

```
pnpm test
```
```
pnpm typecheck
```

- [ ] **Step 8: commit**

```bash
git add packages/plugin/src/debug.ts packages/plugin/src/plugin.ts packages/plugin/test/debug.test.ts
git commit -m "Piano 3 Task 3: overlay di debug nel guscio, sottopath dedicato"
```

---

## Task 4: prova nel browser che l'overlay disegna

Un test jsdom conta oggetti nella display list. Non dice che sullo schermo compaia una linea. Sotto HEADLESS non esiste la metà render del frame: `preRender` non gira, `camera.renderList` resta vuoto. Solo un browser vero può dirlo, ed è per questo che il gate del Piano 2 esiste.

**Files:**
- Create: `examples/e2e/debug.spec.ts`
- Modify: `examples/src/scene.ts`, `examples/index.html`, `examples/e2e/helpers.ts`

**Interfaces:**
- Consumes: `createIsoDebug` da `phaser-isometric/debug` — dentro il monorepo risolve come import relativo finché il Task 7 non aggiunge la mappa `exports`. In `examples/src/scene.ts` importare da `phaser-isometric/debug`: il workspace lo risolve già oggi tramite `main`, e dopo il Task 7 tramite `exports`. Se non risolve prima del Task 7, importare temporaneamente da `../../packages/plugin/src/debug` **e annotarlo nel report**, perché il Task 7 dovrà rimetterlo a posto.
- Produces: il pulsante DOM `#debug-toggle` e `window.__iso.debug`, che il test e2e legge.

- [ ] **Step 1: esporre l'overlay nel playground**

In `examples/index.html`, accanto a `#zoom-toggle`, aggiungere:

```html
<button id="debug-toggle">debug: off</button>
```

In `examples/src/scene.ts`, estendere l'hook e cablare il pulsante:

```ts
import { createIsoDebug } from 'phaser-isometric/debug';
import type { IsoDebugOverlay } from 'phaser-isometric/debug';
```

Aggiungere a `IsoPlaygroundHook`:

```ts
    /** The debug overlay, or null while it is off. */
    debug: () => IsoDebugOverlay | null;
```

Nel corpo della Scene:

```ts
    private overlay: IsoDebugOverlay | null = null;

    /** Toggles the debug overlay from the DOM button. Kept out of create()
     *  so the playground stays readable. */
    private wireDebugToggle(): void {
        const button = document.getElementById('debug-toggle');
        if (!button) return;

        button.addEventListener('click', () => {
            if (this.overlay) {
                this.overlay.destroy();
                this.overlay = null;
                button.textContent = 'debug: off';
                return;
            }
            this.overlay = createIsoDebug(this.iso, {
                area: { minX: 0, maxX: GRID_SIZE - 1, minY: 0, maxY: GRID_SIZE - 1 },
                show: { coords: true, elevation: true }
            });
            button.textContent = 'debug: on';
        });
    }
```

Chiamare `this.wireDebugToggle();` accanto a `this.wireZoomToggle();`, e aggiungere `debug: () => this.overlay` all'oggetto assegnato a `window.__iso`.

- [ ] **Step 2: aggiungere un contatore di pixel agli helper e2e**

`examples/e2e/helpers.ts` sa già campionare **punti** singoli (`samplePixels`), non contarli tutti. Il conteggio va aggiunto lì, con la stessa tecnica — decodificare uno **screenshot PNG** dentro la pagina, **mai** disegnare il canvas WebGL vivo:

```ts
/**
 * Counts the pixels of a PNG screenshot that satisfy a colour predicate.
 *
 * Same technique as {@link samplePixels} and for the same reason: it decodes a
 * static image the compositor already produced, so it needs none of the
 * `preserveDrawingBuffer` workaround that reading the live WebGL canvas would.
 * The predicate is passed as source text because it has to be evaluated in the
 * page, where a closure from this file cannot reach.
 */
export async function countPixels(page: Page, png: Buffer, predicate: string): Promise<number> {
    const base64 = png.toString('base64');
    return page.evaluate(async ({ base64, predicate }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable for pixel counting');
        ctx.drawImage(img, 0, 0);

        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const test = new Function('r', 'g', 'b', `return (${predicate});`) as
            (r: number, g: number, b: number) => boolean;

        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (test(data[i] as number, data[i + 1] as number, data[i + 2] as number)) n += 1;
        }
        return n;
    }, { base64, predicate });
}
```

- [ ] **Step 3: scrivere il test e2e**

Creare `examples/e2e/debug.spec.ts`, usando gli helper reali del Piano 2 — `readyScene`, `waitFrames`, e il nuovo `countPixels`:

```ts
import { test, expect } from '@playwright/test';
import { readyScene, waitFrames, countPixels } from './helpers';

/** La firma del colore di default dell'overlay, 0x00ff88: verde dominante,
 *  rosso basso, blu intermedio. Nessuna texture del playground ci ricade —
 *  e' questo che rende il conteggio una prova invece di un rumore. */
const VERDE_OVERLAY = 'g > 180 && r < 100 && b > 80 && b < 180';

test.describe('overlay di debug', () => {
    test('disegna contorni che a overlay spento non ci sono', async ({ page }) => {
        const { canvas } = await readyScene(page);

        // La prova NON e "ci sono pixel verdi": e "ci sono pixel verdi DOPO e
        // non PRIMA". Un conteggio assoluto passerebbe anche se l'overlay
        // fosse gia acceso di suo, o se il verde venisse da una texture.
        const prima = await countPixels(page, await canvas.screenshot(), VERDE_OVERLAY);

        await page.click('#debug-toggle');
        await page.waitForFunction(() => window.__iso?.debug() !== null);
        await waitFrames(page, 3);

        const dopo = await countPixels(page, await canvas.screenshot(), VERDE_OVERLAY);
        expect(prima).toBe(0);
        expect(dopo).toBeGreaterThan(500);

        await canvas.screenshot({ path: 'examples/e2e/artifacts/proof5-debug-on.png' });
    });

    test('spegnere l overlay riporta il canvas com era', async ({ page }) => {
        const { canvas } = await readyScene(page);

        await page.click('#debug-toggle');
        await waitFrames(page, 3);
        expect(await countPixels(page, await canvas.screenshot(), VERDE_OVERLAY)).toBeGreaterThan(500);

        await page.click('#debug-toggle');
        await waitFrames(page, 3);

        // Se destroy() lasciasse i Text nella Scene, questo resterebbe > 0.
        expect(await countPixels(page, await canvas.screenshot(), VERDE_OVERLAY)).toBe(0);
    });
});
```

`readyScene` attende `window.__iso` e cinque frame reali prima di restituire: è il motivo per cui `depthSort` e `preRender` sono davvero girati quando il test guarda i pixel. Non sostituirlo con un `waitForSelector`.

- [ ] **Step 4: eseguire e verificare**

```
pnpm e2e
```

Atteso: verde, e in `examples/e2e/artifacts/proof5-debug-on.png` si vedono i contorni dei rombi e le etichette. **Guardare davvero il PNG**: è l'unico passo di questo task che un test non può fare al posto tuo.

- [ ] **Step 5: preflight di mutazione**

In `packages/plugin/src/debug.ts`, sostituire `graphics.strokePoints(toPoints(diamond), true);` con `void diamond;`.
Atteso: fallisce *«disegna contorni che a overlay spento non ci sono»*. Se resta verde, `countPixels` sta cercando il colore sbagliato: verificarlo aprendo il PNG, non alzando la soglia.

- [ ] **Step 6: commit**

```bash
git add examples/src/scene.ts examples/index.html examples/e2e/helpers.ts examples/e2e/debug.spec.ts examples/e2e/artifacts/proof5-debug-on.png
git commit -m "Piano 3 Task 4: prova nel browser che l overlay di debug disegna"
```

---

## Task 5: build della libreria — il JavaScript

Vite in library mode, tre entry, `phaser` esterno, core inlinato.

**Files:**
- Create: `packages/plugin/vite.config.ts`
- Create: `packages/plugin/test/dist.test.ts`
- Modify: `package.json` (root), `.gitignore`
- Add dev dependency: `vite`

**Interfaces:**
- Produces: `packages/plugin/dist/index.js`, `dist/core.js`, `dist/debug.js`. Il Task 6 ci affianca i tipi, il Task 7 li nomina nella mappa `exports`.

- [ ] **Step 1: installare Vite come dipendenza di sviluppo del pacchetto**

```
pnpm --filter phaser-isometric add -D vite@^7.3.6
```

`vite@7.3.6` è già nello store pnpm (lo usa `examples/`), quindi l'installazione è locale e non richiede rete.

- [ ] **Step 2: scrivere `packages/plugin/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Library build for the published package.
 *
 * Three entries, one for each subpath in the exports map. `phaser` stays
 * external — bundling a second copy would create a second set of classes,
 * making `instanceof` false and registering the factory on a prototype the
 * host game never sees. The pure core, by contrast, IS bundled: it is not a
 * published dependency, and Rollup hoists the part both entries share into a
 * single chunk, so `phaser-isometric` and `phaser-isometric/core` keep one
 * module instance between them.
 */
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2020',
        minify: false,
        sourcemap: true,
        lib: {
            entry: {
                index: fileURLToPath(new URL('src/index.ts', import.meta.url)),
                core: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
                debug: fileURLToPath(new URL('src/debug.ts', import.meta.url))
            },
            formats: ['es']
        },
        rollupOptions: {
            external: ['phaser'],
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunk-[name].js'
            }
        }
    }
});
```

`minify: false` è deliberato: chi legge uno stack trace dentro un gioco altrui deve poter riconoscere il nostro codice, e la minificazione la fa comunque il bundler del consumatore.

- [ ] **Step 3: aggiungere gli script alla root**

In `package.json` (root), dentro `scripts`:

```json
    "build:js": "vite build --config packages/plugin/vite.config.ts",
    "build": "pnpm build:js && pnpm build:types",
```

`build:types` viene riscritto nel Task 6; per ora lascialo com'è — punta solo al core e non rompe niente.

Aggiungere a `.gitignore`:

```
packages/plugin/dist/
```

(la riga `packages/*/dist/` già presente lo copre; verificarlo con `git check-ignore -v packages/plugin/dist` e non duplicare se è già coperto).

- [ ] **Step 4: costruire**

```
pnpm build:js
```

Atteso: `packages/plugin/dist/` contiene `index.js`, `core.js`, `debug.js`, uno o più `chunk-*.js` e le sourcemap.

- [ ] **Step 5: scrivere il test sull'output costruito**

Creare `packages/plugin/test/dist.test.ts`:

```ts
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
```

Cinque `it()` in questo file.

L'import di `dist/index.js` valuta un modulo che fa `import 'phaser'`: sotto vitest la risoluzione funziona perché `phaser` è una devDependency del pacchetto. Se il caricamento fallisce nell'ambiente `node`, aggiungere `// @vitest-environment jsdom` in cima al file e il setup Phaser vendorizzato lo copre — è lo stesso motivo per cui esiste `packages/plugin/test/vendor/phaser-jsdom-setup.js`.

- [ ] **Step 6: eseguire**

```
pnpm vitest run packages/plugin/test/dist.test.ts
```

Atteso: PASS, cinque test.

- [ ] **Step 7: preflight di mutazione**

In `vite.config.ts`, togliere `external: ['phaser']` e ricostruire.
Atteso: fallisce *«lascia phaser esterno in ogni entry che lo usa»*, sia sulla regex sia sulla dimensione. Ripristinare e ricostruire.

- [ ] **Step 8: commit**

```bash
git add packages/plugin/vite.config.ts packages/plugin/package.json packages/plugin/test/dist.test.ts package.json pnpm-lock.yaml
git commit -m "Piano 3 Task 5: build della libreria in ESM, phaser esterno, core inlinato"
```

---

## Task 6: i tipi, e lo specifier che va riscritto

Vite in library mode emette **zero** `.d.ts`. I tipi escono da un `tsc --emitDeclarationOnly` separato — l'unica strada provata, perché `vite-plugin-dts` e `rollup-plugin-dts` sono storicamente proprio il punto in cui un blocco `declare global` si perde.

Due trappole concrete che questo task deve chiudere:

1. **`tsc` non riscrive mai gli specifier di modulo.** Il `.d.ts` emesso del guscio conterrà `from '@iso-internal/core'`, un pacchetto che non esiste per il consumatore. Va riscritto in un percorso relativo, dopo l'emissione.
2. **`tsc` non ri-emette i file `.d.ts` di input.** `packages/plugin/src/phaser-augment.d.ts` non finisce in output, ma `index.d.ts` continua a portarsi dietro il suo `/// <reference path="./phaser-augment.d.ts" />`: il riferimento punterebbe nel vuoto e **ogni `this.iso` del consumatore diventerebbe un TS2339**. Va copiato a mano.

**Files:**
- Create: `packages/core/tsconfig.build.json`, `packages/plugin/tsconfig.build.json`, `scripts/build-types.mjs`
- Modify: `package.json` (root)
- Test: `packages/plugin/test/dist.test.ts` (esteso)

- [ ] **Step 1: i due tsconfig di build**

`packages/core/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declarationDir": "../plugin/dist/types/core",
    "outDir": null
  },
  "include": ["src"]
}
```

`packages/plugin/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declarationDir": "dist/types/plugin",
    "outDir": null
  },
  "include": ["src"]
}
```

Se `"outDir": null` viene rifiutato da TypeScript 5.7, toglierlo: `declarationDir` ha comunque la precedenza per i `.d.ts`, e con `emitDeclarationOnly` non viene emesso nessun `.js`. **Verificarlo, non assumerlo**: dopo lo Step 3, controllare che in `packages/*/dist` non compaia alcun `.js`.

- [ ] **Step 2: scrivere `scripts/build-types.mjs`**

```js
/**
 * Emits the published type declarations.
 *
 * Three steps that must happen in this order: emit both packages, copy the
 * global augmentation that `tsc` refuses to re-emit, then rewrite the one
 * module specifier that would not resolve on a consumer's machine. The final
 * scan is the point of the whole script: it fails loudly rather than shipping
 * a `.d.ts` that only resolves inside this monorepo.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(ROOT, 'packages/plugin/dist/types');
const INTERNAL = '@iso-internal/core';

function tsc(project) {
    execFileSync('npx', ['tsc', '-p', project], { cwd: ROOT, stdio: 'inherit' });
}

function allFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...allFiles(full));
        else out.push(full);
    }
    return out;
}

tsc('packages/core/tsconfig.build.json');
tsc('packages/plugin/tsconfig.build.json');

// `tsc` non ri-emette i .d.ts di input, ma conserva il loro triple-slash
// reference nell'output: senza questa copia il riferimento punta nel vuoto e
// l'augmentation globale non raggiunge il consumatore.
copyFileSync(
    join(ROOT, 'packages/plugin/src/phaser-augment.d.ts'),
    join(TYPES, 'plugin/phaser-augment.d.ts')
);

const coreEntry = join(TYPES, 'core/index.d.ts');
for (const file of allFiles(join(TYPES, 'plugin'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes(INTERNAL)) continue;
    const rel = relative(dirname(file), coreEntry).replace(/\\/g, '/').replace(/\.d\.ts$/, '.js');
    const prefixed = rel.startsWith('.') ? rel : `./${rel}`;
    writeFileSync(file, src.split(INTERNAL).join(prefixed));
}

const superstiti = allFiles(TYPES).filter(f => readFileSync(f, 'utf8').includes(INTERNAL));
if (superstiti.length > 0) {
    console.error(`Lo specifier interno ${INTERNAL} sopravvive in:\n  ${superstiti.join('\n  ')}`);
    process.exit(1);
}

console.log(`Tipi emessi in ${relative(ROOT, TYPES)}`);
```

Nota: la riscrittura usa `split().join()`, non una regex — la stringa non contiene metacaratteri, e una `String.prototype.replaceAll` sarebbe vietata da `lib: ES2020` in TypeScript, quindi meglio non prendere l'abitudine nemmeno nei `.mjs`.

- [ ] **Step 3: sostituire lo script `build:types`**

In `package.json` (root):

```json
    "build:types": "node scripts/build-types.mjs",
```

- [ ] **Step 4: costruire i tipi**

```
pnpm build:types
```

Atteso: exit 0 e la riga `Tipi emessi in packages/plugin/dist/types`. Verificare a mano che esistano `dist/types/plugin/index.d.ts`, `dist/types/plugin/debug.d.ts`, `dist/types/plugin/phaser-augment.d.ts`, `dist/types/core/index.d.ts`, e che in `packages/core/dist` e `packages/plugin/dist` non ci sia nessun `.js` emesso da tsc.

- [ ] **Step 5: estendere `dist.test.ts` con i tipi**

Aggiungere in fondo a `packages/plugin/test/dist.test.ts`:

```ts
describe('tipi pubblicati', () => {
    const T = join(DIST, 'types');

    it('emette le tre dichiarazioni di entry', () => {
        expect(existsSync(join(T, 'plugin/index.d.ts'))).toBe(true);
        expect(existsSync(join(T, 'plugin/debug.d.ts'))).toBe(true);
        expect(existsSync(join(T, 'core/index.d.ts'))).toBe(true);
    });

    it('porta con se l augmentation globale, non solo il riferimento', () => {
        const index = readFileSync(join(T, 'plugin/index.d.ts'), 'utf8');
        expect(index).toContain('phaser-augment.d.ts');
        // Il riferimento senza il file e' peggio del file senza il
        // riferimento: compila, e ogni `this.iso` del consumatore diventa un
        // TS2339 senza che nulla dica perche'.
        expect(existsSync(join(T, 'plugin/phaser-augment.d.ts'))).toBe(true);
        const aug = readFileSync(join(T, 'plugin/phaser-augment.d.ts'), 'utf8');
        expect(aug).toContain('declare global');
        expect(aug).not.toContain("declare module 'phaser'");
    });

    it('non lascia specifier interni nei tipi', () => {
        for (const f of allDts(T)) {
            expect(readFileSync(f, 'utf8'), `${f}`).not.toContain('@iso-internal/core');
        }
    });
});

function allDts(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...allDts(full));
        else if (full.endsWith('.d.ts')) out.push(full);
    }
    return out;
}
```

Servono `statSync` nell'import di `node:fs` in cima al file. Tre `it()` in più.

- [ ] **Step 6: eseguire**

```
pnpm vitest run packages/plugin/test/dist.test.ts
```

Atteso: PASS.

- [ ] **Step 7: preflight di mutazione**

1. In `scripts/build-types.mjs`, commentare la `copyFileSync` e rieseguire `pnpm build:types`.
   Atteso: fallisce *«porta con se l augmentation globale, non solo il riferimento»*.
2. Commentare il ciclo di riscrittura e rieseguire.
   Atteso: **lo script stesso esce con codice 1** prima ancora dei test. Questo è il comportamento voluto: un errore di packaging deve fermare la build, non aspettare la suite.

Ripristinare e ricostruire dopo ciascuna.

- [ ] **Step 8: commit**

```bash
git add packages/core/tsconfig.build.json packages/plugin/tsconfig.build.json scripts/build-types.mjs packages/plugin/test/dist.test.ts package.json
git commit -m "Piano 3 Task 6: emissione dei tipi, copia dell augmentation e riscrittura dello specifier interno"
```

---

## Task 7: il manifest di pubblicazione e la mappa `exports`

**Files:**
- Modify: `packages/plugin/package.json`, `packages/core/package.json`, `package.json` (root), `examples/e2e/bench.spec.ts`
- Create: `packages/plugin/test/packaging.test.ts`

I quattro vincoli di packaging della spec §8, tradotti in altrettante righe:

1. `phaser` **solo** in `peerDependencies` (già così) **ed esterno nel bundle** (Task 5).
2. `sideEffects: false` è lecito **perché** `registerGameObject` avviene nel costruttore del plugin e non a top-level. Un bundler con tree-shaking cancella in silenzio una registrazione top-level, e questo è già stato misurato con una build Vite reale.
3. I `.d.ts` arrivano da `tsc`, mai da Vite (Task 6).
4. La condizione `types` va dichiarata **esplicitamente** e **per prima** in ogni voce di `exports`, altrimenti TS7016 appena il `.d.ts` non è fratello del `.js` — che è esattamente il nostro caso.

- [ ] **Step 1: riscrivere `packages/plugin/package.json`**

```json
{
  "name": "phaser-isometric",
  "version": "0.1.0",
  "description": "Isometric plugin for Phaser 4: projection, elevation-aware picking, deterministic depth ordering, O(1) culling and correct world bounds.",
  "keywords": [
    "phaser", "phaser4", "phaser-plugin", "isometric", "isometric-game",
    "depth-sort", "tilemap", "typescript", "gamedev"
  ],
  "license": "MIT",
  "author": "Alessandro Vanni",
  "homepage": "https://github.com/VanniMnemonic/phaser-isometric#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/VanniMnemonic/phaser-isometric.git"
  },
  "bugs": {
    "url": "https://github.com/VanniMnemonic/phaser-isometric/issues"
  },
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "skills", "llms.txt"],
  "exports": {
    ".": {
      "types": "./dist/types/plugin/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/types/core/index.d.ts",
      "import": "./dist/core.js",
      "default": "./dist/core.js"
    },
    "./debug": {
      "types": "./dist/types/plugin/debug.d.ts",
      "import": "./dist/debug.js",
      "default": "./dist/debug.js"
    },
    "./package.json": "./package.json"
  },
  "peerDependencies": {
    "phaser": "^4.0.0"
  },
  "peerDependenciesMeta": {
    "phaser": { "optional": true }
  },
  "devDependencies": {
    "@iso-internal/core": "workspace:*",
    "phaser": "4.2.1",
    "vite": "^7.3.6"
  }
}
```

Tre cose da notare, tutte deliberate:

- **`private: true` sparisce.** È l'unica riga che oggi impedisce la pubblicazione.
- **`@iso-internal/core` passa da `dependencies` a `devDependencies`.** È un pacchetto di workspace mai pubblicato: lasciarlo fra le `dependencies` produrrebbe un `workspace:*` irrisolvibile sulla macchina del consumatore. Il bundle lo inlina, quindi a runtime non serve. Le `devDependencies` restano installate per i pacchetti di workspace, perciò lo sviluppo non cambia.
- **`peerDependenciesMeta.phaser.optional`** viene dalla spec §3: serve a `phaser-isometric/core` importato lato server — l'oracolo MCP del Piano 4 — per non emettere un warning di peer mancante.

**`main` e `types` spariscono.** Con `exports` presente, Node e i bundler moderni ignorano `main`; lasciarlo puntare a `src/index.ts` sarebbe un secondo percorso di risoluzione da tenere allineato, e per gli strumenti che leggono `main` invece di `exports` significherebbe spedire TypeScript non compilato.

**Conseguenza da verificare in questo task:** dentro il monorepo, `examples/` e `consumer/` risolvono `phaser-isometric` **attraverso la mappa `exports`**, quindi da qui in poi vogliono `dist/` costruito. È un peggioramento consapevole del ciclo di sviluppo in cambio del fatto che i due progetti gate provano la **forma reale pubblicata** invece della sorgente. Il ciclo di sviluppo del plugin resta immediato: i test di `packages/plugin/test/` importano da `../src/`.

- [ ] **Step 2: annotare l'intento su `packages/core/package.json`**

```json
{
  "name": "@iso-internal/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

Nessuna modifica funzionale: resta **privato**. Il core raggiunge il pubblico solo come sottopath `phaser-isometric/core`, mai come pacchetto a sé — un solo `npm i`, una sola versione da allineare.

- [ ] **Step 3: riordinare gli script della root**

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p packages/core/tsconfig.test.json && tsc --noEmit -p packages/plugin/tsconfig.test.json && tsc --noEmit -p consumer/tsconfig.json && tsc --noEmit -p examples/tsconfig.json && tsc --noEmit -p examples/e2e/tsconfig.json",
    "build:js": "vite build --config packages/plugin/vite.config.ts",
    "build:types": "node scripts/build-types.mjs",
    "build": "pnpm build:js && pnpm build:types",
    "e2e": "playwright test -c examples/e2e/playwright.config.ts",
    "e2e:ci": "playwright test -c examples/e2e/playwright.config.ts --grep-invert @bench",
    "check": "pnpm build && pnpm test && pnpm typecheck && pnpm e2e"
```

`check` è la sequenza completa, nell'ordine giusto: build prima, perché typecheck ed e2e ora ne dipendono. Ogni comando è separato da `&&`, mai da una pipe.

- [ ] **Step 4: taggare il benchmark**

In `examples/e2e/bench.spec.ts:86`, aggiungere il tag al titolo del `describe`:

```ts
test.describe('Task 13 — the 500-entity benchmark gate @bench', () => {
```

Motivo: la baseline in `examples/e2e/artifacts/bench-baseline.json` è stata misurata su un Apple M1 Max, e il file `.claude/plan.md` lo dichiara esplicitamente **NON CI**. Farla girare su un runner GitHub condiviso produrrebbe un rosso che non significa niente, cioè la peggior specie di test.

- [ ] **Step 5: scrivere `packages/plugin/test/packaging.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8')
) as Record<string, any>;

describe('manifest di pubblicazione', () => {
    it('e pubblicabile', () => {
        expect(PKG.private).toBeUndefined();
        expect(PKG.version).toBe('0.1.0');
        expect(PKG.license).toBe('MIT');
        expect(PKG.type).toBe('module');
    });

    it('espone esattamente questi sottopath', () => {
        // Uguaglianza, non inclusione: la deriva della superficie e' un
        // cambio di contratto silenzioso per ogni progetto gia' installato.
        expect(new Set(Object.keys(PKG.exports))).toEqual(
            new Set(['.', './core', './debug', './package.json'])
        );
    });

    it('dichiara types per prima in ogni sottopath di codice', () => {
        for (const key of ['.', './core', './debug']) {
            const entry = PKG.exports[key];
            // L'ordine conta davvero: le condizioni si risolvono in ordine di
            // dichiarazione, e un `import` prima di `types` fa vincere il .js.
            expect(Object.keys(entry)[0], key).toBe('types');
            expect(entry.types, key).toMatch(/\.d\.ts$/);
            expect(entry.import, key).toMatch(/^\.\/dist\/.+\.js$/);
        }
    });

    it('non spedisce sorgenti', () => {
        expect(new Set(PKG.files)).toEqual(new Set(['dist', 'skills', 'llms.txt']));
    });

    it('tiene phaser fuori dalle dipendenze installate', () => {
        // Una seconda copia di Phaser produce due set di classi distinte:
        // `instanceof` falso e la factory registrata su un prototype che il
        // gioco ospite non vede mai.
        expect(PKG.dependencies).toBeUndefined();
        expect(PKG.peerDependencies.phaser).toBe('^4.0.0');
        expect(PKG.peerDependenciesMeta.phaser.optional).toBe(true);
    });

    it('non lascia il pacchetto interno fra le dipendenze pubblicate', () => {
        // `workspace:*` non si risolve sulla macchina di nessun altro.
        const pubbliche = { ...(PKG.dependencies ?? {}), ...(PKG.optionalDependencies ?? {}) };
        expect(Object.keys(pubbliche)).not.toContain('@iso-internal/core');
    });

    it('dichiara sideEffects false, che e lecito solo grazie alla registrazione nel costruttore', () => {
        expect(PKG.sideEffects).toBe(false);
    });

    it('porta i campi che npm mostra su un pacchetto open source', () => {
        expect(PKG.repository.url).toContain('github.com/VanniMnemonic/phaser-isometric');
        expect(PKG.bugs.url).toContain('/issues');
        expect(PKG.homepage).toContain('github.com');
        expect(PKG.description.length).toBeGreaterThan(40);
        expect(PKG.keywords).toContain('phaser');
        expect(PKG.keywords).toContain('isometric');
    });
});
```

Otto `it()` in questo file.

- [ ] **Step 6: reinstallare e ricostruire**

```
pnpm install
```
```
pnpm build
```

- [ ] **Step 7: la prova che la risoluzione reale funziona**

```
pnpm test
```
```
pnpm typecheck
```
```
pnpm e2e
```

Tutti e tre verdi. **Il typecheck è il passo che conta**: `consumer/src/game.ts` scrive `this.iso.configure(...)` e commenta di essere lì proprio per prendere un TS2339 se `declare global` non fonde. Ora quella riga passa attraverso la mappa `exports` e i `.d.ts` emessi dal Task 6, cioè esattamente per la strada che percorrerà un utente. Se qualcosa nella catena tipi è rotto, **è qui che si vede**.

Se `examples/e2e/debug.spec.ts` del Task 4 importava da un percorso relativo temporaneo, **rimetterlo su `phaser-isometric/debug` ora** e rieseguire `pnpm e2e`.

- [ ] **Step 8: preflight di mutazione**

1. In `exports['.']`, spostare `types` dopo `import`.
   Atteso: fallisce *«dichiara types per prima in ogni sottopath di codice»*.
2. Cambiare `exports['./debug'].types` in `./dist/types/plugin/index.d.ts`.
   Atteso: `pnpm typecheck` fallisce su `examples/`, che importa `IsoDebugOverlay` da `phaser-isometric/debug`. Se **non** fallisce, `examples/` non sta davvero importando dal sottopath e va corretto.

- [ ] **Step 9: commit**

```bash
git add packages/plugin/package.json packages/core/package.json package.json packages/plugin/test/packaging.test.ts examples/e2e/bench.spec.ts pnpm-lock.yaml
git commit -m "Piano 3 Task 7: manifest di pubblicazione, mappa exports e sottopath congelati"
```

---

## Task 8: `examples/quickstart`, la sorgente canonica del Quick Start

Il Quick Start è il pezzo di documentazione che invecchia per primo e che nessuno rilegge. Qui non può: **è un progetto Vite+TS reale, compilato dalla CI**, e sia la SKILL.md sia il gate del tarball leggono quel file, non una copia.

È lo stesso antidoto che la spec §7 prescrive per i template dell'MCP — *«i template non vivono dentro il server: vivono in `examples/`, dove la CI li typechecka»* — applicato al Quick Start.

**Files:**
- Create: `examples/quickstart/package.json`, `examples/quickstart/tsconfig.json`, `examples/quickstart/vite.config.ts`, `examples/quickstart/index.html`, `examples/quickstart/src/main.ts`
- Modify: `pnpm-workspace.yaml`, `package.json` (root, `typecheck`)

- [ ] **Step 1: dichiarare il progetto nel workspace**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'consumer'
  - 'examples'
  - 'examples/quickstart'
allowBuilds:
  esbuild: true
```

- [ ] **Step 2: `examples/quickstart/package.json`**

```json
{
  "name": "quickstart",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit -p tsconfig.json && vite build"
  },
  "dependencies": {
    "phaser": "4.2.1",
    "phaser-isometric": "workspace:*"
  },
  "devDependencies": {
    "vite": "^7.3.6"
  }
}
```

- [ ] **Step 3: `examples/quickstart/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "useDefineForClassFields": true
  },
  "include": ["src"]
}
```

`useDefineForClassFields: true` è **deliberato e obbligatorio qui**: è l'impostazione di default della maggior parte dei progetti reali, ed è quella che fa emergere la prima delle quattro trappole. Un quickstart compilato con `false` proverebbe qualcosa che nessun utente vive.

`skipLibCheck: true` è altrettanto deliberato: i tipi di Phaser non typecheckano da soli né in 4.0.0 né in 4.2.1. Deve comparire **per nome** nella checklist della SKILL.md, altrimenti evapora e il primo utente perde un'ora su errori che non sono suoi.

- [ ] **Step 4: `examples/quickstart/vite.config.ts` e `index.html`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({ base: './', build: { outDir: 'dist' } });
```

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>phaser-isometric quickstart</title></head>
  <body style="margin:0;background:#11141a"><div id="game"></div><script type="module" src="/src/main.ts"></script></body>
</html>
```

- [ ] **Step 5: `examples/quickstart/src/main.ts` — il Quick Start canonico**

Deve stare comodamente sotto le 60 righe, essere **interamente in inglese** (finisce nella documentazione spedita) e usare solo API della superficie congelata al Task 1. Deve toccare, in quest'ordine: installazione con `mapping`, `configure`, `setHeights`, `cameraBounds`, `this.add.isoSprite`, `makeDiamondHitArea`, `follow`, `pick`.

```ts
import Phaser from 'phaser';
import { isoScenePlugin, createHeightGrid } from 'phaser-isometric';

const GRID = 24;

class Level extends Phaser.Scene {
    create(): void {
        // The projection was set once, in the game config below, so every
        // Scene shares it. For a per-Scene projection instead, drop it there
        // and call `this.iso.configure({ ... })` here.

        // The heightmap is where elevation lives: one integer per cell, and
        // `null` for a cell with no ground at all.
        const heights = createHeightGrid(GRID, GRID, 0);
        heights.setHeight(6, 6, 2);
        this.iso.setHeights(heights);

        // Isometric world bounds are NOT the orthogonal ones: the world is
        // (W+H) tiles wide and starts at a NEGATIVE x.
        this.iso.cameraBounds(GRID, GRID);

        // A flat 96x48 texture, so the example needs no asset files.
        const g = this.add.graphics();
        g.fillStyle(0x3d5a80, 1).fillRect(0, 0, 96, 48);
        g.generateTexture('tile', 96, 48);
        g.destroy();

        for (let gy = 0; gy < GRID; gy += 1) {
            for (let gx = 0; gx < GRID; gx += 1) {
                const z = heights.heightAt(gx, gy);
                if (z === null) continue;
                const tile = this.add.isoSprite(gx, gy, 'tile');
                tile.setCell(gx, gy, z, this.iso.bands.floor);
                // The default hit area is a rectangle over the whole frame,
                // which on a diamond over-covers by roughly double and steals
                // clicks from its neighbours.
                this.iso.makeDiamondHitArea(tile);
            }
        }

        const hero = this.add.isoSprite(3, 3, 'tile');
        hero.setCell(3, 3, 0, this.iso.bands.hero);
        this.iso.follow(hero);

        // `pick` respects elevation, and is independent of what was rendered
        // last frame - unlike Phaser's own object hit-testing.
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            const cell = this.iso.pick(p.worldX, p.worldY);
            if (cell) hero.setCell(cell.gx, cell.gy, cell.z, this.iso.bands.hero);
        });
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 960,
    height: 720,
    backgroundColor: '#11141a',
    // `isoScenePlugin` fills in the `mapping` for you, and `mapping` is
    // MANDATORY: without it Phaser silently mounts the plugin on
    // `scene["undefined"]` and every call above is a TypeError.
    plugins: {
        scene: [isoScenePlugin({
            projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 }
        })]
    },
    scene: [Level]
});
```

La firma è verificata sul sorgente: `isoScenePlugin(opts?: IsoScenePluginOptions)`, dove `IsoScenePluginOptions` è `{ mapping?: string; projection?: ProjectionSpec; depth?: DepthAssignerOptions; origin?: Point }`. La spec di proiezione sta **sotto la chiave `projection`**, non come primo argomento posizionale, e `mapping` vale `'iso'` di default. Se il codice non compila, **il compilatore ha ragione**: fermarsi e segnalare.

- [ ] **Step 6: aggiungere il progetto al typecheck della root**

```json
    "typecheck": "tsc --noEmit -p packages/core/tsconfig.test.json && tsc --noEmit -p packages/plugin/tsconfig.test.json && tsc --noEmit -p consumer/tsconfig.json && tsc --noEmit -p examples/tsconfig.json && tsc --noEmit -p examples/quickstart/tsconfig.json && tsc --noEmit -p examples/e2e/tsconfig.json",
```

- [ ] **Step 7: installare, costruire, verificare**

```
pnpm install
```
```
pnpm build
```
```
pnpm typecheck
```
```
pnpm --filter quickstart build
```

Tutti e quattro devono uscire con 0. L'ultimo è quello che dimostra che il Quick Start non è solo type-corretto ma **si bundla davvero**.

- [ ] **Step 8: commit**

```bash
git add examples/quickstart pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "Piano 3 Task 8: il Quick Start e un progetto Vite reale che la CI compila"
```

---

## Task 9: `SKILL.md`

La documentazione per agenti, nel formato esatto delle 28 skill che Phaser 4 spedisce dentro il proprio pacchetto npm. Fra quelle 28 **non ce n'è una sui plugin**: un agente che ha indicizzato `node_modules/phaser/skills/` trova la nostra allo stesso posto, nella stessa forma.

**Files:**
- Create: `packages/plugin/skills/phaser-isometric/SKILL.md`
- Create: `packages/plugin/test/docs.test.ts`

**Formato da rispettare**, verificato leggendo `node_modules/phaser/skills/scenes/SKILL.md`:

```markdown
---
name: phaser-isometric
description: "Use this skill when ... Covers ... Triggers on: ..."
---

# Title

> One-paragraph overview, as a blockquote.

**Key source paths:** ...
**Related skills:** ...

## Quick Start
## Core Concepts
## Common Patterns
## Gotchas and Common Mistakes
```

`description` è una **stringa fra doppi apici** che contiene le tre parti: *«Use this skill when …»*, *«Covers …»*, *«Triggers on: …»*. `Related skills` usa percorsi relativi in stile Phaser, che dalla nostra cartella risalgono dentro il pacchetto di Phaser: `../../../phaser/skills/tilemaps/SKILL.md`, `../../../phaser/skills/game-object-components/SKILL.md`, `../../../phaser/skills/scenes/SKILL.md`.

**Il Quick Start non si scrive a mano.** Va lasciato un blocco delimitato che il Task 10 riempirà dal file del Task 8:

````markdown
## Quick Start

<!-- BEGIN quickstart -->
```ts
```
<!-- END quickstart -->
````

### Contenuto obbligatorio

**Le quattro trappole vanno in cima, non in fondo** — subito dopo il Quick Start, prima di *Core Concepts*. Sono i fallimenti che un agente riproduce se non le legge per prime:

1. **`useDefineForClassFields`.** `IsoSprite` usa `declare depth: number`, che non emette codice. Ma chi **sottoclassa** `IsoSprite` compila con il **proprio** tsconfig: con `useDefineForClassFields: true` — il default di quasi tutti i progetti reali — un campo che collide con un accessor di Phaser emette `defineProperty` e **shadowa il setter**. Si rilegge il valore giusto e il renderer ordina su uno zero che non si muove mai. TypeScript non protegge, perché `phaser.d.ts` dichiara `depth` come property piana. Gli accessor a rischio sono `depth`, `scale`, `angle`, `rotation`; `x`, `y`, `z`, `w` sono invece proprietà **dati** che il costruttore di `Sprite` assegna. È il motivo per cui l'elevazione di `IsoSprite` si chiama `elevation` e non `z`.
2. **`declare global`, mai `declare module 'phaser'`.** La forma copiata da Phaser 3 compila senza un warning e **non aggiunge niente**: crea `Phaser.Phaser`, e il consumatore riceve un TS2339 senza capire perché.
3. **`mapping` è obbligatorio.** Senza, Phaser registra `mapping === undefined` e scrive `sys['undefined']` e `scene['undefined']` **in silenzio**. Ed è il `mapping`, non la `key`, a diventare sia la proprietà sulla Scene sia il terzo argomento del costruttore — il JSDoc di `installScenePlugin` afferma il contrario. `systemKey` e `sceneKey`, che compaiono nell'`@example` **ufficiale** di Phaser, sono campi morti.
4. **`sideEffects: false`.** Il pacchetto lo dichiara, ed è lecito **solo** perché la registrazione di `isoSprite` avviene nel costruttore del plugin e non a top-level. La conseguenza per chi usa il pacchetto: `import 'phaser-isometric'` da solo non registra niente e viene rimosso dal tree-shaking. Il plugin va **installato**, non importato.

**I due caveat misurati vanno in prima pagina**, in *Core Concepts*, non in nota:

1. **`setRoundPixels(true)` non protegge a zoom frazionario** in Phaser 4.2.1: l'arrotondamento dei vertici è condizionato a `onlyTranslated`, che diventa falso appena la matrice della camera ha una componente di scala. Serve un paragrafo *«cosa significa per il tuo gioco pixel art»*, non una nota a piè di pagina.
2. **La parità di `pick()` sull'asse `gy` è deliberatamente half-down.** Possiede la stessa metà di confine che `Polygon.Contains` dà al rombo cliccabile. Senza questa scelta, `pick()` e il click nominavano celle diverse su **circa un pixel su 127** — misurato: 5.471 pixel su 691.200 di canvas.

**Il limite noto va dichiarato come tale**, in *Gotchas*:

**Due `Phaser.Game` sulla stessa pagina: il secondo eredita in silenzio il plugin del primo.** `PluginCache` è un singleton di modulo, `installScenePlugin` registra solo `if (!hasCore(key))`, e il warning di Phaser sui duplicati scatta solo dentro lo stesso `PluginManager`. Un secondo Game con una proiezione diversa proietta quindi **tutto il mondo con la dimensione di tile sbagliata**, senza un segnale. Vie d'uscita: `PluginCache.remove(ISO_PLUGIN_KEY)` oppure `game.destroy(true, true)`. Il plugin emette un `console.warn` quando lo rileva. Colpisce l'HMR di Vite, un gioco ricreato al cambio livello, due canvas su una pagina.

**Altre cose che devono comparire, ognuna almeno una volta:**

- `skipLibCheck: true` **nominato** nella sezione di setup, con il motivo: i tipi di Phaser non typecheckano da soli, né in 4.0.0 né in 4.2.1.
- I tre sottopath e a cosa servono: `phaser-isometric`, `phaser-isometric/core` (puro, gira in Node, zero Phaser), `phaser-isometric/debug` (fuori dal bundle di produzione).
- La convenzione di origine, in una riga isolata: **`project(gx, gy, z)` restituisce il centro della faccia superiore della cella.** È il punto in cui Phaser si contraddice da solo — `IsometricTileToWorldXY` restituisce l'angolo top-left del bounding box mentre `IsometricWorldToTileXY` assume il vertice superiore del rombo, e il round-trip esce sfasato di mezza cella: il tile `(0,0)` torna `(-1,0)`.
- Le bande di depth, con il layout numerico dichiarato: `chiave = (gx + gy + rowOffset) * rowStride + banda * bandStride + sub`, `rowStride = 4096`, `bandStride = 256`, `subCapacity = 256`, 7 bande di default che occupano `7 * 256 = 1792 < 4096`.
- Il limite dichiarato sul picking di **oggetti**: l'input di Phaser non usa `depth`, ordina per indice in `camera.renderList`, che è popolato durante il *render* mentre l'input gira nel `PRE_STEP` — quindi l'ordine è quello del **frame precedente**. Per le **celle** si usa `iso.pick()`, esatto e indipendente dal frame precedente.
- **`snapshot().version` è `1` e non è la versione del pacchetto.** Una è il formato di un dato, l'altra la stabilità dell'API: si muovono in modo indipendente e chi le confonde ci perde un'ora.
- La promessa di prestazioni, **con la sua clausola**, copiata dal paragrafo misurato in `.claude/plan.md` — inclusa la precisazione che *«500 attivi» non è «500 disegnati a schermo»*.
- Una riga sulla forma dei messaggi d'errore: **ogni `throw` nomina la correzione**, non il sintomo. `IsoConfigError` segnala un valore invalido, `IsoUsageError` una sequenza di chiamate impossibile, e la distinzione è deliberata perché la correzione è diversa.

- [ ] **Step 1: scrivere `packages/plugin/test/docs.test.ts` — prima del documento**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../skills/phaser-isometric/SKILL.md'),
    'utf8'
);

describe('SKILL.md', () => {
    it('ha il frontmatter nel formato delle skill di Phaser', () => {
        expect(SKILL.startsWith('---\n')).toBe(true);
        expect(SKILL).toMatch(/\nname: phaser-isometric\n/);
        expect(SKILL).toMatch(/\ndescription: "Use this skill when [^"]*Triggers on: [^"]*"\n/);
    });

    it('porta le intestazioni che un agente cerca', () => {
        for (const h of ['## Quick Start', '## Core Concepts', '## Common Patterns', '## Gotchas and Common Mistakes']) {
            expect(SKILL, h).toContain(h);
        }
        expect(SKILL).toContain('**Key source paths:**');
        expect(SKILL).toContain('**Related skills:**');
    });

    it('mette le quattro trappole PRIMA di Core Concepts', () => {
        const trappole = SKILL.indexOf('useDefineForClassFields');
        const concetti = SKILL.indexOf('## Core Concepts');
        // Non e' pedanteria: sono i fallimenti che un agente riproduce se non
        // li legge per primi, e un agente legge dall'alto.
        expect(trappole).toBeGreaterThan(-1);
        expect(trappole).toBeLessThan(concetti);
        for (const t of ['declare global', 'mapping', 'sideEffects']) {
            expect(SKILL.indexOf(t), t).toBeLessThan(concetti);
        }
    });

    it('nomina cio che senza un nome evapora', () => {
        for (const s of [
            'skipLibCheck',
            'phaser-isometric/core',
            'phaser-isometric/debug',
            'setRoundPixels',
            'PluginCache',
            'snapshot().version'
        ]) {
            expect(SKILL, s).toContain(s);
        }
    });

    it('non promette prestazioni senza la clausola che le limita', () => {
        // La promessa e' misurata su 500 entita ATTIVE, di cui solo una parte
        // e a schermo. Il numero senza la clausola e' una promessa diversa da
        // quella che e stata misurata.
        const promessa = SKILL.includes('500');
        expect(promessa).toBe(true);
        expect(SKILL.toLowerCase()).toContain('cull');
    });

    it('e in inglese: nessuna delle parole italiane che ricorrono nei commenti interni', () => {
        // Il documento attraversa il confine del pacchetto, quindi la regola
        // della lingua si applica per intero. Questo controllo e' grezzo per
        // scelta: prende le parole che compaiono davvero nei commenti di
        // questo repo, non l'italiano in generale.
        for (const parola of [' perche', ' quindi ', ' invece ', ' cioe', ' senza il quale ']) {
            expect(SKILL.toLowerCase(), parola).not.toContain(parola);
        }
    });
});
```

Sei `it()` in questo file.

- [ ] **Step 2: eseguire e verificare che fallisca**

```
pnpm vitest run packages/plugin/test/docs.test.ts
```

Atteso: FAIL, il file non esiste.

- [ ] **Step 3: scrivere la SKILL.md**

Interamente in inglese. Lunghezza di riferimento: le 28 skill di Phaser stanno fra 343 e 500 righe; la più corta è `actions-and-utilities`. Puntare a **350-450 righe**. Il blocco `<!-- BEGIN quickstart -->` resta con un fence `ts` vuoto: lo riempie il Task 10.

**Key source paths** deve elencare i percorsi reali di questo pacchetto, non di Phaser:
`packages/core/src/projection.ts`, `packages/core/src/depth.ts`, `packages/core/src/picking.ts`, `packages/core/src/culling.ts`, `packages/core/src/bounds.ts`, `packages/plugin/src/plugin.ts`, `packages/plugin/src/iso-sprite.ts`, `packages/plugin/src/debug.ts`.

- [ ] **Step 4: eseguire i test**

```
pnpm vitest run packages/plugin/test/docs.test.ts
```

Atteso: PASS, sei test.

- [ ] **Step 5: la lettura che nessun test sostituisce**

Rileggere la SKILL.md dall'inizio chiedendosi una sola cosa: **un agente che ha solo questo file scriverebbe una scena che compila?** Se una risposta manca, aggiungerla ora. Il Task 11 la metterà alla prova sul serio, e ogni buco trovato lì costa un giro in più.

- [ ] **Step 6: commit**

```bash
git add packages/plugin/skills packages/plugin/test/docs.test.ts
git commit -m "Piano 3 Task 9: SKILL.md nel formato delle skill di Phaser, quattro trappole in cima"
```

---

## Task 10: il generatore, e il gate di non-divergenza

Quattro artefatti spediti, una sola sorgente per ciascuno, e un controllo che rende impossibile la deriva.

| Artefatto spedito | Sorgente | Come |
| --- | --- | --- |
| Quick Start dentro `SKILL.md` | `examples/quickstart/src/main.ts` | iniettato fra i marker |
| `packages/plugin/llms.txt` | `SKILL.md` | estratto |
| `packages/plugin/README.md` | `README.md` (root) | copiato |
| `packages/plugin/LICENSE` | `LICENSE` (root) | copiato |

**Files:**
- Create: `LICENSE`, `README.md`, `scripts/build-docs.mjs`
- Modify: `packages/plugin/test/docs.test.ts`, `package.json` (root), `.gitignore`

- [ ] **Step 1: `LICENSE`**

MIT standard, `Copyright (c) 2026 Alessandro Vanni`. Testo integrale, non abbreviato.

- [ ] **Step 2: `README.md` (root)**

In inglese. Deve contenere, nell'ordine: cos'è e perché esiste (su npm non c'è alcun plugin isometrico per Phaser 4; i due storici sono morti e il fork per v3 ha l'unprojection rotta); installazione; il Quick Start (**anche qui iniettato fra i marker `<!-- BEGIN quickstart -->` / `<!-- END quickstart -->`**); i tre sottopath; un puntatore esplicito a `skills/phaser-isometric/SKILL.md` per gli agenti; la promessa di prestazioni con la sua clausola; i non-goal della v1 (pathfinding, movimento, collisioni, occlusione, import Tiled, multi-livello) con la riga che li rende non preclusi — `HeightSource`, le bande di depth e la sort key sostituibile sono i giunti; licenza.

Una riga che va scritta e non dimenticata: **`0.1.0` significa che l'API può ancora muoversi.** Nessun gioco reale l'ha esercitata; sotto 1.0.0 semver permette un breaking change in una minor, e dirlo qui è più onesto che scoprirlo.

- [ ] **Step 3: `scripts/build-docs.mjs`**

```js
/**
 * Builds the shipped documentation from its single sources.
 *
 * Run with `--check` it writes nothing and exits non-zero when any target is
 * out of date. That mode is the whole point: it turns "the docs drifted" from
 * something a reader notices into something the build refuses.
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
 * code kept, prose paragraphs dropped. What survives is the shape an agent
 * needs when it has the package but has not indexed the skill.
 */
function llmsTxt(skill) {
    const senzaFrontmatter = skill.replace(/^---\n[\s\S]*?\n---\n/, '');
    const righe = senzaFrontmatter.split('\n');
    const out = [];
    let inFence = false;
    for (const riga of righe) {
        if (riga.startsWith('```')) { inFence = !inFence; out.push(riga); continue; }
        if (inFence) { out.push(riga); continue; }
        if (riga.startsWith('#')) { out.push('', riga); continue; }
        if (/^\s*[-*]\s|^\s*\d+\.\s|^\|/.test(riga)) { out.push(riga); continue; }
        if (riga.startsWith('**') || riga.startsWith('>')) { out.push(riga); continue; }
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
```

- [ ] **Step 4: script e gitignore**

In `package.json` (root):

```json
    "docs:build": "node scripts/build-docs.mjs",
    "docs:check": "node scripts/build-docs.mjs --check",
```

e aggiungere `docs:check` a `check`, dopo `typecheck`.

In `.gitignore` **non** aggiungere `packages/plugin/README.md` né `packages/plugin/LICENSE`: sono copie generate ma **devono stare in git**, perché `pnpm pack` le legge dal disco e il gate di non-divergenza è ciò che le tiene allineate. Aggiungere invece un commento accanto, così il prossimo lettore non le cancella pensando che siano spazzatura:

```
# packages/plugin/{README.md,LICENSE,llms.txt} sono GENERATI da scripts/build-docs.mjs
# ma restano tracciati: pnpm pack li legge dal disco. `pnpm docs:check` impedisce
# che divergano dalle loro sorgenti nella root.
```

- [ ] **Step 5: generare**

```
pnpm docs:build
```

Atteso: cinque artefatti scritti. Aprire `packages/plugin/llms.txt` e **leggerlo**: se è illeggibile o ha perso qualcosa di essenziale, il filtro di `llmsTxt` va aggiustato ora.

- [ ] **Step 6: estendere `docs.test.ts` con il gate di non-divergenza**

```ts
import { execFileSync } from 'node:child_process';

describe('non-divergenza della documentazione', () => {
    it('rigenerare non produce alcun diff', () => {
        const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
        // Se questo fallisce, qualcuno ha modificato un artefatto generato a
        // mano invece della sua sorgente: llms.txt, il README del pacchetto o
        // il Quick Start dentro la SKILL.md.
        expect(() => execFileSync('node', ['scripts/build-docs.mjs', '--check'], { cwd: root }))
            .not.toThrow();
    });

    it('il Quick Start dentro la SKILL.md e quello che il progetto compila', () => {
        const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
        const sorgente = readFileSync(join(root, 'examples/quickstart/src/main.ts'), 'utf8').trimEnd();
        // Non basta che il blocco esista: deve essere IL file, quello che
        // `pnpm --filter quickstart build` compila. Altrimenti il Quick Start
        // torna a essere prosa che invecchia.
        expect(SKILL).toContain(sorgente);
        expect(sorgente.length).toBeGreaterThan(400);
    });
});
```

Serve `join` nell'import di `node:path`. Due `it()` in più.

- [ ] **Step 7: eseguire**

```
pnpm vitest run packages/plugin/test/docs.test.ts
```

Atteso: PASS.

- [ ] **Step 8: preflight di mutazione**

1. Modificare una riga di `examples/quickstart/src/main.ts` (per esempio `const GRID = 24;` → `25`) **senza** rigenerare.
   Atteso: falliscono **entrambi** i test di non-divergenza. Ripristinare e rigenerare.
2. Cambiare una parola in `packages/plugin/README.md` (la copia) senza toccare quella nella root.
   Atteso: fallisce *«rigenerare non produce alcun diff»*. Rigenerare.

- [ ] **Step 9: suite intera**

```
pnpm test
```
```
pnpm typecheck
```

- [ ] **Step 10: commit**

```bash
git add LICENSE README.md scripts/build-docs.mjs packages/plugin/llms.txt packages/plugin/README.md packages/plugin/LICENSE packages/plugin/skills packages/plugin/test/docs.test.ts package.json .gitignore
git commit -m "Piano 3 Task 10: generatore dei documenti spediti e gate di non-divergenza"
```

---

## Task 11: GATE della tappa 4 — una scena scritta soltanto dalla documentazione

Il gate di uscita della tappa 4 nella spec è: *«Un agente parte da zero e scrive una scena che compila e disegna.»*

**Questo task è quel gate, e va eseguito come tale.**

### Regole di esecuzione — vincolanti

Chi esegue questo task riceve **soltanto** il percorso di `packages/plugin/skills/phaser-isometric/SKILL.md` e le regole qui sotto.

- **Vietato leggere `packages/`, `examples/`, `consumer/` e questo piano.** L'unica fonte è la SKILL.md. `node_modules/phaser/` è invece consentito: un utente reale ce l'ha.
- **Ogni volta che serve guardare il sorgente per andare avanti, quello è un difetto della documentazione**, non della scena. Va **annotato** — cosa serviva, e perché la SKILL.md non bastava — e la SKILL.md va corretta. Poi si riprende.
- **Le attese si scrivono prima di eseguire.** Prima di lanciare il typecheck, scrivere nel report che cosa ci si aspetta compili e che cosa si aspetta di vedere a schermo. Se una predizione risulta sbagliata, **si conserva con una nota di correzione**: non si riscrive. Un record corretto vale più di uno pulito.

Il valore di questo gate sta tutto qui. Una regola formulata dopo aver visto il risultato non è una verifica, è una razionalizzazione — e dall'esterno le due sono indistinguibili.

**Files:**
- Create: `examples/from-docs/` (progetto Vite+TS completo, stessa forma di `examples/quickstart/`)
- Create: `examples/e2e/from-docs.spec.ts`
- Modify: `pnpm-workspace.yaml`, `package.json` (root, `typecheck`), `examples/e2e/playwright.config.ts` (secondo `webServer`)
- Modify (come esito atteso, non come effetto collaterale): `packages/plugin/skills/phaser-isometric/SKILL.md`

La scena **non** deve essere il Quick Start. Deve fare qualcosa che il Quick Start non fa, così da esercitare parti diverse della documentazione: **una griglia 12×12 con almeno tre quote diverse e un abisso, un click che sposta un attore sulla cella scelta con `pick()`, e l'overlay di debug acceso.**

- [ ] **Step 1: scrivere le attese, prima di scrivere il codice**

Nel report: che cosa ci si aspetta che la SKILL.md basti a scrivere senza guardare altro, e che cosa si teme manchi.

- [ ] **Step 2: scrivere la scena leggendo solo la SKILL.md**

Progetto completo: `package.json`, `tsconfig.json` (con `useDefineForClassFields: true` e `skipLibCheck: true`), `vite.config.ts`, `index.html`, `src/main.ts`. Registrarlo in `pnpm-workspace.yaml` e nel `typecheck` della root.

- [ ] **Step 3: typecheck e build**

```
pnpm install
```
```
pnpm build
```
```
pnpm typecheck
```
```
pnpm --filter from-docs build
```

Ogni errore va classificato: **difetto della scena** (si corregge la scena) o **difetto della documentazione** (si corregge la SKILL.md e si annota). Nel dubbio è un difetto della documentazione: chi scrive la scena ha letto quello che c'era.

- [ ] **Step 4: provare che disegna**

Serve un secondo server: `examples/from-docs` è un progetto Vite a sé, e `playwright.config.ts` ne avvia uno solo. `webServer` accetta un array — aggiungere la seconda voce sulla porta 4322, con gli stessi vincoli commentati che ha già la prima (`--strictPort`, `reuseExistingServer: false`, e `localhost` invece di `127.0.0.1`):

```ts
    webServer: [
        {
            command: `pnpm --filter examples exec vite --port ${PORT} --strictPort`,
            url: BASE_URL,
            reuseExistingServer: false,
            timeout: 30_000
        },
        {
            command: `pnpm --filter from-docs exec vite --port ${PORT_FROM_DOCS} --strictPort`,
            url: FROM_DOCS_URL,
            reuseExistingServer: false,
            timeout: 30_000
        }
    ]
```

con `const PORT_FROM_DOCS = 4322;` e `const FROM_DOCS_URL = \`http://localhost:${PORT_FROM_DOCS}\`;` accanto alle costanti già presenti.

Creare poi `examples/e2e/from-docs.spec.ts`. **Non usare `readyScene`**: quell'helper attende `window.__iso`, che è un aggancio del playground e non compare in nessun punto della SKILL.md — pretenderlo qui contaminerebbe una scena che deve nascere dalla sola documentazione. Attendere invece il canvas e poi cinque frame con `waitFrames`, e contare i pixel **non** di sfondo:

```ts
import { test, expect } from '@playwright/test';
import { waitFrames, countPixels } from './helpers';

const SFONDO = '#11141a';

test.describe('la scena scritta dalla sola SKILL.md', () => {
    test('disegna qualcosa che non e lo sfondo', async ({ page }) => {
        await page.goto('http://localhost:4322/');
        const canvas = page.locator('canvas');
        await canvas.waitFor({ state: 'visible', timeout: 15_000 });
        await waitFrames(page, 5);

        const png = await canvas.screenshot();
        // Non "il canvas esiste" — quello e' vero anche di una pagina che non
        // ha mai disegnato. La domanda e' se sopra lo sfondo c'e' qualcosa.
        const nonSfondo = await countPixels(page, png, 'r > 30 || g > 40 || b > 50');
        expect(nonSfondo).toBeGreaterThan(10_000);

        await canvas.screenshot({ path: 'examples/e2e/artifacts/proof6-from-docs.png' });
        void SFONDO;
    });
});
```

Il predicato va tarato sul colore di sfondo che la scena usa davvero: `#11141a` è `r=17 g=20 b=26`, quindi le soglie sopra escludono lo sfondo con margine. Se la scena ne usa un altro, **cambiare le soglie, non la scena**.

```
pnpm e2e
```

- [ ] **Step 5: rigenerare i documenti**

Se la SKILL.md è stata corretta:

```
pnpm docs:build
```
```
pnpm vitest run packages/plugin/test/docs.test.ts
```

- [ ] **Step 6: il verdetto, scritto**

Nel report, esplicito:

- L'elenco dei difetti di documentazione trovati, uno per riga, ciascuno con la correzione applicata.
- Quali predizioni dello Step 1 si sono rivelate sbagliate, **conservate** con la nota di correzione.
- La frase di chiusura: *«la scena compila e disegna partendo dalla sola SKILL.md»* — oppure, se non è vero, **perché non lo è**. Un gate che non può fallire non è un gate: se la risposta onesta è che la documentazione non basta, il task è BLOCKED e va segnalato, non aggiustato.

- [ ] **Step 7: commit**

```bash
git add examples/from-docs examples/e2e/from-docs.spec.ts examples/e2e/playwright.config.ts examples/e2e/artifacts/proof6-from-docs.png packages/plugin/skills packages/plugin/llms.txt packages/plugin/README.md README.md pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "Piano 3 Task 11: gate della tappa 4, scena scritta dalla sola SKILL.md"
```

---

## Task 12: GATE della tappa 5 — il tarball in un progetto vergine

Il gate di uscita della tappa 5 nella spec è: *«Installazione pulita da npm in un progetto Vite+TS vergine.»* Qui viene provato su un tarball da `pnpm pack`, installato **fuori dal monorepo**: stessa garanzia, zero irreversibilità.

Perché fuori: dentro il monorepo pnpm risolve `phaser-isometric` al workspace qualunque cosa dica la mappa `exports`, quindi un errore di packaging resterebbe invisibile. E perché il tarball e non la cartella: `files` è ciò che decide che cosa esce davvero, e un file dimenticato lì è esattamente la classe di errore che questo gate esiste per prendere.

**Files:**
- Create: `scripts/verify-tarball.mjs`

- [ ] **Step 1: scrivere lo script**

```js
/**
 * The stage-5 exit gate: pack the package, install the tarball into a Vite+TS
 * project created from scratch OUTSIDE this monorepo, typecheck it, bundle it,
 * and open the bundle in Chromium to check it actually draws.
 *
 * Outside the monorepo on purpose: inside it, pnpm resolves the package to the
 * workspace whatever the exports map says, so a packaging mistake would stay
 * invisible right up to the first user.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'packages/plugin');

function run(cmd, args, cwd) {
    console.log(`\n$ ${cmd} ${args.join(' ')}   (${cwd})`);
    execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

console.log('1/6  build');
run('pnpm', ['build'], ROOT);

console.log('2/6  pack');
run('pnpm', ['pack', '--pack-destination', PLUGIN], PLUGIN);
const tarball = readdirSync(PLUGIN).find(f => f.startsWith('phaser-isometric-') && f.endsWith('.tgz'));
if (!tarball) throw new Error('pnpm pack non ha prodotto alcun tarball');

const dir = mkdtempSync(join(tmpdir(), 'phaser-iso-virgin-'));
console.log(`3/6  progetto vergine in ${dir}`);

writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'virgin', private: true, version: '0.0.0', type: 'module'
}, null, 2));

writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        // Dichiarato per nome: i tipi di Phaser non typecheckano da soli, ne'
        // in 4.0.0 ne' in 4.2.1. Senza, il gate fallisce per colpa di Phaser.
        skipLibCheck: true,
        // Il default della maggior parte dei progetti reali, ed e' quello che
        // fa emergere la trappola numero uno.
        useDefineForClassFields: true
    },
    include: ['src']
}, null, 2));

writeFileSync(join(dir, 'index.html'),
    '<!doctype html><html><body style="margin:0"><div id="game"></div>' +
    '<script type="module" src="/src/main.ts"></script></body></html>');

// La scena e' il Quick Start della documentazione, alla lettera: se il Quick
// Start non compila o non disegna, questo gate diventa rosso. E' l'unico modo
// per cui un esempio nella documentazione non puo' invecchiare in silenzio.
mkdirSync(join(dir, 'src'));
cpSync(join(ROOT, 'examples/quickstart/src/main.ts'), join(dir, 'src/main.ts'));

console.log('4/6  install');
run('npm', ['install', '--no-audit', '--no-fund', 'phaser@4.2.1', 'vite@^7.3.6', 'typescript@~5.7.2'], dir);
run('npm', ['install', '--no-audit', '--no-fund', join(PLUGIN, tarball)], dir);

console.log('5/6  typecheck e build');
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], dir);
run('npx', ['vite', 'build'], dir);

console.log('6/6  disegna davvero?');
const preview = spawn(
    'npx', ['vite', 'preview', '--port', '4319', '--strictPort'],
    { cwd: dir, stdio: 'ignore', detached: false }
);
try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    let ok = false;
    for (let tentativo = 0; tentativo < 30 && !ok; tentativo += 1) {
        try { await page.goto('http://localhost:4319/', { timeout: 1000 }); ok = true; }
        catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ok) throw new Error('vite preview non ha risposto');

    await page.waitForSelector('canvas', { timeout: 10_000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const distinti = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const copia = document.createElement('canvas');
        copia.width = canvas.width; copia.height = canvas.height;
        const ctx = copia.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const data = ctx.getImageData(0, 0, copia.width, copia.height).data;
        const colori = new Set();
        for (let i = 0; i < data.length; i += 4) {
            colori.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        }
        return colori.size;
    });

    await browser.close();
    // Uno solo significa canvas uniforme: o non ha disegnato, o ha disegnato
    // lo sfondo. Due o piu' significa che sopra c'e' qualcosa.
    if (distinti < 2) throw new Error(`il canvas ha ${distinti} colore/i distinti: non ha disegnato`);
    console.log(`\nGATE PASSATO — ${distinti} colori distinti sul canvas, progetto in ${dir}`);
} finally {
    preview.kill('SIGTERM');
    rmSync(join(PLUGIN, tarball), { force: true });
}
```

**Nota sul `preview.kill`:** in zsh `$last_pid` è vuoto, quindi mai gestire il processo dalla shell. Qui il figlio è tenuto da Node e ucciso in un `finally`, che è l'unico modo per cui non resta orfano se il gate fallisce a metà.

- [ ] **Step 2: aggiungere lo script**

```json
    "verify:tarball": "node scripts/verify-tarball.mjs",
```

- [ ] **Step 3: eseguire il gate**

```
pnpm verify:tarball
```

Atteso: sei passi, poi `GATE PASSATO`. Richiede rete per l'`npm install` nel progetto vergine.

- [ ] **Step 4: ispezionare il tarball a mano**

```
pnpm --filter phaser-isometric pack --pack-destination /tmp/iso-pack
```
```
tar -tzf /tmp/iso-pack/phaser-isometric-0.1.0.tgz | sort
```

Verificare a occhio, riga per riga:

- ci sono `package/dist/index.js`, `core.js`, `debug.js`;
- ci sono `package/dist/types/plugin/index.d.ts`, `debug.d.ts`, `phaser-augment.d.ts` e `package/dist/types/core/index.d.ts`;
- c'è `package/skills/phaser-isometric/SKILL.md`;
- ci sono `package/llms.txt`, `package/README.md`, `package/LICENSE`;
- **non** c'è nulla sotto `package/src/`, `package/test/` o `package/node_modules/`.

L'ultima riga è la più importante: se `src/` fosse nel tarball, un errore nella mappa `exports` potrebbe restare mascherato — un bundler compilerebbe il TypeScript e tutto sembrerebbe funzionare.

Aprire anche il `package/package.json` dentro il tarball e guardare `devDependencies`. `@iso-internal/core` è dichiarato `workspace:*` e non è un pacchetto pubblicato: **per il consumatore è inerte**, perché `npm install` di una dipendenza non installa mai le sue `devDependencies`. Se però quel `workspace:*` sopravvive testualmente nel manifest impacchettato, va **annotato nel report**: è il genere di cosa su cui `npm publish` può protestare, e chi pubblicherà deve saperlo prima, non durante.

- [ ] **Step 5: preflight di mutazione sul gate stesso**

In `packages/plugin/package.json`, cambiare `exports['.'].import` in `./dist/nonesiste.js` e rieseguire `pnpm verify:tarball`.
Atteso: **fallisce**, al passo 5 (build) o 6 (disegna). Se passa lo stesso, il gate non sta guardando il pacchetto installato e va corretto prima di dichiararlo verde. Ripristinare.

- [ ] **Step 6: registrare i numeri**

Nel report: la dimensione del tarball, il numero di file, il numero di colori distinti sul canvas.

- [ ] **Step 7: commit**

```bash
git add scripts/verify-tarball.mjs package.json
git commit -m "Piano 3 Task 12: gate della tappa 5, tarball installato in un progetto vergine"
```

---

## Task 13: repository pubblico e CI

Ultimo, a lavoro finito: non si pubblica un pacchetto a metà.

**Files:**
- Create: `.github/workflows/check.yml`
- Modify: `.claude/plan.md` (non tracciato: aggiornarlo comunque, è la continuità a freddo)

- [ ] **Step 1: il workflow**

`.github/workflows/check.yml`:

```yaml
name: check

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build the library
        run: pnpm build

      - name: Unit and integration tests
        run: pnpm test

      - name: Typecheck every project, including a real consumer
        run: pnpm typecheck

      - name: Shipped docs are regenerated from their sources
        run: pnpm docs:check

      - name: Install Chromium for the browser gate
        run: pnpm exec playwright install --with-deps chromium

      # Il benchmark e' escluso: la baseline in bench-baseline.json e' stata
      # misurata su un Apple M1 Max, e un runner condiviso produrrebbe un rosso
      # che non significa niente.
      - name: Browser gate, benchmark excluded
        run: pnpm e2e:ci
```

Nessuno step in pipe: ogni comando è il proprio gate e il proprio exit code.

- [ ] **Step 2: verificare il workflow in locale**

```
pnpm install --frozen-lockfile
```
```
pnpm build
```
```
pnpm test
```
```
pnpm typecheck
```
```
pnpm docs:check
```
```
pnpm e2e:ci
```

Sei comandi, sei exit code a zero. Se `--frozen-lockfile` fallisce, il lockfile non è allineato: rieseguire `pnpm install` e committare `pnpm-lock.yaml` **prima** di proseguire, perché in CI fallirebbe allo stesso modo.

- [ ] **Step 3: commit del workflow**

```bash
git add .github/workflows/check.yml
git commit -m "Piano 3 Task 13: CI su build, test, typecheck, docs e gate browser senza benchmark"
```

- [ ] **Step 4: creare il repository pubblico**

```
gh repo create phaser-isometric --public --source=. --remote=origin --description "Isometric plugin for Phaser 4: projection, elevation-aware picking, deterministic depth ordering, O(1) culling and correct world bounds." --homepage "https://github.com/VanniMnemonic/phaser-isometric"
```

L'account autenticato è `VanniMnemonic` e il token ha lo scope `repo`. Il comando aggiunge il remote `origin` senza pushare.

- [ ] **Step 5: push**

```
git push -u origin main
```

Primo push su un repo appena creato e vuoto: non è una riscrittura di storia e non richiede `--force`. Se il push viene rifiutato, **fermarsi e segnalare** invece di forzare.

- [ ] **Step 6: guardare la CI**

```
gh run watch
```

Se fallisce con un `500`/`504` di GitHub nel checkout, è un problema di infrastruttura: `gh run rerun --failed`, non un'indagine sul codice.

- [ ] **Step 7: aggiornare `.claude/plan.md`**

Riscrivere le sezioni **In corso**, **Prossimo** e **Fatto (saliente)**: Piano 3 chiuso, entrambi i gate passati, il pacchetto pronto ma **non pubblicato**, `npm login` come primo passo di chi pubblicherà, e il Piano 4 (MCP, tappe 6-7) come prossimo. Conservare intatte le sezioni **Perché / vincoli**, **Da non rifare** e i riporti per il Piano 4.

- [ ] **Step 8: commit finale**

```bash
git add -u
git commit -m "Piano 3: chiusura, tappe 4 e 5 complete"
git push
```

---

## Self-review

**1. Copertura della spec.** Tappa 4 (§6): SKILL.md nel formato di Phaser → Task 9; `llms.txt` generato dalla stessa sorgente → Task 10; le quattro trappole in cima → Task 9, verificate da un test sull'**ordine** e non solo sulla presenza; i messaggi d'errore come documentazione → già così nel codice (`IsoConfigError` e `IsoUsageError` hanno entrambi un campo `fix` non opzionale), richiamato in SKILL.md al Task 9; gate d'uscita → Task 11. Tappa 5 (§8 + §5.6): `phaser` peer ed esterno → Task 5 e 7; `sideEffects: false` → Task 7; i `.d.ts` solo da `tsc` → Task 6; condizione `types` esplicita → Task 7; `phaser-isometric/debug` → Task 2, 3, 4; gate d'uscita → Task 12.

**2. Riporti dal Piano 2, tutti assegnati.** `skipLibCheck` per nome nella checklist → Task 8 e 9. `ISO_SYS_KEY` fuori dalla superficie → Task 1. `tileSizeOf` → Task 1, con la decisione presa e motivata. `build:types` che copriva solo il core → Task 6. Nota di migrazione su `snapshot().version` → Task 9. I due caveat misurati in prima pagina → Task 9. Il limite dei due `Phaser.Game` → Task 9.

**3. Coerenza dei tipi.** `buildDebugModel(projection, opts)` del Task 2 è chiamata con la stessa forma dal Task 3. `CullPadding` è `{ above, below, sides }` — la forma reale del codice, non quella della prosa della spec, e il piano lo dice esplicitamente. `IsoDebugOverlay` è definito al Task 3 e consumato al Task 4. I percorsi in `exports` del Task 7 corrispondono uno a uno ai file prodotti dai Task 5 e 6.

**4. Il residuo noto, dichiarato.** `iso.graphicsScene` è un accessore **nuovo** aggiunto al Task 3: allarga la superficie pubblica di `IsoPlugin` **dopo** che il Task 1 l'ha congelata. È voluto e va in quest'ordine — il Task 1 congela ciò che `index.ts` esporta, il Task 3 aggiunge un membro a una classe già esportata, e nessun test enumera i membri di `IsoPlugin` (verificato). Resta però un impegno pubblico: chi esegue il Task 9 deve documentarlo, altrimenti è superficie spedita e non descritta.

**5. Quello che questo piano NON prova.** Il `npm publish` e l'installazione da npm reale: fuori perimetro per decisione dell'utente. La compatibilità con Phaser 4.0.0 e 4.1.0 non viene esercitata a runtime: il peer `^4.0.0` resta giustificato dal `diff -rq` di `src/plugins/` del Piano 2, che è lettura di sorgente, non esecuzione. Nessun test gira su Windows.
