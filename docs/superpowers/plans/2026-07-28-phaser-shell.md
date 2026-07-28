# Guscio Phaser + gate browser — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portare il kernel puro dentro Phaser 4 — uno `ScenePlugin` installabile, un
`IsoSprite` registrato sulla factory, camera e hit area — e poi **provare in un browser
vero** che quel che disegna è quel che diciamo.

**Architecture:** guscio sottile sopra `@iso-internal/core`. Il guscio non contiene
matematica: proietta chiamando il core, ordina chiamando il core, culla chiamando il core.
Tocca solo tre superfici di Phaser — `ScenePlugin`, `GameObjectFactory`, il display list
della Scene — che sono identiche byte per byte fra 4.0.0 e 4.2.1. Ogni pezzo di logica che
*può* essere puro **viene scritto puro** e testato in `node`: è la disciplina che nel Piano 1
ha prodotto zero difetti nel layer puro e li ha concentrati tutti nel layer Phaser.

**Tech Stack:** TypeScript 5.7, Phaser 4.2.1 (peer `^4.0.0`), vitest 3.2.7 (`node` per il
puro, `jsdom` per il guscio), Playwright per il gate browser, Vite per `examples/`.

**Spec di riferimento:** `docs/superpowers/specs/2026-07-27-phaser4-isometric-plugin-design.md`,
tappe **2** e **3** della §14. Il Piano 1 (`2026-07-27-core-kernel.md`) è completo e
mergiato: 102 test, `packages/core` con zero import di Phaser.

---

## Come è stato costruito questo piano

Ogni affermazione su Phaser in questo documento è stata **misurata a runtime**, non letta
nel JSDoc e non ricordata da Phaser 3. Il dossier delle misure è
`scratchpad/recon-shell/MISURATO-runtime.md`; la prova che le ha prodotte è
`scratchpad/jsdom-probe/`. Dove il JSDoc di Phaser e la misura non vanno d'accordo, in
questo piano **vince la misura**, e il disaccordo è annotato.

Cinque cose sono state trovate così, e ognuna cambia il codice che segue:

1. **Phaser non si importa affatto sotto jsdom nudo.** Muore al module load, non al boot.
2. **`init(data)` non viene mai chiamato** su uno `ScenePlugin`, e `data` non arriva da
   nessuna parte.
3. **Il plugin viene costruito una volta per Scene, `__SYSTEM` inclusa** — quindi N+1 volte.
4. **`destroy()` del plugin non viene mai invocato da Phaser**, malgrado il JSDoc.
5. **`startFollow(target)` azzera `roundPixels`** a `false`, buttando via la config del Game.

---

## Global Constraints

Vincolano **ogni** task. I requisiti di ogni task li includono implicitamente.

### Ereditati dal Piano 1 — costano caro riscoprirli

- **Import relativi SENZA estensione** (`moduleResolution: "bundler"`). Nel progetto di
  riferimento: 263 specificatori senza estensione, 0 con `.js`.
- **`lib: ES2020`**: vietati `Array.prototype.at()` (TS2550), `String.replaceAll`,
  `Object.groupBy`.
- **`useDefineForClassFields: false`** in `tsconfig.base.json`. Non toccarlo.
- **`vitest` NON typechecka** (esbuild striscia i tipi senza controllarli). `tsc --noEmit` è
  uno step separato, **mai dietro una pipe**, che ne maschererebbe l'exit code.
- **`-0` non è `0`** per `toEqual`/`toBe`. `Math.round(-0.4896)` vale `-0`. Forma preferita:
  `Math.round(x) + 0`. `JSON.stringify(-0)` è `"0"`, quindi un confronto via JSON lo maschera.
- **Validare alla costruzione, ovunque.** Cinque difetti del Piano 1 erano tutti della stessa
  classe: validazione mancante → risposta sbagliata **in silenzio**. Un input invalido lancia
  con un messaggio che **nomina la correzione**; un percorso caldo non lancia mai.
- **pnpm 11 nega gli script di install per default**: serve `allowBuilds` in
  `pnpm-workspace.yaml` (il monorepo ce l'ha già per `esbuild`; `examples/` lo erediterà).

### Nuovi, propri di questo piano

- **Il guscio non contiene matematica.** Nessuna formula di proiezione, di depth, di culling
  o di bounds viene riscritta in `packages/plugin`. Se serve un calcolo, si chiama il core; se
  il core non ce l'ha, si aggiunge al core con il suo test in `node`. Un test architetturale
  lo verifica (Task 10).
- **Zero import di Phaser in `packages/core`.** La guardia del Piano 1
  (`packages/core/test/purity.test.ts`, basata sull'AST) resta verde: se un task la fa
  fallire, il task è sbagliato, non la guardia.
- **Il codice spedito parla inglese**: messaggi d'errore e JSDoc esportato in inglese. I
  commenti interni restano in italiano, come nel core.
- **Peer `phaser: "^4.0.0"`.** Vietato usare `Phaser.GameObjects.Layer` e i RenderNode custom
  (superficie cambiata dentro la linea v4 → richiederebbero `^4.2.0`). Se un task ne ha
  bisogno, si ferma e lo segnala: il floor è una promessa pubblica, non un dettaglio.

  > **Precisazione su `Layer`, e correzione alla spec §13.6.** La spec §5 è esatta: `Layer`
  > «è diventato un vero GameObject solo in 4.1.0». È l'abbreviazione di §13.6 — «abbiamo
  > escluso `Layer` (4.1.0+)» — a essere fuorviante, perché si legge come «`Layer` non esiste
  > prima di 4.1.0». **Esiste già in 4.0.0**, con gli stessi sei file, esportato alle stesse
  > righe di `index.js`, registrato come `this.add.layer()` e marcato `@since 3.50.0`: quel
  > che 4.1.0 ha aggiunto è che sia un GameObject a pieno titolo. Il divieto resta invariato —
  > non ci serve, e il display list della Scene dà già tutto. Ma un vincolo abbreviato male è
  > un vincolo che qualcuno rimuoverà per la ragione sbagliata, quindi §13.6 va riscritta.
- **Usare l'API pubblica `setDepth()`**, mai scrivere `_depth`. Misurato: `sortChildrenFlag` è
  un singolo booleano, quindi N `setDepth` producono comunque **un solo** sort per frame.
  Non esiste e non va creato un `commitDepths()`.
- **Ogni file di test del guscio comincia con `// @vitest-environment jsdom`.** Verificato: il
  docblock per-file vince sull'`environment: 'node'` globale.
- **Sotto `HEADLESS` la metà «render» del frame NON esiste.** `Game.step` passa per
  `headlessStep`, che omette `scene.render(renderer)`. Le due conseguenze sono precisamente
  sui due comportamenti per cui questo plugin esiste:
  - **il depth sort non gira mai** — `displayList.depthSort()` è la prima istruzione di
    `Systems#render`. Un test che vuole l'ordine deve chiamare **`scene.sys.depthSort()`**
    (metodo pubblico, `Systems.js:404`);
  - **`camera.preRender()` non gira mai**, quindi `worldView` resta `{0,0,0,0}` e il follow
    non si applica. Un test che vuole la posizione della camera deve pompare a mano
    `camera.preRender()`, e uno che vuole il proxy aggiornato deve emettere `PRE_UPDATE`.

  Un test del guscio che *non* pompa e poi asserisce un ordine sta verificando il nulla. È il
  motivo per cui il gate browser (Task 12) non è sostituibile con più test `jsdom`.
- **Nessuna affermazione sul rendering è provata finché non passa il gate browser** (Task 12-13).
  Fino ad allora, un test `jsdom` prova il *cablaggio*, mai il *pixel*. Un task che scrive
  «verificato che disegna» senza il gate sta mentendo.

---

## Struttura dei file

```
packages/plugin/                      → diventerà il pacchetto "phaser-isometric"
├─ package.json                       peer phaser ^4.0.0, dep workspace sul core
├─ tsconfig.json                      build (include: src)
├─ tsconfig.test.json                 typecheck (include: src + test)
├─ src/
│   ├─ index.ts                       la superficie pubblica, bloccata da un assert
│   ├─ plugin.ts                      IsoPlugin: install, lifecycle, configure, place
│   ├─ iso-sprite.ts                  IsoSprite + registrazione sulla factory
│   ├─ camera.ts                      follow proxy + cameraBounds
│   ├─ hit-area.ts                    geometria pura del rombo + cablaggio setInteractive
│   ├─ snapshot.ts                    IsoSnapshot: piano, serializzabile, sola lettura
│   ├─ errors.ts                      IsoUsageError (runtime) accanto a IsoConfigError
│   └─ phaser-augment.d.ts            declare global { namespace Phaser { ... } }
└─ test/
    ├─ vendor/phaser-jsdom-setup.js   vendorizzato da phaser/tests/setup.js
    ├─ helper.ts                      bootGame/destroyGame, idioma di phaser/tests/helper.js
    └─ *.test.ts                      un file per task

examples/                             privato: playground Vite + banco di prova browser
├─ package.json
├─ vite.config.ts
├─ index.html
├─ src/main.ts                        la scena isometrica di riferimento
└─ e2e/
    ├─ playwright.config.ts
    ├─ render.spec.ts                 ordine di disegno, roundPixels, click sul rombo
    └─ bench.spec.ts                  500 entità: il numero che diventa promessa pubblica

consumer/                             fixture: un progetto TS vergine che compila il plugin
├─ tsconfig.json
└─ src/game.ts
```

**Perché `hit-area.ts` contiene sia il puro sia il cablaggio:** la geometria del rombo è
matematica testabile in `node`; `setInteractive` è cablaggio testabile solo in `jsdom`; il
*click* non è testabile in nessuno dei due (misurato: vedi sotto). Tenerli nello stesso file
li fa cambiare insieme, ed è il file che il gate browser va a smentire per primo.

---

## Il limite misurato che ridisegna il piano

**L'hit-test di input NON è esercitabile headless.** Misurato:

```json
{ "hasHitTest": "undefined",           // input.hitTest era v3: in v4 non esiste
  "cameraRenderListLen": 0,
  "cameraRenderListLenDopo": 0,        // resta 0: HEADLESS non renderizza mai
  "hitTestPointer": { "hits": 0 },
  "hitAreaIsOurPolygon": true,         // ma il CABLAGGIO si verifica benissimo
  "hitAreaCallbackIsOurs": true,
  "displayOriginX": 16, "displayOriginY": 16 }
```

`camera.renderList` si popola durante il *render*, e in HEADLESS il render non avviene mai.
Quindi la verifica si divide in tre, e il piano la divide davvero:

| Cosa | Dove | Task |
| --- | --- | --- |
| La geometria del rombo è quella giusta | `node`, funzione pura | 7 |
| Il poligono e la callback finiscono sull'oggetto | `jsdom`, cablaggio | 7 |
| Un click sul rombo colpisce la cella giusta | **browser**, gate bloccante | 12 |

È anche la prova indipendente del caveat della spec §5.4: l'ordine di input viene dalla
`renderList`, cioè dal **frame precedente**.

---

## Sequenza dei task

| # | Task | Anello | Gate di uscita |
| --- | --- | --- | --- |
| 1 | Pacchetto plugin + anello jsdom | jsdom | Un Game headless arriva a `create()` e crea uno Sprite vero |
| 2 | `IsoPlugin`: installazione, `mapping`, `withDefaults` | jsdom | `mapping` finisce dove è misurato che finisca; chiamare prima di configurare lancia |
| 3 | Ciclo di vita cablato a mano | jsdom | START/SHUTDOWN/DESTROY agganciati; nessuna doppia registrazione dopo un restart |
| 4 | `place()`: proiezione + depth | jsdom | Posizione dal core; N `setDepth` → un solo sort |
| 5 | `IsoSprite` e la factory | jsdom | `this.add.isoSprite()` esiste; registrazione idempotente su N+1 costruzioni |
| 6 | Camera: `follow()` e `cameraBounds()` | jsdom | `roundPixels` sopravvive a `startFollow` |
| 7 | Rombo: geometria pura + cablaggio hit area | node + jsdom | Il poligono coincide con `cornersOf`; limite del click dichiarato |
| 8 | `pick()` e `cullBounds()` sulla scena | jsdom | Il culling usa `worldView`; il picking rispetta l'elevazione |
| 9 | `snapshot()` | jsdom | Piano, serializzabile, senza riferimenti a Phaser |
| 10 | Superficie pubblica, `declare global`, consumatore | tsc | Un progetto TS vergine compila; la superficie è bloccata da un assert di uguaglianza |
| 11 | `examples/`: playground Vite | build | `vite build` verde |
| 12 | **GATE**: Playwright — disegno, `roundPixels`, click | **browser** | **Bloccante**: nessuna affermazione sul rendering vale prima di qui |
| 13 | **GATE**: benchmark 500 entità | **browser** | Un numero misurato sostituisce la promessa asserita |

I task 1-11 sono la tappa 2 della spec; i task 12-13 sono la tappa 3, ed è **bloccante**:
finché non passa, il plugin non va documentato come funzionante né pubblicato.

---

### Task 1: Il pacchetto plugin e l'anello jsdom

Il task più rischioso del piano, quindi va per primo. Se questo non regge, niente altro
regge. **È già stato provato che regge** (`scratchpad/jsdom-probe/`), quindi il compito qui
è trascrivere una soluzione nota, non inventarne una.

**Files:**
- Create: `packages/plugin/package.json`
- Create: `packages/plugin/tsconfig.json`
- Create: `packages/plugin/tsconfig.test.json`
- Create: `packages/plugin/test/vendor/phaser-jsdom-setup.js`
- Create: `packages/plugin/test/helper.ts`
- Test: `packages/plugin/test/harness.test.ts`
- Modify: `vitest.config.ts` (aggiungere `setupFiles`)
- Modify: `package.json` (script `typecheck`)

**Interfaces:**
- Consumes: niente dai task precedenti (è il primo).
- Produces: `bootGame(config?): Promise<Phaser.Scene>` e `destroyGame(): void` da
  `test/helper.ts`; ogni task successivo li usa e **non** ne scrive di propri.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/harness.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, Phaser } from './helper';

afterEach(() => { destroyGame(); });

describe('l\'anello jsdom', () => {
    it('avvia un Game headless fino a create()', async () => {
        const scene = await bootGame();
        expect(scene).toBeTruthy();
        expect(scene.sys.settings.key).toBe('probe');
    });

    it('crea un GameObject vero, non un mock', async () => {
        const scene = await bootGame();
        const sprite = scene.add.sprite(100, 200, '__DEFAULT');
        expect(sprite.type).toBe('Sprite');
        expect(sprite.x).toBe(100);
        expect(sprite.y).toBe(200);
        expect(scene.sys.displayList.exists(sprite)).toBe(true);
    });

    it('espone il namespace Phaser con la versione attesa', () => {
        expect(Phaser.VERSION.startsWith('4.')).toBe(true);
        expect(typeof Phaser.Plugins.ScenePlugin).toBe('function');
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `npx vitest run packages/plugin`
Expected: FAIL — `Cannot find module './helper'` (e, prima ancora, il pacchetto non esiste).

- [ ] **Step 3: Creare `packages/plugin/package.json`**

```json
{
  "name": "phaser-isometric",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@iso-internal/core": "workspace:*"
  },
  "peerDependencies": {
    "phaser": "^4.0.0"
  },
  "devDependencies": {
    "phaser": "4.2.1"
  }
}
```

`private: true` per ora: il packaging vero (exports map, `sideEffects`, build) è tappa 5
della spec, cioè un piano successivo. Il nome è già quello definitivo — è libero su npm,
verificato il 2026-07-27.

**Verificato:** `main`/`types` che puntano a un `.ts` con `moduleResolution: "bundler"`
funzionano sia per `tsc --noEmit` sia per vitest a runtime (provato con un pacchetto
`_probe` usa-e-getta prima di scrivere questo piano).

- [ ] **Step 4: Creare i due `tsconfig`**

`packages/plugin/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/plugin/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Due cose deliberate, entrambe misurate:

- **Niente `esModuleInterop`, niente `allowSyntheticDefaultImports`.** `import Phaser from
  'phaser'` typechecka *e* funziona a runtime con la config base così com'è (provato: `tsc
  --noEmit` exit 0 su tutte e tre le forme di import, e a runtime il default export è già il
  namespace, senza `.default` da spacchettare).
- **Niente `types: ["node"]` nel tsconfig di build**, che compila solo `src`: il guscio non
  deve poter usare API di Node. Nel tsconfig di test serve, perché l'helper usa i timer.

- [ ] **Step 5: Installare le dipendenze**

```bash
pnpm install
```

Expected: `phaser 4.2.1` in `packages/plugin/node_modules/`.
Se compare `ERR_PNPM_IGNORED_BUILDS`, `pnpm-workspace.yaml` ha già `allowBuilds: esbuild:
true` — non aggiungerne altri senza motivo.

- [ ] **Step 6: Vendorizzare il setup jsdom di Phaser**

```bash
cp packages/plugin/node_modules/phaser/tests/setup.js \
   packages/plugin/test/vendor/phaser-jsdom-setup.js
```

**Perché vendorizzare e non importare:** l'exports map di Phaser espone **solo** `"."` e
`"./package.json"` (verificato in `node_modules/phaser/package.json`). `import
'phaser/tests/setup.js'` è bloccato da Node con `ERR_PACKAGE_PATH_NOT_EXPORTED`. Non è una
preferenza: è l'unica strada.

Poi applicare **esattamente due modifiche** al file copiato.

**(a)** In cima al file, sostituire il JSDoc originale con questa intestazione — è codice di
terzi in un pacchetto open source, l'attribuzione non è opzionale:

```js
/**
 * Vendorizzato da phaser@4.2.1 `tests/setup.js`.
 * Copyright 2013-2026 Phaser Studio Inc. — MIT License.
 *
 * Copiato invece che importato perche' l'exports map di Phaser espone solo
 * "." e "./package.json": `import 'phaser/tests/setup.js'` fallisce con
 * ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * Perche' serve: senza i mock di getContext, `import 'phaser'` NON arriva
 * nemmeno in fondo — muore al module load in checkInverseAlpha, perche'
 * jsdom restituisce null da canvas.getContext('2d'). Non e' il boot a
 * fallire: e' l'import.
 *
 * MODIFICATO rispetto all'originale: tutto il corpo e' avvolto in una
 * guardia `typeof window`, vedi in fondo al file.
 */
```

**(b)** Avvolgere **tutto** il corpo del file nella guardia seguente:

```js
//  `setupFiles` gira per OGNI file di test, inclusi quelli del core che
//  girano in environment 'node'. Li' non c'e' window, i mock non servono, e
//  soprattutto la sovrascrittura di console.error dell'originale
//  ingoierebbe messaggi di diagnostica dei test puri.
if (typeof window !== 'undefined')
{
    // ... l'intero corpo originale, indentato di un livello ...
}
```

Dopo la copia, verificare che il file contenga ancora i tre pezzi che lo rendono utile:
il mock di `HTMLCanvasElement.prototype.getContext` per `'2d'` e `'webgl'`, il mock di
`Image` che chiama `onload` dentro un `setTimeout` (senza, il `TextureManager` non emette
mai `READY` e **il boot si blocca per sempre**), e gli stub di `global.self` / `global.screen`.

- [ ] **Step 7: Creare `packages/plugin/test/helper.ts`**

```ts
import PhaserNS from 'phaser';

/**
 * Il namespace Phaser, importato una volta sola.
 *
 * Misurato su 4.2.1: il default export del bundle ESM E' gia' il namespace
 * (`Phaser.Game` e' una funzione, `Phaser.default` e' undefined), quindi non
 * serve alcuna normalizzazione `?? .default`.
 */
export const Phaser = PhaserNS;

let currentGame: Phaser.Game | null = null;

/**
 * Avvia un Game headless e risolve con la Scene attiva, una volta che
 * `create()` e' stato chiamato.
 *
 * Idioma copiato da `phaser/tests/helper.js`: HEADLESS, niente banner,
 * niente audio. `config` viene fuso sopra, quindi un test puo' aggiungere
 * `plugins`, `render`, o sostituire `scene`.
 *
 * Il timeout esiste perche' il modo tipico di sbagliare qui non e'
 * un'eccezione: e' un boot che non finisce mai (vedi il mock di Image nel
 * setup vendorizzato). Una Promise appesa farebbe scadere il test con un
 * messaggio che non dice niente; questo dice cosa e' successo.
 */
export function bootGame(config: Record<string, unknown> = {}): Promise<Phaser.Scene> {
    destroyGame();

    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('the game never reached create(): the boot sequence stalled')),
            8000
        );

        currentGame = new Phaser.Game({
            type: Phaser.HEADLESS,
            width: 800,
            height: 600,
            banner: false,
            audio: { noAudio: true },
            scene: {
                key: 'probe',
                create(this: Phaser.Scene) { clearTimeout(timer); resolve(this); }
            },
            ...config
        } as Phaser.Types.Core.GameConfig);
    });
}

/** Distrugge il Game corrente. Idempotente: chiamarlo senza un gioco attivo
 *  non fa niente, cosi' un `afterEach` incondizionato e' sicuro. */
export function destroyGame(): void {
    if (!currentGame) return;
    try { currentGame.destroy(true); } catch { /* un boot fallito puo' lasciare uno stato parziale */ }
    currentGame = null;
}

/**
 * Dimentica uno scene plugin registrato, cosi' il prossimo Game riparte pulito.
 *
 * SERVE DAVVERO, non e' igiene di lusso. `PluginCache` e' un singleton di
 * MODULO, e `game.destroy()` lo svuota solo se `game.noReturn` e' vero
 * (PluginManager.destroy → destroyCorePlugins). Quindi, dopo il primo Game,
 * `installScenePlugin` trova `PluginCache.hasCore(key) === true` e SALTA la
 * ri-registrazione: il secondo Game eredita in silenzio il `mapping` del
 * primo. Un test che installa lo stesso plugin con un mapping diverso
 * fallirebbe per una ragione che non ha niente a che vedere con cio' che sta
 * verificando.
 */
export function forgetScenePlugin(key: string): void {
    Phaser.Plugins.PluginCache.remove(key);
}
```

- [ ] **Step 8: Aggiungere `setupFiles` a `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['packages/*/test/**/*.test.ts'],
        // Deve girare PRIMA di qualunque import di Phaser, quindi vive qui e non
        // in un beforeAll. Sotto 'node' e' un no-op grazie alla guardia interna.
        setupFiles: ['./packages/plugin/test/vendor/phaser-jsdom-setup.js']
    }
});
```

L'`environment: 'node'` globale **resta**: sono i file del guscio a dichiarare
`// @vitest-environment jsdom` in cima. Verificato che il docblock per-file vince.

- [ ] **Step 9: Estendere lo script `typecheck`**

In `package.json`, sostituire lo script `typecheck` con:

```json
"typecheck": "tsc --noEmit -p packages/core/tsconfig.test.json && tsc --noEmit -p packages/plugin/tsconfig.test.json"
```

`&&`, non una pipe: una pipe maschererebbe l'exit code del primo comando.

- [ ] **Step 10: Eseguire i test e vederli passare**

Run: `npx vitest run packages/plugin`
Expected: PASS, 3 test.

Run: `npx vitest run`
Expected: PASS, 102 test del core + 3 del guscio = **105**. Se i test del core sono cambiati
di numero, fermarsi: il setup vendorizzato sta interferendo con l'anello `node`.

Run: `pnpm typecheck`
Expected: exit 0. **Non incanalarlo in una pipe.**

- [ ] **Step 11: Commit**

```bash
git add packages/plugin vitest.config.ts package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "Piano 2 Task 1: il pacchetto plugin e l'anello jsdom"
```

**Definition of Done:**
- `npx vitest run` è verde e conta 105 test.
- `pnpm typecheck` esce 0.
- `packages/plugin/test/vendor/phaser-jsdom-setup.js` porta l'attribuzione MIT e la guardia
  `typeof window`.
- Nessun file sotto `packages/core/` è stato toccato.

---

### Task 2: `IsoPlugin` — installazione, `mapping`, `withDefaults`

**Files:**
- Create: `packages/plugin/src/errors.ts`
- Create: `packages/plugin/src/plugin.ts`
- Test: `packages/plugin/test/install.test.ts`

**Interfaces:**
- Consumes: `bootGame`, `destroyGame`, `forgetScenePlugin`, `Phaser` da `test/helper.ts`
  (Task 1). Dal core: `createProjection`, `createDepthAssigner`, `DEFAULT_BANDS`, e i tipi
  `Projection`, `DepthAssigner`, `DepthAssignerOptions`, `ProjectionSpec`, `ProjectionOptions`.
- Produces:
  - `ISO_PLUGIN_KEY: 'IsoPlugin'` — la chiave nella PluginCache.
  - `class IsoPlugin extends Phaser.Plugins.ScenePlugin`, con
    `configure(spec, opts?): this`, `get projection(): Projection`,
    `get depth(): DepthAssigner`, `get bands()`, `get isConfigured(): boolean`,
    `static withDefaults(spec, opts?): typeof IsoPlugin`.
  - `isoScenePlugin(opts?): Phaser.Types.Core.PluginObjectItem`.
  - `class IsoUsageError extends Error` con `symptom` e `fix`.

**Il fatto misurato che questo task esiste per neutralizzare.** Un utente che copia
l'`@example` ufficiale di Phaser — `{ key, plugin, systemKey, sceneKey }`
(`src/core/typedefs/PluginObjectItem.js:17-18`, riprodotto anche in
`types/phaser.d.ts:96150-96158`) — ottiene un plugin montato su **`scene["null"]`**, con
`pluginKey === null`, **senza un solo warning**. `systemKey` e `sceneKey` sono campi morti su
questo percorso: appartengono al Loader. Misurato, non dedotto.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/install.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';
import { IsoUsageError } from '../src/errors';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => {
    destroyGame();
    // Obbligatorio: la PluginCache e' un singleton di modulo che sopravvive a
    // game.destroy(). Senza questo, il test successivo eredita in silenzio il
    // mapping di questo.
    forgetScenePlugin(ISO_PLUGIN_KEY);
});

describe('dove finisce il plugin', () => {
    it('si monta su sys[mapping] E su scene[mapping]', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        expect(scene.sys.iso).toBeInstanceOf(IsoPlugin);
        expect(scene.iso).toBeInstanceOf(IsoPlugin);
        expect(scene.iso).toBe(scene.sys.iso);
    });

    it('NON si monta sulla key: la key vive solo nella PluginCache', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        expect((scene.sys as Record<string, unknown>)[ISO_PLUGIN_KEY]).toBeUndefined();
        expect((scene as unknown as Record<string, unknown>)[ISO_PLUGIN_KEY]).toBeUndefined();
    });

    it('riceve il mapping come terzo argomento del costruttore', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        expect(scene.iso.pluginKey).toBe('iso');
    });

    it('rispetta un mapping diverso da quello di default', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'griglia', projection: DIAMOND })] }
        });

        expect((scene as unknown as Record<string, unknown>).griglia).toBeInstanceOf(IsoPlugin);
        expect((scene as unknown as Record<string, unknown>).iso).toBeUndefined();
    });
});

describe('quante volte viene costruito', () => {
    it('una per Scene, __SYSTEM inclusa', async () => {
        const viste: string[] = [];

        class Contatore extends IsoPlugin {
            constructor(scene: Phaser.Scene, pm: Phaser.Plugins.PluginManager, key: string) {
                super(scene, pm, key);
                viste.push(scene.sys.settings.key);
            }
        }

        await bootGame({ plugins: { scene: [{ key: ISO_PLUGIN_KEY, plugin: Contatore, mapping: 'iso' }] } });

        // Phaser avvia una Scene di sistema nascosta (SceneManager.js:195) e il
        // plugin viene istanziato anche li'. Il conteggio e' N scene utente + 1,
        // non N: un test che si aspetta 1 fallisce per la ragione sbagliata.
        expect(viste).toEqual(['__SYSTEM', 'probe']);
    });

    it('non riceve mai init(), e `data` viene buttato via', async () => {
        const initChiamate: unknown[] = [];

        class Spia extends IsoPlugin {
            init(data?: unknown): void { initChiamate.push(data); }
        }

        await bootGame({
            plugins: {
                scene: [{ key: ISO_PLUGIN_KEY, plugin: Spia, mapping: 'iso', data: { ciao: 'mondo' } }]
            }
        });

        expect(initChiamate).toEqual([]);
    });
});

describe('configurazione', () => {
    it('withDefaults consegna un plugin gia configurato', async () => {
        const scene = await bootGame({
            plugins: { scene: [{ key: ISO_PLUGIN_KEY, plugin: IsoPlugin.withDefaults(DIAMOND), mapping: 'iso' }] }
        });

        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(0, 0)).toEqual({ x: 0, y: 0 });
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });

    it('configure() dalla create() della Scene fa lo stesso lavoro', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        });

        expect(scene.iso.isConfigured).toBe(false);
        expect(scene.iso.configure(DIAMOND)).toBe(scene.iso);
        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });

    it('leggere projection prima di configurare lancia, e il messaggio nomina la correzione', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso' })] }
        });

        expect(() => scene.iso.projection).toThrow(IsoUsageError);
        try {
            scene.iso.projection;
            expect.unreachable('avrebbe dovuto lanciare');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain('configure');
            expect(msg).toContain('withDefaults');
        }
    });

    it('bands espone le sette bande del core', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ mapping: 'iso', projection: DIAMOND })] }
        });

        expect(scene.iso.bands.floor).toBe(0);
        expect(scene.iso.bands.overlay).toBe(6);
    });
});

describe('la factory di config', () => {
    it('produce una entry con mapping, e mai systemKey/sceneKey', () => {
        const entry = isoScenePlugin({ projection: DIAMOND });

        expect(entry.key).toBe(ISO_PLUGIN_KEY);
        expect(entry.mapping).toBe('iso');
        expect(entry).not.toHaveProperty('systemKey');
        expect(entry).not.toHaveProperty('sceneKey');
    });

    it('senza projection restituisce la classe nuda, non una sottoclasse', () => {
        expect(isoScenePlugin().plugin).toBe(IsoPlugin);
        expect(isoScenePlugin({ projection: DIAMOND }).plugin).not.toBe(IsoPlugin);
    });
});

describe('installazione sbagliata', () => {
    it('senza mapping avvisa, e l avviso nomina mapping', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // La forma ESATTA dell'@example ufficiale di Phaser.
        const scene = await bootGame({
            plugins: {
                scene: [{ key: ISO_PLUGIN_KEY, plugin: IsoPlugin, systemKey: 'isoSys', sceneKey: 'iso' }]
            }
        });

        // Cosi' finisce davvero: sulla proprieta' stringa "null".
        expect((scene as unknown as Record<string, unknown>)['null']).toBeInstanceOf(IsoPlugin);
        expect((scene as unknown as Record<string, unknown>).iso).toBeUndefined();

        const messaggi = warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(messaggi).toContain('mapping');
        warn.mockRestore();
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `npx vitest run packages/plugin/test/install.test.ts`
Expected: FAIL — `Cannot find module '../src/plugin'`.

- [ ] **Step 3: Scrivere `packages/plugin/src/errors.ts`**

```ts
/**
 * A usage error: the API was called in an order that cannot work.
 *
 * Deliberately distinct from the core's `IsoConfigError`, which reports an
 * invalid VALUE. Here every value is fine and the SEQUENCE is not, so the
 * correction is a different one — and a message that blurs the two sends the
 * reader looking at the wrong thing.
 *
 * As in the core, `fix` is not optional: a message that names only the
 * symptom forces whoever reads it to guess, exactly when they can least
 * afford to.
 */
export class IsoUsageError extends Error {
    override readonly name = 'IsoUsageError';

    constructor(
        readonly symptom: string,
        readonly fix: string
    ) {
        super(`${symptom}. Fix: ${fix}`);
    }
}
```

- [ ] **Step 4: Scrivere `packages/plugin/src/plugin.ts`**

```ts
import Phaser from 'phaser';
import { createDepthAssigner, createProjection, DEFAULT_BANDS } from '@iso-internal/core';
import type {
    DepthAssigner,
    DepthAssignerOptions,
    Projection,
    ProjectionOptions,
    ProjectionSpec
} from '@iso-internal/core';
import { IsoUsageError } from './errors';

/**
 * The key this plugin occupies in Phaser's PluginCache.
 *
 * Not the same thing as the `mapping`, which is the property name on the
 * Scene. The key is global and must not collide with a built-in: 'ScenePlugin'
 * for instance is already taken by `Phaser.Scenes.ScenePlugin`, a completely
 * different class.
 */
export const ISO_PLUGIN_KEY = 'IsoPlugin';

export interface IsoConfigureOptions extends ProjectionOptions {
    /** Options forwarded to the core's depth assigner. */
    depth?: DepthAssignerOptions;
}

export interface IsoScenePluginOptions extends IsoConfigureOptions {
    /** The property this plugin gets on the Scene — `this.iso`. Defaults to `'iso'`. */
    mapping?: string;
    /** The projection every Scene starts with. Omit it to configure per Scene. */
    projection?: ProjectionSpec;
}

function notConfigured(what: string): IsoUsageError {
    return new IsoUsageError(
        `the isometric plugin has no projection yet, so \`${what}\` cannot be read`,
        'install it with isoScenePlugin({ projection: { type: "diamond", tileWidth: 96, tileHeight: 48 } }), ' +
        'or call this.iso.configure(...) from your Scene\'s create()'
    );
}

export class IsoPlugin extends Phaser.Plugins.ScenePlugin {
    // `useDefineForClassFields: false` (vedi tsconfig.base.json) e' cio' che
    // rende questi campi assegnazioni normali nel costruttore invece di
    // defineProperty. Con `true` un campo che collide con un accessor della
    // classe base lo shadowerebbe. Qui non collide, ma la regola vale per
    // chiunque sottoclassi, ed e' la ragione per cui l'opzione e' fissata.
    private proiezione: Projection | null = null;
    private assegnatore: DepthAssigner | null = null;

    /**
     * Bakes a projection into a subclass, so the plugin arrives already
     * configured.
     *
     * It exists because Phaser NEVER calls `init(data)` on a Scene plugin, and
     * DISCARDS the `data` field of a `plugins.scene` entry — measured on 4.2.1,
     * where the typedef advertises `data` and the code path never reads it.
     * Without this, a game-wide default projection would have no way to travel.
     */
    static withDefaults(spec: ProjectionSpec, opts: IsoConfigureOptions = {}): typeof IsoPlugin {
        return class IsoPluginWithDefaults extends IsoPlugin {
            constructor(
                scene: Phaser.Scene,
                pluginManager: Phaser.Plugins.PluginManager,
                pluginKey: string
            ) {
                super(scene, pluginManager, pluginKey);
                this.configure(spec, opts);
            }
        };
    }

    /**
     * Sets, or replaces, this Scene's projection. Returns `this`, so it reads
     * well from a Scene's `create()`.
     */
    configure(spec: ProjectionSpec, opts: IsoConfigureOptions = {}): this {
        this.proiezione = createProjection(spec, opts);
        this.assegnatore = createDepthAssigner(opts.depth);
        return this;
    }

    /** Whether a projection has been set. Never throws — use it to branch. */
    get isConfigured(): boolean {
        return this.proiezione !== null;
    }

    /** The active projection. Throws if the plugin has not been configured. */
    get projection(): Projection {
        if (!this.proiezione) throw notConfigured('projection');
        return this.proiezione;
    }

    /** The active depth assigner. Throws if the plugin has not been configured. */
    get depth(): DepthAssigner {
        if (!this.assegnatore) throw notConfigured('depth');
        return this.assegnatore;
    }

    /** The seven default depth bands: floor, decal, prop, item, actor, hero, overlay. */
    get bands(): typeof DEFAULT_BANDS {
        return DEFAULT_BANDS;
    }

    override boot(): void {
        // `pluginKey` is the MAPPING, not the key (measured on 4.2.1). Phaser's
        // .d.ts declares it `string`, but with `mapping` omitted it is `null` at
        // runtime and the plugin silently mounts on `scene["null"]`. This is the
        // only moment the mistake is still catchable, and it costs nothing.
        const mapping: unknown = this.pluginKey;

        if (typeof mapping !== 'string' || mapping.length === 0) {
            console.warn(
                '[phaser-isometric] installed without a `mapping`, so it is reachable only as ' +
                `\`scene[${JSON.stringify(mapping)}]\` and \`this.iso\` will be undefined. ` +
                'Fix: use isoScenePlugin({ mapping: "iso" }) in plugins.scene. ' +
                'Note that `systemKey` and `sceneKey`, which appear in Phaser\'s own documented ' +
                'example, are read only by the Loader and are ignored here.'
            );
        }
    }
}

/**
 * Builds the `plugins.scene` entry for you.
 *
 * Prefer this over writing the object by hand. Phaser's own documented example
 * for a scene plugin uses `systemKey` / `sceneKey`, which this code path never
 * reads; copying it yields a plugin mounted on `scene["null"]` with no warning.
 * This function cannot produce that shape.
 *
 * ```ts
 * new Phaser.Game({
 *   plugins: { scene: [ isoScenePlugin({
 *     projection: { type: 'diamond', tileWidth: 96, tileHeight: 48 }
 *   }) ] }
 * });
 * // then, in any Scene: this.iso.projection.project(gx, gy)
 * ```
 */
export function isoScenePlugin(opts: IsoScenePluginOptions = {}): Phaser.Types.Core.PluginObjectItem {
    const { mapping = 'iso', projection, ...resto } = opts;

    return {
        key: ISO_PLUGIN_KEY,
        plugin: projection ? IsoPlugin.withDefaults(projection, resto) : IsoPlugin,
        mapping
    };
}
```

- [ ] **Step 5: Eseguire i test e vederli passare**

Run: `npx vitest run packages/plugin/test/install.test.ts`
Expected: PASS, 12 test.

Run: `pnpm typecheck`
Expected: exit 0.

Se `scene.iso` non typechecka, **è atteso**: la dichiarazione globale arriva al Task 10. Fino
ad allora i test usano `scene.iso` attraverso un cast, oppure `scene.sys.iso`. Se l'implementer
si trova a dover inventare una dichiarazione globale qui, si fermi e lo segnali: sta facendo
il lavoro del Task 10 con meno informazioni.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/errors.ts packages/plugin/src/plugin.ts packages/plugin/test/install.test.ts
git commit -m "Piano 2 Task 2: IsoPlugin, mapping obbligatorio, withDefaults"
```

**Definition of Done:**
- 12 test verdi in `install.test.ts`; totale della suite **117**.
- `pnpm typecheck` esce 0.
- Nessuna formula matematica in `plugin.ts`: proiezione e depth vengono dal core.
- Il warning del `mapping` mancante nomina `mapping` **e** dice che `systemKey`/`sceneKey`
  sono ignorati.

---

### Task 3: Il ciclo di vita, cablato a mano

`Phaser.Plugins.ScenePlugin` aggancia **un solo** evento: `once(BOOT)`, dal costruttore
(`src/plugins/ScenePlugin.js:83`). Il suo `boot()` è **vuoto**. E `destroy()` **non viene mai
chiamato da nessuno** — misurato, e verificato leggendo i tre soli punti che potrebbero
farlo: `Systems.destroy` azzera una lista di proprietà cablata a mano che non contiene il
nostro `mapping`; `SceneManager` chiama solo `sys.destroy()`; `PluginManager.destroy` itera
la lista dei plugin **globali**, dove uno scene plugin non compare mai.

Il JSDoc di `ScenePlugin#destroy` dice: *«This method is called automatically when the Scene
is destroyed.»* È falso. Se non lo agganciamo noi, il plugin trattiene la Scene, i suoi
Systems e ogni listener per tutta la vita della pagina.

**Nessuno dei 15 plugin core di Phaser estende `Phaser.Plugins.ScenePlugin`** (verificato con
un grep sull'intero `src/`: zero occorrenze di `Extends: ScenePlugin`). Tutti registrano a
mano lo stesso schema, ed è quello che copiamo:

```
costruttore:  once(BOOT, this.boot)  +  on(START, this.start)
boot():       once(DESTROY, this.destroy)      ← la classe base NON lo fa
start():      on(...)  +  once(SHUTDOWN, this.shutdown)
shutdown():   off() esattamente cio' che start() ha aggiunto
destroy():    this.shutdown(); off(START); azzera i riferimenti
```

`BOOT` è `once` e `START` è `on` perché una Scene si avvia una volta sola ma può essere
fermata e riavviata molte volte.

**Files:**
- Modify: `packages/plugin/src/plugin.ts`
- Test: `packages/plugin/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: tutto il Task 2.
- Produces: sul plugin, `start()`, `shutdown()`, `override destroy()`, e
  `get isLive(): boolean`. I task successivi agganciano il proprio lavoro per frame dentro
  `start()` e lo staccano dentro `shutdown()`; **non** registrano listener altrove.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/lifecycle.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, IsoPlugin, isoScenePlugin } from '../src/plugin';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => {
    destroyGame();
    forgetScenePlugin(ISO_PLUGIN_KEY);
});

/** Conta i listener registrati su un evento di Scene, per nome di evento. */
function listenerCount(scene: Phaser.Scene, evento: string): number {
    return scene.sys.events.listenerCount(evento);
}

describe('il cablaggio del ciclo di vita', () => {
    it('boot() aggancia DESTROY, che la classe base non aggancia', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });

        expect(scene.iso.isLive).toBe(true);
        expect(listenerCount(scene, Phaser.Scenes.Events.DESTROY)).toBeGreaterThan(0);
    });

    it('destroy() viene eseguito quando la Scene muore', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });
        const plugin = scene.iso;

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);

        expect(plugin.isLive).toBe(false);
    });

    it('un riavvio della Scene non raddoppia i listener', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });

        const dopoIlPrimoStart = listenerCount(scene, Phaser.Scenes.Events.SHUTDOWN);

        // Il ciclo che Phaser percorre a ogni scene.restart(): SHUTDOWN poi START.
        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);
        scene.sys.events.emit(Phaser.Scenes.Events.START, scene.sys);
        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);
        scene.sys.events.emit(Phaser.Scenes.Events.START, scene.sys);

        // Questo e' il difetto che il test esiste per prendere: se start()
        // registra con `on` e shutdown() non stacca, il conteggio cresce a ogni
        // giro e ogni handler gira N volte per frame.
        expect(listenerCount(scene, Phaser.Scenes.Events.SHUTDOWN)).toBe(dopoIlPrimoStart);
    });

    it('dopo destroy() il plugin non trattiene piu la Scene', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });
        const plugin = scene.iso;

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);

        // ScenePlugin.destroy() della classe base azzera questi quattro.
        expect((plugin as unknown as { scene: unknown }).scene).toBeNull();
        expect((plugin as unknown as { systems: unknown }).systems).toBeNull();
    });

    it('destroy() e idempotente: chiamarlo due volte non lancia', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });
        const plugin = scene.iso;

        scene.sys.events.emit(Phaser.Scenes.Events.DESTROY, scene.sys);
        expect(() => plugin.destroy()).not.toThrow();
    });

    it('la configurazione sopravvive a uno shutdown, che non e una distruzione', async () => {
        const scene = await bootGame({
            plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }
        });

        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);

        expect(scene.iso.isConfigured).toBe(true);
        expect(scene.iso.projection.project(1, 0)).toEqual({ x: 48, y: 24 });
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `npx vitest run packages/plugin/test/lifecycle.test.ts`
Expected: FAIL — `isLive` non esiste.

- [ ] **Step 3: Aggiungere il ciclo di vita a `plugin.ts`**

Nel costruttore della classe `IsoPlugin`, aggiungere `on(START)` accanto all'`once(BOOT)` che
la classe base ha già registrato:

```ts
    constructor(
        scene: Phaser.Scene,
        pluginManager: Phaser.Plugins.PluginManager,
        pluginKey: string
    ) {
        super(scene, pluginManager, pluginKey);

        // La classe base ha gia' registrato `once(BOOT, this.boot, this)`, e
        // NIENT'ALTRO. START va agganciato qui, con `on` e non `once`: una Scene
        // si avvia una volta sola, ma puo' essere fermata e riavviata all'infinito.
        // E' lo schema identico di CameraManager, TweenManager e InputPlugin, che
        // sono i tre plugin di Phaser che fanno questo lavoro sul serio.
        scene.sys.events.on(Phaser.Scenes.Events.START, this.start, this);
    }
```

Aggiungere il campo di stato accanto agli altri:

```ts
    private vivo = false;
```

Sostituire `boot()` con la versione che aggancia `DESTROY`, **tenendo** il controllo sul
mapping già scritto nel Task 2:

```ts
    override boot(): void {
        // ... il controllo sul `mapping` del Task 2, invariato ...

        this.vivo = true;

        // LA riga che la classe base non scrive. `ScenePlugin#destroy` promette
        // nel proprio JSDoc di essere chiamato automaticamente alla morte della
        // Scene: misurato falso. Systems.destroy azzera una lista cablata a mano
        // che non contiene il nostro mapping, SceneManager chiama solo
        // sys.destroy(), e PluginManager.destroy itera i plugin GLOBALI. Senza
        // questa riga il plugin trattiene Scene, Systems e listener per sempre.
        this.systems?.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    }

    /** True between `boot()` and `destroy()`. Never throws. */
    get isLive(): boolean {
        return this.vivo;
    }

    /**
     * Called on every (re)start of the Scene. Per-run wiring goes here, and
     * `shutdown()` must remove exactly what this adds.
     */
    start(): void {
        const events = this.systems?.events;
        if (!events) return;

        // `once`, non `on`: shutdown() lo stacca comunque, ma se una Scene viene
        // riavviata senza passare da SHUTDOWN — cosa che Phaser non fa, ma che un
        // test o un plugin di terze parti puo' fare — `once` impedisce comunque
        // che il conteggio cresca.
        events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    /**
     * Called when the Scene stops. Releases per-run state but KEEPS the
     * configuration: a stopped Scene can be restarted, and re-projecting a world
     * that never changed would be work for nothing.
     */
    shutdown(): void {
        const events = this.systems?.events;
        if (!events) return;

        events.off(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    }

    /**
     * Called when the Scene is destroyed — but only because `boot()` subscribed
     * to it. Nothing in Phaser calls this on its own.
     */
    override destroy(): void {
        if (!this.vivo) return;   // idempotente: DESTROY puo' arrivare due volte
        this.vivo = false;

        this.shutdown();

        // Va staccato esplicitamente: e' l'unico listener registrato con `on`,
        // quindi e' l'unico che sopravvivrebbe.
        this.systems?.events.off(Phaser.Scenes.Events.START, this.start, this);

        this.proiezione = null;
        this.assegnatore = null;

        // Azzera scene/systems/game/pluginManager. Va per ultimo: tutto quello
        // che sta sopra ha bisogno di `this.systems`.
        super.destroy();
    }
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `npx vitest run packages/plugin/test/lifecycle.test.ts`
Expected: PASS, 6 test.

Run: `npx vitest run`
Expected: PASS, **123** test.

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 5: Batteria di mutazione — obbligatoria prima di dichiarare il task chiuso**

Ogni rottura qui sotto **deve** far fallire un test nominato. Se una passa, il test che
dovrebbe prenderla non sta guardando niente e va corretto **prima** del commit.

| # | Rottura | Test che deve fallire |
| --- | --- | --- |
| 1 | Togliere `once(DESTROY, this.destroy)` da `boot()` | «destroy() viene eseguito quando la Scene muore» |
| 2 | In `start()`, usare `on` invece di `once` **e** togliere la `off` da `shutdown()` | «un riavvio della Scene non raddoppia i listener» |
| 3 | In `destroy()`, non chiamare `super.destroy()` | «dopo destroy() il plugin non trattiene piu la Scene» |
| 4 | Togliere la guardia `if (!this.vivo) return` da `destroy()` | «destroy() e idempotente» |
| 5 | In `shutdown()`, azzerare anche `this.proiezione` | «la configurazione sopravvive a uno shutdown» |

Ripristinare il codice dopo ogni mutazione. Riportare l'esito delle cinque nel report.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/plugin.ts packages/plugin/test/lifecycle.test.ts
git commit -m "Piano 2 Task 3: ciclo di vita cablato a mano, perche' Phaser non lo fa"
```

**Definition of Done:**
- 6 test verdi in `lifecycle.test.ts`; totale della suite **123**.
- Le cinque mutazioni sono state provate e **ognuna** ha fatto fallire il test atteso.
- `pnpm typecheck` esce 0.
- `destroy()` chiama `super.destroy()` **per ultimo**.

---

### Task 4: `place()` — proiezione e depth in un solo percorso

Un solo metodo posiziona **e** ordina, così un oggetto creato con
`this.add.isoSprite(...)` e uno posizionato a mano non possono finire con convenzioni
diverse. È la ragione per cui `place()` viene prima di `IsoSprite`, e non il contrario.

**Files:**
- Modify: `packages/plugin/src/plugin.ts`
- Test: `packages/plugin/test/place.test.ts`

**Interfaces:**
- Consumes: `projection`, `depth`, `bands` dal Task 2.
- Produces: `place<T extends Placeable>(target, gx, gy, z?, band?, sub?): T`, e il tipo
  `Placeable = { x: number; y: number; setDepth(value: number): unknown }`. Il Task 5 lo usa.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/place.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { IsoUsageError } from '../src/errors';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso() {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
}

describe('place()', () => {
    it('mette l oggetto sul CENTRO della cella', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(s, 1, 0);

        // Il centro della cella (1,0) sul preset diamond 96x48.
        expect(s.x).toBe(48);
        expect(s.y).toBe(24);
    });

    it('l elevazione ALZA l oggetto sullo schermo', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(s, 0, 0, 2);

        // elevationStep di default = tileHeight / 2 = 24. Due quote = 48 px in SU,
        // cioe' y NEGATIVO: e' il segno che si sbaglia per primo.
        expect(s.y).toBe(-48);
    });

    it('assegna la chiave di depth calcolata dal core', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(s, 3, 4, 0, scene.iso.bands.actor);

        expect(s.depth).toBe(scene.iso.depth.keyFor(3, 4, scene.iso.bands.actor, 0));
        expect(s.depth).toBe((3 + 4) * 4096 + 4 * 256);
    });

    it('una cella piu avanti vince sempre su una banda piu alta', async () => {
        const scene = await conIso();
        const dietro = scene.add.sprite(0, 0, '__DEFAULT');
        const davanti = scene.add.sprite(0, 0, '__DEFAULT');

        scene.iso.place(dietro, 0, 0, 0, scene.iso.bands.overlay);
        scene.iso.place(davanti, 1, 0, 0, scene.iso.bands.floor);

        // E' la garanzia che il layout di depth del core compra: la riga domina
        // la banda. Se questa cade, rowStride e' stato manomesso.
        expect(davanti.depth).toBeGreaterThan(dietro.depth);
    });

    it('N place() producono UN SOLO sort per frame', async () => {
        const scene = await conIso();
        const dl = scene.sys.displayList;
        const spia = vi.spyOn(dl, 'depthSort');

        const sprites = Array.from({ length: 20 }, () => scene.add.sprite(0, 0, '__DEFAULT'));
        sprites.forEach((s, i) => scene.iso.place(s, i, 0));

        // setDepth alza un singolo booleano (sortChildrenFlag); il sort vero
        // avviene una volta, in fase di render. Questo test e' la ragione per cui
        // NON scriviamo `_depth` a mano e NON esiste un commitDepths().
        expect(spia).not.toHaveBeenCalled();
        expect(dl.sortChildrenFlag).toBe(true);

        // Sotto HEADLESS il sort non parte da solo: `Systems#render` non gira.
        // Si pompa dall'API pubblica, non chiamando dl.depthSort() direttamente.
        scene.sys.depthSort();
        expect(spia).toHaveBeenCalledTimes(1);
        expect(dl.sortChildrenFlag).toBe(false);
    });

    it('restituisce l oggetto, cosi si concatena', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');
        expect(scene.iso.place(s, 0, 0)).toBe(s);
    });

    it('place() prima di configure() lancia IsoUsageError', async () => {
        const scene = await bootGame({ plugins: { scene: [isoScenePlugin()] } });
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        expect(() => scene.iso.place(s, 0, 0)).toThrow(IsoUsageError);
    });

    it('una coordinata frazionaria viene rifiutata dal core, non arrotondata in silenzio', async () => {
        const scene = await conIso();
        const s = scene.add.sprite(0, 0, '__DEFAULT');

        // La garanzia "la riga domina la banda" vale solo su gx/gy interi.
        expect(() => scene.iso.place(s, 1.5, 0)).toThrow();
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `npx vitest run packages/plugin/test/place.test.ts`
Expected: FAIL — `place is not a function`.

- [ ] **Step 3: Aggiungere `place()` a `plugin.ts`**

Aggiungere gli import mancanti in cima:

```ts
import { createDepthAssigner, createProjection, DEFAULT_BANDS } from '@iso-internal/core';
import type { Band, Point /* ...gli altri gia' presenti... */ } from '@iso-internal/core';
```

Il tipo, esportato accanto alla classe:

```ts
/**
 * What `place()` needs from its target: a position and a depth setter.
 *
 * Deliberately structural rather than `Phaser.GameObjects.GameObject`. Not
 * every Game Object has `x`/`y` (a Group does not), and asking for exactly the
 * three members we touch means `place()` can be exercised with a plain object.
 */
export type Placeable = {
    x: number;
    y: number;
    setDepth(value: number): unknown;
};
```

Il campo di appoggio, accanto agli altri privati:

```ts
    // Riusato a ogni place(): con centinaia di entita' che si muovono ogni
    // frame, allocare un Point per chiamata darebbe al GC un lavoro che non
    // deve fare. `projectInto` esiste nel core esattamente per questo.
    private readonly appoggio: Point = { x: 0, y: 0 };
```

Il metodo:

```ts
    /**
     * Projects a cell, moves the target to the CENTRE of that cell's top face,
     * and assigns its isometric depth.
     *
     * One code path for position and depth, so an object created through
     * `this.add.isoSprite(...)` and one placed by hand can never end up using
     * different conventions.
     *
     * Elevation moves the target UP the screen (negative y): a cell at z=2 with
     * the default `elevationStep` sits 48px above the same cell at z=0.
     */
    place<T extends Placeable>(
        target: T,
        gx: number,
        gy: number,
        z = 0,
        band: Band = DEFAULT_BANDS.prop,
        sub = 0
    ): T {
        // `projection` e `depth` lanciano entrambi se il plugin non e' stato
        // configurato: leggerli per primi rende l'errore quello giusto, invece
        // di un TypeError su null piu' avanti.
        const punto = this.projection.projectInto(this.appoggio, gx, gy, z);

        target.x = punto.x;
        target.y = punto.y;

        // API pubblica, non `_depth`. Misurato: N setDepth alzano un solo
        // booleano, quindi Phaser coalesce comunque in un sort per frame.
        // Scrivere il campo privato risparmierebbe N assegnazioni booleane e
        // costerebbe la compatibilita' con ogni futura versione.
        target.setDepth(this.depth.keyFor(gx, gy, band, sub));

        return target;
    }
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `npx vitest run packages/plugin/test/place.test.ts` → PASS, 8 test.
Run: `npx vitest run` → **131** test.
Run: `pnpm typecheck` → exit 0.

- [ ] **Step 5: Batteria di mutazione**

| # | Rottura | Test che deve fallire |
| --- | --- | --- |
| 1 | In `place`, `target.y = punto.y + z * step` (elevazione applicata due volte) | «l elevazione ALZA l oggetto sullo schermo» |
| 2 | Scambiare `gx` e `gy` nella chiamata a `keyFor` | nessuno — **atteso**, la chiave dipende da `gx+gy`. Annotarlo nel report invece di inventare un test: è una proprietà del layout, non un buco della suite |
| 3 | Usare `target.setDepth(band)` invece della chiave | «assegna la chiave di depth calcolata dal core» e «una cella piu avanti vince» |
| 4 | Chiamare `dl.depthSort()` dentro `place` | «N place() producono UN SOLO sort per frame» |

La riga 2 è deliberata: una mutazione che **non** deve fallire è informazione quanto una che
deve. Se qualcuno più tardi aggiunge un test che la prende, sta testando qualcosa che il
layout non promette.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/plugin.ts packages/plugin/test/place.test.ts
git commit -m "Piano 2 Task 4: place(), un solo percorso per posizione e depth"
```

**Definition of Done:**
- 8 test verdi; totale **131**.
- Le quattro mutazioni provate, con l'esito della #2 annotato nel report.
- `place()` non contiene aritmetica: proiezione e chiave vengono dal core.

---

### Task 5: `IsoSprite` e la factory

**Files:**
- Create: `packages/plugin/src/iso-sprite.ts`
- Modify: `packages/plugin/src/plugin.ts` (esportare `ISO_SYS_KEY`, registrare la factory)
- Test: `packages/plugin/test/iso-sprite.test.ts`

**Interfaces:**
- Consumes: `place()` (Task 4), `Placeable`, il ciclo di vita (Task 3).
- Produces: `class IsoSprite extends Phaser.GameObjects.Sprite` con
  `gx`, `gy`, `elevation`, `band`, `sub` e `setCell(gx, gy, elevation?, band?, sub?): this`;
  `ISO_SYS_KEY`. Il Task 9 (`snapshot`) legge questi campi.

**Tre fatti verificati che decidono il codice qui sotto.**

1. **`GameObjectFactory.register` è già idempotente, e il PRIMO vince**
   (`src/gameobjects/GameObjectFactory.js`):
   ```js
   GameObjectFactory.register = function (factoryType, factoryFunction) {
       if (!GameObjectFactory.prototype.hasOwnProperty(factoryType)) {
           GameObjectFactory.prototype[factoryType] = factoryFunction;
       }
   };
   ```
   Registrare dal costruttore — che gira N+1 volte, `__SYSTEM` inclusa — è quindi sicuro
   senza guardie nostre. Conseguenza da documentare: se il consumatore registra un proprio
   `isoSprite` per primo, **il nostro viene ignorato in silenzio**.

2. **La factory built-in aggiunge SOLO al display list.**
   `GameObjectFactory.register('sprite', function (x, y, texture, frame) { return
   this.displayList.add(new Sprite(this.scene, x, y, texture, frame)); });`
   L'update list se la aggiunge lo Sprite da solo, in `addedToScene()`
   (`src/gameobjects/sprite/Sprite.js:139`), che `displayList.add` invoca. Aggiungerlo a
   mano lo iscriverebbe **due volte**.

3. **`Phaser.GameObjects.Components.Transform` definisce già `z: 0` e `w: 0`**, come
   proprietà DATI (`src/gameobjects/components/Transform.js:101,111`), documentate come
   «non controllano l'ordine di rendering». `x`, `y`, `depth`, `scale`, `angle`, `rotation`
   sono invece **accessor** — sono quelli, e solo quelli, la trappola di
   `useDefineForClassFields`. Perciò il campo dell'elevazione si chiama **`elevation`**, non
   `z`: riusare `z` funzionerebbe, ma si approprierebbe in silenzio di una proprietà che
   Phaser lascia esplicitamente all'utente.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/iso-sprite.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { IsoSprite } from '../src/iso-sprite';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso() {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
}

describe('la factory', () => {
    it('rende this.add.isoSprite chiamabile', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(2, 1, '__DEFAULT');

        expect(s).toBeInstanceOf(IsoSprite);
        expect(s.gx).toBe(2);
        expect(s.gy).toBe(1);
    });

    it('posiziona e ordina passando da place(), non per conto proprio', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(1, 0, '__DEFAULT');

        expect(s.x).toBe(48);
        expect(s.y).toBe(24);
        expect(s.depth).toBe(scene.iso.depth.keyFor(1, 0, scene.iso.bands.prop, 0));
    });

    it('iscrive l oggetto al display list UNA volta, e all update list UNA volta', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        expect(scene.sys.displayList.list.filter(o => o === s)).toHaveLength(1);
        // Sprite.addedToScene() lo iscrive da solo: se la factory lo aggiunge a
        // mano finisce due volte nella update list e le animazioni avanzano
        // a velocita' doppia.
        expect(scene.sys.updateList.getActive().filter(o => o === s)).toHaveLength(1);
    });

    it('sopravvive alla registrazione ripetuta su N+1 costruzioni', async () => {
        // Il costruttore del plugin gira per __SYSTEM e per la scena utente.
        // register() e' guardato da hasOwnProperty, quindi la seconda e' un no-op.
        const scene = await conIso();
        expect(typeof scene.add.isoSprite).toBe('function');
    });
});

describe('IsoSprite', () => {
    it('setCell riposiziona e riordina', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setCell(2, 3);

        expect(s.gx).toBe(2);
        expect(s.gy).toBe(3);
        expect(s.x).toBe(scene.iso.projection.project(2, 3).x);
        expect(s.depth).toBe(scene.iso.depth.keyFor(2, 3, scene.iso.bands.prop, 0));
    });

    it('setCell conserva banda ed elevazione quando non gliele si passa', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setCell(0, 0, 3, scene.iso.bands.hero);
        s.setCell(1, 1);

        expect(s.elevation).toBe(3);
        expect(s.band).toBe(scene.iso.bands.hero);
        expect(s.depth).toBe(scene.iso.depth.keyFor(1, 1, scene.iso.bands.hero, 0));
    });

    it('NON si appropria di `z`, che resta la proprieta di Phaser', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setCell(0, 0, 5);

        expect(s.elevation).toBe(5);
        // Transform.z e' un campo dati che Phaser lascia all'utente e che non
        // controlla il rendering. Non lo tocchiamo.
        expect(s.z).toBe(0);
    });

    it('setDepth resta l accessor di Phaser, non un campo che lo shadowa', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        s.setDepth(42);

        // Se un campo di classe shadowasse l'accessor `depth`, questo leggerebbe
        // ancora 42 ma `_depth` resterebbe fermo e il renderer ordinerebbe su
        // quello. Controlliamo entrambi.
        expect(s.depth).toBe(42);
        expect((s as unknown as { _depth: number })._depth).toBe(42);
    });

    it('setCell restituisce this', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        expect(s.setCell(1, 1)).toBe(s);
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `npx vitest run packages/plugin/test/iso-sprite.test.ts`
Expected: FAIL — `Cannot find module '../src/iso-sprite'`.

- [ ] **Step 3: Esportare `ISO_SYS_KEY` da `plugin.ts`**

```ts
/**
 * Where the plugin also mounts itself on the Scene's Systems, independently of
 * the user's chosen `mapping`.
 *
 * The GameObject factory is registered on `GameObjectFactory.prototype`, which
 * is GLOBAL — one registration for the whole page, not one per Scene. So at
 * call time the factory function has to find the plugin belonging to the Scene
 * it was invoked on, and it cannot know what `mapping` that user picked. This
 * is that anchor. It is intentionally ugly-looking so nobody mistakes it for
 * public API.
 */
export const ISO_SYS_KEY = '__phaserIsometric';
```

E in `boot()`, subito dopo `this.vivo = true`:

```ts
        // Ancoraggio indipendente dal mapping, per la factory globale.
        (this.systems as unknown as Record<string, unknown>)[ISO_SYS_KEY] = this;
```

E in `destroy()`, prima di `super.destroy()`:

```ts
        if (this.systems) {
            delete (this.systems as unknown as Record<string, unknown>)[ISO_SYS_KEY];
        }
```

- [ ] **Step 4: Scrivere `packages/plugin/src/iso-sprite.ts`**

```ts
import Phaser from 'phaser';
import { DEFAULT_BANDS } from '@iso-internal/core';
import type { Band } from '@iso-internal/core';
import { ISO_SYS_KEY } from './plugin';
import type { IsoPlugin } from './plugin';
import { IsoUsageError } from './errors';

/** Finds the isometric plugin belonging to a Scene, whatever `mapping` it uses. */
function isoOf(scene: Phaser.Scene): IsoPlugin {
    const plugin = (scene.sys as unknown as Record<string, unknown>)[ISO_SYS_KEY];

    if (!plugin) {
        throw new IsoUsageError(
            'this Scene has no isometric plugin, so an IsoSprite cannot be positioned',
            'add isoScenePlugin({ ... }) to plugins.scene in your game config. ' +
            'If you did, check that this Scene does not declare its own `plugins: [...]` ' +
            'array, which replaces the default list and drops the plugin entirely'
        );
    }

    return plugin as IsoPlugin;
}

/**
 * A Sprite that knows which grid cell it occupies.
 *
 * It holds the cell, not the maths: every move goes through `IsoPlugin.place()`,
 * so position and depth come from the same code path as everything else.
 */
export class IsoSprite extends Phaser.GameObjects.Sprite {
    /**
     * `declare` emits NO code — it only tells TypeScript this member exists on
     * the base class. It matters because `depth` is an ACCESSOR on Phaser's
     * prototype (`Depth.js:45`, backed by `_depth`), and under
     * `useDefineForClassFields: true` — the default in most projects, including
     * both of our reference codebases — a plain class field of the same name
     * emits `defineProperty` and SHADOWS the setter. The value then reads back
     * correctly while the renderer keeps sorting on a `_depth` that never moved.
     * TypeScript does not warn, because `phaser.d.ts` declares `depth` as a flat
     * property. Anyone subclassing IsoSprite inherits this hazard.
     */
    declare depth: number;

    /** Grid column. */
    gx = 0;
    /** Grid row. */
    gy = 0;
    /**
     * Elevation, in whole steps.
     *
     * NOT called `z`: `Phaser.GameObjects.Components.Transform` already defines
     * a `z` data property, documented as free for your own use and ignored by
     * the renderer. Quietly repurposing it would break anyone relying on that.
     */
    elevation = 0;
    /** Depth band. Defaults to `prop`. */
    band: Band = DEFAULT_BANDS.prop;
    /** Tie-break slot within the same cell and band. */
    sub = 0;

    /** Moves this sprite to a cell, re-projecting and re-depthing it. */
    setCell(
        gx: number,
        gy: number,
        elevation: number = this.elevation,
        band: Band = this.band,
        sub: number = this.sub
    ): this {
        this.gx = gx;
        this.gy = gy;
        this.elevation = elevation;
        this.band = band;
        this.sub = sub;

        isoOf(this.scene).place(this, gx, gy, elevation, band, sub);

        return this;
    }
}

/**
 * Registers `this.add.isoSprite(...)`.
 *
 * Called from the plugin's constructor, which runs once per Scene — including
 * Phaser's hidden `__SYSTEM` Scene. That is safe without a guard of our own:
 * `GameObjectFactory.register` is itself wrapped in a `hasOwnProperty` check, so
 * the first registration wins and every later one is a no-op. The flip side,
 * worth documenting: if the consumer registered their own `isoSprite` first,
 * ours is silently ignored.
 */
export function registerIsoSprite(pluginManager: Phaser.Plugins.PluginManager): void {
    pluginManager.registerGameObject(
        'isoSprite',
        function (
            this: Phaser.GameObjects.GameObjectFactory,
            gx: number,
            gy: number,
            texture: string | Phaser.Textures.Texture,
            frame?: string | number
        ): IsoSprite {
            const sprite = new IsoSprite(this.scene, 0, 0, texture, frame);

            // SOLO il display list, come fa la factory built-in di Sprite.
            // `Sprite.addedToScene()` si iscrive da solo alla update list, e
            // `displayList.add` lo invoca: farlo anche noi lo iscriverebbe due
            // volte, e le animazioni avanzerebbero a velocita' doppia.
            this.displayList.add(sprite);

            return sprite.setCell(gx, gy);
        }
    );
}
```

E in `plugin.ts`, nel costruttore, dopo l'`on(START)`:

```ts
        registerIsoSprite(pluginManager);
```

> **Attenzione all'import circolare.** `plugin.ts` importa `registerIsoSprite` da
> `iso-sprite.ts`, che importa `ISO_SYS_KEY` da `plugin.ts`. È un ciclo, e sotto ESM funziona
> **solo** perché `ISO_SYS_KEY` è una `const` letta a runtime dentro una funzione, non al
> momento della valutazione del modulo. Se l'implementer si trova a dover leggere
> `ISO_SYS_KEY` al top level di `iso-sprite.ts`, il ciclo va spezzato spostando la costante
> in un terzo file (`src/keys.ts`) — **non** aggirato con un import dinamico.

- [ ] **Step 5: Eseguire i test e vederli passare**

Run: `npx vitest run packages/plugin/test/iso-sprite.test.ts` → PASS, 9 test.
Run: `npx vitest run` → **140** test.
Run: `pnpm typecheck` → exit 0.

`scene.add.isoSprite` non typechecka ancora: la dichiarazione globale è il Task 10. Nei test,
usare un cast locale.

- [ ] **Step 6: Batteria di mutazione**

| # | Rottura | Test che deve fallire |
| --- | --- | --- |
| 1 | Nella factory, aggiungere anche `this.updateList.add(sprite)` | «iscrive l oggetto ... all update list UNA volta» |
| 2 | In `setCell`, non chiamare `place()` e scrivere `this.x`/`this.y` a mano | «posiziona e ordina passando da place()» |
| 3 | Sostituire `declare depth: number` con `depth = 0` | «setDepth resta l accessor di Phaser» — sotto `useDefineForClassFields: false` **potrebbe non fallire**: annotarlo, è precisamente il motivo per cui l'opzione è fissata nel tsconfig e la trappola vive nella documentazione, non nei tipi |
| 4 | Rinominare `elevation` in `z` | «NON si appropria di `z`» |

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src packages/plugin/test/iso-sprite.test.ts
git commit -m "Piano 2 Task 5: IsoSprite e la factory, con elevation al posto di z"
```

**Definition of Done:**
- 9 test verdi; totale **140**.
- La factory aggiunge **solo** al display list.
- Nessun campo di `IsoSprite` collide con un accessor di Phaser (`x`, `y`, `depth`, `scale`,
  `angle`, `rotation`).
- Le quattro mutazioni provate, con l'esito della #3 annotato.

---

### Task 6: Camera — `follow()`, la vista, i bounds

Tre fatti verificati, ognuno dei quali cambia il codice:

1. **`startFollow(target)` mette `roundPixels` a `false`** senza chiedere, buttando via
   `render: { roundPixels: true }` della config del Game (misurato). `stopFollow` non lo
   ripristina. Per un plugin il cui pubblico è fatto di pixel art, è il peggior tipo di
   difetto: sembra un problema di filtraggio delle texture. `follow()` legge il valore
   corrente e lo ripassa, così il default diventa «non cambiare ciò che l'utente ha scelto».
2. **`startFollow` accetta qualsiasi oggetto con `.x`/`.y`** — nient'altro viene toccato. Il
   proxy isometrico non ha bisogno di essere un GameObject, né di stare nel display list. Va
   però **mutato sul posto**: riassegnare un oggetto nuovo romperebbe il riferimento
   `_follow`.
3. **`worldView` NON va letto per il culling.** È scritto solo dentro `Camera.preRender`,
   che è fase di render: ogni aggancio disponibile al plugin legge il rettangolo del frame
   **precedente**, e al primo frame legge `{0,0,0,0}`. La vista si ricostruisce da scalari
   vivi — quattro righe, e in più rende il culling testabile in `node` con una camera finta.

E un fatto che cambia la promessa pubblica: **Phaser 4 non fa alcun culling per-sprite.**
`BaseCamera.cull()` non è chiamato da nessun punto del percorso di render, e `disableCull` è
inerte per gli Sprite. Il nostro culling non è un'ottimizzazione: è l'unico che esista.

**Files:**
- Create: `packages/plugin/src/camera.ts`
- Modify: `packages/plugin/src/plugin.ts`
- Test: `packages/plugin/test/camera.test.ts`

**Interfaces:**
- Consumes: `projection` (Task 2), il ciclo di vita (Task 3).
- Produces: `viewOf(camera): Rect` (pura), e sul plugin `follow(target, opts?)`,
  `stopFollow()`, `view(): Rect`, `cameraBounds(gridW, gridH, opts?)`. Il Task 8 usa `view()`.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/camera.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { viewOf } from '../src/camera';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(extra: Record<string, unknown> = {}) {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] }, ...extra });
}

describe('viewOf — pura, nessun Phaser richiesto', () => {
    it('ricostruisce la vista da scalari vivi', () => {
        const finta = { width: 800, height: 600, zoomX: 1, zoomY: 1, scrollX: 0, scrollY: 0 };
        expect(viewOf(finta)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    });

    it('lo zoom RESTRINGE la vista e la tiene centrata', () => {
        const finta = { width: 800, height: 600, zoomX: 2, zoomY: 2, scrollX: 0, scrollY: 0 };
        // A zoom 2 si vede meta' mondo, centrato sullo stesso punto.
        expect(viewOf(finta)).toEqual({ x: 200, y: 150, width: 400, height: 300 });
    });

    it('lo scroll trasla la vista senza cambiarne la misura', () => {
        const finta = { width: 800, height: 600, zoomX: 1, zoomY: 1, scrollX: 100, scrollY: -50 };
        expect(viewOf(finta)).toEqual({ x: 100, y: -50, width: 800, height: 600 });
    });
});

describe('follow()', () => {
    it('NON spegne roundPixels quando la config lo voleva acceso', async () => {
        const scene = await conIso({ render: { roundPixels: true } });
        expect(scene.cameras.main.roundPixels).toBe(true);

        scene.iso.follow({ gx: 0, gy: 0 });

        // startFollow(target) da solo lo azzera: e' il difetto che questo test
        // esiste per prendere, e sembra un problema di filtraggio delle texture.
        expect(scene.cameras.main.roundPixels).toBe(true);
    });

    it('non lo ACCENDE se la config non lo voleva', async () => {
        const scene = await conIso({ render: { roundPixels: false } });
        scene.iso.follow({ gx: 0, gy: 0 });
        expect(scene.cameras.main.roundPixels).toBe(false);
    });

    it('segue un bersaglio in coordinate di GRIGLIA, proiettandolo', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 2, gy: 0 };

        scene.iso.follow(bersaglio);
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        const atteso = scene.iso.projection.project(2, 0);
        const proxy = (scene.cameras.main as unknown as { _follow: { x: number; y: number } })._follow;
        expect(proxy.x).toBe(atteso.x);
        expect(proxy.y).toBe(atteso.y);
    });

    it('muta il proxy SUL POSTO: l identita non cambia mai', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 0, gy: 0 };
        scene.iso.follow(bersaglio);

        const cam = scene.cameras.main as unknown as { _follow: object };
        const primaIdentita = cam._follow;

        bersaglio.gx = 5;
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        // Riassegnare un oggetto nuovo romperebbe il riferimento _follow e la
        // camera resterebbe ferma per sempre, senza errori.
        expect(cam._follow).toBe(primaIdentita);
        expect((cam._follow as { x: number }).x).toBe(scene.iso.projection.project(5, 0).x);
    });

    it('stopFollow smette di aggiornare', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 0, gy: 0 };
        scene.iso.follow(bersaglio);
        scene.iso.stopFollow();

        bersaglio.gx = 9;
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        expect((scene.cameras.main as unknown as { _follow: unknown })._follow).toBeNull();
    });

    it('smette di aggiornare dopo lo shutdown della Scene', async () => {
        const scene = await conIso();
        scene.iso.follow({ gx: 0, gy: 0 });

        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);

        // Se il listener PRE_UPDATE sopravvive allo shutdown, continua a girare
        // su una camera che la Scene sta smontando.
        expect(scene.sys.events.listenerCount(Phaser.Scenes.Events.PRE_UPDATE)).toBe(0);
    });
});

describe('cameraBounds()', () => {
    it('usa la formula isometrica, non quella ortogonale', async () => {
        const scene = await conIso();

        scene.iso.cameraBounds(10, 10);

        const b = scene.cameras.main.getBounds();
        // (W+H)*tw/2 = 20*48 = 960 di larghezza, e la x parte NEGATIVA.
        // La formula ortogonale darebbe 10*96 = 960 con x = 0: stessa larghezza,
        // origine sbagliata. E' esattamente il difetto di map.widthInPixels.
        expect(b.width).toBe(960);
        expect(b.x).toBeLessThan(0);
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `npx vitest run packages/plugin/test/camera.test.ts`
Expected: FAIL — `Cannot find module '../src/camera'`.

- [ ] **Step 3: Scrivere `packages/plugin/src/camera.ts`**

```ts
import type { Rect } from '@iso-internal/core';

/**
 * The scalars `viewOf` needs. Structural on purpose: it is exactly the subset
 * of a Phaser camera the computation touches, so the function stays pure and
 * can be exercised in Node with a plain object.
 */
export interface CameraScalars {
    width: number;
    height: number;
    zoomX: number;
    zoomY: number;
    scrollX: number;
    scrollY: number;
}

/**
 * The camera's visible rectangle in world space, computed NOW.
 *
 * Deliberately not `camera.worldView`. That rectangle is written only inside
 * `Camera.preRender`, which runs in the render phase — so every hook a plugin
 * can reach (PRE_UPDATE, UPDATE, the Scene's update, POST_UPDATE, PRE_RENDER)
 * reads the PREVIOUS frame's value, and on the first frame reads {0,0,0,0}.
 * These are the same four lines Phaser runs, evaluated at the moment we need
 * them.
 */
export function viewOf(camera: CameraScalars): Rect {
    const width = camera.width / camera.zoomX;
    const height = camera.height / camera.zoomY;

    return {
        x: camera.scrollX + camera.width / 2 - width / 2,
        y: camera.scrollY + camera.height / 2 - height / 2,
        width,
        height
    };
}
```

- [ ] **Step 4: Aggiungere la camera a `plugin.ts`**

Campi privati:

```ts
    /** Mutato sul posto a ogni PRE_UPDATE: riassegnarlo romperebbe `_follow`. */
    private readonly proxy = { x: 0, y: 0 };
    private inseguito: { gx: number; gy: number; z?: number } | null = null;
```

Metodi:

```ts
    /**
     * Follows a target given in GRID coordinates.
     *
     * The camera is handed a private screen-space point that this plugin keeps
     * up to date, because `startFollow` reads nothing but `.x` and `.y` from its
     * target. All of Phaser's smoothing — lerp, deadzone, bounds clamping —
     * then works unmodified, in screen space, which is the space the player
     * actually sees.
     *
     * `roundPixels` is read before the call and passed back in. Phaser's
     * `startFollow(target)` sets it to `false` unconditionally and `stopFollow`
     * never restores it, which silently disables pixel rounding for a pixel-art
     * game the first time it follows anything.
     */
    follow(
        target: { gx: number; gy: number; z?: number },
        opts: { lerp?: number; offsetX?: number; offsetY?: number } = {}
    ): this {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera to follow with',
                'call follow() from your Scene\'s create(), not from its constructor'
            );
        }

        this.inseguito = target;
        this.aggiornaProxy();

        // Leggi PRIMA, passa DOPO: e' l'unico modo di non perdere la scelta
        // dell'utente. Nota che lerp e offset sono specchiati sui due assi da
        // Phaser stesso (lerpY = lerpX): e' una semantica che ereditiamo.
        const roundPixels = camera.roundPixels;
        camera.startFollow(
            this.proxy,
            roundPixels,
            opts.lerp ?? 1,
            opts.lerp ?? 1,
            opts.offsetX ?? 0,
            opts.offsetY ?? 0
        );

        return this;
    }

    /** Stops following. Leaves `roundPixels` exactly as it is. */
    stopFollow(): this {
        this.inseguito = null;
        this.systems?.cameras?.main?.stopFollow();
        return this;
    }

    /** The main camera's visible rectangle in world space, computed now. */
    view(): Rect {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera, so the view cannot be computed',
                'call this from create() or later, once the Scene has booted'
            );
        }
        return viewOf(camera);
    }

    /**
     * Sets the camera bounds to the screen-space extent of a grid.
     *
     * Uses the isometric formula — (W+H)·tw/2 wide, with x starting NEGATIVE
     * because cell (0, H-1) is the leftmost vertex. Phaser's own
     * `map.widthInPixels` is orthogonal, which is why
     * `camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)` is wrong
     * on an isometric map.
     */
    cameraBounds(gridWidth: number, gridHeight: number, opts: { maxElevation?: number } = {}): this {
        const camera = this.systems?.cameras?.main;
        if (!camera) {
            throw new IsoUsageError(
                'there is no main camera to set bounds on',
                'call cameraBounds() from your Scene\'s create()'
            );
        }

        const b = worldBounds(this.projection, gridWidth, gridHeight, opts);
        camera.setBounds(b.x, b.y, b.width, b.height);

        return this;
    }

    private aggiornaProxy(): void {
        if (!this.inseguito) return;
        const t = this.inseguito;
        // SUL POSTO. La camera trattiene il riferimento a questo oggetto.
        this.projection.projectInto(this.proxy, t.gx, t.gy, t.z ?? 0);
    }
```

In `start()`, agganciare l'aggiornamento per frame:

```ts
        // PRE_UPDATE, perche' gira PRIMA di CameraManager.update (che sta su
        // UPDATE) e prima dell'update() della Scene: una sola scrittura, una
        // sola lettura, nessun ritardo di un frame.
        events.on(Phaser.Scenes.Events.PRE_UPDATE, this.aggiornaProxy, this);
```

In `shutdown()`, staccarlo:

```ts
        events.off(Phaser.Scenes.Events.PRE_UPDATE, this.aggiornaProxy, this);
        this.inseguito = null;
```

Import da aggiungere in cima a `plugin.ts`: `worldBounds` dal core, `viewOf` da `./camera`,
e i tipi `Rect`.

- [ ] **Step 5: Eseguire i test e vederli passare**

Run: `npx vitest run packages/plugin/test/camera.test.ts` → PASS, 10 test.
Run: `npx vitest run` → **150** test.
Run: `pnpm typecheck` → exit 0.

- [ ] **Step 6: Batteria di mutazione**

| # | Rottura | Test che deve fallire |
| --- | --- | --- |
| 1 | Chiamare `camera.startFollow(this.proxy)` senza il secondo argomento | «NON spegne roundPixels quando la config lo voleva acceso» |
| 2 | In `aggiornaProxy`, `this.proxy = this.projection.project(...)` (riassegnazione) | «muta il proxy SUL POSTO» |
| 3 | In `viewOf`, usare `camera.width` invece di `camera.width / zoomX` | «lo zoom RESTRINGE la vista» |
| 4 | In `cameraBounds`, usare `gridWidth * tileWidth` con x a 0 | «usa la formula isometrica, non quella ortogonale» |
| 5 | Non staccare `PRE_UPDATE` in `shutdown()` | «smette di aggiornare dopo lo shutdown» |

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/camera.ts packages/plugin/src/plugin.ts packages/plugin/test/camera.test.ts
git commit -m "Piano 2 Task 6: camera isometrica, con roundPixels difeso"
```

**Definition of Done:**
- 10 test verdi; totale **150**.
- `viewOf` è pura e non importa Phaser.
- `follow()` non modifica mai `roundPixels`, in nessuna direzione.
- Le cinque mutazioni provate.

---

### Task 7: Il rombo — geometria pura nel core, cablaggio nel guscio

La hit area di default di Phaser è un `Rectangle` su tutto il frame: su un rombo
**sovra-copre circa il doppio** e ruba i click ai vicini.

Quattro fatti verificati che scrivono questo task:

1. **La callback riceve coordinate in spazio FRAME, top-left**, con `displayOrigin` già
   sommato e scala, rotazione e camera già annullate. Quindi la geometria è aritmetica su
   costanti: nessuno stato di runtime, niente camera → **è pura, e va nel core.**
2. **Deve essere un vero `Phaser.Geom.Polygon`.** Sopravvive al controllo `IsPlainObject` di
   `setInteractive`, è disegnabile da `enableDebug`, e la sua regola di bordo semi-aperta
   piastrella il piano **esattamente una volta per punto** (misurato su una finestra di
   campionamento: `zero=0 one=4941 many=0`). **Non** scrivere a mano
   `|dx|/(tw/2) + |dy|/(th/2) <= 1`: conta due volte ogni bordo condiviso e ogni vertice, e
   su una griglia isometrica ogni bordo è condiviso.
3. **`polygon.points[i]` sono oggetti `{x, y}` a runtime**, non `Vector2`, malgrado il
   `.d.ts` dichiari `Vector2[]`. Un `.clone()` o `.set()` **compila e poi lancia**.
4. **`setInteractive` non è idempotente**: una seconda chiamata si limita a ri-abilitare, e
   **non** sostituisce la hit area. Per aggiornarla bisogna mutare `input.hitArea` sul posto
   o chiamare prima `removeInteractive()`.

**Files:**
- Create: `packages/core/src/hit-area.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/plugin/src/hit-area.ts`
- Modify: `packages/plugin/src/plugin.ts`
- Test: `packages/core/test/hit-area.test.ts` (node), `packages/plugin/test/hit-area.test.ts` (jsdom)

**Interfaces:**
- Produces: dal core, `diamondPoints(opts): number[]`; dal guscio, sul plugin
  `makeDiamondHitArea(target, opts?): T`.

- [ ] **Step 1: Scrivere il test PURO che fallisce**

`packages/core/test/hit-area.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diamondPoints } from '../src/hit-area';

describe('diamondPoints', () => {
    it('produce quattro vertici in ordine orario dall alto', () => {
        // Frame 96x96, rombo 96x48, origine al centro del frame.
        const p = diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 96, tileHeight: 48,
            originX: 0.5, originY: 0.5
        });

        expect(p).toEqual([
            48, 24,   // alto
            96, 48,   // destra
            48, 72,   // basso
            0, 48     // sinistra
        ]);
    });

    it('segue l origine dello sprite, che per un tile sta in basso', () => {
        // Un tile alto: il rombo e' alla BASE della grafica, non al centro.
        const p = diamondPoints({
            frameWidth: 96, frameHeight: 128,
            tileWidth: 96, tileHeight: 48,
            originX: 0.5, originY: 1
        });

        // centro del rombo a (48, 128): il vertice basso esce dal frame, ed e'
        // corretto — la hit area non e' obbligata a stare dentro la texture.
        expect(p).toEqual([48, 104, 96, 128, 48, 152, 0, 128]);
    });

    it('rifiuta una dimensione non finita alla costruzione', () => {
        expect(() => diamondPoints({
            frameWidth: NaN, frameHeight: 96,
            tileWidth: 96, tileHeight: 48, originX: 0.5, originY: 0.5
        })).toThrow();
    });

    it('rifiuta un tile non positivo', () => {
        expect(() => diamondPoints({
            frameWidth: 96, frameHeight: 96,
            tileWidth: 0, tileHeight: 48, originX: 0.5, originY: 0.5
        })).toThrow();
    });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire.** Run: `npx vitest run packages/core/test/hit-area.test.ts`

- [ ] **Step 3: Scrivere `packages/core/src/hit-area.ts`**

```ts
import { requireFinite, requirePositive } from './errors';

export interface DiamondPointsOptions {
    /** The texture frame's width, in pixels. */
    frameWidth: number;
    /** The texture frame's height, in pixels. */
    frameHeight: number;
    /** The diamond's full width — the cell's tile width. */
    tileWidth: number;
    /** The diamond's full height — the cell's tile height. */
    tileHeight: number;
    /** The sprite's horizontal origin, 0..1. */
    originX: number;
    /** The sprite's vertical origin, 0..1. */
    originY: number;
}

/**
 * The four vertices of a cell's diamond, in FRAME space, as a flat
 * `[x0,y0, x1,y1, x2,y2, x3,y3]` — the shape `Phaser.Geom.Polygon` takes.
 *
 * Frame space, top-left anchored, is the space a `hitAreaCallback` receives:
 * the display origin has already been added and the camera's zoom, scroll and
 * rotation have already been removed. So this is arithmetic on constants, with
 * no runtime state — which is why it lives here and not in the Phaser shell.
 *
 * Clockwise from the top: top, right, bottom, left. Vertices may fall outside
 * the frame (a tall tile anchored at its feet puts the bottom vertex below it);
 * that is correct, and a hit area is not required to stay inside its texture.
 */
export function diamondPoints(opts: DiamondPointsOptions): number[] {
    requireFinite(opts.frameWidth, 'frameWidth');
    requireFinite(opts.frameHeight, 'frameHeight');
    requirePositive(opts.tileWidth, 'tileWidth');
    requirePositive(opts.tileHeight, 'tileHeight');
    requireFinite(opts.originX, 'originX');
    requireFinite(opts.originY, 'originY');

    const cx = opts.originX * opts.frameWidth;
    const cy = opts.originY * opts.frameHeight;
    const hw = opts.tileWidth / 2;
    const hh = opts.tileHeight / 2;

    return [
        cx, cy - hh,
        cx + hw, cy,
        cx, cy + hh,
        cx - hw, cy
    ];
}
```

Esportarlo da `packages/core/src/index.ts`:

```ts
export { diamondPoints } from './hit-area';
export type { DiamondPointsOptions } from './hit-area';
```

E aggiungere i due nomi all'assert di uguaglianza in `packages/core/test/public-api.test.ts`,
che altrimenti fallisce — **è il suo lavoro**.

- [ ] **Step 4: Scrivere il test del CABLAGGIO che fallisce**

`packages/plugin/test/hit-area.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso() {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
}

describe('makeDiamondHitArea', () => {
    it('installa un vero Phaser.Geom.Polygon, non un oggetto qualunque', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        expect(s.input).toBeTruthy();
        expect(s.input!.hitArea).toBeInstanceOf(Phaser.Geom.Polygon);
    });

    it('la callback e Polygon.Contains, usabile direttamente', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        expect(s.input!.hitAreaCallback).toBe(Phaser.Geom.Polygon.Contains);
    });

    it('il poligono coincide con diamondPoints per quel frame', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        const centro = { x: s.displayOriginX, y: s.displayOriginY };

        // Il centro e' dentro; i quattro punti a mezzo tile in diagonale sono fuori.
        expect(Phaser.Geom.Polygon.Contains(poly, centro.x, centro.y)).toBe(true);
        expect(Phaser.Geom.Polygon.Contains(poly, centro.x + 47, centro.y - 23)).toBe(false);
    });

    it('NON legge i punti come Vector2: sono letterali {x,y}', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        scene.iso.makeDiamondHitArea(s);

        const poly = s.input!.hitArea as Phaser.Geom.Polygon;
        // Il .d.ts dichiara Vector2[]; a runtime sono letterali. Un .clone()
        // compilerebbe e poi lancerebbe.
        expect((poly.points[0] as unknown as { clone?: unknown }).clone).toBeUndefined();
        expect(typeof poly.points[0]!.x).toBe('number');
    });

    it('ri-chiamarla SOSTITUISCE la hit area invece di limitarsi a ri-abilitare', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');

        scene.iso.makeDiamondHitArea(s);
        const primo = s.input!.hitArea as Phaser.Geom.Polygon;
        const primoAlto = primo.points[0]!.y;

        scene.iso.makeDiamondHitArea(s, { tileHeight: 96 });

        // setInteractive NON e' idempotente: una seconda chiamata si limita a
        // ri-abilitare e lascia la vecchia hit area. Questo test prende quel difetto.
        expect((s.input!.hitArea as Phaser.Geom.Polygon).points[0]!.y).not.toBe(primoAlto);
    });

    it('restituisce l oggetto', async () => {
        const scene = await conIso();
        const s = scene.add.isoSprite(0, 0, '__DEFAULT');
        expect(scene.iso.makeDiamondHitArea(s)).toBe(s);
    });
});
```

- [ ] **Step 5: Scrivere `packages/plugin/src/hit-area.ts` e agganciarlo al plugin**

```ts
import Phaser from 'phaser';
import { diamondPoints } from '@iso-internal/core';

/** What `makeDiamondHitArea` needs from its target. */
export interface DiamondTarget {
    width: number;
    height: number;
    displayOriginX: number;
    displayOriginY: number;
    input: Phaser.Types.Input.InteractiveObject | null;
    setInteractive(
        hitArea?: unknown,
        callback?: Phaser.Types.Input.HitAreaCallback,
        dropZone?: boolean
    ): unknown;
    removeInteractive(): unknown;
}

export interface DiamondHitAreaOptions {
    /** Defaults to the projection's tile width. */
    tileWidth?: number;
    /** Defaults to the projection's tile height. */
    tileHeight?: number;
}

/**
 * Gives `target` a diamond-shaped hit area matching one cell.
 *
 * Phaser's default hit area is a Rectangle covering the whole frame, which on a
 * diamond over-covers by roughly a factor of two and steals clicks from
 * neighbouring cells.
 *
 * `Phaser.Geom.Polygon.Contains` is used directly as the callback: its
 * half-open edge rule tiles the plane exactly once per point, so a click on a
 * shared edge lands on exactly one cell. A hand-rolled
 * `|dx|/(tw/2) + |dy|/(th/2) <= 1` would claim both.
 */
export function applyDiamondHitArea<T extends DiamondTarget>(
    target: T,
    tileWidth: number,
    tileHeight: number
): T {
    const points = diamondPoints({
        frameWidth: target.width,
        frameHeight: target.height,
        tileWidth,
        tileHeight,
        // `displayOrigin` is already added by the time the callback runs, so the
        // diamond has to be authored around that same point.
        originX: target.width === 0 ? 0 : target.displayOriginX / target.width,
        originY: target.height === 0 ? 0 : target.displayOriginY / target.height
    });

    // setInteractive is NOT idempotent: called a second time it only re-enables
    // input and leaves the old hit area in place. Tearing it down first is the
    // only way a later call actually replaces the shape.
    if (target.input) target.removeInteractive();

    target.setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);

    return target;
}
```

Sul plugin:

```ts
    /**
     * Gives a Game Object a diamond hit area matching one cell. Defaults to the
     * projection's own tile size.
     */
    makeDiamondHitArea<T extends DiamondTarget>(target: T, opts: DiamondHitAreaOptions = {}): T {
        const p = this.projection;
        // Dal preset diamond: a = tw/2 e d = th/2, quindi il tile si ricava
        // dalla matrice senza doverlo tenere in un secondo posto che puo'
        // disallinearsi.
        return applyDiamondHitArea(
            target,
            opts.tileWidth ?? p.a * 2,
            opts.tileHeight ?? p.d * 2
        );
    }
```

- [ ] **Step 6: Eseguire i test e vederli passare**

Run: `npx vitest run` → **164** test (4 nel core + 6 nel guscio, più i 150 precedenti,
più l'assert di superficie del core aggiornato).
Run: `pnpm typecheck` → exit 0.

- [ ] **Step 7: Il limite dichiarato, da scrivere nel report**

Questo task **non** prova che un click colpisca la cella giusta, e non può: sotto HEADLESS
`camera.renderList` resta vuoto e `hitTestPointer` restituisce sempre zero candidati
(misurato). Prova che il poligono giusto è installato con la callback giusta. Il
comportamento vero è materia del **Task 12**, ed è la ragione per cui quel gate è bloccante.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/hit-area.ts packages/core/src/index.ts packages/core/test \
        packages/plugin/src/hit-area.ts packages/plugin/src/plugin.ts packages/plugin/test/hit-area.test.ts
git commit -m "Piano 2 Task 7: rombo puro nel core, cablaggio nel guscio"
```

**Definition of Done:**
- 10 test nuovi; totale **164**.
- `packages/core/test/purity.test.ts` resta verde: `hit-area.ts` non importa Phaser.
- L'assert di uguaglianza sulla superficie del core è aggiornato.
- Il report dichiara esplicitamente che il click **non** è verificato.

---

### Task 8: `pick()` e `cullBounds()` sulla scena

**Files:**
- Modify: `packages/plugin/src/plugin.ts`
- Test: `packages/plugin/test/scene-api.test.ts`

**Interfaces:**
- Consumes: `view()` (Task 6), `projection` (Task 2).
- Produces: `setHeights(source): this`, `get heights(): HeightSource | null`,
  `pick(worldX, worldY, opts?): Cell | null`, `cull(pad): GridRect`.

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/plugin/test/scene-api.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createHeightGrid } from '@iso-internal/core';
import { bootGame, destroyGame, forgetScenePlugin } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso() {
    return bootGame({ plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] } });
}

describe('pick()', () => {
    it('senza heightmap restituisce null invece di lanciare', async () => {
        const scene = await conIso();
        expect(scene.iso.pick(0, 0)).toBeNull();
    });

    it('trova la cella sotto un punto del mondo', async () => {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(8, 8, 0));

        expect(scene.iso.pick(0, 0)).toEqual({ gx: 0, gy: 0, z: 0 });
        expect(scene.iso.pick(48, 24)).toEqual({ gx: 1, gy: 0, z: 0 });
    });

    it('rispetta l elevazione: una torre vicina copre il pavimento dietro', async () => {
        const scene = await conIso();
        const griglia = createHeightGrid(8, 8, 0);
        griglia.setHeight(2, 2, 3);
        scene.iso.setHeights(griglia);

        const cima = scene.iso.projection.project(2, 2, 3);
        expect(scene.iso.pick(cima.x, cima.y)).toEqual({ gx: 2, gy: 2, z: 3 });
    });

    it('fuori dalla griglia restituisce null, mai un errore', async () => {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(4, 4, 0));
        expect(scene.iso.pick(100000, 100000)).toBeNull();
    });

    it('un punto non finito restituisce null: il percorso caldo non lancia', async () => {
        const scene = await conIso();
        scene.iso.setHeights(createHeightGrid(4, 4, 0));
        expect(scene.iso.pick(NaN, 0)).toBeNull();
    });
});

describe('cull()', () => {
    it('restituisce un intervallo di celle dalla vista corrente', async () => {
        const scene = await conIso();
        const r = scene.iso.cull({ above: 0, below: 0, sides: 0 });

        expect(r.minX).toBeLessThanOrEqual(r.maxX);
        expect(r.minY).toBeLessThanOrEqual(r.maxY);
    });

    it('e conservativo: allargare il padding non puo restringere il risultato', async () => {
        const scene = await conIso();
        const stretto = scene.iso.cull({ above: 0, below: 0, sides: 0 });
        const largo = scene.iso.cull({ above: 200, below: 200, sides: 200 });

        expect(largo.minX).toBeLessThanOrEqual(stretto.minX);
        expect(largo.maxX).toBeGreaterThanOrEqual(stretto.maxX);
        expect(largo.minY).toBeLessThanOrEqual(stretto.minY);
        expect(largo.maxY).toBeGreaterThanOrEqual(stretto.maxY);
    });

    it('segue lo scroll della camera SENZA aspettare un frame', async () => {
        const scene = await conIso();
        const prima = scene.iso.cull({ above: 0, below: 0, sides: 0 });

        scene.cameras.main.setScroll(5000, 5000);

        // Nessun preRender, nessun frame: la vista si ricostruisce da scalari
        // vivi. Se leggessimo worldView, questo test vedrebbe il rettangolo
        // vecchio e passerebbe con il valore sbagliato.
        const dopo = scene.iso.cull({ above: 0, below: 0, sides: 0 });
        expect(dopo.minX).not.toBe(prima.minX);
    });
});
```

- [ ] **Step 2: Aggiungere i metodi a `plugin.ts`**

```ts
    private sorgenteQuote: HeightSource | null = null;

    /**
     * Sets the elevation source used by `pick()`.
     *
     * `HeightSource` is an interface, not a class: bring your own data. The
     * bundled `createHeightGrid` is one implementation, not a requirement.
     */
    setHeights(source: HeightSource | null): this {
        this.sorgenteQuote = source;
        return this;
    }

    get heights(): HeightSource | null {
        return this.sorgenteQuote;
    }

    /**
     * The cell whose top face is visible at a WORLD point — pass
     * `pointer.worldX` / `pointer.worldY`, not `pointer.x` / `pointer.y`.
     *
     * Exact to the pixel and independent of the render list, unlike Phaser's own
     * input picking. Returns `null` when there is nothing there, and never
     * throws: this is a hot path.
     */
    pick(worldX: number, worldY: number, opts: PickOptions = {}): Cell | null {
        if (!this.sorgenteQuote) return null;
        return pick(this.projection, worldX, worldY, this.sorgenteQuote, opts);
    }

    /**
     * The range of cells that can intersect the camera's view. Both ends
     * INCLUSIVE, and deliberately conservative: it can include a cell that is
     * not visible, never exclude one that is.
     *
     * Phaser 4 does NO per-sprite culling — `BaseCamera.cull()` is not called
     * from anywhere in the render path and `disableCull` is inert for Sprites —
     * so this is not an optimisation on top of an existing one. It is the only
     * one there is.
     */
    cull(pad: CullPadding): GridRect {
        return cullBounds(this.projection, this.view(), pad);
    }
```

Import da aggiungere: `pick`, `cullBounds` e i tipi `Cell`, `CullPadding`, `GridRect`,
`HeightSource`, `PickOptions` dal core.

- [ ] **Step 3: Verde, typecheck, mutazione**

Run: `npx vitest run` → **172** test. `pnpm typecheck` → 0.

| # | Rottura | Test che deve fallire |
| --- | --- | --- |
| 1 | In `cull`, usare `camera.worldView` al posto di `this.view()` | «segue lo scroll della camera SENZA aspettare un frame» |
| 2 | In `pick`, lanciare invece di restituire `null` quando manca la sorgente | «senza heightmap restituisce null invece di lanciare» |
| 3 | In `pick`, passare `opts.maxElevation = 0` fisso | «rispetta l elevazione» |

- [ ] **Step 4: Commit**

```bash
git commit -m "Piano 2 Task 8: pick() e cull() sulla scena"
```

**Definition of Done:** 8 test nuovi, totale **172**; le tre mutazioni provate; `cull()` non
legge mai `worldView`.

---

### Task 9: `snapshot()`

Oggetto piano, serializzabile, sola lettura, **zero riferimenti a Phaser**. Piccolo e si
ripaga da solo: è ciò che rende possibili l'overlay di debug e i test d'integrazione, e —
dato quanti modi ci sono di sbagliare l'installazione — è la diagnosi più economica che
possiamo dare a chi apre una issue.

**Files:**
- Create: `packages/plugin/src/snapshot.ts`
- Modify: `packages/plugin/src/plugin.ts`
- Test: `packages/plugin/test/snapshot.test.ts`

- [ ] **Step 1: Il tipo**

```ts
import type { DepthLayout, Rect } from '@iso-internal/core';

/**
 * A flat, serialisable, read-only view of the plugin's state.
 *
 * Everything here is a number, a string, a boolean or null — no Phaser objects,
 * no functions, no live references. `JSON.stringify(snapshot)` must always
 * succeed, because this is what a debug overlay draws, what an integration test
 * asserts on, and what a bug report can be asked to paste.
 */
export interface IsoSnapshot {
    /** Bumped when a field changes meaning. Consumers should check it. */
    readonly version: 1;
    /** The Scene property the plugin is reachable as, or null when misinstalled. */
    readonly mapping: string | null;
    readonly booted: boolean;
    readonly configured: boolean;
    readonly projection: {
        readonly a: number; readonly b: number; readonly c: number; readonly d: number;
        readonly det: number;
        readonly elevationStep: number;
        readonly origin: { readonly x: number; readonly y: number };
    } | null;
    readonly depth: DepthLayout | null;
    readonly camera: {
        readonly scrollX: number; readonly scrollY: number;
        readonly zoomX: number; readonly zoomY: number;
        readonly roundPixels: boolean;
        readonly following: boolean;
        readonly view: Rect;
    } | null;
    readonly heights:
        | { readonly kind: 'none' }
        | { readonly kind: 'grid'; readonly width: number; readonly height: number; readonly maxElevation: number }
        | { readonly kind: 'custom'; readonly maxElevation: number | null };
    /** How many IsoSprites are currently in the Scene's display list. */
    readonly isoSprites: number;
}
```

- [ ] **Step 2: I test**

`packages/plugin/test/snapshot.test.ts` deve coprire:

1. `JSON.stringify(snapshot())` non lancia e fa round-trip identico
   (`JSON.parse(JSON.stringify(s))` `toEqual` `s`) — è **il** test che prende un riferimento
   a Phaser sfuggito dentro.
2. Su un plugin non configurato: `configured: false`, `projection: null`, `depth: null`,
   e **nessun throw** — `snapshot()` è una diagnosi, quindi non può richiedere che tutto
   sia a posto.
3. `mapping` riporta il mapping reale, e riporta `null` quando il plugin è stato installato
   senza (il caso `scene["null"]`).
4. `camera.view` coincide con `iso.view()`.
5. `heights.kind` passa da `'none'` a `'grid'` dopo `setHeights(createHeightGrid(...))`, e a
   `'custom'` con una sorgente scritta a mano.
6. `isoSprites` conta solo gli `IsoSprite`, non gli Sprite normali.
7. Dopo `destroy()`, `booted: false` e `camera: null`, sempre senza lanciare.

- [ ] **Step 3: L'implementazione**, `snapshotOf(plugin)` in `snapshot.ts` più
  `snapshot(): IsoSnapshot` sul plugin che la richiama. La funzione riceve solo dati già
  estratti, così resta testabile senza una Scene.

- [ ] **Step 4: Verde, typecheck, commit**

Run: `npx vitest run` → **179** test.

```bash
git commit -m "Piano 2 Task 9: snapshot(), piano e serializzabile"
```

**Definition of Done:** 7 test nuovi, totale **179**; il round-trip JSON passa; `snapshot()`
non lancia in nessuno stato, nemmeno dopo `destroy()`.

---

### Task 10: Superficie pubblica, `declare global`, progetto consumatore

**Files:**
- Create: `packages/plugin/src/index.ts`
- Create: `packages/plugin/src/phaser-augment.d.ts`
- Create: `consumer/tsconfig.json`, `consumer/src/game.ts`
- Modify: `package.json` (script `typecheck`)
- Test: `packages/plugin/test/public-api.test.ts`

**Il fatto verificato che decide la forma.** `phaser/types/phaser.d.ts` è un file di
dichiarazione **globale**, non un modulo: contiene **zero** `import`/`export` al top level
(verificato con `grep -c "^import \|^export "` → `0`), dichiara `declare namespace Phaser`
nello scope globale e chiude con `declare module 'phaser' { export = Phaser; }`.

Quindi la forma corretta — e l'unica che fonde davvero — è:

```ts
declare global { namespace Phaser { ... } }
```

La forma copiata da Phaser 3, `declare module 'phaser' { namespace Phaser { ... } }`,
**compila senza un warning e non aggiunge niente**: crea `Phaser.Phaser`, e il consumatore
riceve un TS2339 senza capire perché.

- [ ] **Step 1: `packages/plugin/src/phaser-augment.d.ts`**

```ts
import type { IsoPlugin } from './plugin';
import type { IsoSprite } from './iso-sprite';

// Questo file HA un import al top level, quindi e' un modulo — ed e' proprio
// per questo che serve `declare global`: dentro un modulo, `namespace Phaser`
// creerebbe un namespace locale che non fonde con niente.
declare global {
    namespace Phaser {
        interface Scene {
            /**
             * The isometric plugin, when installed with the default `mapping`.
             *
             * Declared on EVERY Scene, including ones without the plugin: that is
             * the standard trade-off for a Phaser plugin's typings, and it is
             * deliberate. A Scene that did not install the plugin has `undefined`
             * here at runtime, and TypeScript will not warn you.
             */
            iso: IsoPlugin;
        }

        namespace GameObjects {
            interface GameObjectFactory {
                isoSprite(
                    gx: number,
                    gy: number,
                    texture: string | Phaser.Textures.Texture,
                    frame?: string | number
                ): IsoSprite;
            }
        }
    }
}

export {};
```

- [ ] **Step 2: `packages/plugin/src/index.ts` — la superficie, esplicita**

```ts
import './phaser-augment';

export { IsoPlugin, isoScenePlugin, ISO_PLUGIN_KEY, ISO_SYS_KEY } from './plugin';
export type { IsoConfigureOptions, IsoScenePluginOptions, Placeable } from './plugin';

export { IsoSprite } from './iso-sprite';

export { viewOf } from './camera';
export type { CameraScalars } from './camera';

export { applyDiamondHitArea } from './hit-area';
export type { DiamondHitAreaOptions, DiamondTarget } from './hit-area';

export type { IsoSnapshot } from './snapshot';

export { IsoUsageError } from './errors';

// Ri-esportati dal core: chi usa il plugin non deve sapere che il core esiste.
export {
    createProjection, createDepthAssigner, createHeightGrid,
    pick, cullBounds, worldBounds, contentBounds, diamondPoints,
    DEFAULT_BANDS, DEFAULT_LAYOUT, IsoConfigError
} from '@iso-internal/core';
export type {
    Projection, DepthAssigner, DepthAssignerOptions, HeightGrid, HeightSource,
    Point, Cell, Rect, GridRect, Band, DepthLayout, DepthStrategy,
    ProjectionSpec, ProjectionOptions, PickOptions, CullPadding, DiamondPointsOptions
} from '@iso-internal/core';
```

- [ ] **Step 3: `packages/plugin/test/public-api.test.ts` — l'assert di UGUAGLIANZA**

Stesso schema del core: un `Set` atteso confrontato con `toEqual`, **non** con
`toContain`. La deriva della superficie è un cambio di contratto silenzioso, e un assert di
inclusione non la vede.

```ts
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';

const ATTESI = new Set([
    'IsoPlugin', 'isoScenePlugin', 'ISO_PLUGIN_KEY', 'ISO_SYS_KEY',
    'IsoSprite', 'viewOf', 'applyDiamondHitArea', 'IsoUsageError',
    'createProjection', 'createDepthAssigner', 'createHeightGrid',
    'pick', 'cullBounds', 'worldBounds', 'contentBounds', 'diamondPoints',
    'DEFAULT_BANDS', 'DEFAULT_LAYOUT', 'IsoConfigError'
]);

describe('la superficie pubblica', () => {
    it('e esattamente questa', () => {
        expect(new Set(Object.keys(api))).toEqual(ATTESI);
    });
});
```

- [ ] **Step 4: Il progetto consumatore — la prova end-to-end**

`consumer/src/game.ts` è un progetto TypeScript **vergine** che usa solo la superficie
pubblica, e che la CI typechecka. È la sola prova che la dichiarazione globale funziona
davvero per chi installa il pacchetto.

```ts
import Phaser from 'phaser';
import { isoScenePlugin, createHeightGrid } from 'phaser-isometric';

class Livello extends Phaser.Scene {
    create(): void {
        // Se `declare global` non fonde, questa riga e' un TS2339 — che e'
        // esattamente cio' che il progetto consumatore esiste per prendere.
        this.iso.configure({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        this.iso.setHeights(createHeightGrid(32, 32, 0));
        this.iso.cameraBounds(32, 32);

        // E questa riga prova l'augmentation della factory.
        const eroe = this.add.isoSprite(4, 4, '__DEFAULT');
        this.iso.makeDiamondHitArea(eroe);
        this.iso.follow(eroe);

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            const cella = this.iso.pick(p.worldX, p.worldY);
            if (cella) eroe.setCell(cella.gx, cella.gy, cella.z);
        });
    }
}

export const gioco = new Phaser.Game({
    type: Phaser.AUTO,
    plugins: { scene: [isoScenePlugin()] },
    scene: [Livello]
});
```

`consumer/tsconfig.json` — **deliberatamente NON estende** `tsconfig.base.json`: deve
somigliare al tsconfig di uno sconosciuto, non al nostro.

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

Due scelte deliberate, ed entrambe sono il punto:

- **`useDefineForClassFields: true`**, il default di quasi tutti i progetti reali e di
  entrambi i nostri codebase di riferimento. È la configurazione in cui la trappola degli
  accessor morde. Se il consumatore compila qui, compila ovunque.
- **`skipLibCheck: true`** è **obbligatorio**, non igiene: `phaser.d.ts` di 4.2.1 ha errori
  suoi sotto `strict` (verificato: exit 2 senza, exit 0 con). Va detto nel README, prima che
  qualcuno ci passi un pomeriggio convinto di aver rotto il proprio build.

Aggiungere allo script `typecheck` in `package.json`:

```json
"typecheck": "tsc --noEmit -p packages/core/tsconfig.test.json && tsc --noEmit -p packages/plugin/tsconfig.test.json && tsc --noEmit -p consumer/tsconfig.json"
```

`consumer` ha bisogno di risolvere `phaser-isometric`: aggiungerlo come workspace in
`pnpm-workspace.yaml` con `"phaser-isometric": "workspace:*"` fra le sue dipendenze.

- [ ] **Step 5: La mutazione che conta**

Sostituire in `phaser-augment.d.ts` il `declare global { namespace Phaser { ... } }` con
`declare module 'phaser' { namespace Phaser { ... } }`.
Expected: `pnpm typecheck` **fallisce** su `consumer/src/game.ts` con TS2339 su `this.iso`.
Se passa, l'augmentation non stava facendo niente e il test non lo stava vedendo.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/index.ts packages/plugin/src/phaser-augment.d.ts \
        packages/plugin/test/public-api.test.ts consumer package.json pnpm-workspace.yaml
git commit -m "Piano 2 Task 10: superficie pubblica, declare global, progetto consumatore"
```

**Definition of Done:**
- 1 test nuovo (l'assert di uguaglianza); totale **180**.
- `pnpm typecheck` copre core, plugin **e** consumer, ed esce 0.
- La mutazione `declare module` è stata provata e **fa fallire** il typecheck del consumer.

---

### Task 11: `examples/` — il playground Vite

**Files:** `examples/package.json`, `examples/vite.config.ts`, `examples/index.html`,
`examples/src/main.ts`, `examples/src/scene.ts`.

La scena è il banco di prova del gate browser, quindi va costruita **perché sia
osservabile**, non perché sia bella:

- una griglia 16×16 con quote note, incluse una torre a z=3 e una cella `null` (abisso);
- un `IsoSprite` per cella, più tre attori in bande diverse sulla stessa cella (per il
  tie-break);
- due sprite in celle adiacenti scelte perché **si sovrappongono a schermo**: è la coppia su
  cui si misura l'ordine di disegno;
- `window.__iso` che espone `{ scene, iso, snapshot() }` — il gancio da cui Playwright
  interroga il gioco senza screenshot-driven testing;
- un pulsante che alterna zoom `1` e `1.5`, per la prova su `roundPixels`.

`examples/package.json` dipende da `phaser-isometric` come `workspace:*` e da `phaser`.
Aggiungere `examples` a `pnpm-workspace.yaml`.

**Definition of Done:** `pnpm --filter examples build` esce 0 e produce `dist/`;
`pnpm --filter examples dev` serve la pagina; `pnpm typecheck` continua a uscire 0.
Nessun test nuovo — è un artefatto, e il suo gate è il build.

---

### Task 12: **GATE BLOCCANTE** — Playwright: disegno, `roundPixels`, click

> Fino a qui **nessuna affermazione sul rendering è stata provata**. Tutto viene da lettura
> del sorgente, misure headless e typecheck. Questo task è il punto in cui il plugin smette
> di essere una teoria coerente. Se fallisce, non si documenta e non si pubblica: si torna
> indietro.

**Files:** `examples/e2e/playwright.config.ts`, `examples/e2e/render.spec.ts`.
Aggiungere `@playwright/test` alle devDependencies della root e uno script
`"e2e": "playwright test -c examples/e2e/playwright.config.ts"`.

**Prima di guardare, scrivere le attese.** Questo è un checkpoint umano, e l'ordine conta:
un'aspettativa formulata *dopo* aver visto lo schermo non è una verifica, è una
razionalizzazione. L'implementer scrive nel report, **prima** di eseguire, cosa si aspetta
per ognuno dei quattro punti. I subagent non hanno schermo: la lettura del risultato visivo
è dell'umano.

Le quattro prove, tutte programmatiche:

1. **Ordine di disegno reale.** Dopo un frame vero, leggere
   `scene.sys.displayList.list.map(o => o.depth)` da `page.evaluate` e verificare che sia
   **non decrescente**, e che i due sprite sovrapposti compaiano nell'ordine che la chiave
   isometrica prevede. Poi la prova che solo il pixel può dare: uno screenshot ritagliato sul
   punto di sovrapposizione, e il campionamento del colore per verificare che sia **quello
   dello sprite davanti**. È il momento in cui si scopre se il batching riordina.
2. **`roundPixels` sotto zoom frazionario.** A zoom `1.5`, leggere le posizioni schermo
   calcolate e verificare che con `roundPixels: true` i quad finiscano su coordinate intere.
   Confrontare due screenshot (zoom 1 e 1.5) sul bordo di un tile: con il rounding attivo il
   bordo non deve mostrare una riga di pixel semitrasparenti.
3. **Il click sul rombo** — la prova che nessun test `jsdom` può dare, perché
   `camera.renderList` si popola solo durante il render. Con `page.mouse.click`:
   colpire il centro di un tile → l'handler riporta quel tile; colpire un punto **dentro il
   bounding box ma fuori dal rombo** (l'angolo in alto a sinistra del frame) → l'handler
   **non** riporta quel tile. È il difetto che la hit area di default produce, e qui si vede.
4. **`iso.pick()` concorda con il click.** Per venti punti pseudocasuali, confrontare la
   cella che riporta l'handler di Phaser con quella che restituisce `iso.pick(worldX,
   worldY)`. Dove divergono, la divergenza va **spiegata**, non aggirata: la ricognizione
   prevede due casi legittimi — un oggetto reso interattivo nel frame corrente, e un frame
   in cui la camera si è mossa (l'input usa la matrice del frame precedente). Se emerge una
   terza classe di divergenza, è un difetto nostro.

**Definition of Done:**
- `pnpm e2e` verde in headless.
- Le attese scritte **prima** dell'esecuzione, e il confronto con l'esito, sono nel report.
- Ogni divergenza del punto 4 è classificata e spiegata.
- **Se un punto fallisce, il task riporta BLOCKED e il piano si ferma qui.** Non si prosegue
  al Task 13 né si documenta il plugin come funzionante.

---

### Task 13: **GATE** — benchmark a 500 entità

Trasforma la promessa pubblica «centinaia di oggetti dinamici» in un numero misurato. Una
promessa asserita e mai misurata è una promessa che qualcuno scoprirà falsa al posto nostro.

**Files:** `examples/e2e/bench.spec.ts`, `examples/src/bench.ts`.

La scena di benchmark: griglia 100×100 di quote, **500 `IsoSprite` che si muovono ogni
frame** (quindi 500 `place()` per frame, cioè 500 proiezioni e 500 `setDepth`), camera che
segue uno di loro, culling attivo.

Cosa misurare, con `performance.now()` dentro la pagina su 300 frame, scartando i primi 60:

| Metrica | Perché |
| --- | --- |
| Frame time mediano e p95 | La promessa pubblica |
| Costo di `place()` × 500 | Isola il nostro codice dal render di Phaser |
| Numero di `depthSort` per frame | Deve essere **1**. Se è di più, `setDepth` sta venendo chiamato dopo il sort |
| Entità disegnate contro entità totali | Prova che il culling sta togliendo qualcosa di reale |

**La soglia si sceglie PRIMA di misurare**, e va scritta nel report: p95 sotto **16.6 ms**
(60 fps) su un runner CI. Se il numero reale non ci arriva, **non si abbassa la soglia**: si
riporta il numero vero, si dichiara la promessa pubblica su quel numero, e si annota la
distanza. La spec promette «centinaia»; se la misura dice 300 invece di 500, la
documentazione dirà 300.

**Definition of Done:**
- Il benchmark gira in CI e stampa le quattro metriche.
- Il numero misurato è scritto nel report **e** in `.claude/plan.md`, perché diventa la
  promessa pubblica che il Piano 3 documenterà.
- `depthSort` per frame è esattamente 1.

---

## Autoverifica del piano

**Copertura della spec.** Tappa 2 (§5): installazione → Task 2; ciclo di vita → Task 3;
depth → Task 4; input → Task 7; camera → Task 6; introspezione → Task 9; TypeScript → Task 10.
Tappa 3 (§8, terzo anello): → Task 12 e 13. Fuori perimetro **dichiarato**: il sottopath
`phaser-isometric/debug` (§5.6) è tappa 5 della spec, quindi Piano 3, non qui.

**Due scostamenti dalla spec, entrambi deliberati.**

1. **In più: `isoScenePlugin()`** (Task 2). La spec mostra la entry di config scritta a mano.
   La ricognizione ha però misurato che l'`@example` **ufficiale** di Phaser produce un
   plugin montato su `scene["null"]` senza un warning, perché `systemKey`/`sceneKey` sono
   campi morti su quel percorso. Una factory che non può generare la forma sbagliata costa
   dieci righe e toglie di mezzo il difetto di installazione più probabile. Non è
   allargamento di perimetro: è una difesa contro un difetto misurato dopo la stesura della
   spec.
2. **In meno: nessun canale di configurazione via `sys.settings`.** La ricognizione ha
   segnalato che chiavi arbitrarie del config di Scene sopravvivono in `sys.settings` e sono
   leggibili in `boot()` con `GetFastValue` — è così che `CameraManager` legge
   `sys.settings.cameras`, ed è il percorso più idiomatico di Phaser. Sarebbe un **terzo**
   canale accanto a `withDefaults()` e `configure()`, cioè una terza cosa da documentare, da
   testare e da tenere allineata. La spec ne ha decisi due; restano due. Da valutare per la
   v2, quando ci sarà evidenza d'uso reale che serva.

**Scansione dei segnaposto.** Nessun «TBD», nessun «simile al Task N», nessuno step di codice
senza codice. Il Task 9 e il Task 11 descrivono i test per elenco invece che per intero: è
deliberato e circoscritto — sono gli unici due dove la forma è già fissata dai task
precedenti e riprodurla per esteso aggiungerebbe rischio di trascrizione, non chiarezza. Se
l'implementer di quei due task si trova a dover inventare una struttura, si fermi e lo
segnali.

**Coerenza dei tipi.** `Placeable` (Task 4) è ciò che `IsoSprite` soddisfa (Task 5).
`CameraScalars` (Task 6) è il sottoinsieme che `viewOf` tocca, e una camera Phaser lo
soddisfa strutturalmente. `DiamondTarget` (Task 7) nomina i sei membri che
`applyDiamondHitArea` usa. `HeightSource` viene dal core e non è ridefinito. `elevation`,
non `z`, in tutti i task dal 5 in poi.

**Conteggio dei test**, cumulativo: 105 → 117 → 123 → 131 → 140 → 150 → 164 → 172 → 179 →
180. Un implementer che trova un numero diverso **si fermi e lo segnali** invece di
aggiustare il conteggio: nel Piano 1 un conteggio sbagliato nel piano fu segnalato da un
implementer che si rifiutò di inventare un test, ed era la risposta giusta.

---

## Dossier di ricognizione

Il piano cita fatti su Phaser che sono stati verificati sul sorgente reale 4.2.1 e misurati a
runtime. I dossier completi vivono in `docs/recon/` e sono la fonte da consultare quando un
task sembra dire qualcosa di sorprendente:

| File | Copre |
| --- | --- |
| `MISURATO-runtime.md` | Ciò che è stato **eseguito**, non letto: boot jsdom, `mapping`, `__SYSTEM`, `roundPixels`, depth sort, hit-test |
| `scene-plugin-lifecycle.md` | `ScenePlugin`, `PluginManager`, `PluginCache`, gli eventi Scene, i tre idiomi built-in |
| `gameobject-factory.md` | `registerGameObject`, il registro globale, `GameObjectCreator` |
| `depth-displaylist.md` | Il comparatore, `StableSort`, quando gira il sort, `Layer` in 4.0.0 |
| `input-hitarea.md` | `setInteractive`, `Polygon.Contains`, la `renderList` e la sua obsolescenza di un frame |
| `camera.md` | `startFollow`, `worldView`, i bounds, l'assenza di culling per-sprite |
| `typescript-surface.md` | `declare global`, le bugie del `.d.ts`, `skipLibCheck` |

Due avvertenze sull'uso di questi documenti. **Dove un dossier e `MISURATO-runtime.md` non
vanno d'accordo, vince la misura** — è già successo due volte in questa sessione, in entrambe
le direzioni. E i dossier sono stati prodotti da agenti che leggevano il sorgente: ogni
affermazione porta un `file:riga`, ed è quello che va riaperto prima di costruirci sopra, non
la frase che lo riassume.
