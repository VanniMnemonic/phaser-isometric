# phaser-isometric — Piano 1: Core Kernel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire il nucleo matematico puro di `phaser-isometric` — proiezione, depth, picking, culling, bounds — come libreria TypeScript che gira in Node senza alcun import di Phaser.

**Architecture:** Monorepo pnpm. `packages/core` è un workspace **privato** con un proprio `package.json` e `tsconfig`, che non possono nominare Phaser: è ciò che rende il confine di purezza verificabile meccanicamente e non per convenzione. Verrà inlinato nel pacchetto pubblicato `phaser-isometric` ed esposto come sottopath `./core` (Piano 3). Tutta la matematica passa da una singola matrice 2×2 invertibile per costruzione.

**Tech Stack:** TypeScript 5.7+, vitest 3 (`environment: 'node'`), pnpm 11, Node 26.

> **I valori attesi in questo piano sono stati verificati, non dedotti.** Ogni asserzione
> numerica — matrice e determinante, round-trip su 4 configurazioni × 17×17×4 celle, i vertici
> del rombo, tutti gli esiti del picking, la conservatività del culling contro scansione a forza
> bruta, i bounds, il layout della depth — è stata eseguita in Node contro un'implementazione di
> riferimento della matematica qui specificata: 50 asserzioni, 50 verdi. Sono state trovate e
> corrette **due** discrepanze: la direzione di iterazione del picking (era invertita) e una
> mutazione del culling che non mordeva.

## Global Constraints

Ogni task eredita implicitamente questi vincoli.

- **Zero import di Phaser in `packages/core`.** Né `from 'phaser'`, né il namespace `Phaser.`, né import transitivi. Verificato dal Task 1.
- **Import relativi SENZA estensione** (`from './types'`, non `'./types.js'`). È `moduleResolution: "bundler"`, ed è la convenzione del progetto di riferimento dell'utente: 263 import estensionless, zero con `.js`.
- **`lib: ES2020`** — vietati `Array.prototype.at()` (TS2550), `String.replaceAll`, `Object.groupBy`. Vincolo dei progetti consumatori dell'utente.
- **`vitest` NON typechecka** (esbuild strippa i tipi senza controllarli). `pnpm typecheck` (`tsc --noEmit`) è uno step separato, **mai dietro una pipe** — un pipe restituisce l'exit code dell'ultimo comando, quindi `pnpm test | tail -5 && git commit` committa anche con i test rossi.
- **`-0` non è `0` per `toEqual` e `toBe`.** `Math.round(-0.4896)` vale `-0`, e i matcher di uguaglianza profonda di Vitest lo distinguono da `+0`: un `toEqual([0, 0])` fallisce con `expected [ -0, +0 ] to deeply equal [ +0, +0 ]`. Vale per ogni test che arrotonda una coordinata verso la cella `(0,0)`. Due forme corrette, in ordine di preferenza: **normalizzare il segno** con `Math.round(g.x) + 0` e tenere `toEqual`, che conserva la diagnostica mostrando le coordinate sbagliate in caso di fallimento; oppure confrontare con `===`, che equipara `-0` e `0` ma su un booleano stampa solo `expected false to be true`.
- **`useDefineForClassFields: false`** in `tsconfig.base.json`. Nel core non cambia nulla, ma il guscio sottoclasserà GameObject di Phaser, dove un class field che collide con un accessor di prototype emette `defineProperty` e **shadowa il setter**. Il progetto di riferimento ha `true`: è esattamente la trappola da non ereditare.
- **Convenzione di origine, unica e non negoziabile:** `project(gx, gy, z)` restituisce il **centro della faccia superiore** della cella. Ogni funzione del core la assume.
- **Nessuna dipendenza runtime** in `packages/core`. Solo `devDependencies` alla radice.
- **I percorsi caldi non lanciano mai.** La validazione lancia alla costruzione; `pick` a vuoto restituisce `null`.
- Un commit per task completato.

---

## File Structure

```
/                                       repo root
├─ package.json                         workspace root, privato, script condivisi
├─ pnpm-workspace.yaml
├─ tsconfig.base.json                   opzioni condivise
├─ vitest.config.ts                     environment: node
└─ packages/core/
   ├─ package.json                      privato. NON può nominare phaser
   ├─ tsconfig.json                     NON include i tipi di phaser
   ├─ src/
   │   ├─ index.ts                      barrel: la superficie pubblica
   │   ├─ types.ts                      Point, Cell, Rect, GridRect, HeightSource, spec
   │   ├─ errors.ts                     IsoConfigError, messaggi azionabili
   │   ├─ projection.ts                 createProjection, project, unproject, cornersOf
   │   ├─ depth.ts                      layout, depthKey, validazione overflow
   │   ├─ height-grid.ts                HeightGrid (implementazione di HeightSource)
   │   ├─ picking.ts                    pick
   │   ├─ culling.ts                    cullBounds
   │   └─ bounds.ts                     worldBounds, contentBounds
   └─ test/
       ├─ purity.test.ts                le tre guardie architetturali
       ├─ errors.test.ts
       ├─ projection.test.ts
       ├─ depth.test.ts
       ├─ height-grid.test.ts
       ├─ picking.test.ts
       ├─ culling.test.ts
       ├─ bounds.test.ts
       └─ public-api.test.ts
```

Ogni file ha una responsabilità sola. `projection.ts` è l'unico che conosce la matrice; tutti
gli altri la consumano attraverso l'interfaccia `Projection`.

---

## La matematica, una volta sola

Fissata qui perché più task vi fanno riferimento. Nessun task deve riderivarla.

**Proiezione.** Con matrice `(a, b, c, d)`, passo di elevazione `e`, origine `(ox, oy)`:

```
sx = a·gx + c·gy + ox
sy = b·gx + d·gy − z·e + oy
```

Il preset `diamond` con `tileWidth = tw`, `tileHeight = th`:
`a = tw/2`, `b = th/2`, `c = −tw/2`, `d = th/2`, e `det = a·d − b·c = tw·th/2`.

**Inverso.** Con `X = sx − ox` e `Y = sy − oy + z·e`:

```
gx = ( d·X − c·Y) / det
gy = (−b·X + a·Y) / det
```

Verifica sul preset diamond: `gx = X/tw + Y/th`, `gy = −X/tw + Y/th`. Sostituendo la forma
diretta si ottiene l'identità esatta.

**Perché il centro rende l'arrotondamento esatto.** Se `project` restituisce il centro, i valori
interi di `(gx, gy)` sono i centri delle celle, e l'insieme dei punti con `round(gx) = 0 ∧
round(gy) = 0` è il quadrato `|gx| ≤ 0.5 ∧ |gy| ≤ 0.5`, che attraverso la matrice è
**esattamente il rombo** della cella. Quindi il picking usa `Math.round`, mai `Math.floor`, e
non è un'approssimazione: è la regione esatta.

**Vertici del rombo.** Gli scostamenti dal centro, in spazio griglia, sono `(∓0.5, ∓0.5)`.
In ordine orario a partire dall'alto:

| Vertice | Scostamento griglia | Scostamento schermo |
| --- | --- | --- |
| top | `(−0.5, −0.5)` | `(−(a+c)/2, −(b+d)/2)` |
| right | `(+0.5, −0.5)` | `(+(a−c)/2, +(b−d)/2)` |
| bottom | `(+0.5, +0.5)` | `(+(a+c)/2, +(b+d)/2)` |
| left | `(−0.5, +0.5)` | `(−(a−c)/2, −(b−d)/2)` |

Sul preset diamond danno `(0, −th/2)`, `(tw/2, 0)`, `(0, th/2)`, `(−tw/2, 0)`. Corretto.

**Chiave di depth.**

```
chiave = (gx + gy + rowOffset) · rowStride + banda · bandStride + sub
rowStride = 4096   bandStride = 256   subCapacity = 256   bande max = 16
```

`15 · 256 + 255 = 4095 < 4096`: due righe adiacenti non possono mai sovrapporsi.

**Direzione del picking — il punto in cui l'intuizione sbaglia.** Per un punto schermo fisso,
il candidato a quota `z` soddisfa `(gx+gy)·th/2 − z·e = sy − oy`, cioè

```
gx + gy = 2·(sy − oy + z·e) / th
```

`gx+gy` **cresce** con `z`: un candidato più alto sta più **avanti**, non più indietro. Il pixel
mostra la superficie disegnata per ultima — `gx+gy` massimo — quindi quella con `z` **massimo**.
Concretamente: la cima di una torre vicina copre il pavimento lontano che le sta dietro, non il
contrario. Perciò si itera `z` in ordine **decrescente** e si restituisce il primo candidato
valido.

---

### Task 1: Scaffold del monorepo e le tre guardie architetturali

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`,
  `packages/core/tsconfig.test.json`, `packages/core/src/index.ts`
- Test: `packages/core/test/purity.test.ts`

**Interfaces:**
- Consumes: niente (primo task).
- Produces: gli script `pnpm test`, `pnpm typecheck`; il workspace `@iso-internal/core`.

Il test di purezza va scritto **per primo** perché è il vincolo architetturale che governa ogni
task successivo. Ispeziona il **grafo** degli import, non solo il testo: un modulo puro che
importa un modulo non puro passerebbe una ricerca testuale e si tirerebbe dietro la dipendenza
lo stesso.

- [ ] **Step 1: Scrivere il test di purezza (deve fallire)**

Crea `packages/core/test/purity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const PKG = resolve(HERE, '../package.json');
const TSCONFIGS = [resolve(HERE, '../tsconfig.json'), resolve(HERE, '../tsconfig.test.json')];

function collect(dir: string): string[] {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out = out.concat(collect(full));
        else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
}

/**
 * Il sorgente senza commenti. Il nome `Phaser` compare legittimamente nei
 * commenti dei moduli puri — spiegare PERCHE' non si usa Phaser e' esattamente
 * il tipo di nota che merita di stare li'.
 *
 * L'ordine conta, e non e' quello che verrebbe naturale. Togliendo prima i
 * blocchi, una riga di commento che contiene un apri-blocco lascia in giro
 * quell'apertura, e la regex dei blocchi la insegue fino alla chiusura
 * successiva — quasi sempre ce n'e' una, perche' ogni funzione ha il suo JSDoc —
 * divorando il codice in mezzo e nascondendo un uso vero di Phaser. Togliendo
 * prima le righe, quell'apertura sparisce con la riga che la conteneva.
 */
function stripComments(src: string): string {
    return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function relativeImports(src: string): string[] {
    const out: string[] = [];
    const re = /\bfrom\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1] as string);
    return out;
}

describe('vincolo architetturale: il core e\' puro', () => {
    it('esiste almeno un modulo nel core', () => {
        expect(
            collect(SRC).length,
            'nessun modulo trovato in packages/core/src: il test non sta verificando niente'
        ).toBeGreaterThan(0);
    });

    it('nessun modulo importa Phaser', () => {
        for (const file of collect(SRC)) {
            const src = stripComments(readFileSync(file, 'utf8'));
            expect(/from\s+['"]phaser['"]/.test(src), `${file} importa Phaser`).toBe(false);
            expect(/\bPhaser\./.test(src), `${file} usa il namespace Phaser`).toBe(false);
        }
    });

    it('ogni import e\' relativo e risolve dentro il core', () => {
        // Il vincolo vero e' sul GRAFO, non sul testo: un modulo che importa un
        // pacchetto esterno passerebbe il test qui sopra e si porterebbe dietro
        // una dipendenza lo stesso.
        for (const file of collect(SRC)) {
            const src = stripComments(readFileSync(file, 'utf8'));
            for (const spec of relativeImports(src)) {
                expect(
                    spec.startsWith('.'),
                    `${file} importa "${spec}", che non e' un modulo relativo del core`
                ).toBe(true);
                const target = resolve(dirname(file), `${spec}.ts`);
                expect(
                    target.startsWith(SRC),
                    `${file} importa "${spec}", che esce da packages/core/src`
                ).toBe(true);
                let esiste = false;
                try { esiste = statSync(target).isFile(); } catch { esiste = false; }
                expect(esiste, `${file} importa "${spec}", che non risolve a un file del core`).toBe(true);
            }
        }
    });

    it('il package.json del core non nomina phaser', () => {
        expect(/phaser/i.test(readFileSync(PKG, 'utf8')), 'packages/core/package.json nomina phaser').toBe(false);
    });

    it('nessun tsconfig del core include i tipi di phaser', () => {
        for (const path of TSCONFIGS) {
            expect(/phaser/i.test(readFileSync(path, 'utf8')), `${path} nomina phaser`).toBe(false);
        }
    });
});
```

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

```
pnpm vitest run packages/core/test/purity.test.ts
```

Atteso: **FAIL**. `packages/core/src` non esiste ancora — `collect()` lancia `ENOENT`.
È il fallimento giusto: la guardia rifiuta di dichiarare verde un core inesistente.

- [ ] **Step 3: Creare lo scaffold del workspace**

`package.json` (root):

```json
{
  "name": "phaser-isometric-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.17.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p packages/core/tsconfig.test.json",
    "build:types": "tsc --emitDeclarationOnly -p packages/core/tsconfig.json"
  },
  "devDependencies": {
    "typescript": "~5.7.2",
    "vitest": "^3.2.7",
    "@types/node": "^26.1.1"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "declaration": true,
    "skipLibCheck": true,
    "useDefineForClassFields": false,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "forceConsistentCasingInFileNames": true
  }
}
```

> `useDefineForClassFields: false` non serve al core, ma il guscio sottoclassera' GameObject di
> Phaser: un class field che collide con un accessor di prototype emette `defineProperty` e
> shadowa il setter. Il progetto di riferimento dell'utente ha `true` — e' la trappola che non
> va ereditata.
>
> `verbatimModuleSyntax` obbliga a scrivere `import type` per gli import di soli tipi: senza,
> un import di tipo puo' sopravvivere nell'emesso e trascinare un modulo a runtime.

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['packages/*/test/**/*.test.ts']
    }
});
```

- [ ] **Step 4: Creare il pacchetto core**

`packages/core/package.json` — **non può contenere la stringa `phaser`**, nemmeno nel nome:

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

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

> `types: ["node"]` è restrittivo di proposito: senza, TypeScript includerebbe **ogni**
> pacchetto `@types/*` visibile, e i tipi globali di Phaser potrebbero entrare senza un import.
> Elencarli esplicitamente chiude quella porta.

`packages/core/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "declaration": false
  },
  "include": ["src", "test"]
}
```

> Serve un **secondo** tsconfig perché quello di build ha `include: ["src"]` e `rootDir: "src"`:
> senza, `tsc --noEmit` non guarderebbe mai i file di test, che invece contengono codice a
> livello di tipi (tuple, `Parameters<typeof …>`, cast). E `vitest` **non typechecka**, quindi
> quegli errori non li vedrebbe nessuno. Il tsconfig di build resta puro per l'emissione dei
> `.d.ts`; questo copre `src` **e** `test` e non emette nulla.

`packages/core/src/index.ts`:

```ts
export const VERSION = '0.0.0';
```

- [ ] **Step 5: Eseguire il test per verificare che passi**

```
pnpm install
pnpm vitest run packages/core/test/purity.test.ts
```

Atteso: **PASS**, 5 test.

- [ ] **Step 6: Verificare che la guardia morda davvero**

Non basta che sia verde: va provato che fallisce quando deve. Aggiungi **temporaneamente** in
`packages/core/src/index.ts`:

```ts
import Phaser from 'phaser';
```

```
pnpm vitest run packages/core/test/purity.test.ts
```

Atteso: **FAIL** con `.../index.ts importa Phaser`. Poi **rimuovi la riga** e ri-esegui: di
nuovo PASS. Una guardia mai vista fallire non è una guardia.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts packages/core
git commit -m "Scaffold monorepo e guardie di purezza del core

Il test ispeziona il grafo degli import, non il testo: un modulo puro che
importa un modulo non puro passerebbe una ricerca testuale e si tirerebbe
dietro la dipendenza lo stesso. Guardia vista fallire con un import
temporaneo di Phaser, poi rimesso a verde."
```

---

### Task 2: Vocabolario e errori azionabili

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/errors.ts`
- Test: `packages/core/test/errors.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `Point`, `Cell`, `Rect`, `GridRect`, `HeightSource`, `ProjectionSpec`,
  `ProjectionOptions`, `Band`, `DepthLayout`, `DepthStrategy`, `IsoConfigError`.
  Ogni task successivo importa da qui.

Un messaggio d'errore è documentazione: deve nominare **la correzione**, non solo il sintomo.
`IsoConfigError` la rende obbligatoria per costruzione — il campo `fix` non è opzionale.

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `packages/core/test/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { IsoConfigError } from '../src/errors';

describe('IsoConfigError', () => {
    it('include sintomo e correzione nel messaggio', () => {
        const err = new IsoConfigError(
            'la matrice non e\' invertibile (det = 0)',
            'usa tileWidth e tileHeight maggiori di zero'
        );
        expect(err.message).toContain('la matrice non e\' invertibile');
        expect(err.message).toContain('usa tileWidth e tileHeight maggiori di zero');
    });

    it('e\' un Error con un name riconoscibile', () => {
        const err = new IsoConfigError('sintomo', 'correzione');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('IsoConfigError');
    });

    it('espone sintomo e correzione come campi separati', () => {
        // Serve all'MCP: iso_diagnose rende i due pezzi in celle distinte.
        const err = new IsoConfigError('sintomo', 'correzione');
        expect(err.symptom).toBe('sintomo');
        expect(err.fix).toBe('correzione');
    });
});
```

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

```
pnpm vitest run packages/core/test/errors.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/errors"`.

- [ ] **Step 3: Implementare tipi ed errori**

`packages/core/src/errors.ts`:

```ts
/**
 * Errore di configurazione. Il campo `fix` NON e' opzionale: un messaggio che
 * descrive il sintomo senza nominare la correzione costringe chi lo legge a
 * indovinare, ed e' esattamente il momento in cui serve meno.
 */
export class IsoConfigError extends Error {
    override readonly name = 'IsoConfigError';

    constructor(
        readonly symptom: string,
        readonly fix: string
    ) {
        super(`${symptom}. Correzione: ${fix}`);
    }
}
```

`packages/core/src/types.ts`:

```ts
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
```

- [ ] **Step 4: Eseguire il test per verificare che passi**

```
pnpm vitest run packages/core/test/errors.test.ts
pnpm typecheck
```

Atteso: **PASS**, 3 test; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/errors.ts packages/core/test/errors.test.ts
git commit -m "Vocabolario del core ed errori con correzione obbligatoria

Il campo fix di IsoConfigError non e' opzionale: un messaggio che descrive
il sintomo senza nominare la correzione costringe a indovinare."
```

---

### Task 3: Proiezione — matrice, validazione, project

**Files:**
- Create: `packages/core/src/projection.ts`
- Test: `packages/core/test/projection.test.ts`

**Interfaces:**
- Consumes: `Point`, `ProjectionSpec`, `ProjectionOptions` da `types`; `IsoConfigError` da `errors`.
- Produces:
  ```ts
  interface Projection {
      readonly a: number; readonly b: number; readonly c: number; readonly d: number;
      readonly det: number; readonly elevationStep: number; readonly origin: Point;
      project(gx: number, gy: number, z?: number): Point;
      projectInto(out: Point, gx: number, gy: number, z?: number): Point;
  }
  function createProjection(spec: ProjectionSpec, opts?: ProjectionOptions): Projection
  ```
  I Task 4, 5, 8, 9, 10 consumano `Projection`.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `packages/core/test/projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { IsoConfigError } from '../src/errors';

describe('createProjection', () => {
    it('il preset diamond produce la matrice attesa', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        expect(p.a).toBe(48);
        expect(p.b).toBe(24);
        expect(p.c).toBe(-48);
        expect(p.d).toBe(24);
        expect(p.det).toBe(96 * 48 / 2);
    });

    it('elevationStep vale meta\' di tileHeight se omesso', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        expect(p.elevationStep).toBe(24);
    });

    it('elevationStep esplicito vince sul default', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48, elevationStep: 32 });
        expect(p.elevationStep).toBe(32);
    });

    it('rifiuta una matrice non invertibile nominando la correzione', () => {
        // Le colonne (2,1) e (4,2) sono collineari: det = 2*2 - 1*4 = 0.
        expect(() => createProjection({ type: 'matrix', a: 2, b: 1, c: 4, d: 2 }))
            .toThrow(IsoConfigError);
        try {
            createProjection({ type: 'matrix', a: 2, b: 1, c: 4, d: 2 });
            expect.unreachable('doveva lanciare');
        } catch (e) {
            const err = e as IsoConfigError;
            expect(err.symptom).toContain('invertibile');
            expect(err.fix.length).toBeGreaterThan(0);
        }
    });

    it('rifiuta tileWidth o tileHeight non positivi', () => {
        expect(() => createProjection({ type: 'diamond', tileWidth: 0, tileHeight: 48 }))
            .toThrow(IsoConfigError);
        expect(() => createProjection({ type: 'diamond', tileWidth: 96, tileHeight: -1 }))
            .toThrow(IsoConfigError);
    });

    it('rifiuta un\'origine frazionaria', () => {
        // Un'origine non intera reintrodurrebbe proprio l'arrotondamento che la
        // convenzione del centro elimina.
        expect(() => createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 0.5, y: 0 } }
        )).toThrow(IsoConfigError);
    });

    it('rifiuta valori non finiti', () => {
        expect(() => createProjection({ type: 'diamond', tileWidth: Number.NaN, tileHeight: 48 }))
            .toThrow(IsoConfigError);
        expect(() => createProjection({ type: 'matrix', a: 1, b: 0, c: 0, d: Number.POSITIVE_INFINITY }))
            .toThrow(IsoConfigError);
    });
});

describe('project', () => {
    const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

    it('la cella (0,0) a quota 0 e\' nell\'origine', () => {
        expect(p.project(0, 0, 0)).toEqual({ x: 0, y: 0 });
    });

    it('restituisce il CENTRO della faccia superiore', () => {
        // (1,0) e (0,1) sono simmetriche rispetto all'asse verticale e le loro y
        // coincidono: e' la firma della convenzione del centro.
        expect(p.project(1, 0, 0)).toEqual({ x: 48, y: 24 });
        expect(p.project(0, 1, 0)).toEqual({ x: -48, y: 24 });
    });

    it('la quota alza il punto sullo schermo', () => {
        expect(p.project(0, 0, 1)).toEqual({ x: 0, y: -24 });
        expect(p.project(0, 0, 2)).toEqual({ x: 0, y: -48 });
    });

    it('z vale 0 se omesso', () => {
        expect(p.project(3, 4)).toEqual(p.project(3, 4, 0));
    });

    it('l\'origine trasla il risultato', () => {
        const t = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 400, y: 300 } }
        );
        expect(t.project(0, 0, 0)).toEqual({ x: 400, y: 300 });
        expect(t.project(1, 0, 0)).toEqual({ x: 448, y: 324 });
    });

    it('projectInto scrive nel target e lo restituisce', () => {
        const out = { x: 0, y: 0 };
        const r = p.projectInto(out, 1, 0, 0);
        expect(r).toBe(out);
        expect(out).toEqual({ x: 48, y: 24 });
    });

    it('non aliasa l\'oggetto origine del chiamante', () => {
        // Se le closure catturassero l'oggetto del chiamante invece di una copia,
        // `origin` resterebbe fermo mentre `project()` cambierebbe risultato — due
        // fonti di verita' che divergono in silenzio. E un `o.x = 0.5` successivo
        // aggirerebbe la validazione dell'origine intera senza alcun errore.
        const o = { x: 400, y: 300 };
        const t = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 }, { origin: o });
        o.x = 999999;
        expect(t.origin).toEqual({ x: 400, y: 300 });
        expect(t.project(0, 0, 0)).toEqual({ x: 400, y: 300 });
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/projection.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/projection"`.

- [ ] **Step 3: Implementare la proiezione**

Crea `packages/core/src/projection.ts`:

```ts
import { IsoConfigError } from './errors';
import type { Point, ProjectionSpec, ProjectionOptions } from './types';

/**
 * Una proiezione isometrica.
 *
 * CONVENZIONE, unica e non negoziabile: `project` restituisce il CENTRO della
 * faccia superiore della cella. E' la scelta che rende l'arrotondamento esatto
 * invece che approssimato — l'insieme dei punti con round(gx)=0 e round(gy)=0 e'
 * il quadrato di lato 1 centrato sull'origine, che attraverso la matrice e'
 * ESATTAMENTE il rombo della cella. Phaser si contraddice proprio qui:
 * IsometricTileToWorldXY restituisce l'angolo del bounding box mentre
 * IsometricWorldToTileXY assume il vertice del rombo, e il round-trip esce
 * sfasato di mezza cella.
 */
export interface Projection {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly det: number;
    readonly elevationStep: number;
    readonly origin: Point;

    project(gx: number, gy: number, z?: number): Point;
    projectInto(out: Point, gx: number, gy: number, z?: number): Point;
}

function requireFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new IsoConfigError(
            `${name} non e' un numero finito (vale ${String(value)})`,
            `passa un numero finito per ${name}`
        );
    }
}

function requirePositive(value: number, name: string): void {
    requireFinite(value, name);
    if (value <= 0) {
        throw new IsoConfigError(
            `${name} deve essere maggiore di zero (vale ${value})`,
            `passa un ${name} positivo, per esempio 96`
        );
    }
}

export function createProjection(spec: ProjectionSpec, opts: ProjectionOptions = {}): Projection {
    let a: number;
    let b: number;
    let c: number;
    let d: number;
    let elevationStep: number;

    if (spec.type === 'diamond') {
        requirePositive(spec.tileWidth, 'tileWidth');
        requirePositive(spec.tileHeight, 'tileHeight');
        a = spec.tileWidth / 2;
        b = spec.tileHeight / 2;
        c = -spec.tileWidth / 2;
        d = spec.tileHeight / 2;
        elevationStep = spec.elevationStep ?? spec.tileHeight / 2;
    } else {
        requireFinite(spec.a, 'a');
        requireFinite(spec.b, 'b');
        requireFinite(spec.c, 'c');
        requireFinite(spec.d, 'd');
        a = spec.a;
        b = spec.b;
        c = spec.c;
        d = spec.d;
        elevationStep = spec.elevationStep ?? 0;
    }

    requireFinite(elevationStep, 'elevationStep');

    const det = a * d - b * c;
    if (det === 0) {
        throw new IsoConfigError(
            `la matrice di proiezione non e' invertibile (det = 0, a=${a} b=${b} c=${c} d=${d})`,
            'le colonne (a,b) e (c,d) sono collineari: cambiane una, oppure usa il preset diamond'
        );
    }

    const rawOrigin: Point = opts.origin ?? { x: 0, y: 0 };
    if (!Number.isInteger(rawOrigin.x) || !Number.isInteger(rawOrigin.y)) {
        throw new IsoConfigError(
            `l'origine deve avere componenti intere (vale x=${rawOrigin.x} y=${rawOrigin.y})`,
            'arrotonda l\'origine: una traslazione frazionaria reintroduce l\'arrotondamento che la convenzione del centro elimina'
        );
    }

    // UNA sola copia congelata, usata sia dalle closure sia dal campo pubblico.
    // Legare le closure all'oggetto del CHIAMANTE lo lascerebbe mutabile dopo la
    // costruzione: `p.origin` resterebbe fermo mentre `p.project()` cambierebbe
    // risultato, e un `o.x = 0.5` successivo aggirerebbe del tutto la validazione
    // dell'origine intera — che esiste proprio per proteggere la convenzione del
    // centro. Un Point e' un oggetto che un chiamante Phaser riusa e muta di
    // frame in frame: trattenerne il riferimento non e' un'ipotesi teorica.
    const origin = Object.freeze({ ...rawOrigin });

    function projectInto(out: Point, gx: number, gy: number, z = 0): Point {
        out.x = a * gx + c * gy + origin.x;
        out.y = b * gx + d * gy - z * elevationStep + origin.y;
        return out;
    }

    return Object.freeze({
        a, b, c, d, det, elevationStep,
        origin,
        project(gx: number, gy: number, z = 0): Point {
            return projectInto({ x: 0, y: 0 }, gx, gy, z);
        },
        projectInto
    });
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/projection.test.ts
pnpm typecheck
```

Atteso: **PASS**, 14 test; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/projection.ts packages/core/test/projection.test.ts
git commit -m "Proiezione a matrice, invertibile per costruzione

Un solo code path matematico: i preset sono zucchero sopra la stessa
matrice. Il determinante nullo viene rifiutato alla costruzione con la
correzione nominata."
```

---

### Task 4: Inverso esatto e round-trip

**Files:**
- Modify: `packages/core/src/projection.ts`
- Modify: `packages/core/test/projection.test.ts`

**Interfaces:**
- Consumes: `Projection` dal Task 3.
- Produces: `Projection.unproject(sx, sy, z?): Point` e `Projection.unprojectInto(out, sx, sy, z?): Point`.
  Il Task 8 (picking) e il Task 9 (culling) ne dipendono.

Questo è il test che protegge l'invariante centrale del plugin. Se passa anche con la matrice
trasposta, non sta guardando niente — lo Step 5 lo verifica.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungi in fondo a `packages/core/test/projection.test.ts`:

```ts
describe('unproject', () => {
    it('inverte esattamente il preset diamond', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const s = p.project(3, 5, 0);
        const g = p.unproject(s.x, s.y, 0);
        expect(g.x).toBeCloseTo(3, 12);
        expect(g.y).toBeCloseTo(5, 12);
    });

    it('inverte tenendo conto della quota', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const s = p.project(2, 7, 4);
        const g = p.unproject(s.x, s.y, 4);
        expect(g.x).toBeCloseTo(2, 12);
        expect(g.y).toBeCloseTo(7, 12);
    });

    it('inverte tenendo conto dell\'origine', () => {
        const p = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 400, y: 300 } }
        );
        const s = p.project(6, 1, 2);
        const g = p.unproject(s.x, s.y, 2);
        expect(g.x).toBeCloseTo(6, 12);
        expect(g.y).toBeCloseTo(1, 12);
    });

    it('round-trip esatto su tutta una griglia, per ogni configurazione', () => {
        const specs: ReadonlyArray<Parameters<typeof createProjection>[0]> = [
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { type: 'diamond', tileWidth: 64, tileHeight: 64 },
            { type: 'diamond', tileWidth: 128, tileHeight: 32, elevationStep: 16 },
            { type: 'matrix', a: 40, b: 20, c: -30, d: 25, elevationStep: 12 }
        ];
        for (const spec of specs) {
            const p = createProjection(spec, { origin: { x: 7, y: -13 } });
            for (let gx = -8; gx <= 8; gx++) {
                for (let gy = -8; gy <= 8; gy++) {
                    for (let z = 0; z <= 3; z++) {
                        const s = p.project(gx, gy, z);
                        const g = p.unproject(s.x, s.y, z);
                        expect(Math.round(g.x)).toBe(gx);
                        expect(Math.round(g.y)).toBe(gy);
                        expect(g.x).toBeCloseTo(gx, 9);
                        expect(g.y).toBeCloseTo(gy, 9);
                    }
                }
            }
        }
    });

    it('arrotondare l\'inverso identifica ESATTAMENTE il rombo della cella', () => {
        // La rivendicazione forte della convenzione del centro. I punti interni
        // al rombo di (0,0) tornano (0,0); un punto appena oltre un vertice, o
        // oltre uno spigolo, no.
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const dentro = [
            { x: 0, y: 0 }, { x: 47, y: 0 }, { x: -47, y: 0 },
            { x: 0, y: 23 }, { x: 0, y: -23 }
        ];
        for (const pt of dentro) {
            const g = p.unproject(pt.x, pt.y, 0);
            // `===`, non `toEqual`, di proposito: alcuni di questi punti producono
            // un -0 legittimo in una coordinata — `Math.round(-0.4896)` vale `-0` —
            // che e' matematicamente zero ma fa fallire un confronto per uguaglianza
            // profonda, perche' `toEqual` distingue -0 da +0. `===` li tratta come
            // uguali, che e' la semantica corretta qui, ed e' anche quella che il
            // ramo `fuori` usa gia'.
            expect(
                Math.round(g.x) === 0 && Math.round(g.y) === 0,
                `${pt.x},${pt.y} dovrebbe cadere dentro la cella (0,0)`
            ).toBe(true);
        }
        const fuori = [
            { x: 49, y: 0 },     // oltre il vertice destro
            { x: 0, y: 25 },     // oltre il vertice inferiore
            { x: 25, y: 13 }     // oltre lo spigolo in basso a destra
        ];
        for (const pt of fuori) {
            const g = p.unproject(pt.x, pt.y, 0);
            expect(
                Math.round(g.x) === 0 && Math.round(g.y) === 0,
                `${pt.x},${pt.y} dovrebbe cadere fuori dalla cella (0,0)`
            ).toBe(false);
        }
    });

    it('unprojectInto scrive nel target e lo restituisce', () => {
        const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        const out = { x: 0, y: 0 };
        const r = p.unprojectInto(out, 48, 24, 0);
        expect(r).toBe(out);
        expect(out.x).toBeCloseTo(1, 12);
        expect(out.y).toBeCloseTo(0, 12);
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/projection.test.ts
```

Atteso: **FAIL** — `p.unproject is not a function`.

- [ ] **Step 3: Implementare l'inverso**

In `packages/core/src/projection.ts`, aggiungi alla `interface Projection`:

```ts
    unproject(sx: number, sy: number, z?: number): Point;
    unprojectInto(out: Point, sx: number, sy: number, z?: number): Point;
```

E dentro `createProjection`, subito dopo `projectInto`:

```ts
    /**
     * L'inverso analitico della matrice 2x2. Con X = sx - ox e Y = sy - oy + z*e:
     *   gx = ( d*X - c*Y) / det
     *   gy = (-b*X + a*Y) / det
     * Sul preset diamond si riduce a gx = X/tw + Y/th, gy = -X/tw + Y/th, che
     * sostituito nella forma diretta da' l'identita' esatta.
     */
    function unprojectInto(out: Point, sx: number, sy: number, z = 0): Point {
        const X = sx - origin.x;
        const Y = sy - origin.y + z * elevationStep;
        out.x = (d * X - c * Y) / det;
        out.y = (-b * X + a * Y) / det;
        return out;
    }
```

E nell'oggetto restituito, accanto a `projectInto`:

```ts
        unproject(sx: number, sy: number, z = 0): Point {
            return unprojectInto({ x: 0, y: 0 }, sx, sy, z);
        },
        unprojectInto
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/projection.test.ts
pnpm typecheck
```

Atteso: **PASS**, 20 test; typecheck exit 0.

- [ ] **Step 5: Batteria di mutazione — provare che i test mordono**

Un test verde non dice cosa sorveglia. Applica **una mutazione alla volta** in
`projection.ts`, esegui `pnpm vitest run packages/core/test/projection.test.ts`, verifica che
fallisca, poi **ripristina** prima della mutazione successiva.

| # | Mutazione | Deve far fallire |
| --- | --- | --- |
| 1 | In `unprojectInto`, scambia `d` con `a` (matrice trasposta) | round-trip su tutta la griglia |
| 2 | In `unprojectInto`, `+ z * elevationStep` → `- z * elevationStep` | round-trip con quota |
| 3 | In `unprojectInto`, togli `- origin.x` | round-trip con origine |
| 4 | In `projectInto`, `- z * elevationStep` → `+ z * elevationStep` | «la quota alza il punto sullo schermo» |
| 5 | Nel preset diamond, `c = -tileWidth/2` → `c = tileWidth/2` | matrice attesa **e** il test del rombo |

Se una mutazione **non** fa fallire nulla, il buco è nei test: aggiungi il caso mancante prima
di proseguire. Registra l'esito nel messaggio di commit.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/projection.ts packages/core/test/projection.test.ts
git commit -m "Inverso esatto della proiezione, con round-trip verificato

Arrotondare l'inverso identifica esattamente il rombo della cella: e' la
proprieta' che la convenzione del centro compra, ed e' testata come tale.
Batteria di mutazione: 5 mutazioni applicate, 5 fallimenti attesi."
```

---

### Task 5: I quattro vertici del rombo

**Files:**
- Modify: `packages/core/src/projection.ts`
- Modify: `packages/core/test/projection.test.ts`

**Interfaces:**
- Consumes: `Projection` dai Task 3-4.
- Produces: `Projection.cornersOf(gx, gy, z?): [Point, Point, Point, Point]`, in ordine
  **orario a partire dall'alto**: top, right, bottom, left. I Task 9 e 10 e il guscio (hit area
  a rombo, overlay di debug) ne dipendono.

Esiste perché `Tilemaps.Components.GetTileCorners` di Phaser è **NOOP per `ISOMETRIC`**: senza
i quattro vertici non c'è outline, né hit-test preciso, né debug.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungi in fondo a `packages/core/test/projection.test.ts`:

```ts
describe('cornersOf', () => {
    const p = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

    it('restituisce i quattro vertici in ordine orario dall\'alto', () => {
        const [top, right, bottom, left] = p.cornersOf(0, 0, 0);
        expect(top).toEqual({ x: 0, y: -24 });
        expect(right).toEqual({ x: 48, y: 0 });
        expect(bottom).toEqual({ x: 0, y: 24 });
        expect(left).toEqual({ x: -48, y: 0 });
    });

    it('i vertici sono centrati sul punto proiettato', () => {
        const c = p.project(4, 2, 1);
        const corners = p.cornersOf(4, 2, 1);
        const meanX = corners.reduce((s, q) => s + q.x, 0) / 4;
        const meanY = corners.reduce((s, q) => s + q.y, 0) / 4;
        expect(meanX).toBeCloseTo(c.x, 12);
        expect(meanY).toBeCloseTo(c.y, 12);
    });

    it('ogni vertice sta sul bordo del rombo della propria cella', () => {
        // Tirando ogni vertice di un epsilon verso il centro, l'inverso
        // arrotondato deve dare la cella di partenza.
        const c = p.project(3, 6, 2);
        for (const corner of p.cornersOf(3, 6, 2)) {
            const inx = corner.x + (c.x - corner.x) * 0.02;
            const iny = corner.y + (c.y - corner.y) * 0.02;
            const g = p.unproject(inx, iny, 2);
            expect([Math.round(g.x), Math.round(g.y)]).toEqual([3, 6]);
        }
    });

    it('funziona su una matrice arbitraria', () => {
        const m = createProjection({ type: 'matrix', a: 40, b: 20, c: -30, d: 25 });
        const [top, right, bottom, left] = m.cornersOf(0, 0, 0);
        expect(top).toEqual({ x: -(40 - 30) / 2, y: -(20 + 25) / 2 });
        expect(right).toEqual({ x: (40 + 30) / 2, y: (20 - 25) / 2 });
        expect(bottom).toEqual({ x: (40 - 30) / 2, y: (20 + 25) / 2 });
        expect(left).toEqual({ x: -(40 + 30) / 2, y: -(20 - 25) / 2 });
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/projection.test.ts
```

Atteso: **FAIL** — `p.cornersOf is not a function`.

- [ ] **Step 3: Implementare cornersOf**

Aggiungi alla `interface Projection`:

```ts
    cornersOf(gx: number, gy: number, z?: number): [Point, Point, Point, Point];
```

E dentro `createProjection`, dopo `unprojectInto`:

```ts
    /**
     * I quattro vertici della faccia superiore, in ordine ORARIO dall'alto:
     * top, right, bottom, left.
     *
     * Gli scostamenti dal centro, in spazio griglia, sono (∓0.5, ∓0.5); passati
     * per la matrice diventano i quattro scostamenti schermo qui sotto. Sul
     * preset diamond danno (0,-th/2), (tw/2,0), (0,th/2), (-tw/2,0).
     *
     * Esiste perche' GetTileCorners di Phaser e' NOOP per ISOMETRIC.
     */
    const halfSum = { x: (a + c) / 2, y: (b + d) / 2 };
    const halfDiff = { x: (a - c) / 2, y: (b - d) / 2 };

    function cornersOf(gx: number, gy: number, z = 0): [Point, Point, Point, Point] {
        const cx = a * gx + c * gy + origin.x;
        const cy = b * gx + d * gy - z * elevationStep + origin.y;
        return [
            { x: cx - halfSum.x, y: cy - halfSum.y },
            { x: cx + halfDiff.x, y: cy + halfDiff.y },
            { x: cx + halfSum.x, y: cy + halfSum.y },
            { x: cx - halfDiff.x, y: cy - halfDiff.y }
        ];
    }
```

E aggiungi `cornersOf` all'oggetto restituito.

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/projection.test.ts
pnpm typecheck
```

Atteso: **PASS**, 24 test; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/projection.ts packages/core/test/projection.test.ts
git commit -m "I quattro vertici del rombo, che Phaser restituisce NOOP su iso

Ordine orario dall'alto. Derivati dalla matrice, quindi corretti anche per
proiezioni non-diamond."
```

---

### Task 6: Depth — layout, chiave, garanzia di non-pareggio

**Files:**
- Create: `packages/core/src/depth.ts`
- Test: `packages/core/test/depth.test.ts`

**Interfaces:**
- Consumes: `Band`, `DepthLayout`, `DepthStrategy` da `types`; `IsoConfigError` da `errors`.
- Produces:
  ```ts
  const DEFAULT_LAYOUT: DepthLayout    // rowStride 4096, bandStride 256, subCapacity 256, maxBands 16, rowOffset 0
  const DEFAULT_BANDS: { floor: 0; decal: 1; prop: 2; item: 3; actor: 4; hero: 5; overlay: 6 }
  interface DepthAssignerOptions { layout?: Partial<DepthLayout>; strategy?: DepthStrategy; maxRow?: number }
  interface DepthAssigner {
      readonly layout: DepthLayout;
      keyFor(gx: number, gy: number, band: Band, sub?: number): number;
  }
  function createDepthAssigner(opts?: DepthAssignerOptions): DepthAssigner
  ```
  Il guscio (Piano 2) consuma `DepthAssigner`.

Il comparatore di Phaser è `a._depth - b._depth`, fisso, senza alcun hook. A parità di depth
l'ordine dipende dall'ordine di inserimento nella display list. La garanzia va costruita nella
chiave, perché a valle non c'è più modo di ottenerla.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `packages/core/test/depth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDepthAssigner, DEFAULT_BANDS, DEFAULT_LAYOUT } from '../src/depth';
import { IsoConfigError } from '../src/errors';

describe('layout di default', () => {
    it('le bande di una riga non possono invadere la riga successiva', () => {
        const { rowStride, bandStride, maxBands, subCapacity } = DEFAULT_LAYOUT;
        expect((maxBands - 1) * bandStride + (subCapacity - 1)).toBeLessThan(rowStride);
    });
});

describe('createDepthAssigner', () => {
    const d = createDepthAssigner();

    it('una riga piu\' avanti vince SEMPRE, qualunque banda e qualunque sub', () => {
        // L'invariante portante: la riga domina la banda.
        const dietro = d.keyFor(2, 2, DEFAULT_BANDS.overlay, 255);
        const avanti = d.keyFor(3, 2, DEFAULT_BANDS.floor, 0);
        expect(avanti).toBeGreaterThan(dietro);
    });

    it('nella stessa riga, le bande sono ordinate', () => {
        const floor = d.keyFor(3, 3, DEFAULT_BANDS.floor);
        const prop = d.keyFor(3, 3, DEFAULT_BANDS.prop);
        const hero = d.keyFor(2, 4, DEFAULT_BANDS.hero);
        expect(prop).toBeGreaterThan(floor);
        expect(hero).toBeGreaterThan(prop);
    });

    it('celle diverse sulla stessa riga condividono la chiave a parita\' di banda e sub', () => {
        // Conseguenza dichiarata del modello: l'ordine dipende da gx+gy. Due celle
        // sulla stessa diagonale non si sovrappongono mai a schermo, quindi il
        // pareggio e' innocuo — ma va reso esplicito, non scoperto.
        expect(d.keyFor(1, 3, DEFAULT_BANDS.prop)).toBe(d.keyFor(3, 1, DEFAULT_BANDS.prop));
    });

    it('sub distinti danno chiavi distinte e consecutive', () => {
        const a = d.keyFor(4, 4, DEFAULT_BANDS.actor, 0);
        const b = d.keyFor(4, 4, DEFAULT_BANDS.actor, 1);
        expect(b - a).toBe(1);
    });

    it('due chiavi uguali implicano SEMPRE stessa riga e stessa banda', () => {
        // La garanzia vera: nessuna collisione fra combinazioni diverse di
        // (riga, banda). Le uniche collisioni ammesse sono fra celle della
        // stessa riga, gia' dichiarate innocue dal test qui sopra.
        const byKey = new Map<number, string>();
        const bands = Object.values(DEFAULT_BANDS);
        for (let gx = 0; gx < 30; gx++) {
            for (let gy = 0; gy < 30; gy++) {
                for (const band of bands) {
                    const key = d.keyFor(gx, gy, band, 0);
                    const identita = `riga${gx + gy}:banda${band}`;
                    const prima = byKey.get(key);
                    if (prima === undefined) byKey.set(key, identita);
                    else expect(prima, `chiave ${key} condivisa da identita' diverse`).toBe(identita);
                }
            }
        }
        // righe 0..58 = 59 valori, per 7 bande
        expect(byKey.size).toBe(59 * bands.length);
    });

    it('tutte le chiavi restano interi esatti', () => {
        for (let gx = 0; gx < 50; gx++) {
            for (let gy = 0; gy < 50; gy++) {
                expect(Number.isSafeInteger(d.keyFor(gx, gy, DEFAULT_BANDS.hero, 7))).toBe(true);
            }
        }
    });

    it('rowOffset permette coordinate negative senza chiavi negative', () => {
        const neg = createDepthAssigner({ layout: { rowOffset: 64 } });
        expect(neg.keyFor(-20, -20, DEFAULT_BANDS.floor)).toBeGreaterThanOrEqual(0);
    });

    it('rifiuta una banda fuori dal layout, nominando la correzione', () => {
        expect(() => d.keyFor(0, 0, DEFAULT_LAYOUT.maxBands)).toThrow(IsoConfigError);
        try {
            d.keyFor(0, 0, DEFAULT_LAYOUT.maxBands);
            expect.unreachable('doveva lanciare');
        } catch (e) {
            expect((e as IsoConfigError).fix).toContain('maxBands');
        }
    });

    it('rifiuta un sub oltre la capacita\'', () => {
        expect(() => d.keyFor(0, 0, DEFAULT_BANDS.actor, DEFAULT_LAYOUT.subCapacity))
            .toThrow(IsoConfigError);
    });

    it('rifiuta alla COSTRUZIONE un layout che potrebbe traboccare', () => {
        // La validazione deve avvenire una volta sola, non a ogni chiamata.
        expect(() => createDepthAssigner({
            layout: { rowStride: 2 ** 40 },
            maxRow: 2 ** 20
        })).toThrow(IsoConfigError);
    });

    it('rifiuta alla costruzione un layout in cui le bande invadono la riga', () => {
        expect(() => createDepthAssigner({ layout: { bandStride: 4096 } })).toThrow(IsoConfigError);
    });

    it('una strategy custom sostituisce interamente la formula', () => {
        const custom = createDepthAssigner({
            strategy: (gx, gy, band, sub) => -(gx + gy) * 10 + band + sub
        });
        expect(custom.keyFor(1, 1, 3, 2)).toBe(-20 + 3 + 2);
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/depth.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/depth"`.

- [ ] **Step 3: Implementare la depth**

Crea `packages/core/src/depth.ts`:

```ts
import { IsoConfigError } from './errors';
import type { Band, DepthLayout, DepthStrategy } from './types';

/**
 * chiave = (gx + gy + rowOffset) * rowStride + banda * bandStride + sub
 *
 * 15 * 256 + 255 = 4095 < 4096: due righe adiacenti non possono mai
 * sovrapporsi. Il comparatore di Phaser e' `a._depth - b._depth`, fisso e senza
 * hook: a parita' di depth l'ordine dipende dall'inserimento nella display
 * list, quindi la garanzia va costruita QUI — a valle non c'e' piu' modo.
 */
export const DEFAULT_LAYOUT: DepthLayout = Object.freeze({
    rowStride: 4096,
    bandStride: 256,
    subCapacity: 256,
    maxBands: 16,
    rowOffset: 0
});

export const DEFAULT_BANDS = Object.freeze({
    floor: 0,
    decal: 1,
    prop: 2,
    item: 3,
    actor: 4,
    hero: 5,
    overlay: 6
});

export interface DepthAssigner {
    readonly layout: DepthLayout;
    keyFor(gx: number, gy: number, band: Band, sub?: number): number;
}

export interface DepthAssignerOptions {
    layout?: Partial<DepthLayout>;
    strategy?: DepthStrategy;
    /** La riga massima (gx+gy) che il mondo puo' raggiungere. Serve a rifiutare
     *  alla COSTRUZIONE un layout che traboccherebbe, invece di scoprirlo a
     *  runtime quando l'ordine e' gia' sbagliato. */
    maxRow?: number;
}

export function createDepthAssigner(opts: DepthAssignerOptions = {}): DepthAssigner {
    const layout: DepthLayout = Object.freeze({ ...DEFAULT_LAYOUT, ...opts.layout });
    const { rowStride, bandStride, subCapacity, maxBands, rowOffset } = layout;

    const positivi = { rowStride, bandStride, subCapacity, maxBands };
    for (const name of Object.keys(positivi) as Array<keyof typeof positivi>) {
        const value = positivi[name];
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new IsoConfigError(
                `${name} deve essere un intero positivo (vale ${String(value)})`,
                `passa un intero positivo per ${name}`
            );
        }
    }

    const maxWithinRow = (maxBands - 1) * bandStride + (subCapacity - 1);
    if (maxWithinRow >= rowStride) {
        throw new IsoConfigError(
            `le bande invadono la riga successiva: il massimo interno alla riga e' ${maxWithinRow}, ma rowStride e' ${rowStride}`,
            'aumenta rowStride, oppure riduci bandStride, subCapacity o maxBands'
        );
    }

    const maxRow = opts.maxRow ?? 4096;
    const worstKey = (maxRow + rowOffset) * rowStride + maxWithinRow;
    if (!Number.isSafeInteger(worstKey)) {
        throw new IsoConfigError(
            `la chiave massima (riga ${maxRow}) non e' un intero esatto: ${worstKey}`,
            'riduci rowStride oppure maxRow: oltre 2^53 le chiavi smettono di essere distinguibili'
        );
    }

    const strategy: DepthStrategy = opts.strategy ?? ((gx, gy, band, sub) => {
        if (!Number.isInteger(band) || band < 0 || band >= maxBands) {
            throw new IsoConfigError(
                `banda ${String(band)} fuori dal layout (ammesse 0..${maxBands - 1})`,
                'usa una banda valida, oppure alza maxBands nel layout'
            );
        }
        if (!Number.isInteger(sub) || sub < 0 || sub >= subCapacity) {
            throw new IsoConfigError(
                `sub ${String(sub)} fuori dalla capacita' (ammessi 0..${subCapacity - 1})`,
                'alza subCapacity nel layout, oppure riduci gli oggetti nella stessa cella e banda'
            );
        }
        return (gx + gy + rowOffset) * rowStride + band * bandStride + sub;
    });

    return Object.freeze({
        layout,
        keyFor(gx: number, gy: number, band: Band, sub = 0): number {
            return strategy(gx, gy, band, sub);
        }
    });
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/depth.test.ts
pnpm typecheck
```

Atteso: **PASS**, 14 test; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/depth.ts packages/core/test/depth.test.ts
git commit -m "Chiave di depth con non-pareggio garantito per costruzione

Il comparatore di Phaser e' fisso e senza hook: a parita' di depth l'ordine
dipende dall'inserimento. La garanzia va nella chiave, e il layout che
potrebbe traboccare viene rifiutato alla costruzione."
```

---

### Task 7: HeightGrid

**Files:**
- Create: `packages/core/src/height-grid.ts`
- Test: `packages/core/test/height-grid.test.ts`

**Interfaces:**
- Consumes: `HeightSource` da `types`.
- Produces:
  ```ts
  interface HeightGrid extends HeightSource {
      readonly width: number; readonly height: number;
      readonly maxElevation: number;
      setHeight(gx: number, gy: number, z: number | null): void;
  }
  function createHeightGrid(width: number, height: number, fill?: number | null): HeightGrid
  ```
  I Task 8 e 9 la usano nei test.

`null` significa **abisso**: cella non calpestabile e non disegnata. È distinto da quota `0`,
che è terreno valido. Confondere i due è il difetto classico di ogni heightmap sparsa.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `packages/core/test/height-grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHeightGrid } from '../src/height-grid';

describe('createHeightGrid', () => {
    it('riempie di quota 0 per default', () => {
        const g = createHeightGrid(4, 3);
        expect(g.width).toBe(4);
        expect(g.height).toBe(3);
        expect(g.heightAt(0, 0)).toBe(0);
        expect(g.heightAt(3, 2)).toBe(0);
    });

    it('distingue quota 0 da abisso', () => {
        // Il difetto classico di ogni heightmap sparsa: 0 e' terreno valido,
        // null e' assenza di terreno. Un `if (!h)` li confonde entrambi.
        const g = createHeightGrid(2, 2, null);
        expect(g.heightAt(0, 0)).toBeNull();
        g.setHeight(0, 0, 0);
        expect(g.heightAt(0, 0)).toBe(0);
        expect(g.heightAt(0, 0)).not.toBeNull();
    });

    it('fuori dai bordi restituisce null, non lancia', () => {
        const g = createHeightGrid(2, 2);
        expect(g.heightAt(-1, 0)).toBeNull();
        expect(g.heightAt(0, -1)).toBeNull();
        expect(g.heightAt(2, 0)).toBeNull();
        expect(g.heightAt(0, 2)).toBeNull();
    });

    it('coordinate frazionarie restituiscono null invece di indicizzare a caso', () => {
        const g = createHeightGrid(4, 4);
        expect(g.heightAt(1.5, 2)).toBeNull();
    });

    it('setHeight alza maxElevation', () => {
        const g = createHeightGrid(4, 4);
        expect(g.maxElevation).toBe(0);
        g.setHeight(1, 1, 5);
        expect(g.maxElevation).toBe(5);
        g.setHeight(2, 2, 3);
        expect(g.maxElevation).toBe(5);
    });

    it('maxElevation e\' MONOTONO: non scende quando una cella viene abbassata', () => {
        // Scelta dichiarata: ricalcolare il massimo a ogni scrittura costerebbe
        // O(W*H). Il valore resta un limite SUPERIORE valido, che e' tutto cio'
        // di cui il picking ha bisogno.
        const g = createHeightGrid(4, 4);
        g.setHeight(1, 1, 5);
        g.setHeight(1, 1, null);
        expect(g.maxElevation).toBe(5);
    });

    it('maxElevation vale 0 su una griglia interamente abisso', () => {
        expect(createHeightGrid(3, 3, null).maxElevation).toBe(0);
    });

    it('setHeight fuori dai bordi e\' un no-op silenzioso', () => {
        const g = createHeightGrid(2, 2);
        expect(() => g.setHeight(9, 9, 3)).not.toThrow();
        expect(g.maxElevation).toBe(0);
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/height-grid.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/height-grid"`.

- [ ] **Step 3: Implementare HeightGrid**

Crea `packages/core/src/height-grid.ts`:

```ts
import type { HeightSource } from './types';

export interface HeightGrid extends HeightSource {
    readonly width: number;
    readonly height: number;
    /** Un limite SUPERIORE alla quota presente. Monotono: non scende quando una
     *  cella viene abbassata, perche' ricalcolarlo costerebbe O(W*H) a ogni
     *  scrittura. E' tutto cio' di cui il picking ha bisogno. */
    readonly maxElevation: number;
    setHeight(gx: number, gy: number, z: number | null): void;
}

const ABYSS = Number.NEGATIVE_INFINITY;

/**
 * Una heightmap densa e rettangolare: una quota per cella, `null` = abisso.
 *
 * `null` NON e' quota 0. Zero e' terreno valido e calpestabile; null e' assenza
 * di terreno. Un `if (!h)` li confonde entrambi, ed e' il difetto classico di
 * ogni heightmap sparsa.
 *
 * Internamente l'abisso e' -Infinity dentro un Float64Array: un solo buffer,
 * nessun boxing, e il confronto con una quota reale e' sempre falso.
 */
export function createHeightGrid(width: number, height: number, fill: number | null = 0): HeightGrid {
    const cells = new Float64Array(Math.max(0, width * height));
    cells.fill(fill === null ? ABYSS : fill);

    let maxElevation = fill === null ? 0 : fill;

    function inside(gx: number, gy: number): boolean {
        return Number.isInteger(gx) && Number.isInteger(gy)
            && gx >= 0 && gx < width && gy >= 0 && gy < height;
    }

    return {
        width,
        height,
        get maxElevation(): number { return maxElevation; },

        heightAt(gx: number, gy: number): number | null {
            if (!inside(gx, gy)) return null;
            const v = cells[gy * width + gx] as number;
            return v === ABYSS ? null : v;
        },

        setHeight(gx: number, gy: number, z: number | null): void {
            if (!inside(gx, gy)) return;
            cells[gy * width + gx] = z === null ? ABYSS : z;
            if (z !== null && z > maxElevation) maxElevation = z;
        }
    };
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/height-grid.test.ts
pnpm typecheck
```

Atteso: **PASS**, 8 test; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/height-grid.ts packages/core/test/height-grid.test.ts
git commit -m "HeightGrid: quota per cella, null = abisso

null non e' quota 0. Zero e' terreno valido, null e' assenza di terreno:
un if(!h) li confonde, ed e' il difetto classico delle heightmap sparse.
maxElevation e' monotono per scelta, ed e' documentato come tale."
```

---

### Task 8: Picking che rispetta l'elevazione

**Files:**
- Create: `packages/core/src/picking.ts`
- Test: `packages/core/test/picking.test.ts`

**Interfaces:**
- Consumes: `Projection` (Task 3-4), `HeightSource`, `Cell` (Task 2).
- Produces:
  ```ts
  interface PickOptions { maxElevation?: number }
  function pick(projection: Projection, sx: number, sy: number, heights: HeightSource, opts?: PickOptions): Cell | null
  ```
  Il guscio (Piano 2) la espone come `iso.pick()`.

**Attenzione alla direzione — è il punto in cui l'intuizione sbaglia.** Per un punto schermo
fisso, `gx + gy = 2·(sy − oy + z·e)/th`: `gx+gy` **cresce** con `z`, quindi un candidato più
alto sta più **avanti**. Il pixel mostra la superficie disegnata per ultima, cioè `gx+gy`
massimo, cioè **z massimo**. Si itera `z` in ordine **decrescente** e si restituisce il primo
candidato valido. Concretamente: la cima di una torre vicina copre il pavimento lontano dietro
di lei.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `packages/core/test/picking.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { createHeightGrid } from '../src/height-grid';
import { pick } from '../src/picking';

const proj = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

describe('pick su griglia piatta', () => {
    const flat = createHeightGrid(8, 8, 0);

    it('il centro di una cella restituisce quella cella', () => {
        const s = proj.project(3, 5, 0);
        expect(pick(proj, s.x, s.y, flat)).toEqual({ gx: 3, gy: 5, z: 0 });
    });

    it('ogni cella della griglia si ripesca da sola', () => {
        for (let gx = 0; gx < 8; gx++) {
            for (let gy = 0; gy < 8; gy++) {
                const s = proj.project(gx, gy, 0);
                expect(pick(proj, s.x, s.y, flat), `cella ${gx},${gy}`).toEqual({ gx, gy, z: 0 });
            }
        }
    });

    it('un punto spostato verso un vertice resta nella propria cella', () => {
        // Il caso che distingue round da floor: al centro esatto i due
        // coincidono, qui no. Con floor si finirebbe nella cella accanto.
        const c = proj.project(3, 5, 0);
        const left = proj.cornersOf(3, 5, 0)[3];
        const px = c.x + (left.x - c.x) * 0.9;
        const py = c.y + (left.y - c.y) * 0.9;
        expect(pick(proj, px, py, flat)).toEqual({ gx: 3, gy: 5, z: 0 });
    });

    it('una griglia piatta con maxElevation generoso pesca comunque la cella giusta', () => {
        // Il confronto deve essere con la quota ESATTA: con un `!== null` si
        // pescherebbe una cella qualsiasi alla quota piu' alta provata.
        const s = proj.project(5, 5, 0);
        expect(pick(proj, s.x, s.y, flat, { maxElevation: 3 })).toEqual({ gx: 5, gy: 5, z: 0 });
    });

    it('fuori dalla griglia restituisce null, non lancia', () => {
        const s = proj.project(50, 50, 0);
        expect(pick(proj, s.x, s.y, flat)).toBeNull();
    });

    it('un punto sull\'abisso restituisce null', () => {
        const holed = createHeightGrid(8, 8, 0);
        holed.setHeight(4, 4, null);
        const s = proj.project(4, 4, 0);
        expect(pick(proj, s.x, s.y, holed)).toBeNull();
    });
});

describe('pick con elevazione', () => {
    it('la cima di una colonna si ripesca alla propria quota', () => {
        const g = createHeightGrid(8, 8, 0);
        g.setHeight(2, 2, 3);
        const s = proj.project(2, 2, 3);
        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 2, gy: 2, z: 3 });
    });

    it('a parita\' di pixel vince la superficie piu\' AVANTI, cioe\' la quota MAGGIORE', () => {
        // Su questo pixel esistono due superfici: la cima della colonna (4,4) a
        // quota 2, riga 8, e il pavimento (3,3) a quota 0, riga 6. La colonna e'
        // piu' avanti, quindi e' disegnata dopo e si vede lei.
        const g = createHeightGrid(12, 12, 0);
        g.setHeight(4, 4, 2);
        const s = proj.project(4, 4, 2);

        const basso = proj.unproject(s.x, s.y, 0);
        const bx = Math.round(basso.x);
        const by = Math.round(basso.y);
        expect(g.heightAt(bx, by), 'il candidato a quota 0 deve esistere davvero').toBe(0);
        expect(bx + by, 'e deve stare piu\' indietro della colonna').toBeLessThan(4 + 4);

        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 4, gy: 4, z: 2 });
    });

    it('tolta la colonna, sullo stesso pixel vince il pavimento dietro', () => {
        const g = createHeightGrid(12, 12, 0);
        g.setHeight(4, 4, 2);
        const s = proj.project(4, 4, 2);
        g.setHeight(4, 4, null);
        // maxElevation resta 2 (monotono), quindi le quote alte vengono comunque provate.
        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 3, gy: 3, z: 0 });
    });

    it('maxElevation limita quante quote vengono provate', () => {
        const g = createHeightGrid(8, 8, null);
        g.setHeight(1, 1, 9);
        const s = proj.project(1, 1, 9);
        expect(pick(proj, s.x, s.y, g, { maxElevation: 4 })).toBeNull();
        expect(pick(proj, s.x, s.y, g, { maxElevation: 9 })).toEqual({ gx: 1, gy: 1, z: 9 });
    });

    it('usa maxElevation della sorgente quando l\'opzione e\' omessa', () => {
        const g = createHeightGrid(8, 8, 0);
        g.setHeight(1, 1, 6);
        const s = proj.project(1, 1, 6);
        expect(pick(proj, s.x, s.y, g)).toEqual({ gx: 1, gy: 1, z: 6 });
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/picking.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/picking"`.

- [ ] **Step 3: Implementare il picking**

Crea `packages/core/src/picking.ts`:

```ts
import type { Projection } from './projection';
import type { Cell, HeightSource, Point } from './types';

export interface PickOptions {
    /** La quota massima da provare. Se omessa, si usa `maxElevation` della
     *  sorgente quando ce l'ha, altrimenti 0. */
    maxElevation?: number;
}

/**
 * La cella la cui faccia superiore e' visibile nel punto schermo dato.
 *
 * DIREZIONE — e' il punto in cui l'intuizione sbaglia. Per un punto schermo
 * fisso il candidato a quota z soddisfa
 *     gx + gy = 2 * (sy - oy + z*e) / th
 * quindi gx+gy CRESCE con z: un candidato piu' alto sta piu' AVANTI, non piu'
 * indietro. Il pixel mostra la superficie disegnata per ultima, cioe' quella con
 * gx+gy massimo, cioe' quella con z MASSIMO. Percio' si itera z in ordine
 * DECRESCENTE e si restituisce il primo candidato valido. Concretamente: la cima
 * di una torre vicina copre il pavimento lontano che le sta dietro.
 *
 * Il confronto e' con la quota ESATTA (`=== z`), non con "esiste terreno": una
 * cella che esiste ma sta a un'altra quota non e' su questo pixel.
 *
 * Costo O(maxElevation), esatto al pixel, nessun hit-test.
 *
 * LIMITE DICHIARATO: individua solo le facce SUPERIORI. Il fianco verticale di
 * una colonna non e' pescabile — servirebbe un modello a volumi, che il modello
 * a una quota per cella non ha.
 */
export function pick(
    projection: Projection,
    sx: number,
    sy: number,
    heights: HeightSource,
    opts: PickOptions = {}
): Cell | null {
    const dichiarata = (heights as { maxElevation?: number }).maxElevation;
    const maxElevation = opts.maxElevation ?? (typeof dichiarata === 'number' ? dichiarata : 0);

    const scratch: Point = { x: 0, y: 0 };

    for (let z = maxElevation; z >= 0; z--) {
        projection.unprojectInto(scratch, sx, sy, z);
        const gx = Math.round(scratch.x);
        const gy = Math.round(scratch.y);
        if (heights.heightAt(gx, gy) === z) {
            return { gx, gy, z };
        }
    }

    return null;
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/picking.test.ts
pnpm typecheck
```

Atteso: **PASS**, 11 test; typecheck exit 0.

- [ ] **Step 5: Batteria di mutazione**

Una mutazione alla volta in `picking.ts`; esegui i test; **ripristina** prima della successiva.

| # | Mutazione | Deve far fallire |
| --- | --- | --- |
| 1 | `for (let z = maxElevation; z >= 0; z--)` → `for (let z = 0; z <= maxElevation; z++)` | «vince la quota MAGGIORE» |
| 2 | `Math.round` → `Math.floor` | «un punto spostato verso un vertice resta nella propria cella» |
| 3 | `heightAt(gx, gy) === z` → `heightAt(gx, gy) !== null` | «griglia piatta con maxElevation generoso» |
| 4 | `maxElevation` forzato a `0` | «usa maxElevation della sorgente quando l'opzione è omessa» |

Se una mutazione non fa fallire nulla, aggiungi il caso mancante prima di proseguire.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/picking.ts packages/core/test/picking.test.ts
git commit -m "Picking che rispetta l'elevazione, esatto al pixel

Si itera z in ordine DECRESCENTE: gx+gy cresce con z, quindi un candidato
piu' alto sta piu' avanti, e il pixel mostra cio' che e' disegnato per
ultimo. Batteria di mutazione: 4 mutazioni, 4 fallimenti attesi."
```

---

### Task 9: Culling isometrico in O(1)

**Files:**
- Create: `packages/core/src/culling.ts`
- Test: `packages/core/test/culling.test.ts`

**Interfaces:**
- Consumes: `Projection` (Task 3-5), `Rect`, `GridRect`, `Point` (Task 2).
- Produces:
  ```ts
  interface CullPadding { above: number; below: number; sides: number }
  function cullBounds(projection: Projection, view: Rect, pad: CullPadding): GridRect
  ```
  Il guscio (Piano 2) la usa per il culling per-frame.

`IsometricCullTiles` di Phaser itera l'**intera** mappa a ogni frame chiamando `tileToWorldXY`
per ogni cella (200×200 = 40.000 conversioni/frame), e `CheckIsoBounds` valuta solo il punto
d'origine con padding calcolato sulla `tileHeight` della mappa — per questo i tile più alti
della cella poppano ai bordi. Qui si invertono **quattro** angoli, indipendentemente dalla
dimensione della mappa.

Il padding è in **spazio schermo**, rispetto al punto di ancoraggio:
- `above` — quanto un oggetto si estende **sopra** l'ancoraggio. Include l'altezza della
  grafica **e** `maxElevation × elevationStep`, perché la quota alza lo sprite.
- `below` — quanto si estende sotto (di solito 0 per sprite ancorati ai piedi).
- `sides` — la mezza larghezza massima.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `packages/core/test/culling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { cullBounds } from '../src/culling';
import type { Rect } from '../src/types';

const proj = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
const NO_PAD = { above: 0, below: 0, sides: 0 };

/**
 * Piu' viste, non una. Una vista "generica" NON esercita il bordo: floor/ceil da
 * soli arrotondano gia' abbastanza, e il margine di mezza cella sembrerebbe
 * inutile. Sono le viste ALLINEATE alla griglia a romperlo — misurato: senza
 * margine ne mancano 4 celle ciascuna, con margine zero.
 */
const VISTE: ReadonlyArray<Rect> = [
    { x: -200, y: -100, width: 400, height: 300 },   // generica
    { x: 0, y: 0, width: 96, height: 48 },           // esattamente il bbox di un tile
    { x: -48, y: -24, width: 192, height: 96 }       // allineata, due tile
];

function tocca(view: Rect, corners: ReadonlyArray<{ x: number; y: number }>): boolean {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return maxX >= view.x && minX <= view.x + view.width
        && maxY >= view.y && minY <= view.y + view.height;
}

describe('cullBounds', () => {
    it('una vista che contiene una sola cella restituisce quella cella', () => {
        const c = proj.project(4, 4, 0);
        const b = cullBounds(proj, { x: c.x - 1, y: c.y - 1, width: 2, height: 2 }, NO_PAD);
        expect(b.minX).toBeLessThanOrEqual(4);
        expect(b.maxX).toBeGreaterThanOrEqual(4);
        expect(b.minY).toBeLessThanOrEqual(4);
        expect(b.maxY).toBeGreaterThanOrEqual(4);
    });

    it('e\' conservativo: contiene OGNI cella il cui rombo tocca la vista', () => {
        // Il test che conta. Si confronta il risultato O(1) contro una scansione
        // a forza bruta di tutte le celle: nessuna cella visibile puo' restare
        // fuori. Un culling che sbaglia per difetto fa sparire pezzi di mondo,
        // ed e' il difetto piu' difficile da vedere.
        for (const view of VISTE) {
            const b = cullBounds(proj, view, NO_PAD);
            for (let gx = -40; gx <= 40; gx++) {
                for (let gy = -40; gy <= 40; gy++) {
                    if (!tocca(view, proj.cornersOf(gx, gy, 0))) continue;
                    const etichetta = `vista ${JSON.stringify(view)} cella ${gx},${gy}`;
                    expect(gx >= b.minX && gx <= b.maxX, `${etichetta} fuori da minX/maxX`).toBe(true);
                    expect(gy >= b.minY && gy <= b.maxY, `${etichetta} fuori da minY/maxY`).toBe(true);
                }
            }
        }
    });

    it('e\' conservativo anche con elevazione, tramite il padding above', () => {
        const maxElevation = 6;
        const pad = { above: maxElevation * proj.elevationStep, below: 0, sides: 0 };
        for (const view of VISTE) {
            const b = cullBounds(proj, view, pad);
            for (let gx = -40; gx <= 40; gx++) {
                for (let gy = -40; gy <= 40; gy++) {
                    for (let z = 0; z <= maxElevation; z++) {
                        if (!tocca(view, proj.cornersOf(gx, gy, z))) continue;
                        const etichetta = `vista ${JSON.stringify(view)} cella ${gx},${gy} a z=${z}`;
                        expect(gx >= b.minX && gx <= b.maxX, etichetta).toBe(true);
                        expect(gy >= b.minY && gy <= b.maxY, etichetta).toBe(true);
                    }
                }
            }
        }
    });

    it('non degenera: una vista piccola non restituisce l\'intera mappa', () => {
        // Un culling conservativo che restituisce sempre tutto passerebbe i due
        // test qui sopra senza cullare niente.
        const c = proj.project(0, 0, 0);
        const b = cullBounds(proj, { x: c.x - 50, y: c.y - 25, width: 100, height: 50 }, NO_PAD);
        const celle = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
        expect(celle).toBeLessThan(40);
    });

    it('il padding allarga i bounds', () => {
        const view = { x: 0, y: 0, width: 200, height: 200 };
        const stretto = cullBounds(proj, view, NO_PAD);
        const largo = cullBounds(proj, view, { above: 200, below: 50, sides: 100 });
        expect(largo.maxX - largo.minX).toBeGreaterThan(stretto.maxX - stretto.minX);
        expect(largo.maxY - largo.minY).toBeGreaterThan(stretto.maxY - stretto.minY);
    });

    it('tiene conto dell\'origine della proiezione', () => {
        const traslata = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 1000, y: 1000 } }
        );
        const c = traslata.project(5, 5, 0);
        const b = cullBounds(traslata, { x: c.x - 10, y: c.y - 10, width: 20, height: 20 }, NO_PAD);
        expect(b.minX).toBeLessThanOrEqual(5);
        expect(b.maxX).toBeGreaterThanOrEqual(5);
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/culling.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/culling"`.

- [ ] **Step 3: Implementare il culling**

Crea `packages/core/src/culling.ts`:

```ts
import type { Projection } from './projection';
import type { GridRect, Point, Rect } from './types';

export interface CullPadding {
    /** Quanto un oggetto si estende SOPRA il proprio ancoraggio, in pixel.
     *  Include l'altezza della grafica E maxElevation * elevationStep, perche'
     *  la quota alza lo sprite sullo schermo. */
    above: number;
    /** Quanto si estende SOTTO l'ancoraggio. Di solito 0 per sprite ancorati ai piedi. */
    below: number;
    /** La mezza larghezza massima della grafica. */
    sides: number;
}

/**
 * L'intervallo di celle che puo' intersecare la vista. Estremi INCLUSI.
 *
 * Si invertono i quattro angoli della vista allargata e si prende l'AABB in
 * spazio griglia: quattro inversioni, indipendentemente dalla dimensione della
 * mappa. IsometricCullTiles di Phaser itera invece l'INTERA mappa a ogni frame
 * chiamando tileToWorldXY per ogni cella (200x200 = 40.000 conversioni/frame), e
 * CheckIsoBounds valuta solo il punto d'origine con padding calcolato sulla
 * tileHeight della mappa — per questo i tile piu' alti della cella poppano.
 *
 * Il risultato e' CONSERVATIVO: puo' includere celle non visibili, non puo' mai
 * escluderne una visibile. Sbagliare per eccesso costa qualche iterazione;
 * sbagliare per difetto fa sparire pezzi di mondo.
 */
export function cullBounds(projection: Projection, view: Rect, pad: CullPadding): GridRect {
    // Un oggetto che si estende `above` sopra il proprio ancoraggio e' visibile
    // anche quando l'ancoraggio sta SOTTO il bordo inferiore della vista, fino a
    // `above` piu' in basso. Simmetricamente per `below` in alto.
    const left = view.x - pad.sides;
    const right = view.x + view.width + pad.sides;
    const top = view.y - pad.below;
    const bottom = view.y + view.height + pad.above;

    const scratch: Point = { x: 0, y: 0 };
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    // I quattro angoli bastano: la trasformazione e' affine, quindi l'immagine di
    // un rettangolo e' un parallelogramma, il cui AABB e' determinato dai vertici.
    const angoli: ReadonlyArray<readonly [number, number]> = [
        [left, top], [right, top], [right, bottom], [left, bottom]
    ];

    for (const [ax, ay] of angoli) {
        projection.unprojectInto(scratch, ax, ay, 0);
        if (scratch.x < minX) minX = scratch.x;
        if (scratch.x > maxX) maxX = scratch.x;
        if (scratch.y < minY) minY = scratch.y;
        if (scratch.y > maxY) maxY = scratch.y;
    }

    // Mezza cella per lato. `project` restituisce il CENTRO, quindi il rombo di
    // una cella il cui centro cade appena fuori dal parallelogramma puo' ancora
    // intersecarlo: mezza cella su gx e mezza su gy coprono esattamente il
    // semi-rombo (tw/2 in orizzontale, th/2 in verticale). Senza questo margine
    // il culling sbaglia per difetto proprio sul bordo, che e' dove si nota.
    return {
        minX: Math.floor(minX - 0.5),
        maxX: Math.ceil(maxX + 0.5),
        minY: Math.floor(minY - 0.5),
        maxY: Math.ceil(maxY + 0.5)
    };
}
```

> Se il test a forza bruta dovesse fallire per una cella esattamente sul bordo (arrotondamento
> in virgola mobile), alza il margine da `0.5` a `1` e adegua la soglia del test di
> non-degenerazione da `40` a `60`. Non ridurre mai il margine: sbagliare per eccesso è
> gratuito, per difetto no.

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/culling.test.ts
pnpm typecheck
```

Atteso: **PASS**, 6 test; typecheck exit 0.

- [ ] **Step 5: Batteria di mutazione**

| # | Mutazione | Deve far fallire |
| --- | --- | --- |
| 1 | Togli il margine di mezza cella (`- 0.5` / `+ 0.5`) | «conservativo» — 4 celle mancanti su **ciascuna** delle due viste allineate |
| 2 | `Math.floor` → `Math.round` su `minX` | «conservativo» |
| 3 | `pad.above` applicato a `top` invece che a `bottom` | «conservativo anche con elevazione» |
| 4 | Usa 2 angoli invece di 4 | «conservativo» |
| 5 | Restituisci un intervallo fisso `-1000..1000` | «non degenera» |

Due note misurate, non ipotizzate:

- **La mutazione 1 morde solo grazie alle viste allineate.** Con la sola vista generica
  `{-200,-100,400,300}` il margine sembra inutile: `floor`/`ceil` arrotondano già abbastanza e
  la mutazione **non fa fallire nulla**. È precisamente il motivo per cui `VISTE` contiene tre
  viste invece di una.
- **La mutazione 5 è quella che conta di più**: senza il test di non-degenerazione, un culling
  che non culla niente passerebbe tutti gli altri.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/culling.ts packages/core/test/culling.test.ts
git commit -m "Culling isometrico in O(1), conservativo e verificato a forza bruta

Quattro inversioni invece dell'intera mappa per frame. Il test confronta il
risultato contro una scansione di tutte le celle: nessuna cella visibile
puo' restare fuori. Batteria di mutazione: 5 mutazioni, 5 fallimenti."
```

---

### Task 10: Bounds del mondo e del contenuto

**Files:**
- Create: `packages/core/src/bounds.ts`
- Test: `packages/core/test/bounds.test.ts`

**Interfaces:**
- Consumes: `Projection` (Task 3-5), `Rect`, `Cell`, `Point` (Task 2).
- Produces:
  ```ts
  function worldBounds(projection: Projection, gridWidth: number, gridHeight: number, opts?: { maxElevation?: number }): Rect
  function contentBounds(projection: Projection, cells: Iterable<Cell>): Rect | null
  ```
  Il guscio (Piano 2) usa `worldBounds` per `camera.setBounds` e `contentBounds` per centrare un
  diorama.

`widthInPixels`/`heightInPixels` e `TilemapLayerBase.setSize` di Phaser usano la formula
**ortogonale**: `camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)` è sbagliato su
iso. L'estensione reale di una mappa `W×H` è `(W+H)·tw/2` in orizzontale e `(W+H)·th/2` in
verticale, **con la x che parte negativa**.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `packages/core/test/bounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProjection } from '../src/projection';
import { worldBounds, contentBounds } from '../src/bounds';

const proj = createProjection({ type: 'diamond', tileWidth: 96, tileHeight: 48 });

describe('worldBounds', () => {
    it('usa la formula isometrica, non quella ortogonale', () => {
        // Phaser calcolerebbe W*tw = 960 per H*th = 240. La verita' e'
        // (W+H)*tw/2 = 720 per (W+H)*th/2 = 360.
        const b = worldBounds(proj, 10, 5);
        expect(b.width).toBe((10 + 5) * 96 / 2);
        expect(b.height).toBe((10 + 5) * 48 / 2);
    });

    it('la x parte negativa', () => {
        // La cella (0, H-1) e' il vertice piu' a sinistra e sta a x negativa.
        expect(worldBounds(proj, 10, 5).x).toBeLessThan(0);
    });

    it('contiene OGNI cella della griglia', () => {
        const W = 6;
        const H = 8;
        const b = worldBounds(proj, W, H);
        for (let gx = 0; gx < W; gx++) {
            for (let gy = 0; gy < H; gy++) {
                for (const p of proj.cornersOf(gx, gy, 0)) {
                    expect(p.x >= b.x && p.x <= b.x + b.width, `cella ${gx},${gy}`).toBe(true);
                    expect(p.y >= b.y && p.y <= b.y + b.height, `cella ${gx},${gy}`).toBe(true);
                }
            }
        }
    });

    it('maxElevation estende i bounds verso l\'alto', () => {
        const piatto = worldBounds(proj, 6, 6);
        const alto = worldBounds(proj, 6, 6, { maxElevation: 4 });
        expect(alto.y).toBe(piatto.y - 4 * proj.elevationStep);
        expect(alto.height).toBe(piatto.height + 4 * proj.elevationStep);
    });

    it('tiene conto dell\'origine della proiezione', () => {
        const traslata = createProjection(
            { type: 'diamond', tileWidth: 96, tileHeight: 48 },
            { origin: { x: 1000, y: 500 } }
        );
        const base = worldBounds(proj, 6, 6);
        const spostata = worldBounds(traslata, 6, 6);
        expect(spostata.x).toBe(base.x + 1000);
        expect(spostata.y).toBe(base.y + 500);
        expect(spostata.width).toBe(base.width);
    });

    it('una griglia vuota ha bounds a dimensione zero', () => {
        const b = worldBounds(proj, 0, 0);
        expect(b.width).toBe(0);
        expect(b.height).toBe(0);
    });
});

describe('contentBounds', () => {
    it('restituisce null su un insieme vuoto', () => {
        expect(contentBounds(proj, [])).toBeNull();
    });

    it('racchiude i rombi delle celle date', () => {
        const cells = [
            { gx: 2, gy: 2, z: 0 },
            { gx: 5, gy: 3, z: 1 }
        ];
        const b = contentBounds(proj, cells);
        expect(b).not.toBeNull();
        for (const c of cells) {
            for (const p of proj.cornersOf(c.gx, c.gy, c.z)) {
                expect(p.x >= b!.x && p.x <= b!.x + b!.width).toBe(true);
                expect(p.y >= b!.y && p.y <= b!.y + b!.height).toBe(true);
            }
        }
    });

    it('e\' piu\' stretto di worldBounds quando il contenuto e\' sparso', () => {
        const b = contentBounds(proj, [{ gx: 3, gy: 3, z: 0 }]);
        expect(b!.width).toBeLessThan(worldBounds(proj, 20, 20).width);
    });

    it('tiene conto della quota', () => {
        const basso = contentBounds(proj, [{ gx: 1, gy: 1, z: 0 }]);
        const alto = contentBounds(proj, [{ gx: 1, gy: 1, z: 3 }]);
        expect(alto!.y).toBeLessThan(basso!.y);
    });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

```
pnpm vitest run packages/core/test/bounds.test.ts
```

Atteso: **FAIL** — `Failed to resolve import "../src/bounds"`.

- [ ] **Step 3: Implementare i bounds**

Crea `packages/core/src/bounds.ts`:

```ts
import type { Projection } from './projection';
import type { Cell, Point, Rect } from './types';

function boundsOf(points: Iterable<Point>): Rect | null {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let almenoUno = false;

    for (const p of points) {
        almenoUno = true;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    if (!almenoUno) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * L'AABB schermo di una griglia W x H.
 *
 * L'estensione reale e' (W+H)*tw/2 in orizzontale e (W+H)*th/2 in verticale, con
 * la x che parte NEGATIVA: la cella (0, H-1) e' il vertice piu' a sinistra.
 * widthInPixels/heightInPixels e TilemapLayerBase.setSize di Phaser usano invece
 * la formula ortogonale, quindi
 *     camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
 * e' sbagliato su iso.
 *
 * I quattro angoli della griglia bastano: la trasformazione e' affine, quindi
 * ogni cella interna cade nell'inviluppo convesso dei quattro angoli, e gli
 * scostamenti dei vertici del rombo sono gli stessi per ogni cella.
 */
export function worldBounds(
    projection: Projection,
    gridWidth: number,
    gridHeight: number,
    opts: { maxElevation?: number } = {}
): Rect {
    if (gridWidth <= 0 || gridHeight <= 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    const W = gridWidth - 1;
    const H = gridHeight - 1;
    const points: Point[] = [];
    const angoli: ReadonlyArray<readonly [number, number]> = [[0, 0], [W, 0], [0, H], [W, H]];
    for (const [gx, gy] of angoli) {
        for (const p of projection.cornersOf(gx, gy, 0)) points.push(p);
    }

    const base = boundsOf(points) as Rect;
    const lift = (opts.maxElevation ?? 0) * projection.elevationStep;
    return { x: base.x, y: base.y - lift, width: base.width, height: base.height + lift };
}

/**
 * L'AABB schermo delle sole celle date. Serve a centrare un diorama sul
 * contenuto DISEGNATO invece che sull'estensione teorica della griglia.
 * `null` se l'insieme e' vuoto: un rettangolo degenere sarebbe indistinguibile
 * da un contenuto di dimensione zero.
 */
export function contentBounds(projection: Projection, cells: Iterable<Cell>): Rect | null {
    const points: Point[] = [];
    for (const c of cells) {
        for (const p of projection.cornersOf(c.gx, c.gy, c.z)) points.push(p);
    }
    return boundsOf(points);
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```
pnpm vitest run packages/core/test/bounds.test.ts
pnpm typecheck
```

Atteso: **PASS**, 10 test; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bounds.ts packages/core/test/bounds.test.ts
git commit -m "Bounds isometrici corretti, con la x che parte negativa

La formula ortogonale di widthInPixels rende camera.setBounds sbagliato su
iso. contentBounds restituisce null sull'insieme vuoto: un rettangolo
degenere sarebbe indistinguibile da un contenuto di dimensione zero."
```

---

### Task 11: Superficie pubblica ed emissione dei tipi

**Files:**
- Modify: `packages/core/src/index.ts`, `.gitignore`
- Test: `packages/core/test/public-api.test.ts`

**Interfaces:**
- Consumes: tutto ciò che i Task 2-10 producono.
- Produces: il barrel `packages/core/src/index.ts`, che il Piano 2 (guscio) e il Piano 4 (MCP)
  importano. È il contratto pubblico: ciò che non è qui non esiste per i consumatori.

Un assert di **uguaglianza** sulla superficie, non di inclusione: un export aggiunto per sbaglio
è un impegno di manutenzione preso senza accorgersene, e un export rimosso è un breaking change
silenzioso.

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `packages/core/test/public-api.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as api from '../src/index';

const SUPERFICIE_ATTESA = [
    'DEFAULT_BANDS',
    'DEFAULT_LAYOUT',
    'IsoConfigError',
    'contentBounds',
    'createDepthAssigner',
    'createHeightGrid',
    'createProjection',
    'cullBounds',
    'pick',
    'worldBounds'
].sort();

describe('superficie pubblica del core', () => {
    it('esporta esattamente cio\' che dichiara, ne\' piu\' ne\' meno', () => {
        // Uguaglianza, non inclusione: un export in piu' e' un impegno di
        // manutenzione preso senza accorgersene, uno in meno e' un breaking
        // change silenzioso.
        expect(Object.keys(api).sort()).toEqual(SUPERFICIE_ATTESA);
    });

    it('le funzioni portanti sono davvero funzioni', () => {
        for (const nome of ['createProjection', 'createDepthAssigner', 'createHeightGrid', 'pick', 'cullBounds', 'worldBounds', 'contentBounds'] as const) {
            expect(typeof (api as Record<string, unknown>)[nome], nome).toBe('function');
        }
    });
});
```

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

```
pnpm vitest run packages/core/test/public-api.test.ts
```

Atteso: **FAIL** — `index.ts` esporta solo `VERSION`, quindi le due liste non coincidono.

- [ ] **Step 3: Scrivere il barrel**

Sostituisci interamente `packages/core/src/index.ts`:

```ts
/**
 * Il nucleo matematico puro di phaser-isometric.
 *
 * Zero import di Phaser: gira in Node. Lo stesso codice alimenta il plugin, i
 * test e i tool dell'oracolo MCP — due implementazioni della stessa proiezione
 * divergerebbero, sempre.
 *
 * CONVENZIONE, valida per ogni funzione: `project` restituisce il CENTRO della
 * faccia superiore della cella.
 */

export { createProjection } from './projection';
export type { Projection } from './projection';

export { createDepthAssigner, DEFAULT_BANDS, DEFAULT_LAYOUT } from './depth';
export type { DepthAssigner, DepthAssignerOptions } from './depth';

export { createHeightGrid } from './height-grid';
export type { HeightGrid } from './height-grid';

export { pick } from './picking';
export type { PickOptions } from './picking';

export { cullBounds } from './culling';
export type { CullPadding } from './culling';

export { worldBounds, contentBounds } from './bounds';

export { IsoConfigError } from './errors';

export type {
    Point,
    Cell,
    Rect,
    GridRect,
    HeightSource,
    ProjectionSpec,
    ProjectionOptions,
    Band,
    DepthLayout,
    DepthStrategy
} from './types';
```

- [ ] **Step 4: Eseguire il test per verificare che passi**

```
pnpm vitest run packages/core/test/public-api.test.ts
```

Atteso: **PASS**, 2 test.

- [ ] **Step 5: Verificare l'emissione dei tipi**

Vite in library mode emette **zero** file `.d.ts`: i tipi escono da `tsc` a parte. Lo script
`build:types` è già nel `package.json` root dal Task 1.

Aggiungi a `.gitignore`:

```
packages/*/dist/
```

Poi:

```
pnpm build:types
ls packages/core/dist
```

Atteso: `index.d.ts`, `projection.d.ts`, `depth.d.ts`, `height-grid.d.ts`, `picking.d.ts`,
`culling.d.ts`, `bounds.d.ts`, `errors.d.ts`, `types.d.ts` — 9 file.

- [ ] **Step 6: Eseguire l'intera suite e il typecheck**

```
pnpm test
pnpm typecheck
```

Atteso: **PASS** su tutti e 9 i file di test (~81 casi); typecheck exit 0.

> Non incanalare mai questi comandi in `tail`, `head` o `grep` prima di un commit: un pipeline
> restituisce l'exit code dell'ULTIMO comando, quindi `pnpm test | tail -5 && git commit`
> committa anche con i test rossi.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/public-api.test.ts .gitignore
git commit -m "Superficie pubblica del core, bloccata da un assert di uguaglianza

Un export in piu' e' un impegno di manutenzione preso senza accorgersene,
uno in meno e' un breaking change silenzioso. I tipi escono da tsc, perche'
Vite in library mode ne emette zero."
```

---

## Definition of Done — Piano 1

- [ ] `pnpm test` verde: 9 file di test, ~81 casi.
- [ ] `pnpm typecheck` exit 0.
- [ ] `pnpm build:types` produce 9 file `.d.ts`.
- [ ] Le tre guardie architetturali passano, **e** la guardia sugli import è stata vista
      fallire con un `import Phaser` temporaneo (Task 1 Step 6).
- [ ] Le tre batterie di mutazione (proiezione 5, picking 4, culling 5) hanno prodotto il
      numero atteso di fallimenti, e ogni buco scoperto è stato colmato.
- [ ] `packages/core` non contiene la stringa `phaser` in alcun sorgente, `package.json` o
      `tsconfig.json`.

Il Piano 2 (guscio Phaser) parte da qui e consuma `Projection`, `DepthAssigner`, `pick`,
`cullBounds`, `worldBounds` attraverso il barrel.
