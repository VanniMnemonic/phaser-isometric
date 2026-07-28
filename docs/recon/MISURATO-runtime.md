# Fatti MISURATI a runtime — Phaser 4.2.1 sotto jsdom

> Non letti dal sorgente: **eseguiti**. Prova isolata in
> `scratchpad/jsdom-probe/` (vitest 3.2.7 + jsdom 30 + phaser 4.2.1).
> Ogni riga qui sotto è l'output di un `console.log` in un test verde.
> Dove questo file e un dossier di ricognizione non vanno d'accordo,
> **vince questo**: la misura batte la lettura.

---

## 0. Phaser NON si importa sotto jsdom nudo — muore al module load

Con `environment: 'jsdom'` e nessun setup:

```
TypeError: Cannot set properties of null (setting 'fillStyle')
 ❯ checkInverseAlpha  phaser/dist/phaser.esm.js:24598:23
   var context = canvas.getContext('2d', { willReadFrequently: true });
   context.fillStyle = 'rgba(10, 20, 30, 0.5)';   // <-- context è null
 ❯ init             phaser/dist/phaser.esm.js:24630:46
```

Non è il `new Phaser.Game(...)` a fallire: è **l'`import`**. jsdom
restituisce `null` da `getContext()` senza il pacchetto nativo `canvas`.

Stato reale dell'ambiente jsdom 30 misurato:

```json
{
  "requestAnimationFrame": "function",
  "getContext2d": "null",
  "getContextWebGL": "null",
  "Image": "function",
  "Audio": "function",
  "AudioContext": "undefined",
  "URLcreateObjectURL": "undefined"
}
```

**Conseguenza per il piano:** il setup vendorizzato non è un'ottimizzazione,
è la condizione di esistenza dell'anello `jsdom`. Va caricato via
`setupFiles`, cioè PRIMA di qualunque import di Phaser.

## 0-bis. Il setup di Phaser risolve il problema, ed è vendorizzabile

`phaser/tests/setup.js` (257 righe) fa esattamente tre cose che servono:

1. mock di `HTMLCanvasElement.prototype.getContext` per `2d`, `webgl`,
   `webgl2`, `experimental-webgl` (il resto → `null`);
2. mock di `Image` che fa scattare `onload` in un `setTimeout(…, 1)` —
   senza, il `TextureManager` non emette mai `READY` e **il boot si blocca
   per sempre** (il commento nel file di Phaser lo dice esplicitamente);
3. `global.self`, `global.screen`, `window.focus`, e una soppressione dei
   `console.error` "Not implemented" di jsdom.

`phaser/tests/helper.js` avvia un Game vero con
`type: Phaser.HEADLESS, banner: false, audio: { noAudio: true }` e risolve
una Promise dentro `create()`. È l'idioma da copiare.

Nota: `helper.js` fa `require('../dist/phaser.js')` e legge `global.Phaser`
(CJS). Noi importiamo in ESM: `import PhaserNS from 'phaser'` e poi
`const Phaser = PhaserNS.default ?? PhaserNS`.

**Verificato:** con il setup vendorizzato il boot arriva a `create()` e
`scene.add.sprite(100, 200, '__DEFAULT')` produce uno Sprite vero
(`{x:100, y:200, type:"Sprite", depth:0}`).

---

## 1. `mapping` — misurato, e la spec aveva ragione sull'esito

Config usata:

```js
plugins: { scene: [{ key: 'IsoPlugin', plugin: ProbePlugin,
                     mapping: 'iso', data: { hello: 'world' } }] }
```

Misura:

```json
{
  "ctorArgs": { "argCount": 3, "third": "iso", "thirdType": "string" },
  "initCalled": false,
  "initData": null,
  "sys.iso": "object",        "sys.IsoPlugin": "undefined",
  "scene.iso": "object",      "scene.IsoPlugin": "undefined",
  "plugin.pluginKey": "iso",
  "plugin.scene===scene": true,
  "plugin.systems===sys": true
}
```

- Il **terzo argomento del costruttore è il `mapping`**, non la `key`.
- Il plugin finisce su `sys[mapping]` **e** su `scene[mapping]`.
- La `key` non compare da nessuna parte sull'istanza.
- **`init(data)` non viene MAI chiamato**, e `data` non arriva da nessuna
  parte. È ciò che rende necessario `withDefaults()`.

### Perché il JSDoc di `installScenePlugin` sembra dire il contrario

Non mente: descrive **un altro percorso**. Ci sono due strade, e vanno
tenute distinte nel piano.

`PluginManager.installScenePlugin` (src/plugins/PluginManager.js:386-397),
usata SOLO quando si passa `addToScene` (cioè dal Loader, a runtime):

```js
var instance = new plugin(addToScene, this, key);   // <-- key
addToScene.sys[key] = instance;                     // <-- sys[key]
if (mapping && mapping !== '') { addToScene[mapping] = instance; }
instance.boot();
```

`PluginManager.addToScene` (src/plugins/PluginManager.js:~275-290), la
strada che percorre `config.plugins.scene`:

```js
var source  = PluginCache.getCore(pluginKey);
var mapKey  = source.mapping;                       // <-- mapping
var plugin  = new source.plugin(scene, this, mapKey);
sys[mapKey] = plugin;
if (source.custom) { scene[mapKey] = plugin; }
else if (map.hasOwnProperty(mapKey)) { scene[map[mapKey]] = plugin; }
if (isBooted) { plugin.boot(); }
```

Il `true` finale di `PluginCache.register(key, plugin, mapping, true)`
dentro `installScenePlugin` è ciò che rende `source.custom` vero, quindi
per noi vale sempre `scene[mapping] = plugin`.

## 2. SENZA `mapping` il plugin si monta su `scene["null"]`

> **Correzione.** La prima stesura di questo dossier concludeva «non finisce
> da nessuna parte». Era **sbagliata**: avevo cercato la chiave
> `'undefined'`, mentre `GetFastValue(entry,'mapping',null)` produce `null`.
> Il difetto è stato trovato dalla ricognizione sul sorgente e poi
> ri-misurato. È esattamente il motivo per cui misura e lettura vanno
> incrociate: una sonda che guarda la chiave sbagliata non trova niente e
> «niente» somiglia moltissimo a una risposta.

La spec diceva «scrive `sys['undefined']` e `scene['undefined']`». Sbagliato
il nome, giusta la sostanza. Misurato con la forma **esatta dell'`@example`
ufficiale di Phaser** (`src/core/typedefs/PluginObjectItem.js:17-18`), cioè
`{ key, plugin, systemKey, sceneKey }` senza `mapping`:

```json
{
  "sys[\"null\"]": "object",
  "scene[\"null\"]": "object",
  "sonoLaStessaIstanza": true,
  "pluginKey": null,
  "sys.NoMapKey": "undefined",     // la `key` non atterra da nessuna parte
  "sys.noMapSys": "undefined",     // `systemKey` IGNORATO
  "scene.noMap": "undefined",      // `sceneKey`  IGNORATO
  "chiaviSospetteSuSys": ["null"]
}
```

Tre fatti in uno, e tutti e tre vanno nella documentazione:

1. Senza `mapping`, il plugin si monta sulla proprietà stringa `"null"` di
   `sys` **e** di `scene`, con `pluginKey === null`. Nessun warning.
2. **`systemKey` e `sceneKey` sono campi morti** su `config.plugins.scene`.
   Sono documentati in tre posti — il commento in `src/core/Config.js:607`,
   l'`@example` del typedef, e il `.d.ts` spedito (`types/phaser.d.ts:96154`)
   — e implementati in nessuno. Appartengono al percorso del **Loader**
   (`src/loader/filetypes/ScenePluginFile.js:106`), dove `systemKey` diventa
   `key` e `sceneKey` diventa `mapping`.
3. Quindi **chi copia l'esempio ufficiale di Phaser ottiene `scene.null`.**

Conseguenza per il piano: non basta documentare che `mapping` è
obbligatorio. Serve una **factory di config** che l'utente chiama invece di
scrivere l'oggetto a mano, così la forma non può essere sbagliata; e un
controllo in `boot()` su `this.pluginKey`, che è l'unico momento in cui il
difetto è ancora catturabile.

## 3. Il plugin viene costruito una volta PER SCENA, `__SYSTEM` inclusa

Con una sola scena utente il costruttore gira **due volte**. Stack trace:

```
ctor#1  sceneKey=__SYSTEM  isBooted=false
  at PluginManager.addToScene
  at Systems.init
  at SceneManager.createSceneFromInstance      <-- __SYSTEM
  at SceneManager.bootQueue
ctor#2  sceneKey=solo      isBooted=false
  at PluginManager.addToScene
  at Systems.init
  at SceneManager.createSceneFromObject        <-- la scena utente
  at SceneManager.bootQueue
```

Sorgente: `src/scene/SceneManager.js:195`

```js
this.systemScene = this.createSceneFromInstance('__SYSTEM', new Scene());
```

Identica in **4.0.0**, stessa riga 195 — nessun rischio per il peer floor.

**Non è un doppio boot sulla stessa scena**: è una istanza per Scene, e
Phaser ne ha una nascosta che il consumatore non vede mai. `boot()` gira
esattamente una volta per istanza (`sameSys=true` per entrambe).

Conseguenze vincolanti per il piano:

- Il costruttore del plugin gira **N+1 volte** (N scene utente + `__SYSTEM`).
  Tutto ciò che ci mettiamo dentro deve essere idempotente e a costo nullo:
  `registerGameObject` lo è (misurato: due registrazioni della stessa
  chiave, nessuna eccezione, nessun warning).
- Un test che conta le istanze **deve** tenere conto di `__SYSTEM`, o
  fallisce per la ragione sbagliata.
- Costruire la proiezione nel costruttore significa costruirla anche per
  `__SYSTEM`. Innocuo, ma va saputo.

## 4. `destroy()` del plugin non viene mai chiamato

Sequenza misurata su un `game.destroy(true)`, con handler registrati in
`boot()`:

```json
{ "sequence": ["boot","boot","START","DESTROY","DESTROY"],
  "pluginDestroyEverCalled": false }
```

I due `boot` e i due `DESTROY` sono le due scene (§3); `START` una sola
perché `__SYSTEM` non viene avviata.

Il JSDoc di `ScenePlugin#destroy` afferma: *«This method is called
automatically when the Scene is destroyed.»* — **misurato falso.** La
pulizia va agganciata a mano su `SceneEvents.DESTROY`.

## 5. `registerGameObject` restituisce il PluginManager, non `void`

```json
{ "registrations": ["ctor", "registerGameObject returned: this(pluginManager)",
                    "ctor", "registerGameObject returned: this(pluginManager)"] }
```

Il `.d.ts` lo dichiara `: void`. Il `.d.ts` mente. E la doppia
registrazione (per `__SYSTEM` e per la scena) **non lancia e non avvisa**.

La factory registrata dal costruttore funziona:

```json
{ "created": { "x":10, "y":20, "isIsoSprite": true, "type": "Sprite" },
  "inDisplayList": true }
```

---

## 6. Depth: N `setDepth` → UN solo sort

```json
{ "setDepthReturnsThis": true,
  "sortChildrenFlagAfterNSetDepth": true,
  "sortCallsAfterFirstManualSort": 1,
  "flagAfterSort": false,
  "orderedDepths": [7, 96, 97, 98, 99],
  "hasQueueDepthSort": "function" }
```

`sortChildrenFlag` è un singolo booleano che il sort azzera. Conferma la
scelta della spec: **usare `setDepth()` pubblico**, non scrivere `_depth`.
Niente `commitDepths()`.

## 7. Il pareggio di depth cade sull'ordine di inserimento

Tre sprite, stessa depth `5`, inseriti a, b, c → dopo `depthSort()`:
`["a","b","c"]`. **Il sort è stabile e il pareggio non è risolto.**
È esattamente ciò che le bande di depth del core esistono per prevenire.

## 8. `startFollow` AZZERA `roundPixels` — misurato

Con `render: { roundPixels: true }` nella config del Game:

```json
{ "roundPixelsBefore": true,
  "roundPixelsAfterStartFollowNoArg": false,     // <-- azzerato
  "roundPixelsAfterStartFollowTrue": true,
  "followTarget": "il nostro oggetto nudo" }
```

Due fatti in uno:

- **`startFollow(target)` senza secondo argomento mette `roundPixels` a
  `false`**, buttando via la config del Game. `iso.follow()` deve
  ri-applicarlo, o passare `true` esplicitamente.
- **`startFollow` accetta un oggetto nudo `{x, y}`** — non serve un
  GameObject. È il giunto su cui poggia il camera proxy.

## 9. Camera: `worldView` esiste — ma NON va usato per il culling

```json
{ "worldViewType": "Rectangle",
  "worldView": { "x": -277, "y": 156, "w": 800, "h": 600 },
  "matrixProps": ["matrix=object", "matrixExternal=object",
                  "matrixCombined=object"] }
```

> **Correzione.** La prima stesura concludeva «è ciò che alimenta
> `cullBounds`». Sbagliato, e la sonda lo mascherava: chiamavo `preRender()`
> a mano *subito prima* di leggere. In un frame vero nessun hook a nostra
> disposizione gira dopo `preRender`.

`worldView` viene scritto **solo** dentro `Camera.preRender`
(`src/cameras/2d/Camera.js:612`), che è fase di render. Ogni aggancio che il
plugin può usare — `PRE_UPDATE`, `UPDATE`, l'`update()` della Scene,
`POST_UPDATE`, il `PRE_RENDER` di Scene — legge quindi il rettangolo del
**frame precedente**, e al primo frame legge `{0,0,0,0}`.

**Il guscio deve ricostruire la vista da scalari vivi**, con le stesse
quattro righe di `Camera.js:606-612` ma valutate adesso:

```ts
const w = camera.width / camera.zoomX;
const h = camera.height / camera.zoomY;
const view = {
    x: camera.scrollX + camera.width / 2 - w / 2,
    y: camera.scrollY + camera.height / 2 - h / 2,
    width: w, height: h
};
```

Tre vantaggi, non uno: niente ritardo di un frame, nessuna dipendenza da un
`Rectangle` dichiarato `readonly` che leggeremmo mentre viene mutato, e il
culling diventa **testabile in `node` con una camera finta** — cioè rientra
nella disciplina del nucleo puro invece di richiedere jsdom.

### Le matrici: esistono a runtime, ma `matrix` non è nei tipi

Tutte e tre esistono come oggetti a runtime. Ma `BaseCamera#matrix` è
`@private` e **non compare in `types/phaser.d.ts`** (la lista dei membri
salta da `dirty` a `matrixCombined`). Solo `matrixCombined` e
`matrixExternal` sono dichiarate. Non tipizzare contro `camera.matrix`.

## 10. Le costanti degli eventi Scene, valori reali

```json
{ "BOOT":"boot", "START":"start", "READY":"ready",
  "SHUTDOWN":"shutdown", "DESTROY":"destroy",
  "PRE_UPDATE":"preupdate", "UPDATE":"update", "POST_UPDATE":"postupdate",
  "RENDER":"render", "PAUSE":"pause", "RESUME":"resume",
  "SLEEP":"sleep", "WAKE":"wake", "tutte": 22 }
```

Nel codice si usano le costanti (`Phaser.Scenes.Events.START`), mai le
stringhe: sono qui solo per riconoscerle in un log.

---

## 11. Il docblock per-file di vitest funziona

`// @vitest-environment jsdom` in cima al file **vince** su
`environment: 'node'` nella config globale (verificato: `window`,
`document`, `HTMLCanvasElement` tutti presenti). Quindi l'anello `jsdom`
non richiede un secondo sistema di configurazione: si aggiunge
`setupFiles` alla config esistente e si marca ogni file del guscio.

Attenzione: **`setupFiles` gira per OGNI file di test**, anche quelli
`node` del core. Il setup vendorizzato deve quindi essere innocuo quando
`window` non esiste — quello di Phaser lo è già, perché ogni blocco è
protetto da un `typeof … === 'undefined'`.

## 12. pnpm 11 nega gli script di install per default

`pnpm add -D vitest jsdom phaser` finisce con:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1
```

Serve `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`. Il
monorepo ce l'ha già; va ricordato per `examples/`.
