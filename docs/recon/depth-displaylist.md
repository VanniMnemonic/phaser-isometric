# Recon — Depth assignment and the display list sort (Phaser 4.2.1)

**Date:** 2026-07-28
**Question area:** depth assignment, `queueDepthSort` / `depthSort`, the comparator, when the
sort runs in the frame, `Layer` availability across the peer range, and whether the comparator
is replaceable.

## 0. Source roots actually used

The brief gave both source roots as the literal string `undefined`. I resolved them by reading
`package.json#version` out of every Phaser checkout on this machine:

| Version | Root |
| --- | --- |
| **4.2.1** (primary) | `/Users/xsec/projects/phaser/platformer/node_modules/phaser` |
| **4.0.0** (drift check) | `/Users/xsec/projects/phaser/first-game/node_modules/phaser` |
| 3.80.1 (ignored) | `/Users/xsec/Documents/Documents - Alessandro's MacBook Pro/Phaser/node_modules/phaser` |

All `path:LINE` references below are **relative to the 4.2.1 root** unless the heading says 4.0.0.
Behaviour statements come from `src/`. `types/phaser.d.ts` is quoted only where the question is
"what does the consumer's compiler see".

**Version drift: none in this area.** These four files are *byte-identical* between 4.0.0 and 4.2.1
(`diff` exit 0):

```
src/gameobjects/components/Depth.js
src/gameobjects/DisplayList.js
src/utils/array/StableSort.js
src/device/Features.js
```

So every claim in sections 1–4 and 6 holds for the whole `^4.0.0` peer range, not just 4.2.1.

### 0.1 Empirical corroboration

Beyond reading, I ran a headless probe (Node 26, minimal DOM shim, requiring
`src/gameobjects/DisplayList.js` and `src/gameobjects/components/Depth.js` directly, no `Game`).
Probe script: `<scratchpad>/probe.cjs`. Output, verbatim:

```
sortByDepth on prototype? true
depthSort on prototype?  true
after 3 setDepth calls, sortChildrenFlag = true  compares so far = 0
after ONE depthSort: order = b:1,c:3,a:5  flag = false  comparator invocations = 3
second depthSort with flag false: comparator invocations = 3 (unchanged => no second sort)
setDepth returns this? true
all-equal depths keep insertion order? true
instance-level sortByDepth override honoured? true
setDepth on GO with displayList=null queues a sort? false (false => no sort queued anywhere)
[native path] array identity preserved? true
[native path] evens then odds, each in insertion order? true
[native path] result = n0,n2,n4,n6,n8,n10,n12,n14,n16,n18,n1,n3,n5,n7,n9,n11,n13,n15,n17,n19
```

One trap worth recording, because it cost me a wrong first result: `Depth.depth` is a **plain
object literal** `{ get, set }` on the mixin, not an accessor property of the mixin object. Wiring
it with `Object.defineProperty(o, 'depth', Object.getOwnPropertyDescriptor(Depth, 'depth'))`
produces a *data* property whose value is that literal, so `o.depth = 5` silently overwrites the
descriptor and `_depth` never changes. Phaser's own `Class` util handles exactly this at
`src/utils/Class.js:21-24` by unwrapping `def.value` before calling `defineProperty`. Any hand-rolled
mixin application in our plugin must do the same unwrap.

---

## 1. `src/gameobjects/components/Depth.js` — the getter, the setter, `setDepth`

### 1.1 The backing field

`src/gameobjects/components/Depth.js:28`

```js
    _depth: 0,
```

It is a **prototype data property**, not an instance field. It is documented `@private` and it is
**absent from `types/phaser.d.ts`** (`grep -n "_depth" types/phaser.d.ts` → no hits). This matters:
the comparator reads `_depth`, so any TypeScript code that wants to read or write it must cast.

### 1.2 The accessor

`src/gameobjects/components/Depth.js:45-62`

```js
    depth: {

        get: function ()
        {
            return this._depth;
        },

        set: function (value)
        {
            if (this.displayList)
            {
                this.displayList.queueDepthSort();
            }

            this._depth = value;
        }

    },
```

Four facts about the setter, all load-bearing:

1. **It writes exactly one thing: `this._depth = value`.** No coercion, no `Number()`, no
   `isFinite` guard, no clamp. `setDepth(NaN)` stores `NaN`; the comparator then returns `NaN` and
   the sort order becomes implementation-defined. `setDepth('5')` stores the *string* `'5'`, and
   `'5' - 3` still works by JS coercion, so the bug is silent until two strings meet.
2. **It calls exactly one thing: `this.displayList.queueDepthSort()`** — and only when
   `this.displayList` is truthy. This is `displayList`, the raw property, **not** the
   `getDisplayList()` accessor used a few lines below by `setToTop` (`Depth.js:104`). A Game Object
   whose `displayList` is `null` gets its `_depth` written with **no sort queued anywhere**
   (probe: `setDepth on GO with displayList=null queues a sort? false`). See §7.3 for when that
   happens in practice — it is the Container trap.
3. **The `queueDepthSort()` call happens BEFORE the write.** Harmless in the normal frame (the sort
   runs much later, at render), but it means the flag is raised on the *old* value's behalf. It also
   means a re-entrant comparator that mutated depth would see a stale value.
4. **There is no equality short-circuit.** `sprite.depth = sprite.depth` re-queues the sort. For an
   iso plugin that recomputes depth for N sprites every frame this is N redundant boolean writes
   plus a guaranteed full re-sort each frame — the boolean writes are free, the sort is not.

### 1.3 `setDepth`

`src/gameobjects/components/Depth.js:81-88`

```js
    setDepth: function (value)
    {
        if (value === undefined) { value = 0; }

        this.depth = value;

        return this;
    },
```

**Yes, `setDepth` returns `this`** — verified by reading (line 87) and by probe
(`setDepth returns this? true`). It is a pure pass-through to the `depth` setter, so every property
of the setter above applies verbatim to `setDepth`; there is no extra validation on this path
either. The only thing it adds is the `undefined → 0` default.

The declaration agrees: `types/phaser.d.ts:13572`

```ts
            setDepth(value: number): this;
```

`Depth` is mixed into `Sprite` (`src/gameobjects/sprite/Sprite.js`, `Mixins: [ … Components.Depth, … ]`),
so an `IsoSprite extends Phaser.GameObjects.Sprite` inherits all of this unchanged.

---

## 2. `queueDepthSort` / `depthSort` — N `setDepth` calls, exactly ONE sort

### 2.1 The flag

`src/gameobjects/DisplayList.js:47`

```js
        this.sortChildrenFlag = false;
```

That is the whole mechanism. It is a single boolean on the DisplayList instance, public in the
declarations (`types/phaser.d.ts:23013` → `sortChildrenFlag: boolean;`).

### 2.2 The setter

`src/gameobjects/DisplayList.js:174-177`

```js
    queueDepthSort: function ()
    {
        this.sortChildrenFlag = true;
    },
```

Idempotent by construction. Calling it a thousand times in a frame is a thousand writes of `true`
to the same boolean — no queue, no array, no allocation, no event.

### 2.3 The consumer

`src/gameobjects/DisplayList.js:185-193`

```js
    depthSort: function ()
    {
        if (this.sortChildrenFlag)
        {
            StableSort(this.list, this.sortByDepth);

            this.sortChildrenFlag = false;
        }
    },
```

### 2.4 Why N calls ⇒ one sort

The proof is the shape of the code, not a heuristic:

- Every mutation path raises the *same* boolean. `Depth.js:56` (the setter),
  `DisplayList.js:122` (`addChildCallback`), `DisplayList.js:145` (`removeChildCallback`),
  `GameObject.js:286` (constructor — `scene.sys.queueDepthSort()`), `GameObject.js:857`
  (`addToDisplayList`), `GameObject.js:918` (`removeFromDisplayList`), and
  `Systems.js:393-396` (`Systems#queueDepthSort` → `this.displayList.queueDepthSort()`).
- `depthSort()` is the **only** reader, and it clears the flag inside the same `if` block that
  performed the sort (`DisplayList.js:189` then `:191`).
- Therefore, between two `depthSort()` calls, the number of sorts is `min(1, number of queue calls)`.

Probe confirmation: three `setDepth` calls produced `sortChildrenFlag = true` and **zero**
comparator invocations; a single `depthSort()` then produced 3 comparator invocations and cleared
the flag; an immediately following `depthSort()` produced **zero** further invocations.

### 2.5 The one caveat to "exactly one sort per frame"

The guarantee is really *"at most one sort per raise-of-the-flag cycle"*, and one non-render code
path can consume a cycle early:

`src/input/InputPlugin.js:2903-2913`

```js
    sortDropZones: function (gameObjects)
    {
        if (gameObjects.length < 2)
        {
            return gameObjects;
        }

        this.scene.sys.depthSort();
```

`Systems#depthSort` (`src/scene/Systems.js:404-407`) forwards straight to
`this.displayList.depthSort()`. So in a scene with **two or more drop zones**, input processing —
which runs during update, before render — can perform the frame's sort early. Anything that sets
depth *after* that point re-raises the flag and gets a second sort at render. Net effect for a
plugin that writes depth in `POST_UPDATE`: still exactly one *effective* sort, but it is possible
to observe two sorts in one frame. Nothing else in `src/` calls `depthSort()` on the scene display
list.

---

## 3. The comparator, and whether the sort is stable

### 3.1 The comparator — confirmed verbatim

`src/gameobjects/DisplayList.js:206-209`

```js
    sortByDepth: function (childA, childB)
    {
        return childA._depth - childB._depth;
    },
```

**Confirmed: it is exactly `a._depth - b._depth`.** No epsilon, no secondary key, no tie-breaker,
no `y` fallback, no id. Ascending, so lower `_depth` ends up earlier in `this.list` and therefore
renders first (further back).

`Layer` carries an identical copy: `src/gameobjects/layer/Layer.js:317-320` →
`return childA._depth - childB._depth;`.

In the entire 4.2.1 `src/` tree there are only **three** readers of `_depth`:

```
src/gameobjects/DisplayList.js:208:        return childA._depth - childB._depth;
src/gameobjects/layer/Layer.js:319:        return childA._depth - childB._depth;
src/gameobjects/domelement/DOMElementCSSRenderer.js:102:        style.zIndex = src._depth;
```

That third one is the only non-sorting consumer: DOM Elements mirror `_depth` into CSS `z-index`.

### 3.2 Ties fall back to insertion order — but only because the sort is stable

`depthSort` does not add a tie-breaker, so tie behaviour is entirely a property of `StableSort`.

`src/utils/array/StableSort.js:157-181`

```js
var StableSort = function (array, compare)
{
    if (compare === undefined) { compare = Compare; }

    //  Short-circuit when there's nothing to sort.
    if (!array || array.length < 2)
    {
        return array;
    }

    if (Device.features.stableSort)
    {
        return array.sort(compare);
    }

    var result = Process(array, compare);

    // This simply copies back if the result isn't in the original array, which happens on an odd number of passes.
    if (result !== array)
    {
        RunPass(result, null, array.length, array);
    }

    return array;
};
```

**There are two sort implementations, selected at runtime**, and both are stable:

**Path A — `Device.features.stableSort` truthy → native `array.sort(compare)`.**
ES2019 mandates `Array.prototype.sort` be stable, which is precisely the condition Phaser tests for
(see §3.3). Stable by spec.

**Path B — falsy → Phaser's own bottom-up merge sort** (`Process` at `StableSort.js:35-62`,
`RunPass` at `:74-140`). Stability is guaranteed by the merge tie rule at `StableSort.js:115`:

```js
                if (comp(arr[li], arr[ri]) <= 0)
                {
                    result[i++] = arr[li++];
                }
```

`<= 0` takes the **left** (earlier) element on a tie, which is exactly the stability condition for
merge sort. This is the *only* line that decides tie order in the entire mechanism.

Both paths mutate the caller's array **in place and preserve its identity**: path A because
`Array#sort` sorts in place; path B because when `Process` returns the ping-pong buffer instead of
the original, `RunPass(result, null, array.length, array)` copies it back (`StableSort.js:174-178`)
— note `comp` is `null` there, and with `chk === array.length` the merge loop never compares, it
only flushes. This matters: `DisplayList.depthSort` **discards** `StableSort`'s return value
(`DisplayList.js:189`), so if either path returned a new array the sort would silently do nothing.
Probe confirmed `dl.list === before` on the native path.

Probe confirmations: 12 objects all at depth 0 kept insertion order (merge path); 20 objects
alternating depth 0/1 with `Device.features.stableSort` forced to `1` produced
`n0,n2,…,n18,n1,n3,…,n19` — evens then odds, each group in insertion order (native path).

### 3.3 How `Device.features.stableSort` is set — the surprising part

`src/device/Features.js:44` declares it:

```js
    stableSort: false,
```

and `init()` (`src/device/Features.js:81-191`) **never assigns it**. Reading `Features.js` alone,
the reasonable conclusion is "always false, always the merge sort". That conclusion is wrong. The
assignment lives in the **game config**:

`src/core/Config.js:193-202`

```js
        /**
         * @const {(number|boolean)} Phaser.Core.Config#stableSort - `false` or `0` = Use the built-in StableSort (needed for older browsers), `true` or `1` = Rely on ES2019 Array.sort being stable (modern browsers only), or `-1` = Try and determine this automatically based on browser inspection (not guaranteed to work, errs on side of caution).
         */
        this.stableSort = GetValue(config, 'stableSort', -1);

        if (this.stableSort === -1)
        {
            this.stableSort = (Device.browser.es2019) ? 1 : 0;
        }

        Device.features.stableSort = this.stableSort;
```

`Device.browser.es2019` is UA-sniffed in `src/device/Browser.js` — e.g. `:72`
`Browser.es2019 = (Browser.chromeVersion > 69);`, `:78` for Firefox > 10, `:94` for Safari > 10,
and unconditionally `true` for Edge/Opera/mobile Safari (`:60`, `:65`, `:83`).

Consequences for us:

- **`stableSort` is a real, public, documented `GameConfig` field a consumer can set.** It changes
  which sort implementation runs under our plugin. It does **not** change the comparator or the
  tie semantics — both paths are stable — so it cannot break isometric ordering. But it is a knob
  a user can flip, so any benchmark we publish must state which value was in effect.
- **In a headless/Node context with no `Game` constructed, `Device.features.stableSort` stays
  `false`** and the merge sort runs. Confirmed by probe. Relevant if our MCP oracle or a Node test
  ever exercises a real DisplayList.

---

## 4. When in the frame does the sort run

The trace, top to bottom, all in 4.2.1:

**Step 1 — `Game.step`** (`src/core/Game.js:454-502`), driven by RAF via `TimeStep`:

```js
        eventEmitter.emit(Events.PRE_STEP, time, delta);
        eventEmitter.emit(Events.STEP, time, delta);

        //  Update the Scene Manager and all active Scenes

        this.scene.update(time, delta);

        //  Our final event before rendering starts

        eventEmitter.emit(Events.POST_STEP, time, delta);

        var renderer = this.renderer;

        renderer.preRender();

        eventEmitter.emit(Events.PRE_RENDER, renderer, time, delta);

        //  The main render loop. Iterates all Scenes and all Cameras in those scenes, rendering to the renderer instance.

        this.scene.render(renderer);
```

**Step 2 — per-scene update** (`src/scene/Systems.js:350-361`):

```js
    step: function (time, delta)
    {
        var events = this.events;

        events.emit(Events.PRE_UPDATE, time, delta);

        events.emit(Events.UPDATE, time, delta);

        this.sceneUpdate.call(this.scene, time, delta);

        events.emit(Events.POST_UPDATE, time, delta);
    },
```

No sorting happens anywhere in this block.

**Step 3 — `SceneManager.render`** (`src/scene/SceneManager.js:589+`) loops scenes forward and calls
`sys.render(renderer)` for each visible scene.

**Step 4 — the sort** (`src/scene/Systems.js:374-385`):

```js
    render: function (renderer)
    {
        var displayList = this.displayList;

        displayList.depthSort();

        this.events.emit(Events.PRE_RENDER, renderer);

        this.cameras.render(renderer, displayList);

        this.events.emit(Events.RENDER, renderer);
    },
```

**`displayList.depthSort()` is the first statement of `Systems#render`.** It runs:

- **after** all of `PRE_UPDATE` / `UPDATE` / `Scene.update` / `POST_UPDATE` for every scene,
- **after** `Game.POST_STEP` and `renderer.preRender()`,
- **before** the scene's `PRE_RENDER` event,
- **before** per-camera culling and before any Game Object renders,
- **once per scene per frame**, regardless of how many cameras that scene has (the camera loop is
  inside `cameras.render`, downstream of the sort).

**Step 5 — culling, post-sort** (`src/cameras/2d/CameraManager.js:592-609`):

```js
    render: function (renderer, displayList)
    {
        var scene = this.scene;
        var cameras = this.cameras;

        for (var i = 0; i < cameras.length; i++)
        {
            var camera = cameras[i];

            if (camera.visible && camera.alpha > 0)
            {
                camera.preRender();

                var visibleChildren = this.getVisibleChildren(displayList.getChildren(), camera);

                renderer.render(scene, visibleChildren, camera);
            }
        }
    },
```

with `src/cameras/2d/CameraManager.js:625-630`:

```js
    getVisibleChildren: function (children, camera)
    {
        return children.filter(function (child)
        {
            return child.willRender(camera);
        });
    },
```

`getChildren()` returns `this.list` by reference (`DisplayList.js:220-223`), and `filter` preserves
order, so **the render order is exactly the sorted display-list order, minus culled objects**.

**The documented seam.** `src/scene/events/PRE_RENDER_EVENT.js:25` states it outright:

```
 * This event is dispatched after the Scene Display List is sorted and before the Scene is rendered.
```

This is the single most useful sentence in the whole area for us — see §6.3.

### 4.1 Input reads a *different*, one-frame-stale ordering

Worth flagging because it touches the diamond hit area. Input hit-test ordering does **not** read
`_depth`; it reads the camera's `renderList`:

`src/input/InputPlugin.js:2874-2889`

```js
    sortGameObjects: function (gameObjects, pointer)
    {
        if (gameObjects.length < 2 || !pointer.camera)
        {
            return gameObjects;
        }

        var list = pointer.camera.renderList;

        return gameObjects.sort(function (childA, childB)
        {
            var indexA = Math.max(list.indexOf(childA), 0);
            var indexB = Math.max(list.indexOf(childB), 0);

            return indexB - indexA;
        });
    },
```

`renderList` is cleared in `Camera#preRender` (`src/cameras/2d/Camera.js:522-524`,
`this.renderList.length = 0;`) and repopulated during rendering — Sprites and Images do this
themselves at `src/gameobjects/sprite/SpriteWebGLRenderer.js:23`
(`drawingContext.camera.addToRenderList(src);`), `SpriteCanvasRenderer.js:23`,
`ImageWebGLRenderer.js:23`, `ImageCanvasRenderer.js:23`.

Because input runs during update and rendering runs after, **the list input sorts against is the
previous frame's render list**. Two consequences for us: (a) a sprite that has never rendered yet
is not in the list, `indexOf` returns `-1`, `Math.max(-1, 0)` makes it `0`, and it compares equal
to every other unrendered object — so ordering degenerates to whatever order the hit test produced;
(b) a sprite whose depth changed this frame is picked using last frame's order. For static iso
scenes this is invisible; for a fast-moving entity crossing a tile boundary it is a one-frame
mis-pick. This is Phaser's behaviour, not something a plugin can fix from outside, but it belongs
in our docs and it must be the *expected* outcome written down before the browser gate, not a
surprise discovered during it.

---

## 5. `Phaser.GameObjects.Layer` across the peer range

### 5.1 It exists in 4.2.1

`src/gameobjects/layer/` contains `Layer.js`, `LayerCanvasRenderer.js`, `LayerCreator.js`,
`LayerFactory.js`, `LayerRender.js`, `LayerWebGLRenderer.js`, and it is exported and registered:

```
src/gameobjects/index.js:36 :     Layer: require('./layer/Layer'),
src/gameobjects/index.js:80 :         Layer: require('./layer/LayerFactory'),
src/gameobjects/index.js:114:         Layer: require('./layer/LayerCreator'),
```

### 5.2 **It also exists in 4.0.0 — this refutes our stated assumption**

Same directory, same six files, same three index entries, at the *identical* line numbers:

```
first-game/node_modules/phaser/src/gameobjects/index.js:36 :     Layer: require('./layer/Layer'),
first-game/node_modules/phaser/src/gameobjects/index.js:80 :         Layer: require('./layer/LayerFactory'),
first-game/node_modules/phaser/src/gameobjects/index.js:114:         Layer: require('./layer/LayerCreator'),
```

and the factory is registered, so `this.add.layer()` works in 4.0.0:

```
first-game/node_modules/phaser/src/gameobjects/layer/LayerFactory.js:22:
GameObjectFactory.register('layer', function (children)
```

`Layer` is `@since 3.50.0` (`first-game/…/layer/Layer.js:63`). It has existed since Phaser 3.50.

`.claude/plan.md` currently records: *"Peer `^4.0.0` vale SOLO perché abbiamo escluso `Layer`
(4.1.0+)"*. **`Layer` is not 4.1.0+. It is 3.50.0+ and present in 4.0.0.** The premise as written
is false.

### 5.3 What actually changed in 4.1.0 — the real constraint

The source says it in a comment, and the changelog says it in a bullet.

`src/gameobjects/layer/Layer.js:61-65` (4.2.1):

```js
 * Until Phaser version 4.1.0, Layer was not a true GameObject.
 * It is now a true GameObject.
 *
 * @class Layer
 * @extends Phaser.GameObjects.GameObject
```

`changelog/v4/4.1/CHANGELOG-v4.1.0.md:8`:

```
- `Layer` is now a true `GameObject`. This fixes numerous small inconsistencies, and some big issues such as Filters not working. Thanks @rexrainbow for reporting the initial issue!
```

Confirmed structurally by diffing the two `Layer.js` files. In 4.0.0 the class doc is
`@extends Phaser.Structs.List.<Phaser.GameObjects.GameObject>` (`first-game/…/Layer.js:60`) and it
hand-rolls GameObject members — `this.displayList = null`, `this.type = 'Layer'`, a `DataManager`,
`ComponentsToJSON` — plus it mixes in `Components.Filters` and `Components.RenderSteps` with the
explicit comment *"This does not extend GameObject so it must mixin RenderSteps here."* In 4.2.1
those hand-rolled members are gone, `GameObject` is in the `Mixins` array, and the constructor now
calls `GameObject.call(this, scene, 'Layer');` (`src/gameobjects/layer/Layer.js:100`). Both versions
still literally say `Extends: List` (4.0.0 `:78`, 4.2.1 `:81`) — the prototype chain root did not
change; the GameObject-ness was added as a mixin.

**Restated constraint for the plan:** `^4.0.0` is safe *not* because `Layer` is absent from 4.0.0,
but because we do not depend on `Layer` **being a GameObject** — i.e. we never nest a Layer inside
another GameObject, never apply Filters to one, and never rely on `Layer` responding to the
GameObject API. If any of those enter the design, the floor must rise to `^4.1.0`.

### 5.4 `Layer` does honour depth — unlike `Container`

`Layer` is a second, independent display list with its own copy of the whole mechanism:
`sortChildrenFlag` (`Layer.js:142`), `queueDepthSort` (`:285-288`), `depthSort` (`:296-303`),
`sortByDepth` (`:317-320`), and `addChildCallback` sets `gameObject.displayList = this` (`:249`) so
the `Depth` setter's `if (this.displayList)` guard passes. Its sort is triggered from its own
renderer, not from `Systems#render`:

`src/gameobjects/layer/LayerWebGLRenderer.js:39` (and `LayerCanvasRenderer.js:29`)

```js
    layer.depthSort();
```

so it happens per-Layer, at that Layer's turn in the render walk.

---

## 6. Is there any public hook to replace the comparator?

Short answer: **no injectable comparator hook, no event, no config field.** Three things exist that
are adjacent, and one of them is genuinely usable. I searched for all of them explicitly.

### 6.1 What does not exist — negative evidence

- **No config field.** `grep -niE "sort" src/core/Config.js` yields exactly one match group: the
  `stableSort` block at `:193-202` quoted in §3.3. That selects the sort *algorithm*, never the
  comparator. There is no `depthSortCallback`, no `sortComparator`, nothing else.
- **No event.** `grep -rn "sortChildrenFlag\|sortByDepth\|depthSort" src/scene/events/ src/gameobjects/events/`
  returns nothing. `DisplayList` emits exactly two events, both about membership:
  `ADDED_TO_SCENE` (`DisplayList.js:126-128`) and `REMOVED_FROM_SCENE` (`:149-151`). Nothing is
  emitted before, during, or after the sort. The `depthSort` body (`:185-193`) is five lines and
  contains no `emit`.
- **No callback slot.** `DisplayList` has no analogue of `ParticleEmitter#sortCallback`
  (`src/gameobjects/particles/ParticleEmitter.js:891`, `:2525`, `:2556`), which *is* a real,
  settable comparator slot — for particles only. The display list has nothing equivalent. That the
  engine ships this pattern one directory away and did not apply it to `DisplayList` is the
  strongest evidence the omission is deliberate.
- **`Container` does not sort by depth at all.** `grep -n "depthSort\|sortByDepth" src/gameobjects/container/Container.js`
  → no hits. Its only sort is manual and opt-in: `Container#sort(property, handler)` at
  `src/gameobjects/container/Container.js:638-656`, which calls `ArrayUtils.StableSort(this.list, handler)`
  and is never invoked by the engine.

### 6.2 The undocumented-but-real monkeypatch

`depthSort` dereferences the comparator **through `this` at call time**:

`src/gameobjects/DisplayList.js:189`

```js
            StableSort(this.list, this.sortByDepth);
```

and `sortByDepth` lives on the **prototype**, because `Phaser.Class` installs non-accessor members
with `ctor.prototype[k] = definition[k]` (`src/utils/Class.js:116`). Probe:
`sortByDepth on prototype? true`.

Therefore assigning an own property on the instance shadows it and takes effect from the very next
sort:

```js
scene.sys.displayList.sortByDepth = (a, b) => /* your comparator */;
```

Probe: `instance-level sortByDepth override honoured? true` (a reversed comparator produced
reversed output). It is also type-legal: `sortByDepth` is declared as a public method in
`types/phaser.d.ts:23046`

```ts
            sortByDepth(childA: Phaser.GameObjects.GameObject, childB: Phaser.GameObjects.GameObject): number;
```

so TypeScript permits the assignment without a cast. (Reading `_depth` inside your replacement
*does* need a cast — `_depth` is not in the `.d.ts`; see §1.1.)

Caveats before anyone reaches for this: it is not documented as an extension point anywhere; the
comparator is passed as a bare function reference so `this` is `undefined` inside it (the stock one
never uses `this`, and yours must not either); the identical shadowing works on `Layer`
(`Layer.js:300`) but is a *separate* object; and a comparator that is not a consistent strict weak
ordering will produce garbage on the merge path just as it would on the native path.

### 6.3 The supported alternative — `PRE_RENDER`

The engine gives us a documented seam that does the same job without touching a private method.
`Systems#render` sorts, then immediately emits `PRE_RENDER`, then renders
(`src/scene/Systems.js:376-384`), and the event's own documentation is explicit
(`src/scene/events/PRE_RENDER_EVENT.js:25`):

```
 * This event is dispatched after the Scene Display List is sorted and before the Scene is rendered.
```

So `scene.events.on('prerender', …)` is the officially-documented point at which you can reorder
`displayList.list` in place and have that order honoured for the frame — the depth sort has already
run, and per-camera culling (`CameraManager.render` → `getVisibleChildren`, order-preserving
`filter`) has not.

**Definitive answer to Q6:** there is no injectable comparator, no event fired by the sort, and no
config field that changes ordering semantics. If a consumer must impose a custom order, the two
options are (a) shadow `displayList.sortByDepth` — works, type-legal, undocumented, and identical
in 4.0.0 and 4.2.1 since the file is byte-identical; or (b) reorder `displayList.list` on the
documented `PRE_RENDER` event.

---

## 7. Implications for the plugin

### 7.1 The thin shell writes one number and gets the sort for free

The whole Phaser-side depth story reduces to: **the pure core computes a depth key, the shell
assigns it to `sprite.depth`, and Phaser sorts once at render.** There is no ordering machinery for
us to build, own, or schedule. Our `IsoSprite` should do nothing more than write `this.depth = key`
whenever its iso position changes.

Correspondingly, **we should not offer a "sort now" API**. `scene.sys.depthSort()` exists
(`Systems.js:404-407`) but calling it early only wastes a sort — the one at `Systems.js:378` is
mandatory and unconditional, and any depth we set afterwards re-raises the flag anyway.

### 7.2 Where to write depth in the frame

Anywhere in update is correct; the sort is downstream of all of it (§4). The natural home is a
`POST_UPDATE` listener on the scene, after user code and after physics have moved things — that
guarantees the depth we write is based on final positions for the frame, and it still lands well
before `Systems#render`. Writing depth in `PRE_RENDER` would also work (the flag would be raised
after the sort, so it would take effect one frame late) — **do not do that**; it is the one placement
that silently costs a frame of latency.

### 7.3 The Container trap — the single biggest ordering hazard for an iso scene

Two facts compose into a silent failure:

1. `Container#addHandler` calls `gameObject.removeFromDisplayList()`
   (`src/gameobjects/container/Container.js:444`, inside `if (this.exclusive)`, and
   `this.exclusive = true` by default at `:134`), which sets `this.displayList = null`
   (`GameObject.js:920`).
2. The `Depth` setter only queues a sort `if (this.displayList)` (`Depth.js:54`).

So for a Game Object inside a Container: `setDepth` still writes `_depth`, **no sort is queued
anywhere**, and even if one were, `Container` never depth-sorts its children (§6.1). Container
children render in **insertion order, permanently**. An isometric scene assembled inside a
Container is silently unsorted, and `sprite.depth` reads back the value you wrote — so the property
lies about the outcome and there is no error, no warning, and no visual clue until sprites overlap.

Actions for the plugin:

- **Document "do not put IsoSprites in a Container" as a hard rule**, with the reason.
- Consider a cheap dev-time guard in `IsoSprite` (behind the `/debug` subpath, so it costs nothing
  in production): if `this.parentContainer` is set, warn once.
- **`Layer` is the correct container-like primitive** — it has the full sort mechanism (§5.4) and
  its children keep `displayList` pointing at the Layer. If we ever recommend grouping, recommend
  `Layer`, not `Container`. But see §7.6 for the peer-range condition attached to that.

### 7.4 Validate the depth key at the boundary — the setter will not

`Depth.js:52-60` writes whatever it is given. `NaN` propagates into `childA._depth - childB._depth`
and yields `NaN`, which makes the ordering meaningless on both sort paths. This is the same defect
class the plan already flagged for the core (*"Validare alla costruzione ovunque. Cinque difetti
del piano erano tutti della stessa classe: validazione mancante → risposta sbagliata in silenzio"*)
and it applies verbatim here: our depth-key function must be proven to return a finite number, and
`IsoSprite` should validate at the boundary rather than trust Phaser to complain. Phaser never
complains.

### 7.5 Ties are safe, and that is a design lever

`a._depth - b._depth` with a guaranteed-stable sort (§3.2, both paths) means **equal depth keys
resolve to display-list insertion order, deterministically, on every browser and in Node.** Two
things follow:

- Our depth-key function does **not** need to be injective. Deliberate ties are a legitimate way to
  say "these two are on the same cell, draw them in creation order". We should say so in the docs
  and pin it with a test, because it is the kind of guarantee that looks accidental.
- The snapshot / oracle can reproduce Phaser's render order exactly, in Node, with a plain stable
  sort on the key — no Phaser needed. That is precisely the property the "pure core + thin shell"
  architecture was chosen for, and this area confirms it holds.

Both facts are stable across the whole peer range: `DisplayList.js` and `StableSort.js` are
byte-identical in 4.0.0 and 4.2.1 (§0).

### 7.6 What to change in `.claude/plan.md`

The line *"Peer `^4.0.0` vale SOLO perché abbiamo escluso `Layer` (4.1.0+)"* is factually wrong and
should be rewritten before the Piano 2 is drafted, because it is currently *understating* what we
can use. `Layer` — the class, the factory registration `this.add.layer()`, and its complete
depth-sort mechanism — is available in 4.0.0. The real 4.1.0 boundary is `Layer` **being a
GameObject** (Filters on a Layer, nesting a Layer inside another GameObject, the GameObject API on
a Layer instance). If Piano 2 wants to recommend `Layer` purely as a depth-sorted grouping
primitive, `^4.0.0` still holds. The custom-RenderNode half of that constraint (`^4.2.0`) was not
examined here and is untouched by this recon.

### 7.7 Cost model for the 500-entity benchmark

One `StableSort` over the whole scene display list, once per scene per frame, unconditionally
whenever any depth changed — `O(n log n)` on `n` = *every* object in the scene, not just our
IsoSprites. There is no partial sort, no dirty-range optimisation, no early-out beyond the
`length < 2` short-circuit (`StableSort.js:162`). Two consequences for the benchmark we owe the
browser gate: it must record which `stableSort` config value was in effect (§3.3, the two paths are
different code), and the honest baseline is "scene display list size", not "IsoSprite count" — a
plugin user who adds 2000 unrelated tiles to the same scene pays for them on every one of our depth
updates.

---

## Appendix — every file:line cited, for re-verification

```
src/gameobjects/components/Depth.js:28,45-62,52-60,81-88,104
src/gameobjects/DisplayList.js:47,122,145,174-177,185-193,189,206-209,220-223
src/gameobjects/GameObject.js:286,857,918,920
src/gameobjects/layer/Layer.js:61-65,81,100,142,249,285-288,296-303,300,317-320
src/gameobjects/layer/LayerWebGLRenderer.js:39
src/gameobjects/layer/LayerCanvasRenderer.js:29
src/gameobjects/container/Container.js:134,431-449,444,638-656
src/gameobjects/index.js:36,80,114
src/gameobjects/sprite/SpriteWebGLRenderer.js:23
src/gameobjects/sprite/SpriteCanvasRenderer.js:23
src/gameobjects/image/ImageWebGLRenderer.js:23
src/gameobjects/image/ImageCanvasRenderer.js:23
src/gameobjects/domelement/DOMElementCSSRenderer.js:102
src/gameobjects/particles/ParticleEmitter.js:891,2525,2556
src/utils/array/StableSort.js:35-62,74-140,115,157-181,162,167,174-178
src/utils/Class.js:14-27,21-24,112,116
src/device/Features.js:44,81-191
src/device/Browser.js:60,65,72,78,83,94
src/core/Config.js:193-202
src/core/Game.js:454-502
src/scene/Systems.js:350-361,374-385,393-396,404-407
src/scene/SceneManager.js:589
src/scene/events/PRE_RENDER_EVENT.js:25
src/cameras/2d/Camera.js:522-524
src/cameras/2d/BaseCamera.js:535,590-592
src/cameras/2d/CameraManager.js:592-609,625-630
src/input/InputPlugin.js:2874-2889,2903-2913,2910
types/phaser.d.ts:13572,23013,23033,23038,23046
changelog/v4/4.1/CHANGELOG-v4.1.0.md:8
4.0.0: src/gameobjects/index.js:36,80,114
4.0.0: src/gameobjects/layer/Layer.js:59,60,63,78
4.0.0: src/gameobjects/layer/LayerFactory.js:22
```
