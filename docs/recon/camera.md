# Recon dossier — Phaser 4.2.1 camera, following, bounds, roundPixels

**Source read:** `/Users/xsec/projects/phaser/platformer/node_modules/phaser` (package.json `version: 4.2.1`).
**Drift reference:** `/Users/xsec/projects/phaser/first-game/node_modules/phaser` (`4.0.0`).

> **Path note.** The task specified the deliverable path as `undefined/camera.md` and the two
> source roots as `undefined` — the orchestrator's template variables did not interpolate. I
> located the real trees by version (`platformer/node_modules/phaser` = 4.2.1,
> `first-game/node_modules/phaser` = 4.0.0) and wrote this file to
> `/Users/xsec/projects/phaser/plugins/isometric-view/docs/superpowers/recon/camera.md`.
> Every line number below is relative to the 4.2.1 package root above.

**Version drift, checked up front.** `diff -u` of `src/cameras/2d/Camera.js`,
`src/cameras/2d/BaseCamera.js` and `src/cameras/2d/CameraManager.js` between 4.0.0 and 4.2.1
returns **one hunk, in a JSDoc `@param` line only** (`BaseCamera.js:923`, where 4.2.1 drops
`Phaser.GameObjects.Layer` from the `ignore()` type union). The camera implementation is
byte-identical across the whole `^4.0.0` peer range. Nothing in this dossier is version-fragile.

---

## 1. `startFollow` / `stopFollow`

### Full signature and body

`src/cameras/2d/Camera.js:841-878`:

```js
    startFollow: function (target, roundPixels, lerpX, lerpY, offsetX, offsetY)
    {
        if (roundPixels === undefined) { roundPixels = false; }
        if (lerpX === undefined) { lerpX = 1; }
        if (lerpY === undefined) { lerpY = lerpX; }
        if (offsetX === undefined) { offsetX = 0; }
        if (offsetY === undefined) { offsetY = offsetX; }

        this._follow = target;

        this.roundPixels = roundPixels;

        lerpX = Clamp(lerpX, 0, 1);
        lerpY = Clamp(lerpY, 0, 1);

        this.lerp.set(lerpX, lerpY);

        this.followOffset.set(offsetX, offsetY);

        var originX = this.width / 2;
        var originY = this.height / 2;

        var fx = target.x - offsetX;
        var fy = target.y - offsetY;

        this.midPoint.set(fx, fy);

        this.scrollX = fx - originX;
        this.scrollY = fy - originY;

        if (this.useBounds)
        {
            this.scrollX = this.clampX(this.scrollX);
            this.scrollY = this.clampY(this.scrollY);
        }

        return this;
    },
```

### Does it modify `roundPixels`? — YES, unconditionally, and it defaults to `false`

`Camera.js:843` `if (roundPixels === undefined) { roundPixels = false; }` and `Camera.js:851`
`this.roundPixels = roundPixels;`.

There is **no `if (roundPixels !== undefined)` guard**. Calling
`camera.startFollow(target)` with one argument therefore **sets `camera.roundPixels = false`**,
silently destroying any earlier `setRoundPixels(true)` — and also overriding the game config's
`render.roundPixels: true` / `pixelArt: true` that `CameraManager` had propagated at camera
creation (`CameraManager.js:87`, `CameraManager.js:247`; see §3).

This is the single highest-value fact in this area for a pixel-art isometric plugin: our own
`follow()` proxy must either forward the caller's current `roundPixels` as the second argument,
or restore it after the call.

### `stopFollow` — three lines, and it does NOT undo the `roundPixels` write

`Camera.js:888-893`:

```js
    stopFollow: function ()
    {
        this._follow = null;

        return this;
    },
```

That is the whole body. It does not touch `roundPixels`, `lerp`, `followOffset`, `deadzone`,
`scrollX/Y` or `midPoint`. `startFollow` → `stopFollow` is **not** a round trip: the camera
keeps whatever `roundPixels`, lerp and offset the `startFollow` call installed. (`destroy` at
`Camera.js:948-960` also nulls `_follow` and `deadzone`, but not `roundPixels`.)

### CONFIRMED: `startFollow(target)` accepts ANY object with `.x`/`.y`

There is no `instanceof`, no duck-type assertion, no `Phaser.GameObjects.GameObject` check
anywhere in the call. The target is read in exactly two places, and both are plain property
reads:

- **at follow-start**, `Camera.js:863-864`:
  ```js
        var fx = target.x - offsetX;
        var fy = target.y - offsetY;
  ```
- **every frame**, inside `preRender`, `Camera.js:557-558`:
  ```js
            var fx = follow.x - this.followOffset.x;
            var fy = follow.y - this.followOffset.y;
  ```
  reached from `Camera.js:540` `var follow = this._follow;` and gated by `Camera.js:553`
  `if (follow && !this.panEffect.isRunning)`.

A third read is in `setDeadzone`, `Camera.js:287-288`, same shape.

The JSDoc agrees for once (`Camera.js:832`
`@param {(Phaser.GameObjects.GameObject|object)} target`) and so does the declaration file
(`types/phaser.d.ts:4148`):

```ts
startFollow(target: Phaser.GameObjects.GameObject | object, roundPixels?: boolean, lerpX?: number, lerpY?: number, offsetX?: number, offsetY?: number): this;
```

`object` in TypeScript is "any non-primitive", so a bare `{ x: 0, y: 0 }` literal compiles. **A
plain `{x, y}` mutable object is a fully supported follow target** — which is exactly what an
isometric camera proxy needs: keep a private screen-space point, project grid→screen into it
each frame, and let Phaser's own follow code do the lerping.

Two secondary facts worth carrying into the plan:

- **`lerpX`/`lerpY` are clamped to `[0,1]`** (`Camera.js:853-854`), but `offsetX`/`offsetY` are
  not validated at all.
- **The `lerpY`/`offsetY` defaults mirror the X value, not zero** (`Camera.js:845`
  `lerpY = lerpX`, `Camera.js:847` `offsetY = offsetX`). `startFollow(t, false, 0.1)` gives
  `lerp = (0.1, 0.1)`, and `startFollow(t, false, 1, 1, 32)` gives `followOffset = (32, 32)`.
- **The initial snap uses a hard-coded `width/2`, `height/2` origin** (`Camera.js:860-861`)
  while the per-frame follow uses the real camera origin (`Camera.js:537-538`
  `originX = width * this.originX`). Default `originX`/`originY` are `0.5`
  (`BaseCamera.js:467`, `BaseCamera.js:484`), so they agree unless someone calls
  `camera.setOrigin()`. If they do, the camera visibly jumps on the first frame after
  `startFollow`.

---

## 2. Where the follow is actually applied in the frame

**Answer: inside `Camera.preRender()`, during the RENDER phase, after everything in the update
phase has finished — including the Scene's own `update()`.** It is not driven by an event; it is
a direct method call from `CameraManager.render`.

### The call chain, top down

`src/core/Game.js:454-503` (`Game.step`):

```js
        eventEmitter.emit(Events.PRE_STEP, time, delta);
        eventEmitter.emit(Events.STEP, time, delta);

        //  Update the Scene Manager and all active Scenes

        this.scene.update(time, delta);

        eventEmitter.emit(Events.POST_STEP, time, delta);

        var renderer = this.renderer;

        renderer.preRender();

        eventEmitter.emit(Events.PRE_RENDER, renderer, time, delta);

        this.scene.render(renderer);

        renderer.postRender();
```

`src/scene/SceneManager.js:558-579` — the update pass walks scenes **in reverse order**:

```js
        for (var i = this.scenes.length - 1; i >= 0; i--)
        {
            var sys = this.scenes[i].sys;
            ...
                sys.step(time, delta);
```

`src/scene/Systems.js:350-361` (`Systems.step`) — the whole update phase of one Scene:

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

`src/scene/SceneManager.js:589-603` — the render pass walks scenes **in forward order** (opposite
of update):

```js
        for (var i = 0; i < this.scenes.length; i++)
        {
            var sys = this.scenes[i].sys;

            if (sys.settings.visible && sys.settings.status >= CONST.LOADING && sys.settings.status < CONST.SLEEPING)
            {
                sys.render(renderer);
            }
        }
```

`src/scene/Systems.js:374-385` (`Systems.render`):

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

`src/cameras/2d/CameraManager.js:592-610`:

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

### The resulting per-frame order (single scene)

| # | What runs | Anchor |
|---|---|---|
| 1 | `Events.PRE_STEP`, `Events.STEP` (global: Input, Sound) | `Game.js:470,474` |
| 2 | Scene `PRE_UPDATE` — **a ScenePlugin's `preupdate` handler fires here** | `Systems.js:354` |
| 3 | Scene `UPDATE` — **`CameraManager.update` fires here** (`eventEmitter.on(SceneEvents.UPDATE, this.update, this)`, `CameraManager.js:201`) | `Systems.js:356` |
| 4 | `Scene.update(time, delta)` — the user's own code | `Systems.js:358` |
| 5 | Scene `POST_UPDATE` | `Systems.js:360` |
| 6 | `renderer.preRender()` (clear canvas) + game `PRE_RENDER` | `Game.js:488,490` |
| 7 | `displayList.depthSort()` | `Systems.js:378` |
| 8 | Scene `PRE_RENDER` | `Systems.js:380` |
| 9 | **`camera.preRender()` — the follow is applied, `worldView`/`midPoint`/matrices recomputed** | `CameraManager.js:603` |
| 10 | `renderer.render(scene, visibleChildren, camera)` | `CameraManager.js:607` |

### The trap this creates

**`CameraManager.update` (step 3) does NOT touch the follow at all.** It only ticks the six
effects:

`CameraManager.js:668-674` → `Camera.js:925-936`:

```js
    update: function (time, delta)
    {
        if (this.visible)
        {
            this.rotateToEffect.update(time, delta);
            this.panEffect.update(time, delta);
            this.zoomEffect.update(time, delta);
            this.shakeEffect.update(time, delta);
            this.flashEffect.update(time, delta);
            this.fadeEffect.update(time, delta);
        }
    },
```

(`BaseCamera.update` at `BaseCamera.js:1554-1557` is a literal NOOP.)

So a plugin's `PRE_UPDATE` handler (step 2) and the Scene's `update` (step 4) both run **before**
the camera has moved for this frame. Anything they read off the camera — `scrollX`, `midPoint`,
`worldView`, `matrix*` — is **last frame's** value.

Two further ordering facts that matter to us:

- **`preRender` is skipped entirely for a camera with `visible === false` or `alpha === 0`**
  (`CameraManager.js:601`), and for every camera in a scene whose `sys.settings.visible` is
  false (`SceneManager.js:596`). Those cameras keep a permanently stale `worldView`.
- **`displayList.depthSort()` happens at step 7, before any camera's `preRender`.** Writing a
  Game Object's `depth` at any point during steps 1-5 is safe and takes effect the same frame.

---

## 3. `roundPixels`

### Where it lives — BOTH, and the config feeds the camera through the CameraManager

**Camera property.** `BaseCamera.js:137-145`:

```js
        /**
         * Should this camera round its pixel values to integers?
         *
         * @name Phaser.Cameras.Scene2D.BaseCamera#roundPixels
         * @type {boolean}
         * @default false
         * @since 3.0.0
         */
        this.roundPixels = false;
```

Setter: `BaseCamera.js:1266-1271`, a plain assignment, no validation:

```js
    setRoundPixels: function (value)
    {
        this.roundPixels = value;

        return this;
    },
```

**Game config.** `src/core/Config.js:382`:

```js
        this.roundPixels = GetValue(renderConfig, 'roundPixels', false, config);
```

— i.e. `render.roundPixels`, **default `false`**, also readable as a top-level `roundPixels` key
(the fourth `GetValue` argument is the fallback config object). And `Config.js:399-403`:

```js
        if (this.pixelArt)
        {
            ...
            this.roundPixels = true;
```

so `pixelArt: true` implies `roundPixels: true` at the config level.

**The bridge.** `CameraManager.js:87`:

```js
        this.roundPixels = scene.sys.game.config.roundPixels;
```

and every camera it creates or adopts gets it stamped on:
`CameraManager.js:247` `camera.setRoundPixels(this.roundPixels);` (in `add`) and
`CameraManager.js:292` (in `addExisting`).

**JSDoc/config lie worth noting:** `CameraManager.fromJSON` ignores `CameraManager.roundPixels`
and hard-defaults to `false` — `CameraManager.js:427`:

```js
            camera.roundPixels = GetFastValue(cameraConfig, 'roundPixels', false);
```

So a camera restored from JSON in a `pixelArt: true` game silently comes back with rounding off.

### What reads it, and what it actually rounds

There are **two derived flags**, and in 4.x they feed **different renderers**.

**(a) `camera.renderRoundPixels`** — recomputed at the top of every `preRender`,
`Camera.js:535`:

```js
        this.renderRoundPixels = (this.roundPixels && Number.isInteger(zoomX) && Number.isInteger(zoomY));
```

Declared `@readonly`, default `true` (!) at `BaseCamera.js:562-576` — note the default
contradicts `roundPixels`'s default of `false`; it is meaningless until the first `preRender`.
Its **only consumer in the entire source is the Canvas renderer**:

`src/renderer/canvas/CanvasRenderer.js:836-840`:

```js
        if (camera.renderRoundPixels)
        {
            camMatrix.e = Math.floor(camMatrix.e + 0.5);
            camMatrix.f = Math.floor(camMatrix.f + 0.5);
        }
```

(`grep -rn renderRoundPixels src` returns exactly four hits: the declaration, the assignment,
and this one use.)

**(b) `camera.roundPixels` read directly.** Under **WebGL** — the default renderer — rounding
goes through the Game Object, not through `renderRoundPixels`. `GameObject.js:728-748`:

```js
    willRoundVertices: function (camera, onlyTranslated)
    {
        switch (this.vertexRoundMode)
        {
            case 'safe':
                return onlyTranslated;

            case 'safeAuto':
                return onlyTranslated && camera.roundPixels;

            case 'full':
                return true;

            case 'fullAuto':
                return camera.roundPixels;

            case 'off':
            default:
                return false;
        }
    },
```

with `GameObject.js:222` `this.vertexRoundMode = 'safeAuto';` as the default for every Game
Object. `onlyTranslated` is computed per draw from the composed matrix —
`TransformerImage.js:181-182`:

```js
        var cmm = calcMatrix.matrix;
        var onlyTranslate = cmm[0] === 1 && cmm[1] === 0 && cmm[2] === 0 && cmm[3] === 1;
```

and the rounding itself, `TransformerImage.js:185-196`, rounds **the four screen-space vertices
of the output quad**, not the Game Object's `x`/`y`:

```js
        if (gameObject.willRoundVertices(camera, onlyTranslate))
        {
            var quad = this.quad;
            quad[0] = Math.round(quad[0]);
            ...
            quad[7] = Math.round(quad[7]);
        }
```

The same pattern appears in `TransformerStamp.js:161`, `TransformerTileSprite.js:144`,
`TransformerTile.js:145`, `TransformerVertex.js:153`.

The Canvas renderer additionally floors the sprite's world position before building its matrix —
`CanvasRenderer.js:811-818`:

```js
        var gx = sprite.x;
        var gy = sprite.y;

        if (camera.roundPixels)
        {
            gx = Math.floor(gx);
            gy = Math.floor(gy);
        }
```

and floors the destination rect at `CanvasRenderer.js:862-868`.

**Summary of what is rounded:** never the camera's `scrollX/scrollY`, never the Game Object's
`x`/`y` under WebGL. Under WebGL it is **the final screen-space quad vertices**, and only when
the composed matrix is a pure translation (default `safeAuto`) — i.e. **a rotated or scaled
sprite is never rounded**, and **a camera with a non-integer zoom disables rounding only under
Canvas** (the `Number.isInteger` guard lives in `renderRoundPixels`, which WebGL never reads).
Under Canvas it is the sprite's world position (floor), the composed matrix translation
(floor +0.5), and the drawImage destination.

`Shake` also rounds its own offset when `roundPixels` is on, `Shake.js:247-251`.

**Default:** `false`, from both `BaseCamera.js:145` and `Config.js:382` — unless `pixelArt: true`.

---

## 4. `setBounds`

`BaseCamera.js:1122-1142`:

```js
    setBounds: function (x, y, width, height, centerOn)
    {
        if (centerOn === undefined) { centerOn = false; }

        this._bounds.setTo(x, y, width, height);

        this.dirty = true;
        this.useBounds = true;

        if (centerOn)
        {
            this.centerToBounds();
        }
        else
        {
            this.scrollX = this.clampX(this.scrollX);
            this.scrollY = this.clampY(this.scrollY);
        }

        return this;
    },
```

Signature: `setBounds(x, y, width, height, centerOn = false) => this`. No validation of any
argument (a `NaN` width propagates straight into the clamp arithmetic).

### What it clamps — the WORLD VIEW edges, not the scroll origin

`BaseCamera.js:968-987`:

```js
    clampX: function (x)
    {
        var bounds = this._bounds;

        var dw = this.displayWidth;

        var bx = bounds.x + ((dw - this.width) / 2);
        var bw = Math.max(bx, bx + bounds.width - dw);

        if (x < bx)
        {
            x = bx;
        }
        else if (x > bw)
        {
            x = bw;
        }

        return x;
    },
```

`clampY` (`BaseCamera.js:1000-1019`) is the same with `displayHeight`/`height`.
`displayWidth = this.width / this.zoomX` (`BaseCamera.js:1986-1993`).

The `(dw - width) / 2` term exists because `scrollX` is the top-left of the **unzoomed** viewport
while the visible region is `displayWidth` wide, centred on `midPoint`. Substituting shows the
clamp keeps `worldView.x >= bounds.x` and `worldView.right <= bounds.right` exactly (see §5 for
the `worldView` formula). At `zoom === 1` the correction is zero and `bx === bounds.x`.

The clamp is applied from **five** places: `setBounds` (`BaseCamera.js:1137-1138`), `getScroll`
(`BaseCamera.js:660-664`), `centerOnX`/`centerOnY` (`BaseCamera.js:688-691`, `715-718`),
`startFollow` (`Camera.js:871-875`), and — the one that matters — **every frame in `preRender`**,
`Camera.js:589-597`:

```js
        if (this.useBounds)
        {
            sx = this.clampX(sx);
            sy = this.clampY(sy);
        }

        //  Values are in pixels and not impacted by zooming the Camera
        this.scrollX = sx;
        this.scrollY = sy;
```

So `useBounds` is enforced continuously; you cannot scroll outside the bounds even by writing
`scrollX` directly, because the next `preRender` snaps it back before the matrices are built.

### Bounds smaller than the viewport

`bw = Math.max(bx, bx + bounds.width - dw)`. When `bounds.width < dw`, the second term is less
than `bx`, so `bw === bx` and **the allowed scroll range collapses to a single value**,
`bx = bounds.x + (dw - width)/2`. The camera is **pinned so that `worldView.x === bounds.x`** —
the bounds' **left/top edge**, *not* centred. Everything to the right of `bounds.right` renders
as empty space. The JSDoc's "it will stop the Camera from being able to scroll"
(`BaseCamera.js:1103-1104`) is accurate but does not say where it stops.

### `centerOn` and `centerToBounds` do NOT clamp

`BaseCamera.js:734-740`:

```js
    centerOn: function (x, y)
    {
        this.centerOnX(x);
        this.centerOnY(y);

        return this;
    },
```

`centerOnX` (`BaseCamera.js:680-694`) *does* clamp its own scroll write when `useBounds`, but it
sets `this.midPoint.x = x` **before** the clamp — so immediately after `centerOn`, `midPoint`
reports the requested point while `scrollX` reports the clamped one. `midPoint` is repaired on
the next `preRender` (`Camera.js:599-604`).

`centerToBounds` — the path `setBounds(..., centerOn = true)` takes — does **not** clamp at all,
`BaseCamera.js:750-765`:

```js
    centerToBounds: function ()
    {
        if (this.useBounds)
        {
            var bounds = this._bounds;
            var originX = this.width * 0.5;
            var originY = this.height * 0.5;

            this.midPoint.set(bounds.centerX, bounds.centerY);

            this.scrollX = bounds.centerX - originX;
            this.scrollY = bounds.centerY - originY;
        }

        return this;
    },
```

With bounds smaller than the viewport this writes a `scrollX` **below** the clamp floor, which
the next `preRender` snaps to `bx`. Net effect: `setBounds(x, y, smallW, smallH, true)` does not
actually leave the camera centred on those bounds — it leaves it pinned to their top-left after
one frame. Also note `centerToBounds` hard-codes the `0.5` origin, same mismatch as `startFollow`.

`removeBounds` (`BaseCamera.js:1034-1043`) sets `useBounds = false` and empties `_bounds`.
`useBounds` can also be toggled directly as a boolean (documented at `BaseCamera.js:1099`).

---

## 5. `worldView`

### Type and declaration

`BaseCamera.js:171-182`:

```js
        /**
         * The World View is a Rectangle that defines the area of the 'world' the Camera is currently looking at.
         * This factors in the Camera viewport size, zoom and scroll position and is updated in the Camera preRender step.
         * If you have enabled Camera bounds the worldview will be clamped to those bounds accordingly.
         * You can use it for culling or intersection checks.
         *
         * @name Phaser.Cameras.Scene2D.BaseCamera#worldView
         * @type {Phaser.Geom.Rectangle}
         * @readonly
         * @since 3.11.0
         */
        this.worldView = new Rectangle();
```

`Phaser.Geom.Rectangle`, constructed empty → `{x: 0, y: 0, width: 0, height: 0}` until the first
`preRender`. `types/phaser.d.ts:3142` declares it `readonly worldView: Phaser.Geom.Rectangle;` —
the `readonly` applies to the *binding*; the Rectangle's own fields are freely mutable from TS,
and Phaser mutates them in place.

### WHEN it is updated — `Camera.preRender`, and only there

`Camera.js:599-612`:

```js
        var midX = sx + halfWidth;
        var midY = sy + halfHeight;

        //  The center of the camera, in world space, so taking zoom into account
        //  Basically the pixel value of what it's looking at in the middle of the cam
        this.midPoint.set(midX, midY);

        var displayWidth = width / zoomX;
        var displayHeight = height / zoomY;

        var vwx = midX - (displayWidth / 2);
        var vwy = midY - (displayHeight / 2);

        this.worldView.setTo(vwx, vwy, displayWidth, displayHeight);
```

`grep -n preRender src/cameras/2d/BaseCamera.js` returns **only JSDoc mentions** — `preRender`
is defined on `Camera`, not on `BaseCamera`. There is no second writer of `worldView` anywhere in
`src`.

### Reading it during a Scene's `update` gives the PREVIOUS frame's value — CONFIRMED

From the ordering table in §2: `Scene.update` is step 4, `camera.preRender()` is step 9. On frame
N, `Scene.update` sees the `worldView` written during frame N−1's render pass. On the very first
frame it sees `{0, 0, 0, 0}` — an empty rectangle, because no `preRender` has run yet.

**Our culling is driven off `worldView`, so this is load-bearing.** Three consequences:

1. Culling computed in `update` lags the camera by exactly one frame. With a fast-moving followed
   camera at 60fps and a large lerp, that is up to one frame of camera travel of pop-in at the
   trailing edge. The plugin's culling margin has to absorb it, or the cull has to move to the
   Scene `PRE_RENDER` event (`Systems.js:380`, step 8 — after `depthSort`, before
   `camera.preRender`) — which is *still* one frame stale, because `preRender` has not run yet
   either. **There is no hook in the frame that sees a fresh `worldView` before that frame's
   draw**, short of computing the view rectangle ourselves from `scrollX/scrollY/zoom/width/height`
   (which is 6 lines of the formula above and is what I would do).
2. `worldView` is stale forever for a camera with `visible === false` / `alpha === 0`
   (`CameraManager.js:601`), or in a scene with `sys.settings.visible === false`
   (`SceneManager.js:596`).
3. The JSDoc claim "*If you have enabled Camera bounds the worldview will be clamped to those
   bounds accordingly*" (`BaseCamera.js:174`) is **only indirectly true and is false in the
   degenerate case**. `worldView` is never clamped; the *scroll* is (`Camera.js:589-593`), which
   keeps `worldView` inside the bounds *when the bounds are at least as large as the viewport*.
   When they are smaller, `worldView` is `displayWidth × displayHeight` and therefore **larger
   than the bounds it is supposedly clamped to**, sticking out past `bounds.right`/`bounds.bottom`.

Sibling field: `midPoint` (`BaseCamera.js:437-450`, `@readonly`, initialised to
`(width/2, height/2)`) is written on the same line-block and carries the same one-frame lag —
except that `startFollow`, `setDeadzone`, `centerOnX/Y` and `centerToBounds` also write it
eagerly, sometimes to an unclamped value (§4).

---

## 6. The matrix properties

### The names EXIST in 4.2.1, exactly as the design doc claims

`BaseCamera.js:349-383`:

```js
        this.matrix = new TransformMatrix();
        ...
        this.matrixCombined = new TransformMatrix();
        ...
        this.matrixExternal = new TransformMatrix();
```

with the v3→v4 semantics change spelled out in the JSDoc at `BaseCamera.js:350-358`:

> *In v3, this contained a combination of the external camera position, and the internal rotation
> and zoom. In v4, it instead contains the internal camera scroll, rotation, and zoom.*

- **`matrix`** — the *internal* view: origin, zoom, rotation, scroll.
- **`matrixExternal`** — the camera's *viewport position on the canvas* only.
- **`matrixCombined`** — `matrixExternal × matrix`.

All three are destroyed together at `BaseCamera.js:1627-1629`.

### CONFIRMED: all three are recomputed on every `preRender`, so any external write is overwritten

`Camera.js:614-639`:

```js
        var matrix = this.matrix;
        var matrixExternal = this.matrixExternal;

        if (this.isObjectInversion)
        {
            // Game Object filter camera
            matrix.loadIdentity();
            matrix.translate(originX, originY);
            matrix.scale(zoomX, zoomY);
            matrix.rotate(this.rotation);
            matrix.translate(-sx - originX, -sy - originY);
        }
        else
        {
            // Regular camera
            // Apply view transforms in order ITRS.
            matrix.applyITRS(originX, originY, this.rotation, zoomX, zoomY);
            matrix.translate(-sx - originX, -sy - originY);
        }


        matrixExternal.applyITRS(this.x, this.y, 0, 1, 1);

        this.shakeEffect.preRender();

        matrixExternal.multiply(matrix, this.matrixCombined);
```

The overwrite is total, not incremental — `TransformMatrix.applyITRS`
(`src/gameobjects/components/TransformMatrix.js`) assigns all six components:

```js
    applyITRS: function (x, y, rotation, scaleX, scaleY)
    {
        var matrix = this.matrix;

        var radianSin = Math.sin(rotation);
        var radianCos = Math.cos(rotation);

        // Translate
        matrix[4] = x;
        matrix[5] = y;

        // Rotate and Scale
        matrix[0] = radianCos * scaleX;
        matrix[1] = radianSin * scaleX;
        matrix[2] = -radianSin * scaleY;
        matrix[3] = radianCos * scaleY;

        return this;
    },
```

and `multiply(rhs, out)` writes all six components of `out.matrix` from the two operands, never
reading the destination. So **writing `camera.matrix`, `camera.matrixExternal` or
`camera.matrixCombined` from user code survives at most until the next rendered frame of that
camera.** The design doc's claim is correct as written.

Two refinements the design doc should absorb:

- **`matrixExternal` never carries zoom or rotation** — `applyITRS(this.x, this.y, 0, 1, 1)`,
  `Camera.js:635`. It is a pure translate by the viewport position.
- **There is exactly one in-band mutation point**, and it belongs to `Shake`.
  `Camera.js:637` calls `shakeEffect.preRender()`, whose entire body
  (`src/cameras/2d/effects/Shake.js:204-210`) is:
  ```js
    preRender: function ()
    {
        if (this.isRunning)
        {
            this.camera.matrix.translate(this._offsetX, this._offsetY);
        }
    },
  ```
  It runs **after** `matrix` is built and **before** the `matrixCombined` multiply — the only
  place in the engine that appends to the camera's view matrix mid-`preRender`.

### There is NO projection hook — confirmed

- `grep -rn "projection\|Projection" src/cameras --include="*.js"` → **zero hits**. No
  `projectionMatrix`, no `setProjection`, no overridable projector object.
- The nearest thing to a funnel is `Camera.getViewMatrix(forceComposite)`, `Camera.js:659-673`:
  ```js
    getViewMatrix: function (forceComposite)
    {
        if (
            forceComposite || this.forceComposite ||
            this.filters.external.length > 0 ||
            this.filters.internal.length > 0
        )
        {
            return this.matrix;
        }
        else
        {
            return this.matrixCombined;
        }
    },
  ```
  It is consumed by the WebGL transformers and a few WebGL renderers only —
  `TransformerImage.js:152`, `TransformerTile.js:73`, `TransformerVertex.js:128`,
  `TransformerTileSprite.js:111`, `SubmitterTilemapGPULayer.js:502`,
  `ParticleEmitterWebGLRenderer.js:41`, `BlitterWebGLRenderer.js:46`, `Filters.js:376`. It is
  marked `@webglonly` (`Camera.js:654`). **The Canvas renderer bypasses it entirely**, taking
  `camera.matrix` directly (`CanvasRenderer.js:491` `camera.matrix.copyToContext(ctx);` and
  `CanvasRenderer.js:823` `camera.matrixCombined,`). Overriding `getViewMatrix` on one camera is
  therefore possible in JS but (a) is not a documented extension point, (b) would silently do
  nothing under Canvas, and (c) is not typed for a subclass to override cleanly.
- **The camera's own `PRE_RENDER` event is WebGL-dead.** `grep -rn CameraEvents src/renderer/webgl`
  returns only `POST_RENDER` emissions (`renderNodes/Camera.js:452`,
  `DynamicTextureHandler.js:346`). `CameraEvents.PRE_RENDER` is emitted **only by the Canvas
  renderer** (`CanvasRenderer.js:463` and again at `:488` when `renderToTexture`). Its own doc
  comment, `src/cameras/2d/events/PRE_RENDER_EVENT.js`, says *"It is only dispatched if the Camera
  is rendering to a texture"* — which is wrong even for Canvas, where line 463 fires
  unconditionally. **A plugin must not build anything on `camera.on('prerender')`**: under the
  default WebGL renderer it never fires.
- The one event that *does* fire from inside `preRender` is `FOLLOW_UPDATE`, `Camera.js:641-644`:
  ```js
        if (emitFollowEvent)
        {
            this.emit(Events.FOLLOW_UPDATE, this, follow);
        }
  ```
  emitted **last**, after `worldView` and all three matrices are final, and only when a follow
  target is set and `panEffect` is not running (`emitFollowEvent` is set at `Camera.js:586`).
  Mutating `scrollX` inside this listener will **not** affect the current frame's matrices — they
  were built 30 lines earlier. It is a read-only observation point, and it is the only per-frame,
  post-follow, pre-draw hook the camera offers under WebGL.

### Bonus finding: `camera.matrix` is invisible to TypeScript

`BaseCamera.js:360-363` tags it `@private`, so the generated declarations omit it.
In `types/phaser.d.ts` the BaseCamera members run `worldView` (3142) → `dirty` (3151) →
`matrixCombined` (3156) → `matrixExternal` (3161) — **there is no `matrix:` member**. A consumer's
`tsc` rejects `camera.matrix` even though the property exists at runtime and is what the Canvas
renderer actually draws with. `matrixCombined` and `matrixExternal` *are* declared (public in
JSDoc since 4.0.0).

---

## Implications for the plugin

**A. `follow()` must defend `roundPixels`, and must be documented as doing so.**
`startFollow(target)` sets `roundPixels = false` unconditionally (`Camera.js:843`+`851`) and
`stopFollow` never restores it (`Camera.js:888-893`). For a plugin whose entire audience is
tile/pixel art, silently disabling pixel rounding on the first `follow()` call is the worst kind
of bug: it looks like a texture-filtering problem. Our proxy should read `camera.roundPixels`
before the call and pass it through as the second argument, so the default is "don't change what
the user configured" rather than Phaser's "false".

**B. The follow-target contract is `{x, y}`, and that is the whole camera design.**
Nothing in the follow path touches anything but `.x` and `.y` (`Camera.js:557-558`, `863-864`).
The isometric camera proxy therefore needs no Game Object, no display-list entry, no
`GameObjectFactory` registration: a private `{x: 0, y: 0}` object owned by the plugin, updated
from grid coordinates through the core's projector, and handed to `startFollow` once. `lerp`,
`deadzone`, bounds clamping and `FOLLOW_UPDATE` then all work unmodified, in **screen space** —
which is correct, because the core projects grid→screen and the camera should smooth in the space
the user sees. Two hard requirements fall out: the point object must be **mutated in place**
(re-assigning a new object breaks the `_follow` reference), and the `lerpY = lerpX` /
`offsetY = offsetX` mirroring (`Camera.js:845`, `847`) must be documented in our API, because
`followIso(target, {lerp: 0.1})` meaning "0.1 on both axes" is a semantic we inherit rather than
choose.

**C. Update the plugin's camera state in `PRE_UPDATE`, and accept that the camera moves after us.**
A ScenePlugin's `preupdate` handler (`Systems.js:354`) runs before both `CameraManager.update`
(`CameraManager.js:201`, on `UPDATE`) and `Scene.update`. That is the right place to project the
follow point, because the value is then consumed by `preRender` later in the same frame
(`CameraManager.js:603`) — one clean write, one read, no lag. It is the *wrong* place to read
camera output.

**D. Do not read `worldView` for culling — recompute it.**
`worldView` is written only in `Camera.preRender` (`Camera.js:612`), which runs in the render
phase; every hook available to us (`PRE_UPDATE`, `UPDATE`, `Scene.update`, `POST_UPDATE`, scene
`PRE_RENDER`) sees the previous frame's rectangle, and on frame 1 sees `{0,0,0,0}`. Since our
culling core takes a plain `{x, y, width, height}` view anyway, the shell should build it from
live scalars:
`w = camera.width / camera.zoomX; h = camera.height / camera.zoomY;`
`x = camera.scrollX + camera.width/2 - w/2; y = camera.scrollY + camera.height/2 - h/2;`
— the same four lines as `Camera.js:606-612`, but evaluated *now*. This also sidesteps the
invisible-camera staleness (`CameraManager.js:601`) and makes the plugin testable in Node with a
fake camera object. It is 4 lines of code to remove a whole class of one-frame bug, and it
removes a dependency on a `readonly`-declared Rectangle we would otherwise be reading mid-mutation.

**E. Culling is genuinely ours to do — Phaser 4 does no per-sprite culling.**
`CameraManager.render` filters only through `willRender` (`CameraManager.js:605`, `625-631`), and
`BaseCamera.cull()` (`BaseCamera.js:796-859`) is **called from nowhere** in the render path —
`grep -rn "\.cull(" src` finds only `TilemapLayer`'s own unrelated `src.cull(camera)`. So
`disableCull` is inert for Sprites, and every isometric entity in the display list is transformed
and submitted every frame unless *we* turn it off. Our O(1) cull is not an optimisation, it is
the only one there is. (Corollary: it also means our cull cannot fight a built-in one.)

**F. Bounds: convert grid bounds to screen bounds, and warn on the degenerate case.**
`setBounds` clamps so the **worldView edges** align to the bounds (`BaseCamera.js:968-987`), and
the clamp is re-applied every frame inside `preRender` (`Camera.js:589-593`), so it is authoritative
— a user writing `scrollX` directly cannot escape it. An isometric `setGridBounds()` helper should
therefore compute the screen-space AABB of the diamond (which the core's `worldBounds` already
produces, x starting negative) and hand it straight to `setBounds`. Two things to guard: bounds
smaller than the viewport pin the camera to the bounds' **top-left**, not centre (`bw === bx`), and
`setBounds(..., centerOn = true)` on such bounds *appears* to centre and then snaps to that pin one
frame later, because `centerToBounds` (`BaseCamera.js:750-765`) does not clamp. For an isometric
diamond, "bounds smaller than the viewport" is the normal case for small maps, so this deserves an
explicit note in our docs — and it is a good argument for our helper to add a configurable margin
rather than passing the tight AABB.

**G. There is no supported way to make the camera itself isometric — and we should say so loudly.**
No `projection` anything exists in `src/cameras` (zero grep hits); all three matrices are
rebuilt from scratch in `preRender` (`Camera.js:614-639`) via `applyITRS`, which assigns all six
components; `getViewMatrix` is `@webglonly` and bypassed by Canvas; and `camera.on('prerender')`
**never fires under WebGL** (only `CanvasRenderer.js:463` emits it). The isometry must live where
we already put it: in the *positions we write to Game Objects*, not in the camera transform. This
retroactively validates the "pure core + thin shell" architecture — the alternative was never
available. `FOLLOW_UPDATE` (`Camera.js:643`) is the one legitimate per-frame observation hook,
and it is read-only in effect.

**H. TypeScript-visible surface: don't type against `camera.matrix`.**
It exists at runtime (`BaseCamera.js:365`) but is `@private` and therefore absent from
`types/phaser.d.ts` (the member list jumps `dirty` → `matrixCombined`). `matrixCombined` and
`matrixExternal` *are* declared (3156, 3161). Since our `snapshot()` will want camera state, note
that `BaseCamera.toJSON()` (`BaseCamera.js:1515-1542`) already serialises
`name/x/y/width/height/zoom/rotation/roundPixels/scrollX/scrollY/backgroundColor` plus `bounds`
when `useBounds` — but **not** `worldView`, `midPoint`, `lerp`, `followOffset`, `deadzone`, or the
follow target. If `snapshot()` is meant to round-trip an isometric view, it has to carry those
itself. And beware `CameraManager.fromJSON` (`CameraManager.js:427`), which hard-defaults
`roundPixels` to `false` regardless of game config — a JSON round-trip of a `pixelArt` game loses
pixel rounding.

**I. Free fact worth one line in the plan: `camera.dirty` is vestigial in 4.2.1.**
It is set `true` by every scroll/zoom/rotation/size setter (`BaseCamera.js:1774`, `1807`, `1841`,
`1872`, `1903`, `1933`, plus `1038`, `1128`, `1604`) and set `false` at
`renderNodes/Camera.js:450` / `CanvasRenderer.js:517` — but **nothing anywhere in `src` branches
on it**. Do not use it as a change signal, and do not expect writing it to skip any work.
