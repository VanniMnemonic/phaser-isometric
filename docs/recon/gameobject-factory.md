# Dossier — Registering a custom GameObject on the Phaser 4 factory

**Subject:** what `phaser-isometric` must do to make `this.add.isoSprite(...)` and
`this.make.isoSprite(...)` exist, and what the real source does that the docs and the
`.d.ts` do not say.

**Phaser 4.2.1 source root (authoritative for every line number below):**
`/Users/xsec/projects/phaser/platformer/node_modules/phaser`
(`package.json` → `"version": "4.2.1", "release": "Giedi"`)

**Phaser 4.0.0 source root (drift control):**
`/Users/xsec/projects/phaser/The Battlepits of Krarth/node_modules/phaser`

> **Note on the task inputs.** The task arrived with both the Phaser source root and the
> dossier output path interpolated as the literal string `undefined`. The source root was
> recovered by locating a real 4.2.1 install (above). The output path was substituted with
> this repository's existing documentation convention, `docs/superpowers/research/`.

### Version drift: none, in this whole area

Byte-for-byte identical between 4.0.0 and 4.2.1:

```
src/gameobjects/GameObjectFactory.js        IDENTICAL
src/gameobjects/GameObjectCreator.js        IDENTICAL
src/gameobjects/sprite/SpriteFactory.js     IDENTICAL
src/gameobjects/sprite/SpriteCreator.js     IDENTICAL
src/gameobjects/sprite/Sprite.js            IDENTICAL
src/gameobjects/image/ImageFactory.js       IDENTICAL
src/plugins/PluginManager.js                IDENTICAL
src/plugins/ScenePlugin.js                  IDENTICAL
src/gameobjects/DisplayList.js              IDENTICAL
```

Everything in this dossier therefore holds across the entire declared peer range
`^4.0.0`. No floor needs raising on account of the factory.

---

## 1. `PluginManager.registerGameObject` / `removeGameObject`

### 1.1 The implementation

`src/plugins/PluginManager.js:778-791`:

```javascript
    registerGameObject: function (key, factoryCallback, creatorCallback)
    {
        if (factoryCallback)
        {
            GameObjectFactory.register(key, factoryCallback);
        }

        if (creatorCallback)
        {
            GameObjectCreator.register(key, creatorCallback);
        }

        return this;
    },
```

`src/plugins/PluginManager.js:804-820`:

```javascript
    removeGameObject: function (key, removeFromFactory, removeFromCreator)
    {
        if (removeFromFactory === undefined) { removeFromFactory = true; }
        if (removeFromCreator === undefined) { removeFromCreator = true; }

        if (removeFromFactory)
        {
            GameObjectFactory.remove(key);
        }

        if (removeFromCreator)
        {
            GameObjectCreator.remove(key);
        }

        return this;
    },
```

Both are thin dispatchers. Neither validates `key`. Neither logs. Neither checks whether
the key is already taken — that decision is delegated entirely to the two statics.

### 1.2 What they RETURN — the `.d.ts` lies

Both **return `this`** (the PluginManager), i.e. they are chainable —
`PluginManager.js:790` and `PluginManager.js:819`.

The declarations say otherwise. `types/phaser.d.ts:120722` and `:120731`:

```typescript
            registerGameObject(key: string, factoryCallback?: Function, creatorCallback?: Function): void;
            removeGameObject(key: string, removeFromFactory?: boolean, removeFromCreator?: boolean): void;
```

The JSDoc on the implementation carries **no `@returns` tag at all**
(`PluginManager.js:771-777`, `:797-803`) — that is the proximate cause: the declaration
generator emitted `void` because the JSDoc never claimed a return.

Verified with the real compiler (TypeScript 5.7.3, the version this repo pins):

```
probe.ts(12,7): error TS2322: Type 'void' is not assignable to type 'PluginManager'.
```

for the source line
`const r: Phaser.Plugins.PluginManager = pm.registerGameObject('isoSprite', fn);`

**Consequence for the plan:** do **not** write `return this.pluginManager.registerGameObject(...)`
or chain off it in TypeScript. It works at runtime and fails `tsc`. Call it as a statement.

### 1.3 The registry is MODULE-GLOBAL, not per-Game

This is the single most consequential fact in the dossier.

`src/gameobjects/GameObjectFactory.js:197-203`:

```javascript
GameObjectFactory.register = function (factoryType, factoryFunction)
{
    if (!GameObjectFactory.prototype.hasOwnProperty(factoryType))
    {
        GameObjectFactory.prototype[factoryType] = factoryFunction;
    }
};
```

`src/gameobjects/GameObjectFactory.js:214-220`:

```javascript
GameObjectFactory.remove = function (factoryType)
{
    if (GameObjectFactory.prototype.hasOwnProperty(factoryType))
    {
        delete GameObjectFactory.prototype[factoryType];
    }
};
```

The storage is `GameObjectFactory.prototype` — a property on the **module's single class
object**. There is no `game`, no `scene`, no per-instance map anywhere in the code path.
`PluginManager.registerGameObject` never passes a Game or Scene to `register`
(`PluginManager.js:782`, `:787`).

So:

* Every `Phaser.Game` in the page shares one registry.
* Every `Scene` in every Game shares one registry.
* Registration order relative to Game/Scene creation is irrelevant, because prototype
  lookup happens at **call** time, not at instantiation time. A `GameObjectFactory`
  instance created before the registration still resolves the method.
* Conversely, `removeGameObject` from one Scene's teardown removes the method for
  **every other Scene and every other Game still alive**.

The `GameObjectCreator` half is the identical pattern on its own prototype —
`src/gameobjects/GameObjectCreator.js:165-171` and `:186-192`.

### 1.4 Second registration of the same key: SILENTLY IGNORED, first wins

Not a throw. Not a warning. Not an overwrite. The `hasOwnProperty` guard at
`GameObjectFactory.js:199` makes the second and every subsequent call a **no-op**.

Verified empirically against the real 4.2.1 module (Node, requiring the file by absolute
path — see §1.5 for why the package specifier does not work):

```
register returns: undefined
after 1st is A: true
after 2nd -> still A: true | is B: false
after remove hasOwn: false
remove unknown key -> undefined (no throw)
hasOwnProperty on inherited key: false
register OVER an inherited key succeeded: true
--- clash with a built-in method name ---
hasOwn(existing): true
overwrote built-in existing?: false | unchanged: true
```

Reading, line by line:

* `register` itself returns `undefined` (the function has no `return`). Only the
  `PluginManager` wrapper returns `this`. The `.d.ts` is **honest** about the statics —
  `types/phaser.d.ts:27163` `static register(factoryType: string, factoryFunction: Function): void;`
  and `:27169` for `remove`; `GameObjectCreator`'s pair is at `:26518` / `:26528`.
* Re-registering `'probe'` left the **first** function installed.
* `remove` of an unregistered key is a safe no-op — the guard at `:216` covers it.
* The guard is `hasOwnProperty`, not `in`. A name that exists only on a **prototype
  ancestor** is not "own", so registration over it succeeds and shadows it.
* A name that collides with a real `GameObjectFactory` method — `existing`, `boot`,
  `start`, `shutdown`, `destroy`, `scene`, `systems`, `events`, `displayList`,
  `updateList` — is an own property of the prototype (methods) and is therefore
  **silently refused**. Your registration appears to succeed and nothing happens.

**Consequence for the plan:** `isoSprite` collides with nothing, so registration will
land. But the plugin must never assume its callback is the one installed: if a user has
another isometric plugin loaded first, ours is silently dropped and every `this.add.isoSprite`
call goes to the other plugin's implementation. If the plan wants a diagnostic, the only
honest test is a post-registration identity check:

```javascript
Phaser.GameObjects.GameObjectFactory.prototype.isoSprite === ourFactoryFn
```

### 1.5 The package does not export its sources

`phaser@4.2.1` `package.json` `exports` has exactly two subpaths:

```json
{"types":"./types/phaser.d.ts","main":"./src/phaser.js","module":"./dist/phaser.esm.js",
 "exports":{".":{"types":"./types/phaser.d.ts","import":"./dist/phaser.esm.js",
 "require":"./dist/phaser.js","default":"./dist/phaser.esm.js"},
 "./package.json":"./package.json"}}
```

`require('phaser/src/gameobjects/GameObjectFactory')` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. The plugin cannot deep-import Phaser internals; it must
reach `GameObjectFactory` either via the `Phaser` root export
(`Phaser.GameObjects.GameObjectFactory`) or, preferably, via the injected PluginManager.

---

## 2. `src/gameobjects/GameObjectFactory.js` — binding, `this`, and when the context is populated

### 2.1 How the method gets bound

It is not bound. `register` assigns a plain function onto the **prototype**
(`GameObjectFactory.js:201`). When the user writes `this.add.isoSprite(...)`, ordinary
JavaScript method dispatch supplies the receiver. `this` inside the callback is therefore
**the per-Scene `GameObjectFactory` instance** — not the plugin, not the Scene.

Phaser states this twice, and it is true both times:

`PluginManager.js:759-769` (JSDoc on `registerGameObject`):

```
 * The callbacks are what are called when the factories try to create a Game Object
 * matching the given key. It's important to understand that the callbacks are invoked within
 * the context of the GameObjectFactory. In this context there are several properties available
 * to use:
 *
 * this.scene - A reference to the Scene that owns the GameObjectFactory.
 * this.displayList - A reference to the Display List the Scene owns.
 * this.updateList - A reference to the Update List the Scene owns.
```

and as a trailing comment on every built-in factory file, e.g.
`src/gameobjects/sprite/SpriteFactory.js:30-36`:

```javascript
//  When registering a factory function 'this' refers to the GameObjectFactory context.
//
//  There are several properties available to use:
//
//  this.scene - a reference to the Scene that owns the GameObjectFactory
//  this.displayList - a reference to the Display List the Scene owns
//  this.updateList - a reference to the Update List the Scene owns
```

**Corollary the plan must respect: the factory callback must be a `function`, never an
arrow function.** An arrow captures the enclosing `this` and the whole context is lost.

### 2.2 What `this.scene` / `this.displayList` / `this.updateList` are, and WHEN

`GameObjectFactory.js:31-85` — the constructor:

```javascript
    function GameObjectFactory (scene)
    {
        this.scene = scene;
        this.systems = scene.sys;
        this.events = scene.sys.events;
        this.displayList;
        this.updateList;

        this.events.once(SceneEvents.BOOT, this.boot, this);
        this.events.on(SceneEvents.START, this.start, this);
    },
```

(elided JSDoc; the assignments are at `:41`, `:51`, `:61`, and the two bare
statements at `:71` and `:81`.)

`this.displayList` and `this.updateList` are **declared and left `undefined`** in the
constructor — `:71` and `:81` are bare expression statements, they assign nothing.

They are populated in `boot`, `GameObjectFactory.js:95-101`:

```javascript
    boot: function ()
    {
        this.displayList = this.systems.displayList;
        this.updateList = this.systems.updateList;

        this.events.once(SceneEvents.DESTROY, this.destroy, this);
    },
```

reached only via the `SceneEvents.BOOT` subscription at `:83`. That event is emitted at
`src/scene/Systems.js:332` (see §6).

They are nulled again in `destroy`, `GameObjectFactory.js:170-182`:

```javascript
    destroy: function ()
    {
        this.shutdown();

        this.events.off(SceneEvents.START, this.start, this);

        this.scene = null;
        this.systems = null;
        this.events = null;

        this.displayList = null;
        this.updateList = null;
    }
```

**Timeline for `this.displayList` inside a factory callback:**

| moment | `this.scene` | `this.displayList` |
| --- | --- | --- |
| GameObjectFactory constructor | set | `undefined` |
| Scene `BOOT` (`Systems.js:332`) → `boot()` | set | set |
| Scene `init` / `preload` / `create` / any user code | set | set |
| Scene `DESTROY` → `destroy()` | `null` | `null` |

Since a factory callback can only be invoked from user code, and user code runs after
`BOOT`, `this.displayList` is always live at call time. The `undefined` window matters
only if the *plugin* touches `factory.displayList` during its own construction — which it
must not.

### 2.3 The one non-factory method worth knowing: `existing`

`GameObjectFactory.js:132-147`:

```javascript
    existing: function (child)
    {
        if (child.renderCanvas || child.renderWebGL)
        {
            this.displayList.add(child);
        }

        //  For when custom objects have overridden `preUpdate` but don't hook into the ADDED_TO_SCENE event:
        //  Adding to the list multiple times is safe, as it won't add duplicates into the list anyway.
        if (child.preUpdate)
        {
            this.updateList.add(child);
        }

        return child;
    },
```

This is the escape hatch for `new IsoSprite(...)` constructed outside the factory. Note it
adds to the update list *directly and unconditionally* when `preUpdate` exists — a
different path from the event-driven one the factories use (§3.3).

---

## 3. The built-in `sprite` and `image` factories — the shape to copy

### 3.1 `sprite`, verbatim

`src/gameobjects/sprite/SpriteFactory.js`, complete file body (lines 7-36; the 6-line
license header is omitted):

```javascript
var GameObjectFactory = require('../GameObjectFactory');
var Sprite = require('./Sprite');

/**
 * Creates a new Sprite Game Object and adds it to the Scene.
 *
 * Note: This method will only be available if the Sprite Game Object has been built into Phaser.
 *
 * @method Phaser.GameObjects.GameObjectFactory#sprite
 * @since 3.0.0
 *
 * @param {number} x - The horizontal position of this Game Object in the world.
 * @param {number} y - The vertical position of this Game Object in the world.
 * @param {(string|Phaser.Textures.Texture)} texture - The key, or instance of the Texture this Game Object will use to render with, as stored in the Texture Manager.
 * @param {(string|number)} [frame] - An optional frame from the Texture this Game Object is rendering with.
 *
 * @return {Phaser.GameObjects.Sprite} The Game Object that was created.
 */
GameObjectFactory.register('sprite', function (x, y, texture, frame)
{
    return this.displayList.add(new Sprite(this.scene, x, y, texture, frame));
});

//  When registering a factory function 'this' refers to the GameObjectFactory context.
//
//  There are several properties available to use:
//
//  this.scene - a reference to the Scene that owns the GameObjectFactory
//  this.displayList - a reference to the Display List the Scene owns
//  this.updateList - a reference to the Update List the Scene owns
```

The body is one line, `SpriteFactory.js:27`:

```javascript
    return this.displayList.add(new Sprite(this.scene, x, y, texture, frame));
```

### 3.2 `image`, verbatim

`src/gameobjects/image/ImageFactory.js:25-28`:

```javascript
GameObjectFactory.register('image', function (x, y, texture, frame)
{
    return this.displayList.add(new Image(this.scene, x, y, texture, frame));
});
```

Structurally identical. The require order differs cosmetically (`Image` first at `:7`,
`GameObjectFactory` second at `:8`) and the trailing comment block is the same.

### 3.3 How the object reaches the display list and the update list — exactly

**Display list:** directly, by the factory's own `this.displayList.add(...)`.

`DisplayList` extends `List` (`DisplayList.js:31`), and installs its own add callback,
`DisplayList.js:76-78`:

```javascript
        //  Set the List callbacks
        this.addCallback = this.addChildCallback;
        this.removeCallback = this.removeChildCallback;
```

`src/structs/List.js:116-126`:

```javascript
    add: function (child, skipCallback)
    {
        if (skipCallback)
        {
            return ArrayUtils.Add(this.list, child);
        }
        else
        {
            return ArrayUtils.Add(this.list, child, 0, this.addCallback, this);
        }
    },
```

`src/utils/array/Add.js:46-62` — the return value the factory propagates:

```javascript
    if (!Array.isArray(item))
    {
        if (array.indexOf(item) === -1)
        {
            array.push(item);

            if (callback)
            {
                callback.call(context, item);
            }

            return item;
        }
        else
        {
            return null;
        }
    }
```

So `this.displayList.add(gameObject)` returns **the game object itself** — which is why
`return this.displayList.add(new Sprite(...))` is a correct factory. Note the `null`
branch at `Add.js:61`: adding an object that is *already* in the list returns `null`. For
a freshly-constructed object that cannot happen. The JSDoc on `List.add`
(`List.js:114`) claims `@return {*} The list's underlying array.` — **that is wrong**;
`Add` returns the item, never the array, in the scalar path.

**Update list:** *not* by the factory. Indirectly, through an event.

1. `DisplayList.addChildCallback`, `DisplayList.js:108-130`:

```javascript
    addChildCallback: function (gameObject)
    {
        if (gameObject.displayList && gameObject.displayList !== this)
        {
            gameObject.removeFromDisplayList();
        }

        if (gameObject.parentContainer)
        {
            gameObject.parentContainer.remove(gameObject);
        }

        if (!gameObject.displayList)
        {
            this.queueDepthSort();

            gameObject.displayList = this;

            gameObject.emit(GameObjectEvents.ADDED_TO_SCENE, gameObject, this.scene);

            this.events.emit(SceneEvents.ADDED_TO_SCENE, gameObject, this.scene);
        }
    },
```

2. Every GameObject subscribes itself in its constructor, `src/gameobjects/GameObject.js:282-283`:

```javascript
        this.on(Events.ADDED_TO_SCENE, this.addedToScene, this);
        this.on(Events.REMOVED_FROM_SCENE, this.removedFromScene, this);
```

3. `Sprite` overrides the handler, `src/gameobjects/sprite/Sprite.js:139-142`:

```javascript
    addedToScene: function ()
    {
        this.scene.sys.updateList.add(this);
    },
```

and its mirror, `Sprite.js:153-156`:

```javascript
    removedFromScene: function ()
    {
        this.scene.sys.updateList.remove(this);
    },
```

`UpdateList` extends `ProcessQueue` (`UpdateList.js:30`), whose `add` is idempotent —
`src/structs/ProcessQueue.js:179-192`:

```javascript
    add: function (item)
    {
        //  Don't add if already active or pending, but DO add if active AND in the destroy list
        if (this.checkQueue && (this.isActive(item) && !this.isDestroying(item)) || this.isPending(item))
        {
            return item;
        }

        this._pending.push(item);

        this._toProcess++;

        return item;
    },
```

**The load-bearing consequence:** an `IsoSprite` that extends `Phaser.GameObjects.Sprite`
inherits `addedToScene` / `removedFromScene` and is therefore wired to the update list for
free — **provided the subclass does not override `addedToScene` without calling `super`**.
If the plugin needs to hook `addedToScene` (e.g. to register the sprite with an iso depth
manager), it MUST chain:

```javascript
addedToScene () { super.addedToScene(); /* iso bookkeeping */ }
```

Forget the `super` call and animations stop advancing, silently, with no error — because
`preUpdate` (`Sprite.js:168-171`, `this.anims.update(time, delta)`) is never called.

---

## 4. `Phaser.GameObjects.Sprite` in v4 — signature and subclass contract

### 4.1 Yes, `(scene, x, y, texture, frame)` is unchanged

`src/gameobjects/sprite/Sprite.js:79-111`, the constructor complete:

```javascript
    function Sprite (scene, x, y, texture, frame)
    {
        GameObject.call(this, scene, 'Sprite');

        this._crop = this.resetCropObject();

        this.anims = new AnimationState(this);

        this.setTexture(texture, frame);
        this.setPosition(x, y);
        this.setSizeToFrame();
        this.setOriginFromFrame();
        this.initRenderNodes(this._defaultRenderNodesMap);
    },
```

(elided JSDoc blocks; assignments at `:91` and `:104`, call chain at `:106-110`.)

The declaration agrees, `types/phaser.d.ts:66465`:

```typescript
            constructor(scene: Phaser.Scene, x: number, y: number, texture: string | Phaser.Textures.Texture, frame?: string | number);
```

Verified: an ES-class subclass calling `super(scene, x, y, texture, frame)` compiles clean
under `strict` against the shipped `.d.ts`.

### 4.2 What a subclass MUST do

**(a) Call `super(scene, x, y, texture, frame)` first.** That is the only way
`GameObject.call(this, scene, 'Sprite')` runs, and it is what sets `this.scene`
(`GameObject.js:71`), `this.displayList = null` (`GameObject.js:85`), `this.type`
(`GameObject.js:95`), and installs the two scene-membership listeners
(`GameObject.js:282-283`).

**(b) Reset `this.type` afterwards if the plan wants it.** `Sprite` hardcodes the string:
`Sprite.js:81` passes `'Sprite'`, and `GameObject.js:95` does `this.type = type;`. A
subclass therefore reports `type === 'Sprite'` unless it assigns
`this.type = 'IsoSprite'` in its own constructor body, after `super`. The property is a
plain writable field, not an accessor — `GameObject.js:88-94` JSDoc says
"Used internally by Phaser but is available for your own custom classes to populate."

**(c) Do not declare a class field that collides with an inherited accessor.**
`Sprite.js:123-128` defines `_defaultRenderNodesMap` as a **getter** on the prototype, and
the mixin list at `Sprite.js:58-75` contributes accessor-backed properties (`x`, `y`,
`depth`, `alpha`, `visible`, `originX`, …). Under `useDefineForClassFields: true` a
subclass field of the same name is installed with `Object.defineProperty` as an own **data**
property, shadowing the accessor and silently breaking rendering. This repo already sets
`"useDefineForClassFields": false` in `tsconfig.base.json`, which neutralises the trap —
that setting is now load-bearing and must not be removed.

**(d) New fields are safe.** A field named `isoX`, `isoY`, `isoZ` collides with nothing on
`Sprite` or its mixins.

---

## 5. `GameObjectCreator` — the `this.make.isoSprite` half

### 5.1 A parallel registration IS required

They are two independent prototypes. Registering only a factory callback gives
`this.add.isoSprite` and leaves `this.make.isoSprite` undefined. `registerGameObject`
makes both optional and independent — `PluginManager.js:780` and `:785` are two separate
`if` guards.

### 5.2 The register signature — identical shape, identical guard

`src/gameobjects/GameObjectCreator.js:165-171`:

```javascript
GameObjectCreator.register = function (factoryType, factoryFunction)
{
    if (!GameObjectCreator.prototype.hasOwnProperty(factoryType))
    {
        GameObjectCreator.prototype[factoryType] = factoryFunction;
    }
};
```

`src/gameobjects/GameObjectCreator.js:186-192`:

```javascript
GameObjectCreator.remove = function (factoryType)
{
    if (GameObjectCreator.prototype.hasOwnProperty(factoryType))
    {
        delete GameObjectCreator.prototype[factoryType];
    }
};
```

`GameObjectCreator.js:194` registers the plugin itself:
`PluginCache.register('GameObjectCreator', GameObjectCreator, 'make');`
(the `GameObjectFactory` equivalent is `GameObjectFactory.js:222`, mapping `'add'`).

Same module-global storage, same silent-refusal-on-collision semantics, same `void`
return. Same `.d.ts` declarations at `types/phaser.d.ts:26518` and `:26528`.

### 5.3 The creator's `this` context

`GameObjectCreator.js:31-85` is a near-verbatim copy of the factory constructor:
`this.scene` (`:41`), `this.systems` (`:51`), `this.events` (`:61`), and the same two
un-assigned declarations `this.displayList` (`:71`) and `this.updateList` (`:81`),
populated in `boot` at `:97-98`. The lifecycle is identical.

### 5.4 The creator callback's contract is DIFFERENT from the factory's

`src/gameobjects/sprite/SpriteCreator.js:26-47`, verbatim:

```javascript
GameObjectCreator.register('sprite', function (config, addToScene)
{
    if (config === undefined) { config = {}; }

    var key = GetAdvancedValue(config, 'key', null);
    var frame = GetAdvancedValue(config, 'frame', null);

    var sprite = new Sprite(this.scene, 0, 0, key, frame);

    if (addToScene !== undefined)
    {
        config.add = addToScene;
    }

    BuildGameObject(this.scene, sprite, config);

    //  Sprite specific config options:

    BuildGameObjectAnimation(sprite, config);

    return sprite;
});
```

Note the differences the plan must not blur:

* signature is `(config, addToScene)`, **not** `(x, y, texture, frame)`;
* the object is constructed at `(0, 0)` and positioned later by `BuildGameObject`;
* the creator does **not** touch `this.displayList` — `BuildGameObject` decides, honouring
  `config.add`. The class JSDoc says so at `GameObjectCreator.js:17-18`:
  "Game Objects made via this class are automatically added to the Scene and Update List
  unless you explicitly set the `add` property in the configuration object to `false`."
* `addToScene`, when passed explicitly, **overwrites the caller's config object**
  (`SpriteCreator.js:37` mutates `config.add`). A creator callback for `isoSprite` should
  copy this behaviour to stay consistent, and the plan should note that the user's config
  object is mutated.

---

## 6. Timing — when may `registerGameObject` be called?

### 6.1 The short answer

**There is no timing constraint at all.** Module top level, plugin constructor, plugin
`boot()`, or a Scene's `create()` — all work identically, because the registry is a
prototype property (§1.3) and JavaScript method lookup is dynamic. The only thing that
changes with timing is *whether an earlier registration of the same key has already won*
(§1.4).

The rest of this section shows the code that makes that true, and the two ordering facts
that DO matter for a ScenePlugin.

### 6.2 The Scene bring-up sequence

`src/scene/Systems.js:313-335`:

```javascript
    init: function (game)
    {
        this.settings.status = CONST.INIT;

        //  This will get replaced by the SceneManager with the actual update function, if it exists, once create is over.
        this.sceneUpdate = NOOP;

        this.game = game;
        this.renderer = game.renderer;

        this.canvas = game.canvas;
        this.context = game.context;

        var pluginManager = game.plugins;

        this.plugins = pluginManager;

        pluginManager.addToScene(this, DefaultPlugins.Global, [ DefaultPlugins.CoreScene, GetScenePlugins(this), GetPhysicsPlugins(this) ]);

        this.events.emit(Events.BOOT, this);

        this.settings.isBooted = true;
    },
```

Read the three load-bearing lines:

* `:328` — `sys.plugins` is assigned **before** `addToScene`, so `GetScenePlugins(this)`
  (which calls `sys.plugins.getDefaultScenePlugins()` at `GetScenePlugins.js:25`) has a
  PluginManager to work with.
* `:330` — every scene plugin, core and custom, is constructed inside this one call.
* `:332` — `SceneEvents.BOOT` is emitted only **after** `addToScene` returns.

### 6.3 Inside `addToScene`: constructors run, `boot` does not

`src/plugins/PluginManager.js:258-295`:

```javascript
        for (var s = 0; s < scenePlugins.length; s++)
        {
            pluginList = scenePlugins[s];

            for (i = 0; i < pluginList.length; i++)
            {
                pluginKey = pluginList[i];

                if (!PluginCache.hasCore(pluginKey))
                {
                    continue;
                }

                var source = PluginCache.getCore(pluginKey);

                var mapKey = source.mapping;

                var plugin = new source.plugin(scene, this, mapKey);

                sys[mapKey] = plugin;

                //  Scene level injection
                if (source.custom)
                {
                    scene[mapKey] = plugin;
                }
                else if (map.hasOwnProperty(mapKey))
                {
                    scene[map[mapKey]] = plugin;
                }

                //  Scene is already booted, usually because this method is being called at run-time, so boot the plugin
                if (isBooted)
                {
                    plugin.boot();
                }
            }
        }
```

`:275` is where a ScenePlugin instance is born:
`var plugin = new source.plugin(scene, this, mapKey);` — arguments
`(scene, pluginManager, pluginKey)`, matching `ScenePlugin.js:40`.

The outer loop walks the array-of-arrays from `Systems.js:330` in order:
`[ CoreScene, GetScenePlugins(sys), GetPhysicsPlugins(sys) ]`. `GameObjectFactory` and
`GameObjectCreator` are in the first element — `src/plugins/DefaultPlugins.js:63-74`:

```javascript
    CoreScene: [

        'EventEmitter',

        'CameraManager',
        'GameObjectCreator',
        'GameObjectFactory',
        'ScenePlugin',
        'DisplayList',
        'UpdateList'

    ],
```

So by the time a **custom** ScenePlugin's constructor runs, the Scene's
`GameObjectFactory` instance already exists — but its `displayList` is still `undefined`
(§2.2), because `boot()` has not fired. This does not matter: registration touches the
prototype, not the instance.

`:290-293` is the run-time branch — a Scene added after the game booted has
`settings.isBooted === true`, so `plugin.boot()` is called synchronously right there
instead of via the `BOOT` event.

### 6.4 What a ScenePlugin constructor has available

`src/plugins/ScenePlugin.js:40-84`:

```javascript
    function ScenePlugin (scene, pluginManager, pluginKey)
    {
        BasePlugin.call(this, pluginManager);

        this.scene = scene;
        this.systems = scene.sys;
        this.pluginKey = pluginKey;

        scene.sys.events.once(SceneEvents.BOOT, this.boot, this);
    },
```

(elided JSDoc; assignments at `:55`, `:68`, `:81`, subscription at `:83`.)

and `src/plugins/BasePlugin.js:30-52`:

```javascript
    function BasePlugin (pluginManager)
    {
        this.pluginManager = pluginManager;

        this.game = pluginManager.game;
    },
```

So `this.pluginManager` is set by the first statement of the base constructor —
`this.pluginManager.registerGameObject('isoSprite', factoryFn, creatorFn)` is valid from
the very next line of a subclass constructor. Equally valid: `scene.sys.plugins`
(`Systems.js:328`) or `scene.plugins` (`src/scene/InjectionMap.js:24`, `plugins: 'plugins'`).

`ScenePlugin.boot` (`ScenePlugin.js:121-123`) is an empty override point.

### 6.5 Two ordering facts that DO bite

**(a) A Scene-level `plugins` array replaces the defaults wholesale.**
`src/scene/GetScenePlugins.js:23-43`:

```javascript
var GetScenePlugins = function (sys)
{
    var defaultPlugins = sys.plugins.getDefaultScenePlugins();

    var scenePlugins = GetFastValue(sys.settings, 'plugins', false);

    //  Scene Plugins always override Default Plugins
    if (Array.isArray(scenePlugins))
    {
        return scenePlugins;
    }
    else if (defaultPlugins)
    {
        return defaultPlugins;
    }
    else
    {
        //  No default plugins or plugins in this scene
        return [];
    }
};
```

A user who writes `plugins: [ 'IsoPlugin' ]` in a Scene config loses Loader, Input,
Tweens and the rest of `DefaultPlugins.DefaultScene`. The CoreScene list is a separate
array element and survives. This is a documentation landmine, not a code one.

**(b) `mapping` is effectively mandatory for a custom ScenePlugin.**
`PluginCache.register` has no default for it — `src/plugins/PluginCache.js:34-39`:

```javascript
PluginCache.register = function (key, plugin, mapping, custom)
{
    if (custom === undefined) { custom = false; }

    corePlugins[key] = { plugin: plugin, mapping: mapping, custom: custom };
};
```

and the game-config path passes `null` when the entry omits it —
`PluginManager.js:191`, `mapping = GetFastValue(entry, 'mapping', null);`, forwarded at
`:197` to `installScenePlugin(key, plugin, mapping)`, which stores it at
`PluginManager.js:372`, `PluginCache.register(key, plugin, mapping, true);`.

Then `addToScene:273` reads `var mapKey = source.mapping;` → `null`, and `:277` executes
`sys[null] = plugin`. The plugin instance is installed under the property name `"null"`
and is unreachable by any sane name.

**(c) The two installation paths disagree with each other, and the JSDoc describes only
one of them.** `installScenePlugin`'s own JSDoc, `PluginManager.js:335-345`:

```
 * The `key` property is what the plugin is injected into Scene.Systems as.
 * The `mapping` property is optional, and if specified is what the plugin is installed into
 * the Scene as. For example:
 *
 * this.plugins.installScenePlugin('powerupsPlugin', pluginCode, 'powerups');
 *
 * // and from within the scene:
 * this.sys.powerupsPlugin; // key value
 * this.powerups; // mapping value
```

That describes the direct branch, `PluginManager.js:386-398`:

```javascript
        if (addToScene)
        {
            var instance = new plugin(addToScene, this, key);

            addToScene.sys[key] = instance;

            if (mapping && mapping !== '')
            {
                addToScene[mapping] = instance;
            }

            instance.boot();
        }
```

— `sys[key]`, `scene[mapping]`, and note `new plugin(addToScene, this, key)` passes the
**key** as the third constructor argument, where `addToScene:275` passes the **mapping**.

But every Scene created *afterwards* goes through `addToScene`, which does
`sys[mapKey]` / `scene[mapKey]` with `mapKey = mapping`. So `this.sys.powerupsPlugin`
exists on the Scene you installed into and **does not exist on any later Scene** — where
it is `this.sys.powerups` instead. The JSDoc is true of one code path and false of the
other. `ScenePlugin#pluginKey` likewise holds the key on one path and the mapping on the
other.

Practical rule for the plan: set `key` and `mapping` to **the same string**, and the
divergence disappears.

**(d) `installScenePlugin` DOES warn on a duplicate key** — unlike `registerGameObject`.
`PluginManager.js:375-384`:

```javascript
        if (this.scenePlugins.indexOf(key) === -1)
        {
            this.scenePlugins.push(key);
        }
        else if (!fromLoader && PluginCache.hasCore(key))
        {
            //  Plugin wasn't from the loader but already exists
            console.warn('Scene Plugin key in use: ' + key);
            return;
        }
```

So the two halves of "install an isometric plugin" have **opposite** collision behaviour:
the ScenePlugin half warns and bails; the GameObject half is silent.

### 6.6 Nothing ever calls a ScenePlugin's `destroy()`

`ScenePlugin.js:126-141` claims:

```
     * Destroys this plugin and releases all references it holds, including the Scene, Scene Systems,
     * and Plugin Manager. This method is called automatically when the Scene is destroyed.
```

```javascript
    destroy: function ()
    {
        this.pluginManager = null;
        this.game = null;
        this.scene = null;
        this.systems = null;
    }
```

"called automatically when the Scene is destroyed" is **false in 4.2.1**.

`src/scene/Systems.js:800-820` — the Scene's own destroy:

```javascript
    destroy: function ()
    {
        var events = this.events;
        var settings = this.settings;

        settings.status = CONST.DESTROYED;

        settings.active = false;
        settings.visible = false;

        events.emit(Events.DESTROY, this);

        events.removeAllListeners();

        var props = [ 'scene', 'game', 'anims', 'cache', 'plugins', 'registry', 'sound', 'textures', 'add', 'cameras', 'displayList', 'events', 'make', 'scenePlugin', 'updateList' ];

        for (var i = 0; i < props.length; i++)
        {
            this[props[i]] = null;
        }
    }
```

It emits `DESTROY` and nulls a **hardcoded** list of core plugin keys. A custom plugin's
`sys[mapping]` is not in that list and its `destroy` is not called.

The only `.destroy()` dispatch in the plugin system is over **global** plugins —
`src/plugins/PluginManager.js:875-892`:

```javascript
    destroy: function ()
    {
        for (var i = 0; i < this.plugins.length; i++)
        {
            this.plugins[i].plugin.destroy();
        }

        PluginCache.destroyCustomPlugins();

        if (this.game.noReturn)
        {
            PluginCache.destroyCorePlugins();
        }

        this.game = null;
        this.plugins = [];
        this.scenePlugins = [];
    }
```

`this.plugins` is the global-plugin entry array (`PluginManager.js:95` initialises
`this.scenePlugins = []` separately). A grep for `scenePlugins` across the whole of
`src/` returns only the eleven sites listed at `PluginManager.js:91,95,225,227,258,260,325,375,377,739,891`
and `GetScenePlugins.js:27,30,32` — none of them iterate instances to destroy them.

**Consequence:** if the plugin wants teardown, it must subscribe itself in `boot()`:

```javascript
this.systems.events.once(Phaser.Scenes.Events.DESTROY, this.myTeardown, this);
```

And per §1.3, that teardown must **not** call `removeGameObject`.

---

## 7. TypeScript reality check (measured, not remembered)

All of the following was run with the repo's own `typescript@5.7.3`
(`node_modules/.bin/tsc`) against `types/phaser.d.ts` from the 4.2.1 install.

**(a) The shipped `.d.ts` does not typecheck itself.** Under `--strict` without
`skipLibCheck`, compiling a file whose only content is a reference to `phaser.d.ts`
produces two errors *inside the declaration file*:

```
types/phaser.d.ts(22,45): error TS2526: A 'this' type is available only in a non-static member of a class or interface.
types/phaser.d.ts(124835,21): error TS2416: Property 'run' in type 'SubmitterMeshToQuad' is not assignable to the same property in base type 'SubmitterQuad'.
```

Line 22 is a global function declaration returning `this`:

```typescript
declare function setFlipV(value?: boolean): this;
```

With `"skipLibCheck": true` the same compile exits 0. This repo already has
`"skipLibCheck": true` in `tsconfig.base.json` — **that setting is now load-bearing and
must not be removed**, or adding the `phaser` peer will break `pnpm typecheck` with errors
that have nothing to do with our code.

**(b) `this.displayList` in a factory callback compiles — with the right `this` parameter.**
The context properties are declared, but `protected` —
`types/phaser.d.ts:27125`, `:27130`, `:27140`, `:27145`:

```typescript
             protected scene: Phaser.Scene;
             protected systems: Phaser.Scenes.Systems;
             protected displayList: Phaser.GameObjects.DisplayList;
             protected updateList: Phaser.GameObjects.UpdateList;
```

Accessing them off a plain instance fails:

```
probe3.ts(3,22): error TS2445: Property 'displayList' is protected and only accessible within class 'GameObjectFactory' and its subclasses.
```

But a function that declares `this: Phaser.GameObjects.GameObjectFactory` as its `this`
parameter **compiles clean** — this exact source exits 0:

```typescript
const fn = function (this: Phaser.GameObjects.GameObjectFactory) {
    const dl: Phaser.GameObjects.DisplayList = this.displayList;
    const sc: Phaser.Scene = this.scene;
    const ul: Phaser.GameObjects.UpdateList = this.updateList;
    return [ dl, sc, ul ];
};
```

No cast, no `as any`, no `@ts-ignore` is needed. The plan should spell this idiom out
verbatim, because the obvious workaround an implementer would reach for (`as any`) throws
away the only type safety in the file.

**(c) Both module-augmentation forms work.** `phaser.d.ts` declares a **global namespace**
(`:40`, `declare namespace Phaser {`) and re-exports it as a module at the very end
(`:148648-148651`):

```typescript
declare module 'phaser' {
    export = Phaser;

}
```

Both of these compiled clean and both produced real, checked types:

```typescript
// Form A — through the module specifier
declare module 'phaser' {
    namespace GameObjects {
        interface GameObjectFactory {
            isoSprite (x: number, y: number, texture: string): IsoSprite;
        }
    }
}

// Form B — the global namespace
declare global {
    namespace Phaser.GameObjects {
        interface GameObjectFactory { isoSprite (x: number, y: number, texture: string): IsoSprite; }
        interface GameObjectCreator { isoSprite (config: object, addToScene?: boolean): IsoSprite; }
    }
}
```

Negative control, confirming the augmentation is real and `scene.add` is not silently
`any`:

```
aug2.ts(3,30): error TS2339: Property 'notRegisteredAnywhere' does not exist on type 'GameObjectFactory'.
aug2.ts(4,43): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
```

Form B (`declare global`) is the safer choice for a published library: it does not depend
on the consumer's module resolution finding the same `'phaser'` specifier, and it merges
with the same global namespace the `.d.ts` itself declares.

---

## Implications for the plugin

**1. The registry is a global mutable singleton. Treat it as one.**
`GameObjectFactory.prototype` is shared by every Scene and every Game on the page. That
buys us something valuable — registration can happen anywhere, at any time, and every
Scene sees it — but it also means the plugin owns a piece of global state it did not
allocate. Two rules follow:

* **Never call `removeGameObject`.** Not in `destroy`, not in a `shutdown` handler, not
  "for hygiene". A second Scene using `isoSprite` would lose the method mid-game with a
  `TypeError: this.add.isoSprite is not a function`. Phaser itself never cleans up a
  registered game object (§6.6), and the correct behaviour is to match that. If a
  `removeGameObject` call appears anywhere in the plan, it is a bug.
* **Registration is idempotent by accident, not by design.** Installing IsoPlugin in five
  Scenes calls `registerGameObject` five times; calls 2-5 are silent no-ops. That is
  fine and needs no guard — but the plan should say so explicitly so no one adds a
  "already registered?" flag that is really a per-Game flag masking a global registry.

**2. Register from the ScenePlugin constructor.** It is the earliest point where
`this.pluginManager` exists (`BasePlugin.js:41`), it runs once per Scene, and it needs no
event subscription. Module top level also works, but couples the side effect to import
order and makes the plugin unusable as a value. `boot()` works too and is a defensible
alternative. What does *not* work is any form that depends on `this.displayList` being
populated at registration time — it is `undefined` until `SceneEvents.BOOT`
(`GameObjectFactory.js:97-98`).

**3. The `isoSprite` factory is one line, and it must be a `function`.** Copy the
`SpriteFactory.js:27` shape exactly:

```javascript
function (x, y, z, texture, frame) {
    return this.displayList.add(new IsoSprite(this.scene, x, y, z, texture, frame));
}
```

An arrow function loses `this` and the plugin dies at the first call. The `displayList.add`
return value **is** the game object (`Add.js:57`), so the `return` is correct as written —
do not "fix" it to `return sprite`.

**4. Do not add to the update list by hand.** Extending `Sprite` inherits
`addedToScene` (`Sprite.js:139-142`), which the `ADDED_TO_SCENE` event fires
(`DisplayList.js:126` → `GameObject.js:282`). If `IsoSprite` overrides `addedToScene` for
iso bookkeeping, it must call `super.addedToScene()` — otherwise animations stop with no
error. This is the single most likely silent bug in the whole shell.

**5. `this.type` must be set manually.** `Sprite.js:81` hardcodes `'Sprite'`. If
`snapshot()` or the debug subpath keys off `type`, an `IsoSprite` will report `'Sprite'`
unless the constructor assigns `this.type = 'IsoSprite'` after `super(...)`.

**6. Ship the creator too, or document its absence.** `this.make.isoSprite` requires a
second, differently-shaped callback: `(config, addToScene)`, construct at `(0,0)`, let
`BuildGameObject` place it and decide on `config.add` (`SpriteCreator.js:26-47`). Skipping
it is a legitimate v1 scope cut — but it must be a *stated* one, because
`registerGameObject`'s third argument being optional makes the omission invisible.

**7. TypeScript specifics that must be transcribed exactly, not improvised:**

* `registerGameObject` is typed `void` but returns `this` — call it as a statement.
* The factory callback needs `this: Phaser.GameObjects.GameObjectFactory` as its first
  (type-only) parameter to reach the `protected` context properties. No cast required.
* Declare the new methods via `declare global { namespace Phaser.GameObjects { interface
  GameObjectFactory { … } interface GameObjectCreator { … } } }`.
* `"skipLibCheck": true` must stay in `tsconfig.base.json`; the shipped `phaser.d.ts` has
  two self-errors under `--strict`.
* `"useDefineForClassFields": false` must stay; `Sprite` and its mixins are accessor-based.

**8. Plugin installation config: set `key` and `mapping` to the same string.** Omitting
`mapping` installs the plugin as `sys[null]` (§6.5b). Using different values for `key` and
`mapping` makes the plugin reachable under one name on the Scene you installed it into and
a different name on every Scene created afterwards (§6.5c). One string for both, and the
documented access path is unambiguous.

**9. Documentation debt to record.** The Scene-config `plugins: [...]` array *replaces*
the default scene plugins rather than extending them (`GetScenePlugins.js:30-33`). A user
who follows the obvious pattern to install IsoPlugin loses the Loader and Input plugins.
The plugin's README must show the additive form (game-config `plugins.scene`) as the
primary example.

---

## Appendix — every claim, with its anchor

| Claim | Anchor |
| --- | --- |
| `registerGameObject` returns `this` | `src/plugins/PluginManager.js:790` |
| `removeGameObject` returns `this` | `src/plugins/PluginManager.js:819` |
| `.d.ts` declares both `void` | `types/phaser.d.ts:120722`, `:120731` |
| Registry is `GameObjectFactory.prototype` | `src/gameobjects/GameObjectFactory.js:201` |
| Second registration silently ignored | `src/gameobjects/GameObjectFactory.js:199` |
| `remove` guarded, safe on unknown key | `src/gameobjects/GameObjectFactory.js:216` |
| Creator: same guard, same storage | `src/gameobjects/GameObjectCreator.js:167`, `:189` |
| `this` in a factory = the GameObjectFactory instance | `src/gameobjects/sprite/SpriteFactory.js:30-36` |
| `displayList`/`updateList` undefined until `boot` | `GameObjectFactory.js:71,81` vs `:97-98` |
| `boot` reached via `SceneEvents.BOOT` | `GameObjectFactory.js:83` |
| `sprite` factory body | `src/gameobjects/sprite/SpriteFactory.js:27` |
| `image` factory body | `src/gameobjects/image/ImageFactory.js:27` |
| `displayList.add` returns the child | `src/utils/array/Add.js:57` |
| `List.add` JSDoc wrongly says "underlying array" | `src/structs/List.js:114` |
| Update list wired by `ADDED_TO_SCENE` | `DisplayList.js:126` → `GameObject.js:282` → `Sprite.js:141` |
| `ProcessQueue.add` is idempotent | `src/structs/ProcessQueue.js:182-185` |
| `Sprite(scene, x, y, texture, frame)` | `src/gameobjects/sprite/Sprite.js:79` |
| `Sprite` hardcodes `type === 'Sprite'` | `src/gameobjects/sprite/Sprite.js:81`, `GameObject.js:95` |
| `Sprite` uses a prototype getter | `src/gameobjects/sprite/Sprite.js:123-128` |
| `.d.ts` `Sprite` ctor agrees | `types/phaser.d.ts:66465` |
| Creator callback is `(config, addToScene)` | `src/gameobjects/sprite/SpriteCreator.js:26` |
| Creator mutates the caller's config | `src/gameobjects/sprite/SpriteCreator.js:37` |
| ScenePlugin ctor `(scene, pluginManager, pluginKey)` | `src/plugins/ScenePlugin.js:40` |
| `this.pluginManager` set first | `src/plugins/BasePlugin.js:41` |
| Scene plugins constructed at `addToScene` | `src/plugins/PluginManager.js:275` |
| `BOOT` emitted after `addToScene` | `src/scene/Systems.js:330` then `:332` |
| GameObjectFactory is a CoreScene plugin | `src/plugins/DefaultPlugins.js:69` |
| Scene `plugins` array replaces defaults | `src/scene/GetScenePlugins.js:30-33` |
| `mapping` has no default | `src/plugins/PluginCache.js:34-38` |
| Config path passes `mapping = null` | `src/plugins/PluginManager.js:191` |
| `addToScene` uses `sys[mapping]` | `src/plugins/PluginManager.js:273,277` |
| `installScenePlugin` uses `sys[key]` | `src/plugins/PluginManager.js:390` |
| Duplicate ScenePlugin key warns | `src/plugins/PluginManager.js:382` |
| ScenePlugin `destroy` JSDoc is false | `src/plugins/ScenePlugin.js:127` |
| `Systems.destroy` only emits + nulls a fixed list | `src/scene/Systems.js:811,815` |
| `PluginManager.destroy` iterates GLOBAL plugins only | `src/plugins/PluginManager.js:877-881` |
| `phaser` package exports no `./src/*` | `phaser/package.json` `exports` |
