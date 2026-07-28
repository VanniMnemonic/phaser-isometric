# Recon — Headless testing of a Phaser 4 plugin

**Subject:** can we run a jsdom test ring against a real Phaser `ScenePlugin` / `GameObjectFactory` /
camera-follow / hit-area shell, and if so, what exactly does the harness have to provide?

**Verdict up front: YES.** A real `Phaser.HEADLESS` game boots under jsdom, installs a custom
`ScenePlugin`, registers a custom `GameObjectFactory` entry, builds real Game Objects and accepts a
custom polygon hit area. It needs **two** DOM mocks and nothing else. But `HEADLESS` **never
renders**, and in Phaser 4 *render* is where depth sorting and camera-follow live — so those two
behaviours must be pumped by hand in tests.

---

## Source roots used

The task brief passed the Phaser roots as the literal string `undefined`. Resolved by search:

| Version | Root |
| --- | --- |
| **4.2.1** (primary) | `/Users/xsec/projects/phaser/platformer/node_modules/phaser` |
| 4.0.0 (drift check) | `/Users/xsec/projects/phaser/first-game/node_modules/phaser` |

All `path:LINE` anchors below are relative to the **4.2.1** root unless stated.

Every dynamic claim in this document was verified by executing Phaser 4.2.1 under
jsdom 28.1.0 / Node v26.5.0. Probe scripts live in the session scratchpad
(`.../scratchpad/{dbl,life,partial,nosetup,dual,cam2,depth,minimal}.cjs`).

---

## 1. What is in `tests/`, what `tests/setup.js` does, and `vitest.config.js`

### 1.1 Inventory

`tests/` ships **1097 `*.test.js` files** plus three top-level files:

```
tests/setup.js         257 lines — global env setup (auto-loaded by vitest)
tests/helper.js        117 lines — boots a real HEADLESS Phaser Game
tests/helper.test.js   131 lines — tests for the helper itself
tests/TESTING.md       134 lines — the house style guide for writing Phaser tests
```

and 26 subdirectories mirroring `src/`. Counts of `*.test.js` per area:

```
gameobjects 207   geom 167   math 126   tilemaps 101   renderer  77
utils        70   display 69   actions  55   physics  44   loader  33
filters      24   input   24   tweens   21   textures 18   cameras 11
scene         9   curves   8   sound     6   plugins   5   structs  5
animations    4   scale    4   time      3   cache     2   data     2   dom 1
```

Only **16 of the 1097** test files boot a real game (`grep -rl "require('.*helper')"`). Everything
else is `require()` the source module directly + hand-built fakes. That ratio is the single most
useful signal in this whole area: **Phaser's own team treats the real-game harness as the exception**.

### 1.2 `tests/setup.js` in full — what it actually mocks

Four blocks. Two are load-bearing, two are cosmetic.

**(a) Globals jsdom "doesn't provide" — `tests/setup.js:15-29`. COSMETIC.**

```js
if (typeof global.self === 'undefined')
{
    global.self = global;
}

if (typeof global.screen === 'undefined')
{
    global.screen = { width: 1920, height: 1080, orientation: { type: 'landscape-primary' } };
}

// Stub window.focus to suppress jsdom "Not implemented" warnings
if (typeof window !== 'undefined')
{
    window.focus = function () {};
}
```

Measured: under a vitest-shaped jsdom env, `typeof self === 'object'` and `typeof screen === 'object'`
*before* setup.js runs — jsdom supplies both, and vitest copies window props onto `globalThis`. Both
guards are dead branches. The `window.focus` stub is real but avoidable: it exists only because
`VisibilityHandler` calls it —

`src/core/VisibilityHandler.js:88-90`
```js
    if (window.focus && game.config.autoFocus)
    {
        window.focus();
```

and `autoFocus` defaults true (`src/core/Config.js:190` — `this.autoFocus = GetValue(config, 'autoFocus', true);`).
Passing `autoFocus: false` in the game config removes the call entirely. **Prefer the config flag to
the stub.**

**(b) `console.error` filter — `tests/setup.js:32-44`. COSMETIC, and actively harmful.**

```js
var _origConsoleError = console.error;

console.error = function ()
{
    var msg = arguments[0];

    if (typeof msg === 'string' && msg.indexOf('Not implemented') !== -1)
    {
        return;
    }

    _origConsoleError.apply(console, arguments);
};
```

A global, never-restored monkeypatch on `console.error` installed in a vitest *setup file*, i.e. once
per worker for the whole run. It swallows any error message containing the substring `Not implemented`
from **our** code too. With `autoFocus: false` there is nothing left for it to suppress. **Do not
vendor this block.**

**(c) `Image` mock — `tests/setup.js:52-90`. MANDATORY.**

```js
var OriginalImage = global.Image;

global.Image = function ()
{
    var img = {
        width: 32,
        height: 32,
        naturalWidth: 32,
        naturalHeight: 32,
        complete: false,
        crossOrigin: '',
        onload: null,
        onerror: null,
        addEventListener: function (type, fn) { if (type === 'load') { img.onload = fn; } },
        removeEventListener: function () {}
    };

    Object.defineProperty(img, 'src', {
        set: function (val)
        {
            img._src = val;
            img.complete = true;

            setTimeout(function ()
            {
                if (typeof img.onload === 'function')
                {
                    img.onload();
                }
            }, 1);
        },
        get: function ()
        {
            return img._src || '';
        }
    });

    return img;
};
```

The header comment (`tests/setup.js:47-50`) explains why, and it is accurate:

> jsdom's Image doesn't fire onload because it has no image decoder. Phaser's TextureManager loads
> base64 textures via Image and waits for onload before emitting READY, which blocks the entire boot
> sequence.

Verified: with the canvas mock present but the Image mock **absent**, `game.isBooted === true` but
`Scene.create()` **never fires** — the boot deadlocks at `src/core/Game.js:374`
(`this.textures.once(TextureEvents.READY, this.texturesReady, this);`). Probe output:

```
----------- canvasonly
RESULT: FAIL — TIMEOUT: create() never fired | isBooted = true
----------- canvas+image
RESULT: booted OK, isRunning = true
```

Note `var OriginalImage = global.Image;` on line 52 is captured and then never used — dead code.

**(d) Canvas 2D + WebGL context mock — `tests/setup.js:94-257`. THE 2D HALF IS MANDATORY; the WebGL
half is not needed for HEADLESS.**

```js
if (typeof HTMLCanvasElement !== 'undefined')
{
    HTMLCanvasElement.prototype.getContext = function (type)
    {
        if (type === '2d' || type === '2D')
        {
            return { canvas: this, fillRect: …, clearRect: …, getImageData: …, /* ~40 members */ };
        }

        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')
        {
            return { canvas: this, getExtension: …, /* ~50 members + ~25 GL enums */ };
        }

        return null;
    };
}
```

This is not about rendering — it is about **module load**. `src/device/CanvasFeatures.js` runs its
probe at `require()` time:

`src/device/CanvasFeatures.js:69-77, 101-112`
```js
function checkInverseAlpha ()
{
    var canvas = CanvasPool.create2D(this, 2);
    var context = canvas.getContext('2d', { willReadFrequently: true });

    context.fillStyle = 'rgba(10, 20, 30, 0.5)';
…
function init ()
{
    if (typeof importScripts !== 'function' && document !== undefined)
    {
        CanvasFeatures.supportNewBlendModes = checkBlendMode();
        CanvasFeatures.supportInverseAlpha = checkInverseAlpha();
    }

    return CanvasFeatures;
}

module.exports = init();
```

Vanilla jsdom returns `null` from `getContext('2d')` (it prints
`Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package`).
So `context.fillStyle = …` throws. Measured, on `require('phaser/dist/phaser.js')` with no canvas mock:

```
LOAD ERR: Cannot set properties of null (setting 'fillStyle')
```

**`import Phaser from 'phaser'` fails at module evaluation, before any test body runs.** That is the
hardest constraint in this area.

The **WebGL** half of the mock is not required for HEADLESS. `src/device/Features.js` guards its
WebGL probe in a `try`, and a `null` return simply yields `Features.webGL === false`, which HEADLESS
never consults (see §3). A 15-line 2D-only mock was verified sufficient.

### 1.3 `vitest.config.js` — verbatim, all 11 lines

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.js'],
        testTimeout: 10000
    }
});
```

`globals: true` is why the test files call `describe`/`it`/`expect`/`vi` with no imports.
`testTimeout: 10000` is a 4.2.1 addition (see §7).

Vitest's jsdom environment defaults `pretendToBeVisual: true`, which is what supplies
`window.requestAnimationFrame`:

`node_modules/.pnpm/vitest@3.2.7_…/node_modules/vitest/dist/chunks/index.CmSc2RE5.js:423`
```js
const { html = "<!DOCTYPE html>", userAgent, url = "http://localhost:3000", contentType = "text/html", pretendToBeVisual = true, … } = jsdom;
```

---

## 2. `package.json` — `exports`, `files`, and whether `tests/` is importable

### 2.1 The `exports` map, verbatim (`package.json:11-23`)

```json
  "main": "./src/phaser.js",
  "types": "./types/phaser.d.ts",
  "browser": "./dist/phaser.js",
  "module": "./dist/phaser.esm.js",
  "exports": {
    ".": {
      "types": "./types/phaser.d.ts",
      "import": "./dist/phaser.esm.js",
      "require": "./dist/phaser.js",
      "default": "./dist/phaser.esm.js"
    },
    "./package.json": "./package.json"
  },
```

### 2.2 There is no `files` array

```
$ grep -n '"files"' package.json
NO files ARRAY
```

**First-class negative finding: the key the question asks about does not exist.** With no `files`
array and no `.npmignore`, npm ships everything not covered by its built-in exclusion list. Empirical
proof — the *installed* package (which is exactly the tarball) contains:

```
changelog/  CHANGELOG.md  CITATION.cff  config/  dist/  docs/  LICENSE.md
package.json  README.md  scripts/  skills/  src/  tests/  types/  vitest.config.js
```

**`tests/` (all 1097 files), `src/`, `config/` and `vitest.config.js` are all in the published
tarball.** They are on disk in every consumer's `node_modules`.

### 2.3 …but nothing under `tests/` is reachable through the exports map

The map exposes exactly two subpaths: `.` and `./package.json`. Everything else is blocked. Measured
(`require.resolve` from the platformer project):

```
main resolve:        …/node_modules/phaser/dist/phaser.js
tests/setup ERR:  ERR_PACKAGE_PATH_NOT_EXPORTED | Package subpath './tests/setup.js' is not defined by "exports"
helper ERR:       ERR_PACKAGE_PATH_NOT_EXPORTED | Package subpath './tests/helper.js'  is not defined by "exports"
src ERR:          ERR_PACKAGE_PATH_NOT_EXPORTED | Package subpath './src/phaser.js'    is not defined by "exports"
```

**Answer to the plan's question: importing Phaser's setup is impossible.**
`import 'phaser/tests/setup.js'` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` under Node and under Vite's
resolver. The files are present but unreachable by specifier. The only ways in are a hard relative
path (`../../node_modules/phaser/tests/setup.js`) — brittle under pnpm's symlinked store, which is
what this monorepo uses — or vendoring. **Vendor.** And since two of setup.js's four blocks are dead
or harmful (§1.2), vendoring a trimmed copy is strictly better than copying it whole.

### 2.4 Two side-findings from the same map

- **`main` and `exports.require` disagree.** `main` says `./src/phaser.js` (unbundled source);
  `exports["."].require` says `./dist/phaser.js` (webpack bundle). `exports` wins on Node ≥12 and in
  Vite, so this is latent — but any tool that still reads `main` gets the *unbundled* tree, where the
  `WEBGL_RENDERER` / `CANVAS_RENDERER` / `FEATURE_SOUND` build flags are undefined identifiers.
  `tests/TESTING.md:115` warns about this in the "Do NOT" section:

  > Require from `src/phaser.js` directly — it is unbundled source without webpack flags. Always use
  > `dist/phaser.js` (which the helper does automatically).

- **`types/index.d.ts` references four files that do not exist.**

  `types/index.d.ts` (all 5 lines)
  ```ts
  /// <reference types="./phaser" />
  /// <reference types="./SpinePlugin" />
  /// <reference types="./SpineFile" />
  /// <reference types="./SpineGameObject" />
  /// <reference types="./SpineContainer" />
  ```
  `ls types/` returns only `index.d.ts  matter.d.ts  phaser.d.ts  phaser.json`. Harmless *today*
  because `package.json` points `types` at `./types/phaser.d.ts`, not at `index.d.ts` — but do not
  add a `/// <reference>` to `types/index` from our package.

- **`declare module 'phaser' { export = Phaser; }`** (tail of `types/phaser.d.ts`). An `export =`
  namespace. `import Phaser from 'phaser'` needs `esModuleInterop`; `import * as Phaser from 'phaser'`
  is the form that works unconditionally.

---

## 3. Does `new Phaser.Game({ type: Phaser.HEADLESS })` boot without a real canvas?

**Yes — measured, repeatedly.** But the constant's own JSDoc is the clearest statement of the catch:

`src/const.js:73-83`
```js
    /**
     * A Headless Renderer doesn't create either a Canvas or WebGL Renderer. However, it still
     * absolutely relies on the DOM being present and available. This mode is meant for unit testing,
     * not for running Phaser on the server, which is something you really shouldn't do.
     *
     * @name Phaser.HEADLESS
     …
     */
    HEADLESS: 3,
```

Read that literally: **"doesn't create either a Canvas or WebGL *Renderer*"** — the *renderer object*.
It says nothing about the canvas *element*, and the implementation does create one.

### 3.1 Renderer selection — `src/core/CreateRenderer.js`

```js
30  var CreateRenderer = function (game)
31  {
32      var config = game.config;
…
40      if (!config.customEnvironment && !config.canvas && config.renderType !== CONST.HEADLESS)
41      {
…              // AUTO resolution + Features.webGL / Features.canvas capability throws
59      }
…
67      var baseSize = game.scale.baseSize;
…
80      else
81      {
82          game.canvas = CanvasPool.create(game, width, height, config.renderType);
83      }
…
97      if (config.renderType === CONST.HEADLESS)
98      {
99          //  Nothing more to do here
100         return;
101     }
```

Two things follow:

- Line 40 — HEADLESS **skips the capability gate entirely**. `Features.webGL` / `Features.canvas`
  being `false` under jsdom cannot abort the boot. This is why the WebGL half of setup.js's mock is
  unnecessary.
- Line 82 runs **before** the HEADLESS early-return at 97. **HEADLESS still allocates a real
  `<canvas>` element**, via `src/display/canvas/CanvasPool.js:57` — `canvas: document.createElement('canvas')`.
  Measured: `game.canvas.tagName === 'CANVAS'`, and its `parentNode.tagName === 'BODY'`.

`game.renderer` is left as its constructor default. Measured: **`game.renderer === null`** under
HEADLESS.

**Bonus finding — dead code at `CreateRenderer.js:106-143.`** The three build-flag branches read:

```js
106     if (typeof WEBGL_RENDERER && typeof CANVAS_RENDERER)
…
123     if (typeof WEBGL_RENDERER && !typeof CANVAS_RENDERER)
…
133     if (!typeof WEBGL_RENDERER && typeof CANVAS_RENDERER)
```

`typeof X` yields a non-empty string, which is always truthy; `!typeof X` is therefore always `false`.
Branch 1 always runs, branches 2 and 3 are unreachable regardless of how the flags are defined. Not
our problem (HEADLESS returns at line 100 before reaching any of them) but it is a real defect in the
file that our plan's reviewers should not "fix".

### 3.2 What HEADLESS still requires from the DOM

Traced through `src/core/Game.js` boot:

```js
335         //  Wait for the DOM Ready event, then call boot.
336         DOMContentLoaded(this.boot.bind(this));
…
350     boot: function ()
…
358         this.isBooted = true;
…
364         CreateRenderer(this);
365
366         CreateDOMContainer(this);
367
368         DebugHeader(this);
369
370         AddToDOM(this.canvas, this.config.parent);
371
372         //  The Texture Manager has to wait on a couple of non-blocking events before it's fully ready.
373         //  So it will emit this internal event when done:
374         this.textures.once(TextureEvents.READY, this.texturesReady, this);
375
376         this.events.emit(Events.BOOT);
```

| Requirement | Where | Notes |
| --- | --- | --- |
| `document` (+ `readyState`) | `src/dom/DOMContentLoaded.js:30` — `if (document.readyState === 'complete' \|\| document.readyState === 'interactive')` | otherwise it waits on `DOMContentLoaded` / `load` listeners |
| `document.createElement('canvas')` | `src/display/canvas/CanvasPool.js:57` | HEADLESS included |
| a working `getContext('2d')` | `src/device/CanvasFeatures.js:72-74` | at **module load**, before any Game exists |
| `document.body` | `src/dom/AddToDOM.js:46-49` — `target = document.body; … target.appendChild(element);` | the canvas is appended for real |
| `window` | `src/device/OS.js:153` — `if (window.cordova !== undefined)` | at **module load** |
| an `Image` that fires `onload` | `src/core/Game.js:374` gate | boot deadlocks without it |
| `window.requestAnimationFrame` **or** `forceSetTimeOut` | `src/dom/RequestAnimationFrame.js:151` | see below |
| `window.performance.now` | `src/dom/RequestAnimationFrame.js:122` | only on the setTimeout path |

**`requestAnimationFrame`: needed by default, but escapable.**

`src/dom/RequestAnimationFrame.js:136-152`
```js
    start: function (callback, forceSetTimeOut, delay)
    {
…
        this.timeOutID = (forceSetTimeOut) ? window.setTimeout(this.stepTimeout, 0) : window.requestAnimationFrame(this.step);
    },
```

Vitest's jsdom env gives you rAF for free (`pretendToBeVisual: true`, §1.3), so the default path
works. Verified that deleting `window.requestAnimationFrame` and passing
`fps: { forceSetTimeOut: true }` also boots cleanly — a useful lever if rAF timing ever makes tests
flaky.

### 3.3 The measured boot

```
[env] window.requestAnimationFrame = function
[env] document.readyState = loading
[phaser] VERSION = 4.2.1  HEADLESS = 3
[boot] game.isBooted = true  isRunning = true
[boot] game.renderer = null  typeof = object
[boot] game.canvas = CANVAS  parentNode= BODY
[boot] game.config.renderType = 3
[scene] scene.add = object  scene.cameras = object  main cam = true
[scene] scene.input = object
[scene] scene.textures default frame = 32
[factory] scene.add.probeThing -> Image 11 22
[input] input.enabled = true  hitArea = Polygon
[input] hitAreaCallback contains(16,16) = true
[input] hitAreaCallback contains(1,1)  = false
[loop] game.loop.frame = 7
```

Everything the thin shell touches — factory, display list, cameras, input hit areas, texture manager —
is alive under HEADLESS. Two sequential `new Phaser.Game(...)` / `game.destroy(true)` cycles in one
process were also verified to work.

### 3.4 The catch: HEADLESS never renders, and *render* owns two things we care about

`src/core/Game.js:410-423`
```js
    start: function ()
    {
        this.isRunning = true;

        this.config.postBoot(this);

        if (this.renderer)
        {
            this.loop.start(this.step.bind(this));
        }
        else
        {
            this.loop.start(this.headlessStep.bind(this));
        }
```

Note the branch is on **`this.renderer` being falsy**, not on `renderType`. And `headlessStep`
(`src/core/Game.js:523-559`) is `step` minus the render half:

```js
545         //  Update the Scene Manager and all active Scenes

547         this.scene.update(time, delta);
…
553         //  Render
554         this.scene.isProcessing = false;
555
556         eventEmitter.emit(Events.PRE_RENDER, null, time, delta);
557
558         eventEmitter.emit(Events.POST_RENDER, null, time, delta);
```

`this.scene.render(renderer)` — present in `step` at line 494 — is **absent**. Consequences:

**(a) Depth sorting never runs.**

`src/scene/Systems.js:374-385`
```js
    render: function (renderer)
    {
        var displayList = this.displayList;

        displayList.depthSort();
…
```

`depthSort()` is called from exactly one place in the frame path, and that place is dead under
HEADLESS. Measured:

```
insertion order            : a:30 b:10 c:20 | sortChildrenFlag= true
after 200ms headless frames: a:30 b:10 c:20 | frames= 11 | flag= true
after manual sys.depthSort(): b:10 c:20 a:30
```

Eleven frames elapsed; the list stayed unsorted and `sortChildrenFlag` stayed `true`. The public
escape hatch is `scene.sys.depthSort()` (`src/scene/Systems.js:404-407` → `this.displayList.depthSort();`).

**For an isometric plugin this is the finding that matters most.** Sorting by an iso depth key is the
whole product. A test that sets depths, runs frames, and asserts order will pass vacuously — it
asserts *insertion* order, which happens to be right in many fixtures.

**(b) Camera follow never applies.**

`src/cameras/2d/CameraManager.js:592-610` is the only caller of `camera.preRender()`:

```js
    render: function (renderer, displayList)
    {
…
            if (camera.visible && camera.alpha > 0)
            {
                camera.preRender();
```

and `CameraManager.render` is only reached from `Systems.render` → `SceneManager.render` →
`Game.step`. Measured:

```
immediately after startFollow: scrollX= 600 scrollY= 400
after ~200ms of headless loop (frames=11): scrollX= 600 scrollY= 400
moved sprite, +200ms headless loop (frames=23): scrollX= 600 scrollY= 400
after MANUAL cam.preRender(): 1600 1200
```

`startFollow()` centres the camera once, synchronously — which is exactly the trap: the first
assertion *looks* right. Then the target moved 1000×800 world units, twelve more frames ran, and
`scrollX`/`scrollY` did not budge until `cam.preRender()` was called by hand.

---

## 4. Minimum viable way to exercise a ScenePlugin's boot/start/shutdown/destroy

### 4.1 Phaser's own two idioms, verbatim

`tests/TESTING.md:13-35` names them:

> ### Pattern 1: Direct require (no Phaser Game needed)
> For pure functions — math, geometry, color utilities, array helpers, etc. — just require the source
> file directly
>
> ### Pattern 2: Real Phaser Game (for Game Objects, physics, scenes)
> For anything that needs Sprites, Images, physics bodies, Scenes, or other Phaser objects, use the
> test helper which boots a real headless Phaser Game from the `dist/phaser.js` build

**Idiom (b) — hand-built fake.** The closest analogue to our plugin, `tests/plugins/ScenePlugin.test.js:9-30`:

```js
    beforeEach(function ()
    {
        mockEvents = {
            once: vi.fn(),
            emit: vi.fn()
        };

        mockScene = {
            sys: {
                events: mockEvents
            }
        };

        mockPluginManager = {
            game: {
                events: {
                    on: vi.fn(),
                    off: vi.fn()
                }
            }
        };
    });
```

and the assertion that pins the wiring, `tests/plugins/ScenePlugin.test.js:58-65`:

```js
        it('should register a once listener for the BOOT scene event', function ()
        {
            var plugin = new ScenePlugin(mockScene, mockPluginManager, 'testKey');
            expect(mockEvents.once).toHaveBeenCalled();
            var callArgs = mockEvents.once.mock.calls[0];
            expect(callArgs[1]).toBe(plugin.boot);
            expect(callArgs[2]).toBe(plugin);
        });
```

A `{ sys: { events } }` two-property object is genuinely enough to construct a `ScenePlugin` and
assert its constructor contract — because that is all the constructor touches
(`src/plugins/ScenePlugin.js:42-83`: `BasePlugin.call(this, pluginManager)`, `this.scene = scene`,
`this.systems = scene.sys`, `this.pluginKey = pluginKey`, `scene.sys.events.once(SceneEvents.BOOT, this.boot, this)`).

`tests/scene/Systems.test.js:38-45` shows the half-real variant, with the reason spelled out in a
comment:

```js
        sys = new Systems(mockScene, { key: 'test' });

        // Inject mocks since init() requires a full Game instance
        sys.events = mockEvents;
        sys.displayList = mockDisplayList;
        sys.cameras = mockCameras;
        sys.scenePlugin = mockScenePlugin;
```

`tests/plugins/PluginManager.test.js:12-30` builds a fake game for the manager:

```js
    function createMockGame ()
    {
        return {
            isBooted: false,
            config: {
                renderType: 0,
                installGlobalPlugins: [],
                installScenePlugins: [],
                defaultPlugins: [ 'corePlugin' ]
            },
            events: { once: vi.fn(), emit: vi.fn(), on: vi.fn(), off: vi.fn() },
            noReturn: false
        };
    }
```

**Idiom (a) — real headless game.** `tests/helper.js:53-86`:

```js
function createGame (gameConfig)
{
    return new Promise(function (resolve)
    {
        // Clean up any existing game
        if (currentGame)
        {
            try { currentGame.destroy(true); } catch (e) {}
            currentGame = null;
        }

        sceneCounter++;

        var sceneKey = 'test_' + sceneCounter;

        var config = Object.assign({
            type: Phaser.HEADLESS,
            width: 800,
            height: 600,
            parent: 'game',
            banner: false,
            audio: { noAudio: true },
            scene: {
                key: sceneKey,
                create: function ()
                {
                    resolve(this);
                }
            }
        }, gameConfig || {});

        currentGame = new Phaser.Game(config);
    });
}
```

and the call site (`tests/gameobjects/sprite/SpriteFactory.test.js:1-15`):

```js
var helper = require('../../helper');

describe('SpriteFactory', function ()
{
    var scene;

    beforeEach(async function ()
    {
        scene = await helper.createGame();
    });

    afterEach(function ()
    {
        helper.destroyGame();
    });
```

Three details of the helper worth copying and one worth not:

- `require('../dist/phaser.js')` at `tests/helper.js:39`, then `var Phaser = global.Phaser;` at line 41.
  Verified: `require('phaser/dist/phaser.js') === global.Phaser` (UMD sets the global and returns it).
- Resolution on `create`, not on `Game` construction — boot is asynchronous (texture READY gate).
- `parent: 'game'` with no `#game` element in the document: `AddToDOM` silently falls back to
  `document.body` (`src/dom/AddToDOM.js:44-47`). Harmless.
- `try { … } catch (e) {}` around `destroy` (lines 60 and 96). Swallowing teardown errors will hide
  a leak in *our* plugin's destroy path. Do not copy the swallow.

### 4.2 The measured `ScenePlugin` lifecycle under a real HEADLESS game

Registered as `plugins: { scene: [ { key: 'IsoPlugin', plugin: Iso, mapping: 'iso' } ] }`, with a
game holding scenes `A` (autostart) and `B` (inactive):

```
ctor@__SYSTEM
boot@__SYSTEM
ctor@A
boot@A
ctor@B
boot@B
start@A
ready@A
--- after create ---
shutdown@A                 (game.scene.stop('A'))
--- after stop A ---
start@A                    (game.scene.start('A'))
ready@A
--- after restart A ---
destroyEvt@A               (game.scene.remove('A'))
--- after remove A ---
destroyEvt@B
destroyEvt@__SYSTEM
--- after game.destroy ---
```

Five facts fall out, and **four of them contradict the JSDoc**:

**(i) Your plugin is instantiated once per scene — including the internal `__SYSTEM` scene.**

`src/scene/SceneManager.js:187-197`
```js
    bootQueue: function ()
    {
        if (this.isBooted)
        {
            return;
        }

        //  Create the system Scene
        this.systemScene = this.createSceneFromInstance('__SYSTEM', new Scene());
```

Measured: `game.scene.systemScene.iso` is a live plugin instance, and
`game.scene.scenes.indexOf(game.scene.systemScene) === -1` — it is **not** in the public scene list.
So `boot()` runs against a scene our users never see, and iterating `game.scene.scenes` will not find
it. `boot()` must survive a scene with no user content, and any global registration inside `boot()`
must be idempotent.

**(ii) The plugin lands on `sys[mapping]`, not `sys[key]`. The JSDoc says the opposite.**

`src/plugins/PluginManager.js:271-287`
```js
                var source = PluginCache.getCore(pluginKey);

                var mapKey = source.mapping;

                var plugin = new source.plugin(scene, this, mapKey);

                sys[mapKey] = plugin;

                //  Scene level injection
                if (source.custom)
                {
                    scene[mapKey] = plugin;
                }
```

versus `src/plugins/PluginManager.js:335-344`:

```js
     * The `key` property is what the plugin is injected into Scene.Systems as.
     * The `mapping` property is optional, and if specified is what the plugin is installed into
     * the Scene as. For example:
     *
     * ```javascript
     * this.plugins.installScenePlugin('powerupsPlugin', pluginCode, 'powerups');
     *
     * // and from within the scene:
     * this.sys.powerupsPlugin; // key value
     * this.powerups; // mapping value
     * ```
```

Measured, registering `{ key: 'IsoPlugin', mapping: 'iso' }`:

```
sys keys holding plugin: [ 'iso' ]
sys.IsoPlugin = undefined   sys.iso = object   scene.iso = object   scene.IsoPlugin = undefined
```

`this.sys.IsoPlugin` — the exact form the JSDoc documents — is `undefined`. **The documented access
path does not exist.** Both `sys` and `scene` use the mapping.

**(iii) The third constructor argument is the mapping, not the registration key.** Same line 275,
`new source.plugin(scene, this, mapKey)`. So `this.pluginKey` is `'iso'`, not `'IsoPlugin'` — despite
`src/plugins/ScenePlugin.js:71-81` documenting it as *"The key under which this plugin was installed
into the Scene Systems"* and `types/phaser.d.ts:120792` repeating it. If `snapshot()` or any error
message embeds `this.pluginKey`, it embeds the user's mapping string.

(The `addToScene:388` path — used only when `installScenePlugin` is called with an explicit
`addToScene` argument, i.e. from the Loader at `src/loader/filetypes/ScenePluginFile.js:106` — passes
`key` instead and assigns `addToScene.sys[key]`. So the two install routes genuinely disagree with each
other. The game-config route is the one our users will take.)

**(iv) `ScenePlugin#destroy()` is NEVER called. The JSDoc says it is.**

`src/plugins/ScenePlugin.js:126-141`
```js
    /**
     * Destroys this plugin and releases all references it holds, including the Scene, Scene Systems,
     * and Plugin Manager. This method is called automatically when the Scene is destroyed.
…
    destroy: function ()
    {
        this.pluginManager = null;
        this.game = null;
        this.scene = null;
        this.systems = null;
    }
```

Measured across scene `stop`, scene `remove` (a real scene destroy) **and** `game.destroy(true)`: a
`DESTROY-METHOD@…` log line placed inside an overridden `destroy()` never printed once. The `destroy`
*event* fired for all three scenes; the *method* did not.

The code confirms it. `src/scene/Systems.js:800-819` emits and nulls, and never touches installed
plugins:

```js
    destroy: function ()
    {
…
        events.emit(Events.DESTROY, this);

        events.removeAllListeners();

        var props = [ 'scene', 'game', 'anims', 'cache', 'plugins', 'registry', 'sound', 'textures', 'add', 'cameras', 'displayList', 'events', 'make', 'scenePlugin', 'updateList' ];

        for (var i = 0; i < props.length; i++)
        {
            this[props[i]] = null;
        }
```

(Note `sys[mapping]` — where our instance lives — is not in that `props` list.) And
`src/plugins/PluginManager.js:875-880` iterates only the **global** plugin array:

```js
    destroy: function ()
    {
        for (var i = 0; i < this.plugins.length; i++)
        {
            this.plugins[i].plugin.destroy();
        }
```

Scene plugin *keys* live in `this.scenePlugins` (strings), not `this.plugins` (global instances).
Nothing bridges the two.

**Implication for the shell: `IsoPlugin.boot()` must self-wire teardown**, exactly as
`src/plugins/ScenePlugin.js:111-116` suggests in prose:

```js
     * At the very least you should offer a destroy handler for when the Scene closes down, i.e:
     *
     * ```javascript
     * var eventEmitter = this.systems.events;
     * eventEmitter.once('destroy', this.sceneDestroy, this);
     * ```
```

Follow the *prose*, not the `destroy()` method's own doc comment.

**(v) `init()` / `start()` / `stop()` are never called on a Scene Plugin — and here the JSDoc is
honest.** `src/plugins/BasePlugin.js:59`, `:74`, `:103` each say *"On a Scene Plugin, this method is
never called."* Confirmed by probe: an overridden `start()` never fired. Use the `start` **scene
event**, not the `start` method.

**(vi) The instance survives shutdown/restart.** `stop('A')` then `start('A')` produced
`shutdown@A → start@A → ready@A` with **no second `ctor@A`**. Handlers registered in `boot()` persist
across the cycle; re-registering them on `start` would double-fire. Conversely, per-run state must be
reset on `shutdown`.

### 4.3 One HEADLESS-only timing divergence in the plugin system

`src/plugins/PluginManager.js:117-124`
```js
        if (game.isBooted || game.config.renderType === CONST.HEADLESS)
        {
            this.boot();
        }
        else
        {
            game.events.once(GameEvents.BOOT, this.boot, this);
        }
```

Under HEADLESS the PluginManager boots **synchronously inside its own constructor**
(`src/core/Game.js:280`), i.e. *before* `Game.boot()` runs and before `Events.BOOT` is emitted. Under
WEBGL/CANVAS it boots on the `BOOT` event. Plugin *installation* therefore happens at a different
point in the sequence in tests than in production.

Nothing in the observed lifecycle changed as a result (scene-plugin instantiation is driven by
`SceneManager.bootQueue`, which is gated on `GameEvents.READY` at `src/scene/SceneManager.js:176`
either way). But it is a genuine test/production divergence, and it is the one place where a green
HEADLESS test could hide a real ordering bug. If `IsoPlugin` ever does work in a *global* plugin's
`init()`/`start()`, re-verify it in a browser.

### 4.4 Cross-test contamination: two module-level singletons

**`GameObjectFactory.register` mutates a shared prototype and silently no-ops on re-register.**

`src/gameobjects/GameObjectFactory.js:197-203`
```js
GameObjectFactory.register = function (factoryType, factoryFunction)
{
    if (!GameObjectFactory.prototype.hasOwnProperty(factoryType))
    {
        GameObjectFactory.prototype[factoryType] = factoryFunction;
    }
};
```

Measured: a second `register('isoA', …)` with a different function body left the **first** function
in place — no error, no warning, no overwrite. And the registration **survives `game.destroy(true)`**;
a second game in the same process sees it already present.

For the test ring: `scene.add.isoSprite` will be present in test #2 even if test #2's setup never
registered it. A test asserting "the plugin registers the factory" must therefore call
`GameObjectFactory.remove('isoSprite')` first, or it asserts nothing.

**`PluginCache` custom registrations are wiped on game destroy.**

`src/plugins/PluginManager.js:882` — `PluginCache.destroyCustomPlugins();` → `src/plugins/PluginCache.js:195-204`
deletes every key from the module-level `customPlugins` object. Self-healing for the config-driven
route (`installScenePlugin` re-registers when `!PluginCache.hasCore(key)`, `src/plugins/PluginManager.js:369-373`),
so passing `plugins:` in each `createGame()` config works. But any test that registers via
`PluginCache` directly and reuses it across games will find it gone.

**And the trap that combines the two: `dist` and `src` are different singletons.**

Measured:

```
dist GOF === src GOF ? false
after registering on each: dist proto has isoA? true   dist proto has isoB? false
```

`require('phaser/dist/phaser.js').GameObjects.GameObjectFactory` and
`require('phaser/src/gameobjects/GameObjectFactory.js')` are **two distinct constructors with two
distinct prototypes**. If `IsoPlugin` ever registers against a `src/`-imported factory while the game
runs on `dist/`, `scene.add.isoSprite` is `undefined` and nothing throws at registration time. This is
the concrete failure mode behind `tests/TESTING.md:115`. **Our package must have exactly one Phaser
import path, and it must be the bare specifier `phaser`** (which the exports map resolves to `dist/`).

---

## 5. Does Phaser's ESM entry die at module load under Node/jsdom?

### 5.1 `src/phaser-esm.js` is not loadable ESM at all

All 65 lines are of this shape (`src/phaser-esm.js:7-16`):

```js
require('./polyfills/requestVideoFrame');

var CONST = require('./const');

export const Actions = require('./actions');
export const Animations = require('./animations');
export const BlendModes = require('./renderer/BlendModes');
export const Cache = require('./cache');
export const Cameras = require('./cameras');
export const Core = require('./core');
```

`export` statements alongside bare `require()` calls — valid webpack input, not valid ESM for Node.
It is unreachable anyway (`ERR_PACKAGE_PATH_NOT_EXPORTED`, §2.3). The **published** ESM entry is the
bundled `dist/phaser.esm.js`, which is what `exports["."].import` points at.

### 5.2 Both entries throw on `window` under bare Node

Every module in `src/device/` runs its probe **at module evaluation time** — the file ends
`module.exports = init();`, without exception:

```
src/device/OS.js:186              module.exports = init();
src/device/Browser.js:113         module.exports = init();
src/device/Features.js:193        module.exports = init();
src/device/CanvasFeatures.js:112  module.exports = init();
src/device/Audio.js:120           module.exports = init();
src/device/Video.js:155           module.exports = init();
src/device/Fullscreen.js:99       module.exports = init();
src/device/Input.js:74            module.exports = init();
```

and `src/device/index.js:30-41` pulls in all eight:

```js
module.exports = {

    os: require('./OS'),
    browser: require('./Browser'),
    features: require('./Features'),
    input: require('./Input'),
    audio: require('./Audio'),
    video: require('./Video'),
    fullscreen: require('./Fullscreen'),
    canvasFeatures: require('./CanvasFeatures')

};
```

Measured in bare Node v26.5.0 with no DOM, **CJS bundle**:

```
$ node -e "require('.../dist/phaser.js')"
dist/phaser.js:25195
        if (window.cordova !== undefined)
ReferenceError: window is not defined
    at init (dist/phaser.js:25195:9)
```

**ESM bundle**, same result:

```
$ node --input-type=module -e "import('.../dist/phaser.esm.js')…"
ERR: ReferenceError window is not defined
```

and the unbundled source, which pins the exact line:

```
$ node -e "require('.../src/device/OS.js')"
src/device/OS.js:153
        if (window.cordova !== undefined)
ReferenceError: window is not defined
    at init (src/device/OS.js:153:9)
    at Object.<anonymous> (src/device/OS.js:186:18)
```

`src/device/OS.js:146` — `if (navigator.standalone)` — comes *first* and does **not** throw, because
Node ≥21 ships a global `navigator`. So the OS-detection block runs to completion against
`userAgent === 'Node.js/26'` and produces nonsense before dying two lines later on `window`. The first
hard failure is `window`, at `src/device/OS.js:153`.

### 5.3 So there are exactly two module-load blockers

1. **`window` must exist** — jsdom (or any shim with a `window` object) satisfies it.
2. **`getContext('2d')` must return a non-null object with a settable `fillStyle`** — jsdom alone does
   **not** satisfy it (`src/device/CanvasFeatures.js:74`).

Note the ordering: #2 fires under a *plain* `environment: 'jsdom'` config with no setup file. That is
the failure a reader would most likely misdiagnose, because the message
(`Cannot set properties of null (setting 'fillStyle')`) names neither Phaser nor canvas.

**`environment: 'node'` is not an option for anything that imports `phaser`.** Our current
`vitest.config.ts` is `environment: 'node'` with `include: ['packages/*/test/**/*.test.ts']` — correct
for the pure maths core, unusable for the shell.

---

## 6. Recommendation

**Use (a), a real headless Game — but ring-fence it, and vendor a trimmed setup rather than
Phaser's.**

Rationale, in order of weight:

1. **(b) cannot reach the behaviours the shell is made of.** A `{ sys: { events } }` fake proves the
   `ScenePlugin` constructor calls `events.once('boot', …)` and nothing more. It cannot show that
   `sys[mapping]` (not `sys[key]`) receives the instance, that `__SYSTEM` gets an extra instance, that
   `destroy()` is never called, that `scene.add.isoSprite` resolves off a shared prototype, or that a
   diamond `hitAreaCallback` returns the right booleans. Every one of those is a **wiring** fact, and
   wiring is what a thin shell *is*.
2. **The real game costs almost nothing.** Verified: two mocks (~35 lines), a jsdom environment, one
   `async beforeEach`. Boot-to-`create` is a couple of event-loop turns.
3. **Keep (b) for the pure-lifecycle unit tests**, mirroring `tests/plugins/ScenePlugin.test.js` — they
   are faster and they pin the constructor contract precisely. Two rings, not one.

### What the harness must provide

**A second vitest project/config** (the existing `environment: 'node'` root config stays as-is for
`packages/core`):

```js
// vitest.shell.config.ts  — sketch, not verbatim plan code
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['packages/phaser/test/**/*.test.ts'],
        setupFiles: ['./test/setup/phaser-jsdom.ts']
    }
});
```

**The vendored setup file must contain exactly two things** (both verified individually necessary and
jointly sufficient):

1. `HTMLCanvasElement.prototype.getContext` returning a 2D-context stub. Minimum members exercised at
   load: `fillStyle` (settable), `fillRect`, `getImageData` → `{ data: Uint8ClampedArray }`,
   `putImageData`, `drawImage`, `globalCompositeOperation`. Add `measureText` if any Text object is
   ever constructed. Return `null` for `'webgl'` — HEADLESS never asks (`src/core/CreateRenderer.js:40`).
2. An `Image` constructor whose `src` setter fires `onload` on a later tick. Without it the boot
   deadlocks silently at `src/core/Game.js:374`.

**Do NOT vendor** the `self` / `screen` guards (dead under jsdom) or the `console.error` filter
(global, unrestored, swallows our own errors).

**Game config for the test helper:**

```js
{
    type: Phaser.HEADLESS,
    width: 800, height: 600,
    banner: false,
    autoFocus: false,          // replaces setup.js's window.focus stub
    audio: { noAudio: true },
    plugins: { scene: [ { key: 'IsoPlugin', plugin: IsoPlugin, mapping: 'iso' } ] },
    scene: { key: 'test', create () { resolve(this); } }
}
```

Resolve on `create`, not on construction. `afterEach` → `game.destroy(true)` **without** a
`try/catch` swallow.

**Three pump helpers the tests must have**, because HEADLESS does not render:

| Need | Call |
| --- | --- |
| apply depth ordering | `scene.sys.depthSort()` (`src/scene/Systems.js:404`) |
| apply camera follow / scroll | `camera.preRender()` (`src/cameras/2d/CameraManager.js:603`) |
| advance the world one tick | rely on the rAF loop, or `fps: { forceSetTimeOut: true }` when timing is flaky |

**Import discipline:** one and only one Phaser specifier across the whole package — the bare
`'phaser'`. Never a `phaser/src/...` relative path (blocked by exports anyway, and a different
singleton if forced).

**Cross-test hygiene:** `GameObjectFactory.prototype` survives `game.destroy()` and re-registration is
a silent no-op. Any test asserting *that registration happened* must `GameObjectFactory.remove(key)`
first.

---

## 7. Version drift, 4.0.0 → 4.2.1

Checked because the plan pins a version.

```
tests/setup.js            IDENTICAL
tests/helper.js           IDENTICAL
package.json exports/     IDENTICAL   (and neither version has a `files` array)
  main/module/browser/types
tests/*.test.js count     1097 → 1097
vitest.config.js          one change:
    <         setupFiles: ['./tests/setup.js']
    ---
    >         setupFiles: ['./tests/setup.js'],
    >         testTimeout: 10000
```

The harness is stable across the 4.0 → 4.2 range. The only delta is a raised test timeout. Nothing in
this dossier is 4.2.1-specific on the *testing* axis; treat the harness design as valid for any
Phaser 4.x we might support.

---

## 8. Implications for the plugin

**The test ring is feasible. Build it.** Everything the thin shell consists of is observable under
jsdom + HEADLESS. That is the headline, and it is a green light.

**But three of the shell's five components are only half-testable there, and knowing which is the
difference between a suite that guards and a suite that decorates:**

- **The depth key.** `depthSort()` sits behind the render call that HEADLESS deletes. Tests must call
  `scene.sys.depthSort()` explicitly. A suite that sets iso positions, runs frames and asserts display
  order will pass on *insertion* order and prove nothing — precisely the failure mode
  `test-mutation-preflight` exists to catch. **Mutation check to write into the plan: invert the
  comparator in `sortByDepth`; if the depth-ordering test still passes, it never sorted.**
- **The camera-follow proxy.** `startFollow()` centres synchronously, so the *first* assertion after
  wiring looks correct — then never updates again. Every follow test must move the target and call
  `camera.preRender()` before asserting `scrollX`/`scrollY`. **Mutation check: move the target and
  assert scroll *changed*; a test that only asserts the post-`startFollow` value is a mirror.**
- **The diamond hit area.** Fully testable, and the cheapest real win in the ring: `setInteractive`
  stores `hitArea` + `hitAreaCallback` and both are directly callable
  (`thing.input.hitAreaCallback(hitArea, x, y, thing)` returned `true` at the diamond centre and
  `false` at a corner in the probe). No pointer plumbing, no render, no frames. Test the callback as a
  pure predicate over a table of points — inside, outside, and on each of the four edges.

**Four API facts the shell's *code* (not just its tests) depends on, all of which contradict the
docs:**

1. **`sys[mapping]`, never `sys[key]`.** Our README, our `.d.ts` augmentation and any
   `declare module 'phaser'` interface merge must document `scene.iso` / `scene.sys.iso` — the mapping.
   Publishing `this.sys.IsoPlugin` because the Phaser JSDoc says so would ship a broken example.
2. **`this.pluginKey` is the mapping.** Do not put it in `snapshot()` output under a name like
   `pluginKey` expecting `'IsoPlugin'`; it will be whatever the user typed as `mapping`.
3. **`destroy()` is never called.** `IsoPlugin.boot()` must do
   `this.systems.events.once('destroy', this.sceneDestroy, this)` itself. Nothing else will. And since
   `Systems.destroy` does not null `sys[mapping]`, our handler should release its own references or the
   instance graph leaks per destroyed scene. **This is the single most likely source of a real leak in
   the shell, and it is invisible unless a test asserts it.**
4. **`boot()` runs against `__SYSTEM`.** It must tolerate a scene with no user content, and anything
   global it does — notably `GameObjectFactory.register` — must be idempotent. It happens to be
   (`hasOwnProperty` guard), but by luck, not by our design. State that dependency explicitly in the
   plan.

**One structural constraint on the package itself:** exactly one Phaser import specifier, the bare
`'phaser'`. `dist` and `src` are separate singletons with separate `GameObjectFactory` prototypes, and
mixing them produces an `undefined` factory method with no error at registration time — a silent
failure that a test using the *other* path would not catch.

**And one thing we cannot get from this ring at all:** HEADLESS never renders, so nothing here proves
a sprite is *drawn* in the right place, or that the depth order we compute produces the right visual
stacking. That gap is not closable by any subagent — it is a human visual checkpoint, and the plan
should say so rather than imply the jsdom suite covers it.
