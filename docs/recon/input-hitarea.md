# Recon — custom hit areas and how Phaser 4 input picks the top object

**Target:** Phaser **4.2.1**, real source.
**Source root used (`$P`):** `/Users/xsec/projects/phaser/platformer/node_modules/phaser`
**Drift-check root (4.0.0):** `/Users/xsec/projects/phaser/first-game/node_modules/phaser`

> **Note on the requested output path.** The brief said to write to `undefined/input-hitarea.md`
> and gave both source roots as the literal string `undefined` — the orchestrator's template
> variables were not interpolated. I located the two Phaser checkouts by searching the machine
> (`find /Users/xsec -name InputPlugin.js`) and verified their versions from `package.json`
> (`"version": "4.2.1"` and `"4.0.0"`). This dossier is written to
> `/Users/xsec/projects/phaser/plugins/isometric-view/docs/recon/input-hitarea.md`.

All line references below are `path/to/file.js:LINE` **relative to `$P`**.

**Version drift (4.0.0 vs 4.2.1) — checked, and the answer is "none that matters".**
`diff` of every file this dossier depends on:

| File | 4.0.0 vs 4.2.1 |
| --- | --- |
| `src/input/InputPlugin.js` | byte-identical |
| `src/input/InputManager.js` | byte-identical |
| `src/input/CreateInteractiveObject.js` | byte-identical |
| `src/gameobjects/GameObject.js` | byte-identical |
| `src/geom/polygon/Polygon.js` | byte-identical |
| `src/geom/polygon/Contains.js` | byte-identical |
| `src/cameras/2d/Camera.js` | byte-identical |
| `src/core/Game.js` | byte-identical |
| `src/cameras/2d/BaseCamera.js` | one JSDoc line only (`@param` of `ignore()` mentions `Layer`) |

Everything in this dossier therefore holds across the whole `^4.0.0` peer range.

---

## 1. `setInteractive` — full signature and all "overloads"

### 1.1 The method itself

`src/gameobjects/GameObject.js:560`

```js
    setInteractive: function (hitArea, hitAreaCallback, dropZone)
    {
        this.scene.sys.input.enable(this, hitArea, hitAreaCallback, dropZone);

        return this;
    },
```

It is a pure forwarder. Three positional parameters, no arity checks, no validation.

**JSDoc lie #1 (cosmetic but real).** `src/gameobjects/GameObject.js:555` documents the second
parameter as `callback`, while the implementation names it `hitAreaCallback`:

```js
     * @param {Phaser.Types.Input.HitAreaCallback} [callback] - The callback that determines if the pointer is within the Hit Area shape or not. If you provide a shape you must also provide a callback.
```

The `.d.ts` copies the JSDoc name, not the source name — `types/phaser.d.ts:25957`:

```ts
setInteractive(hitArea?: Phaser.Types.Input.InputConfiguration | any, callback?: Phaser.Types.Input.HitAreaCallback, dropZone?: boolean): this;
```

Irrelevant for positional calls; relevant if anyone ever writes docs against the parameter name.
Note also that `InputConfiguration | any` **collapses to `any`** in TypeScript, so TS gives a
consumer *no* checking at all on the first argument of `setInteractive`.

### 1.2 `InputPlugin.enable`

`src/input/InputPlugin.js:930`

```js
    enable: function (gameObject, hitArea, hitAreaCallback, dropZone)
    {
        if (dropZone === undefined) { dropZone = false; }

        if (gameObject.input)
        {
            //  If it already has an InteractiveObject then just enable it and return
            gameObject.input.enabled = true;
        }
        else
        {
            //  Create an InteractiveObject and enable it
            this.setHitArea(gameObject, hitArea, hitAreaCallback);
        }
        ...
```

**Load-bearing consequence for the plugin:** calling `setInteractive(shape, cb)` a *second* time
on the same Game Object **does not replace the hit area**. It only flips `input.enabled = true`
and returns. To change a hit area after the fact you must mutate `sprite.input.hitArea` in place
(exactly what `GameObject.js:607-610` tells you to do) or call `removeInteractive()` first.

### 1.3 `InputPlugin.setHitArea` — the actual dispatcher

`src/input/InputPlugin.js:2357`

```js
    setHitArea: function (gameObjects, hitArea, hitAreaCallback)
    {
        if (hitArea === undefined)
        {
            return this.setHitAreaFromTexture(gameObjects);
        }

        if (!Array.isArray(gameObjects))
        {
            gameObjects = [ gameObjects ];
        }

        var draggable = false;
        var dropZone = false;
        var cursor = false;
        var useHandCursor = false;
        var pixelPerfect = false;
        var customHitArea = true;

        //  Config object?
        if (IsPlainObject(hitArea) && Object.keys(hitArea).length)
        {
            var config = hitArea;

            hitArea = GetFastValue(config, 'hitArea', null);
            hitAreaCallback = GetFastValue(config, 'hitAreaCallback', null);

            pixelPerfect = GetFastValue(config, 'pixelPerfect', false);
            var alphaTolerance = GetFastValue(config, 'alphaTolerance', 1);

            if (pixelPerfect)
            {
                hitArea = {};
                hitAreaCallback = this.makePixelPerfect(alphaTolerance);
            }

            draggable = GetFastValue(config, 'draggable', false);
            dropZone = GetFastValue(config, 'dropZone', false);
            cursor = GetFastValue(config, 'cursor', false);
            useHandCursor = GetFastValue(config, 'useHandCursor', false);

            //  Still no hitArea or callback?
            if (!hitArea || !hitAreaCallback)
            {
                this.setHitAreaFromTexture(gameObjects);
                customHitArea = false;
            }
        }
        else if (typeof hitArea === 'function' && !hitAreaCallback)
        {
            hitAreaCallback = hitArea;
            hitArea = {};
        }

        for (var i = 0; i < gameObjects.length; i++)
        {
            var gameObject = gameObjects[i];

            if (pixelPerfect && gameObject.type === 'Container')
            {
                console.warn('Cannot pixelPerfect test a Container. Use a custom callback.');
                continue;
            }

            var io = (!gameObject.input) ? CreateInteractiveObject(gameObject, hitArea, hitAreaCallback) : gameObject.input;

            io.customHitArea = customHitArea;
            io.dropZone = dropZone;
            io.cursor = (useHandCursor) ? 'pointer' : cursor;

            gameObject.input = io;

            if (draggable)
            {
                this.setDraggable(gameObject);
            }

            this.queueForInsertion(gameObject);
        }

        return this;
    },
```

### 1.4 The four real call shapes ("overloads")

| Form | Branch taken | Result |
| --- | --- | --- |
| `setInteractive()` | `InputPlugin.js:2359` → `setHitAreaFromTexture` | `new Rectangle(0, 0, width, height)` + `Rectangle.Contains` (`InputPlugin.js:2503`, `:2538`) |
| `setInteractive(shape, cb)` | falls past both `if`s | `CreateInteractiveObject(go, shape, cb)`, `customHitArea = true` |
| `setInteractive(cb)` (bare function) | `InputPlugin.js:2405-2409` | `hitAreaCallback = hitArea; hitArea = {}` — the callback gets `{}` as its first argument |
| `setInteractive({ hitArea, hitAreaCallback, ... })` | `InputPlugin.js:2377` | config object; also honours `draggable`, `dropZone`, `cursor`, `useHandCursor`, `pixelPerfect`, `alphaTolerance` |
| `setInteractive(shape, cb, true)` | 3rd arg | `dropZone` set at `InputPlugin.js:945-948` (only if `gameObject.input` exists) |

**How you pass a custom shape plus a callback — the two supported spellings:**

```js
sprite.setInteractive(diamondPolygon, Phaser.Geom.Polygon.Contains);
// or, if you also want the hand cursor / draggable / dropZone:
sprite.setInteractive({ hitArea: diamondPolygon, hitAreaCallback: Phaser.Geom.Polygon.Contains, useHandCursor: true });
```

> Only the **config-object** form can set `draggable` / `cursor` / `useHandCursor` /
> `dropZone`. The positional form leaves them at their defaults (`io.cursor = false`,
> `InputPlugin.js:2425`), because those locals are only ever assigned inside the config branch.

### 1.5 FOOTGUN — a plain-object hit area is silently reinterpreted as a config object

`IsPlainObject` (`src/utils/object/IsPlainObject.js:21`) returns `true` for anything created via
`{}` / `new Object()` and `false` for any class instance. I ran it (Node, real module):

```
Geom.Polygon instance  -> false
Geom.Rectangle instance-> false
custom class instance  -> false
object literal {w,h}   -> true
empty literal {}       -> true keys= 0
```

Therefore:

* `setInteractive(new Phaser.Geom.Polygon(...), cb)` — **safe**, the Polygon is not a plain object.
* `setInteractive(new MyIsoDiamond(64, 32), cb)` — **safe**, a class instance is not plain.
* `setInteractive({ tileWidth: 64, tileHeight: 32 }, cb)` — **BROKEN, silently.** It enters the
  config branch, `GetFastValue(config, 'hitArea', null)` yields `null`, so
  `if (!hitArea || !hitAreaCallback)` fires, the object gets the **texture rectangle** hit area,
  and **your callback is discarded without a warning**. The sprite still appears interactive,
  just with the wrong shape.
* `setInteractive({}, cb)` — worse. `Object.keys({}).length === 0` so the config branch is
  skipped; not a function so the second branch is skipped; you get
  `CreateInteractiveObject(go, {}, undefined)` and the first hit test throws
  `TypeError: input.hitAreaCallback is not a function` at `src/input/InputManager.js:971`
  (the call is unguarded).

**Rule for the plugin: the hit area must be a class instance (use `Phaser.Geom.Polygon`) or be
passed inside the config object. Never a bare object literal.**

### 1.6 The Interactive Object that results

`src/input/CreateInteractiveObject.js:28`

```js
var CreateInteractiveObject = function (gameObject, hitArea, hitAreaCallback)
{
    return {

        gameObject: gameObject,

        enabled: true,
        draggable: false,
        dropZone: false,
        cursor: false,

        target: null,

        camera: null,

        hitArea: hitArea,
        hitAreaCallback: hitAreaCallback,
        hitAreaDebug: null,

        //  Has the dev specified their own shape, or is this bound to the texture size?
        customHitArea: false,

        localX: 0,
        localY: 0,
        ...
```

It is a **plain object literal**, not a class — cheap to create, and every field is directly
mutable from the plugin (`sprite.input.hitArea.points[…] = …` is a legitimate resize path).

### 1.7 Insertion is deferred by one frame

`src/input/InputPlugin.js:2218`

```js
    queueForInsertion: function (child)
    {
        if (this._pendingInsertion.indexOf(child) === -1 && this._list.indexOf(child) === -1)
        {
            this._pendingInsertion.push(child);
        }

        return this;
    },
```

flushed only in `preUpdate` (`src/input/InputPlugin.js:487`, ending at `:525`):

```js
        //  Move pendingInsertion to list (also clears pendingInsertion at the same time)
        this._list = current.concat(insertList.splice(0));
```

which is bound to the Scene's `PRE_UPDATE` (`src/input/InputPlugin.js:431`):

```js
        eventEmitter.on(SceneEvents.PRE_UPDATE, this.preUpdate, this);
```

**A Game Object made interactive during frame N cannot be hit-tested until frame N+1.** This is
part of the answer to question 5.

---

## 2. The `hitAreaCallback` contract — arguments and coordinate space

### 2.1 The contract as declared

`src/input/typedefs/HitAreaCallback.js:2`

```js
/**
 * @callback Phaser.Types.Input.HitAreaCallback
 * @since 3.0.0
 *
 * @param {any} hitArea - The hit area object.
 * @param {number} x - The translated x coordinate of the hit test event.
 * @param {number} y - The translated y coordinate of the hit test event.
 * @param {Phaser.GameObjects.GameObject} gameObject - The Game Object that invoked the hit test.
 *
 * @return {boolean} `true` if the coordinates fall within the space of the hitArea, otherwise `false`.
 */
```

`types/phaser.d.ts:99767`

```ts
type HitAreaCallback = (hitArea: any, x: number, y: number, gameObject: Phaser.GameObjects.GameObject)=>boolean;
```

### 2.2 The one call site that actually runs

`src/input/InputManager.js:963`

```js
    pointWithinHitArea: function (gameObject, x, y)
    {
        //  Normalize the origin
        x += gameObject.displayOriginX;
        y += gameObject.displayOriginY;

        var input = gameObject.input;

        if (input && input.hitAreaCallback(input.hitArea, x, y, gameObject))
        {
            input.localX = x;
            input.localY = y;

            return true;
        }
        else
        {
            return false;
        }
    },
```

So the four arguments are `(input.hitArea, x, y, gameObject)` — **the 4th argument is the Game
Object**, matching the typedef. Note `localX`/`localY` are only written **on a hit**; after a miss
they hold whatever the last hit left there.

**Second declared call site is dead code.** `src/input/InputManager.js:1000`:

```js
    pointWithinInteractiveObject: function (object, x, y)
    {
        if (!object.hitArea)
        {
            return false;
        }

        //  Normalize the origin
        x += object.gameObject.displayOriginX;
        y += object.gameObject.displayOriginY;

        object.localX = x;
        object.localY = y;

        return object.hitAreaCallback(object.hitArea, x, y, object);
    },
```

`grep -rn "pointWithinInteractiveObject" $P/src` returns **only its own definition and JSDoc** —
nothing in the engine calls it. It is public API (also in the `.d.ts`) that no code path reaches.
Note it passes the **InteractiveObject** as the 4th argument, not the Game Object, contradicting
the typedef; and unlike `pointWithinHitArea` it sets `localX`/`localY` *before* the test, i.e. on
misses too. If the plugin ever calls it (e.g. for a headless oracle), the 4th argument differs.

### 2.3 The full transform chain, in order

`src/input/InputManager.js:888` — `hitTest`:

```js
    hitTest: function (pointer, gameObjects, camera, output)
    {
        if (output === undefined) { output = this._tempHitTest; }

        var tempPoint = this._tempPoint;

        var csx = camera.scrollX;
        var csy = camera.scrollY;

        output.length = 0;

        var x = pointer.x;
        var y = pointer.y;

        //  Stores the world point inside of tempPoint
        camera.getWorldPoint(x, y, tempPoint);

        pointer.worldX = tempPoint.x;
        pointer.worldY = tempPoint.y;

        var point = { x: 0, y: 0 };

        var matrix = this._tempMatrix;
        var parentMatrix = this._tempMatrix2;

        for (var i = 0; i < gameObjects.length; i++)
        {
            var gameObject = gameObjects[i];

            //  Checks if the Game Object can receive input (isn't being ignored by the camera, invisible, etc)
            //  and also checks all of its parents, if any
            if (!this.inputCandidate(gameObject, camera))
            {
                continue;
            }

            var px = tempPoint.x + (csx * gameObject.scrollFactorX) - csx;
            var py = tempPoint.y + (csy * gameObject.scrollFactorY) - csy;

            if (gameObject.parentContainer)
            {
                gameObject.getWorldTransformMatrix(matrix, parentMatrix);

                matrix.applyInverse(px, py, point);
            }
            else
            {
                TransformXY(px, py, gameObject.x, gameObject.y, gameObject.rotation, gameObject.scaleX, gameObject.scaleY, point);
            }

            if (this.pointWithinHitArea(gameObject, point.x, point.y))
            {
                output.push(gameObject);
            }
        }

        return output;
    },
```

Stage by stage, and what is **already undone** by the time the callback runs:

1. **DOM page coords → canvas/display coords.** `src/input/InputManager.js:1038-1039`
   `var x = this.scaleManager.transformX(pageX); var y = this.scaleManager.transformY(pageY);`
   → Scale-manager letterboxing/`FIT` scaling is **undone**.
2. **Camera inverse — scroll, zoom, rotation, origin, and camera x/y all undone at once.**
   `src/cameras/2d/BaseCamera.js:876`:

   ```js
   getWorldPoint: function (x, y, output)
   {
       if (output === undefined) { output = new Vector2(); }

       var cameraMatrix = this.matrixCombined.matrix;
       ...
       //  Invert Matrix
       var determinant = (mva * mvd) - (mvb * mvc);
       ...
       // Apply transform to point
       output.x = (x * ima + y * imc) + ime;
       output.y = (x * imb + y * imd) + imf;
   ```

   `matrixCombined` is built in `src/cameras/2d/Camera.js:614-639`:

   ```js
        var matrix = this.matrix;
        var matrixExternal = this.matrixExternal;
        ...
            // Regular camera
            // Apply view transforms in order ITRS.
            matrix.applyITRS(originX, originY, this.rotation, zoomX, zoomY);
            matrix.translate(-sx - originX, -sy - originY);
        ...
        matrixExternal.applyITRS(this.x, this.y, 0, 1, 1);
        ...
        matrixExternal.multiply(matrix, this.matrixCombined);
   ```

   That is a genuine full inverse — **zoom (including non-uniform `zoomX`/`zoomY`), rotation,
   scroll, camera origin and camera viewport position are ALL undone**. (This is a v4 change:
   in Phaser 3 `getWorldPoint` was a hand-rolled scroll/zoom/rotation formula.)

   ⚠️ **Timing trap (see §5).** `matrixCombined` is only recomputed inside `Camera.preRender`,
   which runs during **render**. Input runs *before* render. So the camera transform used by the
   hit test is the one from the **previous** frame's render, exactly like `renderList`.
3. **Per-object scroll factor re-applied.** `src/input/InputManager.js:924-925`. With
   `scrollFactor === 1` this is a no-op (`+ csx*1 - csx`).
4. **Object transform inverse** — position, rotation, scale undone by `TransformXY`
   (`src/math/TransformXY.js:31-51`), or by the full world matrix inverse when the object is
   inside a Container. Result: coordinates **local to the Game Object, origin at the Game
   Object's transform point**.
5. **`displayOrigin` IS added, last, immediately before the callback** —
   `src/input/InputManager.js:966-967`:

   ```js
        //  Normalize the origin
        x += gameObject.displayOriginX;
        y += gameObject.displayOriginY;
   ```

   with `src/gameobjects/components/Origin.js:194-198`:

   ```js
    updateDisplayOrigin: function ()
    {
        this._displayOriginX = this.originX * this.width;
        this._displayOriginY = this.originY * this.height;
   ```

### 2.4 The answer, stated once

> **The `x`/`y` handed to `hitAreaCallback` are in un-scaled, un-rotated *frame space*: `(0,0)`
> is the TOP-LEFT of the Game Object's texture frame regardless of its `origin`, `scale`,
> `rotation`, `scrollFactor`, or the camera's scroll/zoom/rotation.**

That is exactly why the default auto hit area is `new Rectangle(0, 0, width, height)`
(`src/input/InputPlugin.js:2538`) — top-left anchored, size of the frame.

For the isometric shell this means: **the diamond polygon must be authored in frame space**, i.e.
its vertices are offsets from the frame's top-left corner, *not* from the sprite's origin. With
`originX/originY = 0.5, 1.0` (the usual isometric foot-anchored sprite) and a frame `w × h`, the
tile diamond of size `tw × th` sitting at the sprite's feet is

```
(w/2,        h - th/2)   // top
(w/2 + tw/2, h       )   // right   ← careful, see the half-open edge rule in §3.4
(w/2,        h + th/2)   // bottom
(w/2 - tw/2, h       )   // left
```

— and it is independent of scale and rotation, both already undone.

---

## 3. `Phaser.Geom.Polygon` and `Polygon.Contains`

### 3.1 Constructor

`src/geom/polygon/Polygon.js:38`

```js
    function Polygon (points)
    {
        this.type = GEOM_CONST.POLYGON;
        this.area = 0;
        this.points = [];

        if (points)
        {
            this.setTo(points);
        }
    },
```

Accepted `points` formats (`src/geom/polygon/Polygon.js:112-153`): a space-separated string, a
flat `[x1,y1, x2,y2, ...]` number array, an array of `[x,y]` pairs, or an array of `{x,y}`
objects. `setTo` also runs `calculateArea()` (Shoelace).

### 3.2 `.d.ts` lie: `points` are NOT `Vector2`

`types/phaser.d.ts:80598` declares:

```ts
points: Phaser.Math.Vector2[];
```

The implementation pushes bare object literals — `src/geom/polygon/Polygon.js:132` and `:152`:

```js
            p = { x: 0, y: 0 };
            ...
            this.points.push(p);
```

Verified at runtime (Node, real module):

```
points are Vector2? Object has clone? undefined
```

**Consequence for verbatim plan code:** `polygon.points[0].clone()`, `.set()`, `.add()`,
`.length()` — any `Vector2` method — **typechecks and then throws at runtime**. Only `.x` / `.y`
are real. If the plugin needs to move a diamond it must write `p.x = …; p.y = …` or call
`polygon.setTo(...)`.

### 3.3 `Polygon.Contains`

Exported as `Phaser.Geom.Polygon.Contains` at `src/geom/polygon/index.js:10`
(`Polygon.Contains = require('./Contains');`).

`src/geom/polygon/Contains.js:22`

```js
var Contains = function (polygon, x, y)
{
    var inside = false;

    for (var i = -1, j = polygon.points.length - 1; ++i < polygon.points.length; j = i)
    {
        var ix = polygon.points[i].x;
        var iy = polygon.points[i].y;

        var jx = polygon.points[j].x;
        var jy = polygon.points[j].y;

        if (((iy <= y && y < jy) || (jy <= y && y < iy)) && (x < (jx - ix) * (y - iy) / (jy - iy) + ix))
        {
            inside = !inside;
        }
    }

    return inside;
};
```

Three-parameter, side-effect free, ignores extra arguments.

`types/phaser.d.ts:80487`

```ts
static Contains(polygon: Phaser.Geom.Polygon, x: number, y: number): boolean;
```

### 3.4 Is it a valid `hitAreaCallback` directly? — **YES. No wrapper needed.**

**Runtime:** the engine calls it as `input.hitAreaCallback(input.hitArea, x, y, gameObject)`
(`src/input/InputManager.js:971`); JS drops the 4th argument. Verified:

```
4-arg call == true
```

**TypeScript:** a 3-parameter function is assignable to a 4-parameter signature, and
`hitArea: any` accepts `polygon: Phaser.Geom.Polygon` in either direction. I compiled a real probe
against the shipped `types/phaser.d.ts` with `strict: true`:

```ts
const diamond = new Phaser.Geom.Polygon([ 0, -24, 48, 0, 0, 24, -48, 0 ]);
sprite.setInteractive(diamond, Phaser.Geom.Polygon.Contains);                  // OK
const cb: Phaser.Types.Input.HitAreaCallback = Phaser.Geom.Polygon.Contains;   // OK
sprite.setInteractive({ hitArea: diamond, hitAreaCallback: Phaser.Geom.Polygon.Contains, useHandCursor: true }); // OK
```

`tsc --noEmit --strict --skipLibCheck` → **exit 0**. And the probe is a real gate — mutating it
(wrong return type, wrong arity) produces `TS2322` and `TS2554`, so the green result is meaningful.

> **`skipLibCheck: true` is MANDATORY for consumers.** Without it, Phaser 4.2.1's own
> `types/phaser.d.ts` fails to compile with two errors *in the declaration file itself*:
> `phaser.d.ts(22,45): error TS2526: A 'this' type is available only in a non-static member of a
> class or interface.` and `phaser.d.ts(124835,21): error TS2416: Property 'run' in type
> 'SubmitterMeshToQuad' is not assignable to the same property in base type 'SubmitterQuad'.`
> This is not caused by our code. The plugin's docs must say so.

### 3.5 Edge semantics — measured, not assumed

The test is a half-open ray cast (`iy <= y && y < jy`, and strict `x <`). I ran it on a real
64×32 diamond centred at the origin:

| Point | Contains |
| --- | --- |
| centre `(0,0)` | `true` |
| top vertex `(0,-16)` | `false` |
| bottom vertex `(0,16)` | `false` |
| **left** vertex `(-32,0)` | `true` |
| **right** vertex `(32,0)` | `false` |
| on upper-**left** edge `(-16,-8)` | `true` |
| on upper-**right** edge `(16,-8)` | `false` |
| on lower-**left** edge `(-16,8)` | `true` |
| on lower-**right** edge `(16,8)` | `false` |

This asymmetry is a **feature** for a tile grid: I brute-forced a 7×7 lattice of iso diamonds
(`cx = (gx-gy)*32`, `cy = (gx+gy)*16`) over every integer point in an 81×61 window:

```
tiling coverage over the sampled window: zero=0 one=4941 many=0
```

**Every point belongs to exactly one diamond — no gaps, no double-hits.** A hand-rolled
`|dx|/(tw/2) + |dy|/(th/2) <= 1` test would double-count every shared edge. The plugin should use
`Polygon.Contains` and inherit this property rather than reimplement it.

One degenerate case to avoid: a polygon with a **horizontal** edge would divide by
`(jy - iy) === 0`; the guard `(iy <= y && y < jy)` is false in that case so it never divides, but
do not author diamonds with duplicated vertices.

---

## 4. Input debug drawing

### 4.1 What enables it — nothing automatic

`enableDebug` is **only ever called by user code**. `grep -rn "enableDebug" $P/src` finds only its
own definition (`src/input/InputPlugin.js:2632`) and its JSDoc. There is **no game-config flag**:
`src/core/Config.js:221-301` reads exactly `input.keyboard*`, `input.mouse*`, `input.touch*`,
`input.activePointers`, `input.smoothFactor`, `input.windowEvents`, `input.gamepad*` — there is no
`input.debug`. This is a first-class negative finding: if the plugin wants a debug overlay for hit
areas, it must call `scene.input.enableDebug(gameObject, color)` itself, per object.

Signature — `src/input/InputPlugin.js:2632`:

```js
    enableDebug: function (gameObject, color)
    {
        if (color === undefined) { color = 0x00ff00; }

        var input = gameObject.input;

        if (!input || !input.hitArea)
        {
            return this;
        }
```

Note the silent bail: an object not yet enabled for input gets **no debug shape and no warning**.

### 4.2 What it draws — and yes, it handles Polygon

`src/input/InputPlugin.js:2661-2692`

```js
        switch (shapeType)
        {
            case GEOM_CONST.CIRCLE:
                debug = factory.arc(0, 0, shape.radius);
                offsetx = shape.x - shape.radius;
                offsety = shape.y - shape.radius;
                break;

            case GEOM_CONST.ELLIPSE:
                debug = factory.ellipse(0, 0, shape.width, shape.height);
                offsetx = shape.x - shape.width / 2;
                offsety = shape.y - shape.height / 2;
                break;

            case GEOM_CONST.LINE:
                debug = factory.line(0, 0, shape.x1, shape.y1, shape.x2, shape.y2);
                break;

            case GEOM_CONST.POLYGON:
                debug = factory.polygon(0, 0, shape.points);
                break;

            case GEOM_CONST.RECTANGLE:
                debug = factory.rectangle(0, 0, shape.width, shape.height);
                offsetx = shape.x;
                offsety = shape.y;
                break;

            case GEOM_CONST.TRIANGLE:
                debug = factory.triangle(0, 0, shape.x1, shape.y1, shape.x2, shape.y2, shape.x3, shape.y3);
                break;
        }
```

**Polygon IS supported** (`GEOM_CONST.POLYGON`, `:2679-2681`) — along with Circle, Ellipse, Line,
Rectangle and Triangle. What is *not* supported is a hit area that isn't one of the six Phaser
geometry types: `shape.type` is `undefined`, no `case` matches, `debug` stays `null`, and the
method returns having done nothing (silently). This is another reason for the plugin to use a real
`Phaser.Geom.Polygon` for the diamond rather than a bespoke shape object.

The debug shape is an outline-only Shape kept in sync every frame — `src/input/InputPlugin.js:2694`:

```js
        if (debug)
        {
            debug.isFilled = false;
            debug.strokeColor = color;

            debug.preUpdate = function ()
            {
                debug.setVisible(gameObject.visible);

                debug.setStrokeStyle(1 / gameObject.scale, debug.strokeColor);

                debug.setDisplayOrigin(gameObject.displayOriginX, gameObject.displayOriginY);

                var x = gameObject.x;
                var y = gameObject.y;
                var rotation = gameObject.rotation;
                var scaleX = gameObject.scaleX;
                var scaleY = gameObject.scaleY;

                if (gameObject.parentContainer)
                {
                    var matrix = gameObject.getWorldTransformMatrix();
                    ...
                }

                debug.setRotation(rotation);
                debug.setScale(scaleX, scaleY);
                debug.setPosition(x + offsetx * scaleX, y + offsety * scaleY);
                debug.setScrollFactor(gameObject.scrollFactorX, gameObject.scrollFactorY);
                debug.setDepth(gameObject.depth);
            };

            updateList.add(debug);

            input.hitAreaDebug = debug;
        }
```

For the POLYGON case `offsetx`/`offsety` stay `0` and the alignment comes entirely from
`setDisplayOrigin(gameObject.displayOriginX, gameObject.displayOriginY)` — which is the *same*
frame-space convention the hit test uses (`src/input/InputManager.js:966`). The Polygon Shape
renders its raw `pathData` offset by `src._displayOriginX/Y`
(`src/gameobjects/shape/polygon/PolygonWebGLRenderer.js:32-33, :41-46`), so the outline should land
exactly on the tested area. **Static reading only — I have no screen; this must be confirmed in
the browser gate.**

Two further caveats worth writing into the plan:

* `debug.setDepth(gameObject.depth)` — the debug outline inherits the sprite's depth, so in an
  isometric scene the outlines will be interleaved with the sprites, not drawn on top.
* The debug shape is a **separate Game Object added to the display list**. It will appear in the
  camera `renderList` and in any `snapshot()` that walks the display list. Filter it out.
* `removeDebug` (`src/input/InputPlugin.js:2751`) destroys it and nulls `input.hitAreaDebug`.

---

## 5. THE LOAD-BEARING QUESTION — picking order

### 5.1 Confirmed: input does NOT order by `depth`

`grep -n "depth" $P/src/input/InputPlugin.js` returns exactly three hits, and **none of them
orders the pick candidates**:

* `:2728` — `debug.setDepth(gameObject.depth);` (the debug outline, §4).
* `:2894` — a JSDoc line for `sortDropZones`.
* `:2910` — `this.scene.sys.depthSort();` inside `sortDropZones` — **drop zones only**.

The actual sort — `src/input/InputPlugin.js:2874`:

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

**Confirmed: the ordering key is the index into `pointer.camera.renderList`, descending
(last-rendered first). `depth` never appears.** `depth` influences the result only *indirectly*,
because the display list is depth-sorted before rendering — but the value read at pick time is a
render-list index, not a depth.

The result is then truncated to one entry when `topOnly` is set, and `topOnly` defaults to `true`
(`src/input/InputPlugin.js:185`, `this.topOnly = true;`; truncation at `:664-676` and `:732-744`).

All seven call sites go through `this.sortGameObjects(...)` — `:661`, `:729`, `:1271` (drag list),
`:1775`, `:1902`, `:1953`, `:2001` (over/out lists) — so there is a single choke point.

### 5.2 Where `renderList` is populated

Declared and cleared — `src/cameras/2d/BaseCamera.js:531-535`, `src/cameras/2d/BaseCamera.js:590`:

```js
        this.renderList = [];
```
```js
    addToRenderList: function (child)
    {
        this.renderList.push(child);
    },
```

Cleared at the **first line of `Camera.preRender`** — `src/cameras/2d/Camera.js:522-524`:

```js
    preRender: function ()
    {
        this.renderList.length = 0;
```

**JSDoc lie #2.** `src/cameras/2d/BaseCamera.js:525` says:

```js
     * It is cleared at the start of `Camera.preUpdate`, or if the Camera is destroyed.
```

There is no `Camera.preUpdate`. It is cleared at the start of `Camera.preRender`. (The same
JSDoc block, `:522-523`, is honest about the rest: *"populated with all of the Game Objects that
this Camera has rendered in the previous (or current, depending on when you inspect it) frame"*.)

Filled by each Game Object's own renderer, as its very first act — e.g.
`src/gameobjects/sprite/SpriteWebGLRenderer.js:23`:

```js
    drawingContext.camera.addToRenderList(src);
```

(57 such call sites across `$P/src`.) The children arrive in display-list order via
`src/renderer/webgl/renderNodes/ListCompositor.js:63-94`:

```js
        for (var i = 0; i < children.length; i++)
        {
            var child = children[i];
            ...
            child.renderWebGLStep(renderer, child, currentContext, parentTransformMatrix, renderStep, children, i);
```

and that array is `getVisibleChildren(displayList.getChildren(), camera)`
(`src/cameras/2d/CameraManager.js:605`), filtered by `child.willRender(camera)` — so
**invisible / camera-ignored / alpha-0 objects never enter `renderList` at all.**

### 5.3 WHEN, in the frame, relative to input — the two lines that prove it

`src/core/Game.js:454` — the game step, in order:

```js
        this.scene.update(time, delta);          // :478   ← Scene PRE_UPDATE / UPDATE happen here
        ...
        eventEmitter.emit(Events.PRE_RENDER, renderer, time, delta);   // :490  ← INPUT POLLS HERE
        ...
        this.scene.render(renderer);             // :494   ← renderList is cleared + rebuilt HERE
```

and `src/input/InputManager.js:322`, in `boot`:

```js
        events.on(GameEvents.PRE_RENDER, this.preRender, this);
```

whose handler polls every Scene's InputPlugin — `src/input/InputManager.js:368-388`:

```js
    preRender: function ()
    {
        var time = this.game.loop.now;
        var delta = this.game.loop.delta;
        var scenes = this.game.scene.getScenes(true, true);
        ...
            if (scene.sys.input && scene.sys.input.updatePoll(time, delta) && this.globalTopOnly)
```

**The two proving line references:**

* `src/core/Game.js:490` — `eventEmitter.emit(Events.PRE_RENDER, ...)`, the event input runs on,
  emitted **before**
* `src/core/Game.js:494` — `this.scene.render(renderer);`, the only thing that repopulates
  `renderList` (via `src/cameras/2d/Camera.js:524` clearing it and
  `src/gameobjects/sprite/SpriteWebGLRenderer.js:23` refilling it).

> **The ordering used to pick the top object at frame N is derived from the render list built
> during frame N−1.**

There is a second, worse path. Real pointer events do **not** wait for `PRE_RENDER` at all:
`src/input/mouse/MouseManager.js:471` (`target.addEventListener('mousedown', this.onMouseDown);`)
→ `src/input/InputManager.js:737` (`this.updateInputPlugins(CONST.MOUSE_DOWN, this.mousePointerContainer);`)
→ `src/input/InputPlugin.js:709` `update()` → `hitTestPointer` + `sortGameObjects`, **synchronously
inside the browser event handler**, at an arbitrary point between frames. The render list it reads
is whatever the last completed render left behind. (`update()` then sets `_updatedThisFrame = true`
at `:792`, which makes the next `updatePoll` bail at `:601-606`.)

The same staleness applies to the **camera transform**: `getWorldPoint` reads
`this.matrixCombined` (`src/cameras/2d/BaseCamera.js:880`), and `matrixCombined` is only rebuilt in
`Camera.preRender` (`src/cameras/2d/Camera.js:639`), i.e. during `scene.render`. So a camera that
scrolled during `update()` this frame is not yet reflected in the hit test that runs at
`PRE_RENDER` of the same frame. Both the ordering *and* the projection lag by one render.

### 5.4 What index does an object created this frame get?

Two separate delays, and the plan must state both:

1. **It is not even a candidate.** `setInteractive` → `setHitArea` → `queueForInsertion`
   (`src/input/InputPlugin.js:2434`) puts it in `_pendingInsertion`. It only enters `this._list` in
   `preUpdate` (`src/input/InputPlugin.js:525`) on the **next** Scene `PRE_UPDATE`. Until then
   `hitTest` never sees it — it cannot be picked at all, at any depth.
2. **On the first frame it IS a candidate, its index is `0` — the bottom.** At that moment it has
   not yet been rendered, so `list.indexOf(child) === -1`, and
   `src/input/InputPlugin.js:2885-2886` clamps it:

   ```js
            var indexA = Math.max(list.indexOf(childA), 0);
            var indexB = Math.max(list.indexOf(childB), 0);
   ```

   Index `0` sorts **last** (the comparator returns `indexB - indexA`, so higher index comes
   first). A brand-new sprite therefore loses every tie against any already-rendered sprite,
   **even one that should be behind it**, for exactly one frame. From frame N+2 it has a real
   index. The same `-1 → 0` clamp hits any object that was culled, invisible, or
   `camera.ignore()`d on the previous frame — though `inputCandidate`
   (`src/input/InputManager.js:842`) already rejects the invisible ones before the sort.

### 5.5 Multi-camera

`hitTestPointer` (`src/input/InputPlugin.js:967`) walks cameras top-down via
`getCamerasBelowPointer` (`src/cameras/2d/CameraManager.js:497-518`, which `unshift`s so the
top-most camera is first) and **returns on the first camera that yields any hit**, setting
`pointer.camera`. The sort then uses *that* camera's `renderList`.

---

## 6. Is there a public hook to override the input sort?

**Definitive answer: there is no designed hook — no config option, no event, no strategy object.
The only lever is overriding the public method `InputPlugin.sortGameObjects`, which works because
every call site goes through `this`.**

Evidence:

* **No config.** `src/core/Config.js:221-301` — the complete set of `input.*` keys is
  `keyboard`, `keyboard.target`, `keyboard.capture`, `mouse`, `mouse.target`,
  `mouse.preventDefault{Down,Up,Move,Wheel}`, `touch`, `touch.target`, `touch.capture`,
  `activePointers`, `smoothFactor`, `windowEvents`, `gamepad`, `gamepad.target`. Nothing about
  sorting, ordering, picking or depth.
* **No event.** The only `pluginEvents` emissions are `BOOT` (`:411`), `START` (`:443`),
  `PRE_UPDATE` (`:490`) and `UPDATE` (`:598`, and only in `updatePoll`). None of them carries the
  candidate array, and `update()` — the DOM-driven path — emits nothing at all before sorting.
  There is no "after hit test / before dispatch" hook.
* **The method is public, non-`@private`, and in the `.d.ts`** — `types/phaser.d.ts:84053`:

  ```ts
  sortGameObjects(gameObjects: Phaser.GameObjects.GameObject[], pointer: Phaser.Input.Pointer): Phaser.GameObjects.GameObject[];
  ```

  (Contrast `sortDropZoneHandler`, which is `@private` at `src/input/InputPlugin.js:2922` and is
  absent from the `.d.ts`.)
* **All seven call sites are `this.`-dispatched** — `src/input/InputPlugin.js:661`, `:729`,
  `:1271`, `:1775`, `:1902`, `:1953`, `:2001`. An instance-level assignment
  (`scene.input.sortGameObjects = fn`) therefore covers down, up, move, over, out and drag
  uniformly. There is no internal alias captured at boot that would bypass it.
* **The other seam** is `this.manager.hitTest` (`src/input/InputPlugin.js:977`), on the
  *global* InputManager — replacing it would affect every Scene in the game, so it is the wrong
  lever for a Scene plugin.
* `camera.renderList` is technically writable, but `src/cameras/2d/BaseCamera.js:527-529` says
  *"You should not modify this array as it is used internally by the input system"*, and it is
  wiped on every `Camera.preRender`. Not a hook.

So: overriding `sortGameObjects` is **supported by the type surface and structurally safe**, but it
is a monkey-patch, not an extension point. It must be installed on the Scene's InputPlugin instance
and restored on shutdown.

---

## Implications for the plugin

**A. The diamond hit area is cheap and correct, and it must be a real `Phaser.Geom.Polygon`.**
`Polygon.Contains` is directly usable as a `hitAreaCallback` — runtime-verified (extra arg
ignored) and `tsc --strict`-verified. Using the real Geom type buys three things a hand-rolled
shape object does not: it survives `IsPlainObject` (§1.5), it is drawable by `enableDebug` (§4.2),
and its half-open edge rule tiles the plane exactly once per point (§3.5). Do **not** hand-roll
`|dx|/(tw/2) + |dy|/(th/2) <= 1`: it double-counts every shared edge and every vertex.

**B. Author the diamond in frame space, top-left anchored.** The callback receives coordinates with
`displayOrigin` already added and scale/rotation/camera already removed (§2.4). The plugin's
`makeDiamondHitArea(frameWidth, frameHeight, tileWidth, tileHeight, originX, originY)` helper is
therefore pure arithmetic on constants — no camera, no runtime state. That keeps it in the pure
core and out of the shell, which matters for the headless MCP oracle.

**C. Do not touch `polygon.points[i]` as if it were a `Vector2`.** The `.d.ts` says `Vector2[]`;
the runtime gives `{x, y}` literals (§3.2). Any `.clone()`/`.set()` in verbatim plan code compiles
and then throws. Mutate `.x`/`.y` or call `setTo()`.

**D. `setInteractive` is not idempotent.** A second call only re-enables (`InputPlugin.js:934-938`).
If `IsoSprite` recomputes its hit area (tile size change, frame change), it must mutate
`this.input.hitArea` in place or `removeInteractive()` first. Write that into the plan; it is the
kind of thing that produces a "the hit area didn't update" bug two weeks later.

**E. The picking order is NOT our depth order, and it is one frame stale.** This is the finding
with teeth. The plugin computes an isometric depth key and writes it to `gameObject.depth`; the
display list is depth-sorted before render; the render list inherits that order; input reads the
render list. So in the *steady state* the pick order does agree with our depth ordering — but:

* it agrees **one frame late**. A sprite that moved this frame is picked using last frame's
  ordering *and* last frame's camera matrix (§5.3). At 60fps with a following camera this is a
  sub-pixel-to-few-pixel discrepancy; on a fast pan or a zoom tween it is visible.
* a sprite created this frame is picked as **bottom-most** for one frame (§5.4).
* a sprite that was culled or invisible last frame gets index `0` the moment it reappears.
* if the plugin ever renders isometric content through anything that does not call
  `addToRenderList` in display order, picking silently degrades to "index 0 for everything".

**Two honest options for v1, and the plan must pick one explicitly:**

1. **Rely on Phaser's ordering** (do nothing). Correct in the steady state, one frame stale, zero
   code, zero maintenance. Document the staleness. Recommended for v1.
2. **Override `scene.input.sortGameObjects`** with our own comparator over the isometric depth key
   (§6). This removes the staleness *and* the created-this-frame bug, and it makes picking agree
   with the core's `pick()` oracle by construction — which is a real selling point for the MCP
   story. Cost: it is a monkey-patch on a public method; it must be installed in the ScenePlugin's
   `start`/`boot` and restored in `shutdown`/`destroy`, and it must fall back to the original for
   any object the plugin does not own (mixed scenes with normal sprites and UI). It is also the
   only place where the plugin would take over a Phaser behaviour rather than sit beside it — a
   direct tension with "thin shell".

   If option 2 is chosen, the correct shape is: capture `const original = input.sortGameObjects`,
   install a wrapper that partitions candidates into "ours" (has our iso component) and "theirs",
   sorts ours by the core depth key and delegates the rest to `original`, and restores `original`
   on shutdown. Never call `this.scene.sys.depthSort()` from it — that is the drop-zone path and
   it has different semantics.

**F. `topOnly` defaults to `true`** (`InputPlugin.js:185`). For an isometric scene where the user
may want "everything under the cursor, tallest first", the plugin should expose that rather than
have consumers discover `setTopOnly(false)`. Note that when `topOnly` is `false` the *whole sorted
array* is dispatched, so our ordering (E) governs the event order, not just the winner.

**G. Debug: build the `/debug` subpath on `enableDebug`, but own the lifecycle.** It is per-object
and manual (no config flag, §4.1), it silently no-ops on an object not yet interactive, the outline
inherits the sprite's `depth` (so it will be occluded by other tiles), and it adds a real Game
Object to the display list that `snapshot()` must filter out. All four of those are plugin
responsibilities, not Phaser's.

**H. Consumer TS config must set `skipLibCheck: true`.** Phaser 4.2.1's own `phaser.d.ts` has two
self-errors under `strict` (§3.4). Our README and our `tsconfig.base.json` should both say so,
before someone spends an afternoon believing the plugin broke their build.

**I. `pointWithinInteractiveObject` is dead code with a different contract.** If the headless
oracle ever wants to reuse a Phaser hit-test entry point, it must use `pointWithinHitArea`
(4th arg = Game Object) and not `pointWithinInteractiveObject` (4th arg = InteractiveObject,
and it writes `localX/localY` even on a miss). §2.2.

**J. Peer range `^4.0.0` is safe for this entire area.** Every input, geom and camera file this
dossier depends on is byte-identical between 4.0.0 and 4.2.1.

---

## Appendix — probes I actually ran

**Runtime (Node, requiring the real Phaser CommonJS modules — geom has no DOM dependency):**

```js
const P = '.../phaser/src/geom/polygon/';
const Polygon = require(P + 'Polygon');
const Contains = require(P + 'Contains');
const d = new Polygon([ 0, -16, 32, 0, 0, 16, -32, 0 ]);   // 64x32 diamond
```

output:

```
points are Vector2? Object has clone? undefined
area 1024
centre                 (0,0)        true
top vertex             (0,-16)      false
bottom vertex          (0,16)       false
left vertex            (-32,0)      true
right vertex           (32,0)       false
just inside top        (0,-15.9)    true
on upper-left edge     (-16,-8)     true
on upper-right edge    (16,-8)      false
on lower-left edge     (-16,8)      true
on lower-right edge    (16,8)       false
outside corner         (-31,-15)    false
4-arg call == true
tiling coverage over the sampled window: zero=0 one=4941 many=0
```

**`IsPlainObject` on candidate hit-area shapes:**

```
Geom.Polygon instance  -> false
Geom.Rectangle instance-> false
custom class instance  -> false
object literal {w,h}   -> true
empty literal {}       -> true keys= 0
```

**TypeScript, `strict: true`, against the shipped `types/phaser.d.ts`:**
probe (Polygon + `Polygon.Contains` as `hitAreaCallback`, positional and config forms) → exit 0
with `skipLibCheck`; exit 2 without it, with the two errors quoted in §3.4.
Mutation check (wrong return type; wrong arity) → `TS2322` and `TS2554`, confirming the probe is a
real gate and not a vacuous pass.

**Not verified — needs the browser gate:** that the `enableDebug` Polygon outline lands exactly on
the tested diamond (§4.2, read statically only), and any claim about rendering.
