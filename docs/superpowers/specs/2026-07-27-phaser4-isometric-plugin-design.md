# phaser-isometric — design

> Plugin isometrico per Phaser v4, in TypeScript.
> Data: 2026-07-27 · Stato: approvato, pronto per il piano di implementazione.

---

## 1. Perché

Su npm **non esiste alcun plugin isometrico per Phaser 4**. I due storici sono morti:
`phaser-plugin-isometric` (lewster32) è fermo a Phaser 2 e si dichiara non mantenuto nel
proprio README; il fork per v3 ha l'unprojection **rotta** — usa `this.game.world`, che in
Phaser 4 non esiste, e `this.game` non è nemmeno assegnato nel costruttore. Non c'è
un'implementazione di riferimento da leggere: il buco è reale e inesplorato.

Phaser v4 copre da solo una parte del dominio (le due proiezioni diamond di prima parte, il
parser Tiled completo, il batching, il depth sort stabile, l'hit-test poligonale, la camera).
Quello che **non** copre — e che ogni gioco isometrico è costretto a riscrivere — è
elencato in §9.

---

## 2. Decisioni prese

| Asse | Decisione |
| --- | --- |
| Destinatario | **Open source pubblico su npm.** Configurabile, documentato, con esempi. |
| Perimetro v1 | **Kernel iso**: proiezione, depth, picking, culling, bounds, `IsoSprite`, camera. Niente tilemap, fisica, pathfinding, occlusione. |
| Proiezione | **Matrice 2×2 invertibile** all'interno, preset leggibili all'esterno. Un solo code path matematico. |
| Scala | **Centinaia di oggetti dinamici** (~100-500 entità, griglia fino a ~100×100). Promessa fissata da un benchmark misurato. |
| Elevazione | **Una quota intera per cella** (heightmap sparsa, `null` = abisso). Depth a formula chiusa. Sort key sostituibile come giunto di estensione. |
| Architettura | **Nucleo puro + guscio Phaser sottile.** Gli sprite restano dell'utente. |
| Documentazione | Skill per agenti **dentro il pacchetto npm**, nel formato delle 28 di Phaser. |
| MCP | Livelli 1-3 in v1; livello 4 (introspezione) dopo il gate browser, con il bridge in quarantena. |

Il fattore decisivo per l'architettura è stata la richiesta di MCP: **un oracolo matematico
headless può esistere solo se il cuore gira in Node senza Phaser.** Con un motore intrecciato
a Phaser, l'MCP dovrebbe reimplementare la stessa matematica, e due implementazioni della
stessa proiezione divergono sempre.

Conferma sul campo: nel codebase di riferimento (*The Battlepits of Krarth*, Phaser 4.0.0) il
layer puro ha prodotto **zero difetti** e tutti i difetti si sono concentrati nel layer Phaser.

---

## 3. Architettura

```
phaser-isometric/                (monorepo pnpm)
├─ packages/core/                → sottopath "phaser-isometric/core"
│    zero dipendenze, zero import di Phaser, gira in Node
│    proiezione · depth · picking · culling · bounds · griglia
├─ packages/plugin/              → pacchetto "phaser-isometric"
│    ScenePlugin · IsoSprite · camera proxy · hit area · snapshot · debug
│    peerDependencies: { phaser: "^4.0.0" }
├─ packages/mcp/                 → pacchetto "phaser-isometric-mcp"
│    importa SOLO phaser-isometric/core. Mai Phaser.
└─ examples/                     privato: playground Vite, banco di prova browser
```

**Il core è un sottopath, non un pacchetto separato.** Un solo `npm i phaser-isometric` per
chi fa giochi, una sola versione da allineare, nessun rischio di disallineamento fra core e
plugin. L'MCP importa `phaser-isometric/core`; `peerDependenciesMeta: { phaser: { optional:
true } }` evita i warning di installazione lato server.

**Il confine è verificato meccanicamente, in tre modi indipendenti:**

1. Un test che ispeziona il **grafo** degli import (non il testo): un modulo puro che importa
   un modulo Phaser viene preso. Portato da `src/purity.test.ts` del codebase di riferimento,
   inclusa la rimozione dei commenti **prima le righe, poi i blocchi** — l'ordine inverso fa
   inseguire alla regex dei blocchi un `*/` successivo, divorando codice vero.
2. `packages/core/package.json` non può nominare `phaser`.
3. Il `tsconfig` del core non include i tipi di Phaser: `Phaser.` non compila.

**Nome del pacchetto:** `phaser-isometric`. Da verificare la disponibilità su npm prima di
scriverlo ovunque; alternative in ordine: `phaser4-isometric`, `phaser-iso-view`.

---

## 4. Nucleo puro

Zero import di Phaser, zero allocazioni obbligate nei percorsi caldi, tutto testabile con
`vitest` in `environment: 'node'`.

### 4.1 Proiezione

Una sola implementazione matematica: una matrice 2×2 più un fattore di elevazione,
**invertibile per costruzione** — il costruttore rifiuta un determinante nullo con un
messaggio azionabile. I preset sono zucchero sopra la stessa matrice, non code path paralleli.

```ts
type ProjectionSpec =
  | { type: 'diamond'; tileWidth: number; tileHeight: number; elevationStep?: number }
  | { type: 'matrix'; a: number; b: number; c: number; d: number; elevationStep?: number }

createProjection(spec, opts?: { origin?: { x: number; y: number } })
```

`origin` è una traslazione **intera** applicata dopo la proiezione: copre il caso del diorama
centrato senza introdurre arrotondamenti.

Per il preset `diamond`, `elevationStep` vale `tileHeight / 2` se omesso.

### 4.2 Convenzione di origine — una sola

**`project(gx, gy, z)` restituisce il centro della faccia superiore della cella.**

È la scelta che rende l'arrotondamento esatto invece che approssimato, ed è esattamente il
punto in cui Phaser si contraddice: `IsometricTileToWorldXY` restituisce l'angolo top-left del
bounding box mentre `IsometricWorldToTileXY` assume il vertice superiore del rombo, e il
round-trip esce **sfasato di mezza cella** (misurato: il tile `(0,0)` torna `(-1,0)`).

```ts
project(gx, gy, z): Point
projectInto(out, gx, gy, z): Point      // zero-alloc per i percorsi caldi
unproject(sx, sy, z): Point             // frazionario, inverso esatto
cornersOf(gx, gy, z): [Point, Point, Point, Point]
```

`cornersOf` esiste perché `Tilemaps.Components.GetTileCorners` è **NOOP per ISOMETRIC**:
senza i quattro vertici non c'è outline, né hit-test preciso, né debug.

### 4.3 Picking con elevazione

Con quote diverse, un pixel dello schermo corrisponde a una cella **diversa per ogni z**. Si
itera z, si inverte per quella quota, si valida il candidato contro la heightmap e si tiene
quello più avanti (`gx+gy` massimo). `O(zMax)`, esatto al pixel, zero hit-test di Phaser.

```ts
interface HeightSource { heightAt(gx: number, gy: number): number | null }  // null = abisso
pick(sx, sy, heights: HeightSource, opts?): Cell | null
```

`HeightSource` è un'**interfaccia**, non una classe: è il giunto con cui l'utente porta i
propri dati. Spediamo un'implementazione `HeightGrid`, non obbligatoria. È anche tutto ciò
che serve a chi vuole scriverci sopra un A\*.

### 4.4 Depth — l'assenza di pareggi è garantita, non sperata

Con una quota per cella l'ordine dipende solo da `gx+gy`: è precisamente la semplificazione
che quel modello compra. Un oggetto in cima a una colonna alta e un pavimento in una cella più
avanti restano ordinati correttamente, perché la cella più avanti va comunque disegnata dopo.

Layout numerico dichiarato:

```
chiave = (gx + gy + rowOffset) * rowStride + banda * bandStride + sub
```

Valori di default, fissati: `rowStride = 4096`, `bandStride = 256`, `subCapacity = 256`,
fino a 16 bande. Le 7 bande predefinite occupano `7 × 256 = 1792 < 4096`, quindi due righe
adiacenti non possono mai sovrapporsi. Con `rowStride = 4096` il range intero-esatto di un
`float64` copre righe fino a `2^53 / 4096 ≈ 2.2 × 10^12`: irraggiungibile in pratica, e
comunque validato.

```ts
bands: { floor, decal, prop, item, actor, hero, overlay }   // configurabili
depthKey(gx, gy, band, sub = 0): number
```

La validazione della config **rifiuta a priori** un mondo che possa traboccare il range
intero-esatto di un `float64`.

**Il giunto di estensione** è la funzione stessa: `createProjection` accetta un
`depthStrategy?: (cell, band, sub) => number` che sostituisce la formula chiusa. Chi ha
bisogno di un ordinamento topologico per il multi-livello (§11) lo innesta lì, senza fork.
Il default resta la formula chiusa, e la garanzia di non-pareggio vale solo per essa: una
strategia custom si assume quella responsabilità, e lo dice il tipo.

Il pareggio residuo — stessa cella, stessa banda — lo risolve il guscio allocando `sub` in
modo deterministico, e in sviluppo **lancia** quando lo spazio si esaurisce, invece di
produrre un ordine casuale.

> Motivazione: il comparatore di Phaser è `a._depth - b._depth`, fisso, senza alcun hook né su
> `DisplayList` né su `Layer`. A parità di depth l'ordine dipende dalla posizione nella lista,
> cioè dall'ordine di inserimento. Il codebase di riferimento ha pagato **due volte** questo
> difetto e l'ha risolto inventando bande di depth.

### 4.5 Culling e bounds

```ts
cullBounds(view: Rect, opts: { maxElevation, maxSpriteHeight }): GridRect
worldBounds(gridW, gridH, opts?): Rect
contentBounds(items): Rect
```

`cullBounds` inverte i quattro angoli del `worldView` in spazio griglia e prende l'AABB —
**`O(1)`** invece dell'`O(W×H)` di `IsometricCullTiles`, che chiama `tileToWorldXY` per ogni
cella della mappa a ogni frame (200×200 = 40.000 conversioni/frame). L'estensione verticale usa
l'**altezza reale della grafica**, non la `tileHeight` della mappa: è il motivo per cui in
Phaser i tile più alti della cella poppano ai bordi.

`worldBounds` usa la formula giusta — `(W+H)·tw/2` in orizzontale, `(W+H)·th/2` in verticale,
con la x che parte **negativa**. Quella ortogonale di `widthInPixels` rende
`camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels)` sbagliato su iso.

### 4.6 Errori

La validazione della config **lancia alla costruzione**, con messaggi che nominano la
correzione. I percorsi caldi **non lanciano mai**: un picking a vuoto restituisce `null`.

---

## 5. Guscio Phaser

Sottile per scelta: tocca solo `ScenePlugin`, `GameObjectFactory` e il display list della
Scene — la superficie provata **identica byte per byte** fra 4.0.0 e 4.2.1.

**Niente `Layer`.** È diventato un vero GameObject solo in 4.1.0: dipenderne alzerebbe il peer
floor senza dare nulla che il display list della Scene non dia già.

### 5.1 Installazione

```ts
plugins: {
  scene: [{
    key: 'IsoPlugin',
    plugin: IsoPlugin.withDefaults({ type: 'diamond', tileWidth: 96, tileHeight: 48 }),
    mapping: 'iso'          // OBBLIGATORIO
  }]
}
```

`mapping` non è opzionale: senza, Phaser registra `mapping === undefined` e scrive
`sys['undefined']` e `scene['undefined']` **in silenzio**. Ed è il `mapping` — non la `key` —
a diventare sia la proprietà sulla Scene sia il terzo argomento `pluginKey` del costruttore.
Il JSDoc di `installScenePlugin` afferma il contrario (`sys[key]`).

`withDefaults()` esiste perché a uno ScenePlugin **`init(data)` non viene mai chiamato**:
restituisce una sottoclasse con la proiezione già incorporata, senza toccare internals. Chi
vuole una proiezione per scena chiama `this.iso.configure(...)`. Chiamare qualunque metodo
prima di configurare **lancia** con un messaggio esplicito, invece di usare in silenzio un
default sbagliato.

### 5.2 Ciclo di vita — cablato a mano

`Phaser.Plugins.ScenePlugin` aggancia **solo** `SceneEvents.BOOT`. `START`, `SHUTDOWN` e
`DESTROY` vanno registrati dentro `boot()`. In particolare **`destroy()` del plugin non viene
mai invocato da Phaser**: `Systems.destroy` azzera una lista fissa di proprietà che non
include `sys[mapping]`.

Nessuno dei 15 plugin core di Phaser estende `Phaser.Plugins.ScenePlugin` — registrano tutti
la coppia `once(BOOT)` + `on(START)` a mano. Noi la incapsuliamo **una volta**, così chi usa
il plugin non la incontra mai.

`registerGameObject` avviene nel **costruttore** del plugin (mai a top-level, vedi §8), ed è
idempotente per game.

### 5.3 Depth

```ts
iso.place(gameObject, gx, gy, z, band)   // proietta, posiziona, assegna la depth
```

`this.add.isoSprite(...)` chiama `place()` internamente: un solo percorso di codice per
posizionamento e depth, qualunque sia il call-site.

**Usiamo l'API pubblica `setDepth()`, non la scrittura diretta di `_depth`.** Scrivere il
campo privato eviterebbe `N` accodamenti, ma `queueDepthSort()` alza un singolo booleano:
`N` scritture producono comunque **un solo** `StableSort` per frame. Non vale toccare un campo
privato per risparmiare `N` assegnazioni booleane. Da rivedere solo se un benchmark lo smentisce.

**Non esiste un `commitDepths()`.** Era previsto nelle prime bozze, quando la depth veniva
scritta a mano su `_depth`; con `setDepth()` Phaser coalesce già da sé in un solo sort per
frame, quindi sarebbe una chiamata che non fa nulla e che l'utente può solo dimenticare.

### 5.4 Input

```ts
iso.makeDiamondHitArea(gameObject)
```

`Phaser.Geom.Polygon` + `Polygon.Contains` come `hitAreaCallback` risolve il rombo in quattro
confronti, in coordinate locali di texture (`displayOrigin` già sommato, zoom e rotazione della
camera già annullati), con `enableDebug` che disegna anche i poligoni. La hit area di default è
un `Rectangle` sull'intero frame: su un rombo **sovra-copre circa il doppio** e ruba i click ai
vicini.

**Limite dichiarato, non aggirato.** Il picking di input di Phaser **non usa `depth`**: ordina
per indice in `camera.renderList`, popolato durante il *render* mentre l'input gira nel
`PRE_STEP` — quindi l'ordine è quello del **frame precedente**, e un oggetto appena creato
riceve indice 0. Non esiste alcun hook pubblico. Le uniche leve sono monkey-patch mai
verificati a runtime, ed è esattamente lì che sono morti entrambi i plugin storici.

Conseguenza operativa: per il picking di **celle** si usa `iso.pick()`, esatto e indipendente
dal frame precedente; per il picking di **oggetti** si usa il rombo, con il caveat documentato.

### 5.5 Camera

```ts
iso.follow(entity)
iso.cameraBounds(gridW, gridH)
```

Non esiste alcun hook di proiezione sulla camera: `matrix`, `matrixExternal` e `matrixCombined`
sono ricalcolate a ogni `preRender`, quindi ogni scrittura esterna viene sovrascritta. L'unico
punto di estensione provato è che **`startFollow(target)` accetta qualsiasi oggetto con
`.x`/`.y`**: `iso.follow()` mantiene un proxy proiettato aggiornato in `PRE_UPDATE` e
**ri-applica `roundPixels`**, che `startFollow` resetta di sua iniziativa.

### 5.6 Introspezione e debug

```ts
iso.snapshot(): IsoSnapshot     // oggetto piano, serializzabile, sola lettura
```

Piccolo, testabile in `vitest`, e si ripaga da solo: è ciò che rende possibili l'overlay di
debug e i test d'integrazione, indipendentemente dal fatto che il bridge di §7 venga mai spedito.

`phaser-isometric/debug` — **sottopath separato**, così non finisce nel bundle di produzione —
disegna griglia, coordinate, quote, chiavi di depth, bounds di culling e outline dei rombi.
`TilemapLayer.renderDebug` di Phaser è no-op per tutto ciò che non è ortogonale.

### 5.7 TypeScript

```ts
declare global {                      // NON  declare module 'phaser'
  namespace Phaser {
    interface Scene { iso: IsoPlugin }
    namespace GameObjects {
      interface GameObjectFactory { isoSprite(...): IsoSprite }
    }
  }
}
```

La forma copiata da v3 — `declare module 'phaser' { namespace Phaser { ... } }` — **compila
senza un warning e non aggiunge niente**: crea `Phaser.Phaser`, e il consumatore riceve un
TS2339 senza capire perché.

`interface Scene { iso: IsoPlugin }` rende `iso` presente su **ogni** Scene, incluse quelle
senza il plugin. È il compromesso standard dei plugin Phaser; scelta consapevole, documentata.

`skipLibCheck: true` è di fatto obbligatorio: i tipi di Phaser non typecheckano da soli né in
4.0.0 né in 4.2.1. `this.scene` e `this.systems` di `ScenePlugin` sono `protected` e
**nullable** — servono `!` o una guard, altrimenti TS2531.

---

## 6. Documentazione per agenti AI

**Phaser 4 spedisce 28 skill per agenti dentro il pacchetto npm**, in `skills/<nome>/SKILL.md`,
con frontmatter (`name`, `description` con i trigger), *Key source paths*, *Related skills* e
Quick Start. Fra quelle 28 **non c'è una skill sui plugin**.

Seguiamo esattamente quella convenzione:

- `skills/phaser-isometric/SKILL.md` **dentro il pacchetto npm**, stesso formato, con
  *Related skills* che puntano a `tilemaps`, `game-object-components`, `scenes`. Un agente che
  ha già indicizzato `node_modules/phaser/skills/` la trova allo stesso posto, nella stessa forma.
- `llms.txt` compatto e canonico, **generato dalla stessa sorgente** della SKILL.md così non
  possono divergere.
- **Le quattro trappole in cima, non in fondo** — sono i fallimenti che un agente riprodurrà se
  non le legge per prime: `useDefineForClassFields`, `declare global`, `mapping` obbligatorio,
  `sideEffects`.
- **I messaggi d'errore sono documentazione**: ogni `throw` nomina la correzione, non il sintomo.

---

## 7. Server MCP

Principio guida: una chiamata deve restituire una risposta *decision-grade*, non righe che il
modello deve riaggregare. Float quantizzati al bordo, mai notazione scientifica; ogni
descrizione dice **quando non chiamare** il tool e nomina quello più economico; un
`resource://iso/contract` piccolo con il contratto delle unità e un albero decisionale di 6 righe.

### Livello 1 — Oracolo (v1)

Esegue il core reale, quindi non può divergere dal plugin.

| Tool | Restituisce |
| --- | --- |
| `iso_diagnose(config)` | Dossier composito: matrice, determinante, invertibilità, errore di round-trip, layout depth con i limiti di overflow, world bounds, warning. Una chiamata al posto di cinque. |
| `iso_project` / `iso_pick` | **In batch**, TSV con riga di meta `# rows=N`. |
| `iso_depth_order(entities)` | CSV ordinato con la chiave calcolata: risponde a *«in che ordine vengono disegnati?»*. |
| `iso_verify(scenario, expected)` | Pass/fail con il valore reale. È il tool che giustifica l'MCP: l'agente **controlla** la propria assunzione invece di indovinarla. |

### Livello 2 — Documentazione (v1, deliberatamente minimo)

Un solo `iso_docs(topic?)`, sulla stessa sorgente canonica della SKILL.md. La sua descrizione
dice esplicitamente: *«se il pacchetto è installato, leggi `skills/phaser-isometric/SKILL.md` —
è gratis»*. Niente ricerca semantica, niente indice: sarebbe un secondo sistema di
documentazione da tenere allineato.

### Livello 3 — Scaffolding (v1)

`iso_scaffold(kind)`. **I template non vivono dentro il server MCP**: vivono in `examples/`,
dove la CI li typechecka e li testa. L'MCP restituisce gli stessi file che la CI compila — se
invecchiano, la CI diventa rossa. È l'antidoto strutturale all'invecchiamento del codegen.

### Livello 4 — Introspezione runtime (dopo il gate browser)

Il pezzo fragile non sono i tool MCP: è il **bridge dentro il gioco**. Quindi:

- Il transport vive in `phaser-isometric/inspect`, sottopath separato con **zero import dal
  plugin**: parla solo attraverso `iso.snapshot()`. Se si rompe, non porta giù niente.
- WebSocket **solo su loopback**, **solo se abilitato esplicitamente**, e rifiuta di partire in
  produzione.
- **Sola lettura.** Nessun tool muta lo stato del gioco.
- **Un solo server MCP**, non due. I tool `iso_inspect_*` **degradano con grazia**: senza bridge
  connesso restituiscono `# note: nessun gioco connesso`, non un errore.
- Onestà in-band: `age_ms=` su ogni lettura; *«nessun gioco connesso»* deve essere distinguibile
  da *«gioco connesso, zero entità»*. Uno zero non deve mai nascondere un buco.

### Disciplina di superficie

Un test di integrazione blocca la lista dei tool con un assert di **uguaglianza**, non di
inclusione: la deriva della superficie è un cambio di contratto silenzioso per ogni sessione
già connessa.

---

## 8. Testing, packaging e verifica

### Tre anelli

1. **Purezza (`node`, ~1s)** — il grosso del valore. Property test sul round-trip
   proiezione/inversione; unicità delle chiavi di depth su griglie generate; culling confrontato
   contro una scansione a forza bruta di tutte le celle; bounds contro il calcolo diretto. Più
   le tre guardie architetturali di §3.
2. **Guscio (`jsdom`)** — ciclo di vita (`BOOT`→`START`→`SHUTDOWN`→`DESTROY` cablati a mano),
   `mapping` che finisce dove deve, `registerGameObject` idempotente, `snapshot()`.
   Phaser espone un `tests/setup.js` **non dichiarato nell'exports map**: usarlo sarebbe una
   dipendenza da un percorso non documentato che una release può togliere. Lo **vendorizziamo**.
3. **Browser, come gate esplicito** — Playwright headless su `examples/`. Assicura ciò che solo
   il pixel può dire: ordine di disegno effettivo, `roundPixels` sotto zoom frazionario,
   hit-test del rombo, e un **benchmark a 500 entità** che fissa la promessa pubblica con un
   numero misurato invece che asserito.

### Preflight di mutazione

Prima di dichiarare verde una suite: rompere deliberatamente la proiezione, il tie-break della
depth e i bounds del culling, e verificare che **ogni rottura faccia fallire un test nominato**.
Una property test sul round-trip che passa anche con la matrice trasposta non sta guardando niente.

### Packaging — quattro vincoli provati

1. `phaser` come **peer *ed* external** nel bundle. Una copia duplicata produce due classi
   distinte, `instanceof` falso e la factory registrata su un prototype diverso.
2. `sideEffects: false` **cancella in silenzio** una registrazione fatta a top-level (misurato
   con un build Vite reale). Lecito solo grazie alla registrazione nel costruttore (§5.2).
3. Vite in library mode emette **zero** file `.d.ts`: i tipi escono da un
   `tsc --emitDeclarationOnly` separato.
4. La condizione `types` va dichiarata **esplicitamente** nell'exports map, altrimenti TS7016
   non appena il `.d.ts` non è fratello del `.js`.

### Vincoli dell'ambiente

`lib: ES2020` → vietati `Array.prototype.at` (TS2550), `String.replaceAll`, `Object.groupBy`.
`vitest` **non typechecka** (esbuild strippa i tipi senza controllarli): `tsc --noEmit` è uno
step separato, **mai dietro una pipe**, che ne maschererebbe l'exit code.

---

## 9. Cosa Phaser v4 già copre (da non riscrivere)

Installazione e ciclo di vita dei plugin · registrazione di GameObject custom · l'intero parser
Tiled (gruppi annidati, mappe infinite a chunk, flip/rotazione dai bit del GID, animazioni per
tile, collision shape) · le due proiezioni diamond di prima parte · il disegno batchato dei tile
(fino a 16384 quad per draw call, multi-texture) · il depth sort stabile una volta per frame ·
l'hit-testing poligonale · la disciplina pixel-art (`pixelArt`, `MAX_ZOOM` intero) · la camera
completa · `DynamicTexture`, `Blitter`, `SpriteGPULayer`.

## 10. I gap che il plugin colma

Elevazione/z (il modello `Tile` è strettamente 2D) · interleaving di profondità fra entità e
tile · tie-break deterministico della depth · culling isometrico efficiente · bounds del mondo
corretti · una convenzione di origine unica con inverso esatto · picking che rispetta
l'elevazione · i quattro vertici del rombo · parametrizzazione · debug isometrico ·
aggiramento dei bug upstream elencati in §12.

---

## 11. Non-goal della v1

Pathfinding · movimento e collisioni · occlusione e fade · import Tiled · fisica ·
multi-livello (ponti, gallerie, edifici a piani).

Nessuno è precluso: `HeightSource`, le bande di depth e la sort key sostituibile sono i giunti.
Ma non entrano nel kernel — il pacchetto si chiama *view*.

**Sovrapposizione da tenere d'occhio:** `grid-engine` 2.52.1 dichiara supporto isometrico
(Beta), pathfinding e movimento a 8 direzioni, con peer `~4.0.0` (che per semver esclude
4.1/4.2 — non verificato se funzioni davvero su 4.2.x). Tenendo il pathfinding fuori dal
kernel, componiamo invece di competere.

---

## 12. Bug isometrici attivi in Phaser 4.2.1 da neutralizzare o dichiarare

| Bug | Effetto |
| --- | --- |
| `IsometricCullTiles` con `renderOrder` 2 e 3 | TypeError (mancano i guard `mapData[y] &&` che `RunCull` ha). Riprodotto in Node. |
| Culling iso `O(W×H)` per frame | Nessun `IsometricCullBounds`; `CheckIsoBounds` testa solo il punto d'origine con padding sulla `tileHeight` della mappa → i tile alti poppano ai bordi. |
| Round-trip sfasato di mezza cella | `tileToWorldXY` → `worldToTileXY`: il tile `(0,0)` torna `(-1,0)`. Origini incompatibili nello stesso modulo. |
| `GetTileCorners` | NOOP per `ISOMETRIC`. |
| `renderDebug` | No-op per tutto ciò che non è ortogonale. |
| `widthInPixels` / `setSize` | Formula ortogonale → `camera.setBounds` sbagliato su iso. |
| `TilemapGPULayer` | Orthogonal-only **senza alcun guard runtime**: `createLayer(..., gpu: true)` su una mappa isometrica renderizza sbagliato **in silenzio**. |
| `TransformerTile` su `flipY` | Fa `x += frameHeight` invece di `y +=`. |
| `createFromObjects` | Ramo iso corretto solo a rapporto 2:1. |

---

## 13. Rischi

1. **Nessuna verifica in un browser reale.** Tutte le affermazioni su rendering, batching,
   ordine di disegno, `roundPixels` in WebGL e culling vengono da lettura del sorgente,
   typecheck, test headless e probe in Node. → Mitigato dal gate browser di §8, che è
   **bloccante** prima di costruire su un comportamento di rendering.
2. **Bundling dei `.d.ts` con `declare global`.** Non è verificato che `vite-plugin-dts` o
   `rollup-plugin-dts` preservino correttamente un blocco `declare global { namespace Phaser
   { ... } }`: è storicamente il punto in cui quei tool sbagliano. → Solo
   `tsc --emitDeclarationOnly` è provato: partiamo da lì, e la CI typechecka un progetto
   consumatore reale come prova end-to-end.
3. **`useDefineForClassFields` si trasmette al consumatore.** `IsoSprite` usa `declare depth:
   number` (verificato: non emette codice), ma **chi sottoclassa `IsoSprite` compila con il
   proprio `tsconfig`**. Con `useDefineForClassFields: true` — attivo in entrambi i progetti di
   riferimento — un campo che collide con un accessor di Phaser emette `defineProperty` e
   shadowa il setter: si legge il valore giusto e il renderer ordina su zero. TS non protegge,
   perché `phaser.d.ts` dichiara `depth` come property piana. → Documentato in cima alla SKILL.md.
4. **I tipi di Phaser mentono in più punti.** `registerGameObject`/`removeGameObject` sono
   dichiarati `: void` ma ritornano `this`; `Phaser.Class.mixin` esiste a runtime ma non è
   tipizzato; il typedef `CustomPluginContainer` documenta `{ key, plugin }` mentre
   `registerCustom` scrive `{ plugin, mapping, data }`. → Non usare il `.d.ts` come specifica
   di comportamento.
5. **Nessuna documentazione ufficiale v4 sui plugin.** `docs.phaser.io/phaser/concepts/plugins`
   → 404; il template ufficiale `phaserjs/plugin-template` è fermo a Phaser 3 + webpack 3; e i
   JSDoc sono sbagliati in almeno tre punti provati (`sys[key]` vs `sys[mapping]`;
   `systemKey`/`sceneKey` ignorati da `config.plugins`; un evento Scene `resize` inesistente).
   → Ogni scelta basata su un JSDoc va ricontrollata sul sorgente.
6. **Peer floor.** `^4.0.0` è verificato per la superficie
   `BasePlugin`/`ScenePlugin`/`PluginManager`/`GameObjectFactory` (`diff -rq` di `src/plugins/`
   fra 4.0.0 e 4.2.1: exit 0). Vale **perché** abbiamo escluso `Layer` e i RenderNode
   custom (superficie cambiata dentro la linea v4 → richiederebbero `^4.2.0`). Se una di quelle
   due rientrasse, il floor va alzato.

   > Precisato il 2026-07-28, dopo la ricognizione sul sorgente reale: `Phaser.GameObjects.Layer`
   > **esiste già in 4.0.0** (`@since 3.50.0`, registrato come `this.add.layer()`). La stesura
   > precedente lo abbreviava in «`Layer` (4.1.0+)», che si legge come «non esiste prima di
   > 4.1.0» ed è falso. Quel che 4.1.0 ha aggiunto — e che §5 dice correttamente — è che `Layer`
   > sia un GameObject a pieno titolo. Il divieto e il floor restano invariati.
7. **Costi non misurati.** Nessuno ha profilato il costo reale di centinaia di `IsoSprite`, del
   sort dell'input (`indexOf` `O(n)` dentro il comparatore) o del culling. → Il benchmark a 500
   entità di §8 è ciò che trasforma la promessa in un numero.

---

## 14. Sequenza di implementazione

La spec copre più di quanto stia in un solo ciclo. L'ordine è vincolante: ogni tappa è
verificabile da sola e nessuna dipende da una successiva.

| # | Tappa | Contenuto | Gate di uscita |
| --- | --- | --- | --- |
| 1 | **Core** | §4 per intero, monorepo e confine di §3 | Property test verdi + batteria di mutazione + le tre guardie architetturali |
| 2 | **Guscio** | §5 senza `debug` e senza `inspect` | Test `jsdom` sul ciclo di vita + `tsc --noEmit` su un progetto consumatore reale |
| 3 | **Verifica browser** | `examples/` + Playwright headless + benchmark 500 entità | **Gate bloccante**: nessuna affermazione sul rendering è ancora provata (§13, rischio 1) |
| 4 | **Documentazione** | §6: SKILL.md, `llms.txt`, le quattro trappole, messaggi d'errore | Un agente parte da zero e scrive una scena che compila e disegna |
| 5 | **Pubblicazione v1** | Packaging di §8, `phaser-isometric/debug` | Installazione pulita da npm in un progetto Vite+TS vergine |
| 6 | **MCP livelli 1-3** | §7 | Assert di uguaglianza sulla lista dei tool |
| 7 | **MCP livello 4** | `phaser-isometric/inspect` + tool di introspezione | Degradazione con grazia verificata senza bridge connesso |

Le tappe 1-5 sono la v1. Le tappe 6-7 seguono, e la 7 **non può precedere la 3**.

## 15. Punti chiusi

- **Nome dei pacchetti — risolto (2026-07-27).** `phaser-isometric` e `phaser-isometric-mcp`
  sono entrambi **liberi** su npm (registry: 404 su entrambi). Nomi confermati. Erano
  bloccanti perché compaiono nell'exports map, nei sottopath e nella SKILL.md.
- **Forma dell'output di `iso_scaffold` — risolto.** Restituisce **file** (percorso +
  contenuto), non una patch: una patch richiederebbe di conoscere lo stato corrente del
  progetto di destinazione, che l'MCP non ha e non deve avere.

Nessun punto aperto residuo.
