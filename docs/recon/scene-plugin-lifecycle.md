# Dossier — `Phaser.Plugins.ScenePlugin` lifecycle and `config.plugins.scene` installation

**Read against real source, Phaser 4.2.1.**
Source root used: `/Users/xsec/projects/phaser/platformer/node_modules/phaser`
Drift-check root (4.0.0): `/Users/xsec/projects/phaser/first-game/node_modules/phaser`

> **Note on the requested path.** The task specified the source root and the deliverable path
> as the literal string `undefined`. Both roots were located empirically (see above) and this
> dossier was written to the project's own `docs/recon/` rather than into `node_modules`.

## Version drift: none in this area

Every file this dossier depends on is **byte-identical between 4.0.0 and 4.2.1**:

```
src/plugins/ScenePlugin.js               IDENTICAL
src/plugins/PluginManager.js             IDENTICAL
src/plugins/PluginCache.js               IDENTICAL
src/scene/Systems.js                     IDENTICAL
src/scene/GetScenePlugins.js             IDENTICAL
src/plugins/DefaultPlugins.js            IDENTICAL
```

(`diff -q` over the two trees.) The `^4.0.0` peer floor is safe for everything below.

---

## 1. `Phaser.Plugins.ScenePlugin` — the real constructor

### Constructor signature

`src/plugins/ScenePlugin.js:40`

```js
    function ScenePlugin (scene, pluginManager, pluginKey)
    {
        BasePlugin.call(this, pluginManager);
```

Three parameters, named exactly `scene`, `pluginManager`, `pluginKey`.

### What it assigns

| Property | Line | Assigned |
| --- | --- | --- |
| `this.pluginManager` | `src/plugins/BasePlugin.js:41` | `this.pluginManager = pluginManager;` |
| `this.game` | `src/plugins/BasePlugin.js:51` | `this.game = pluginManager.game;` |
| `this.scene` | `src/plugins/ScenePlugin.js:55` | `this.scene = scene;` |
| `this.systems` | `src/plugins/ScenePlugin.js:68` | `this.systems = scene.sys;` |
| `this.pluginKey` | `src/plugins/ScenePlugin.js:81` | `this.pluginKey = pluginKey;` |

Note `this.game` comes from `pluginManager.game` — so **a null `pluginManager` throws in the
constructor**, before any of the ScenePlugin body runs.

### The only event the base class hooks

`src/plugins/ScenePlugin.js:83`

```js
        scene.sys.events.once(SceneEvents.BOOT, this.boot, this);
```

That is the **entire** event wiring of the base class. One listener, `BOOT`, registered with
**`once`**. It does *not* hook `START`, `SHUTDOWN`, `DESTROY`, `UPDATE`, or anything else.

Because the constructor dereferences `scene.sys.events`, the plugin **cannot be constructed
before the Scene's `EventEmitter` core plugin exists**. `Systems`' constructor declares
`this.events` (`src/scene/Systems.js:240`) but never assigns it; the assignment happens when
`addToScene` instantiates the `EventEmitter` core plugin, which is first in the CoreScene list
(`src/plugins/DefaultPlugins.js:65`). Hand-constructing an `IsoPlugin` inside a `Scene`
constructor therefore throws on `undefined.once`.

### Default `boot()`

`src/plugins/ScenePlugin.js:121`

```js
    boot: function ()
    {
    },
```

**It is empty.** It does nothing at all — in particular it does **not** register a `DESTROY`
listener, which is what every one of Phaser's own scene plugins does in their `boot` (see §5).

### `destroy()`

`src/plugins/ScenePlugin.js:135`

```js
    destroy: function ()
    {
        this.pluginManager = null;
        this.game = null;
        this.scene = null;
        this.systems = null;
    }
```

Identical body to `BasePlugin.destroy` (`src/plugins/BasePlugin.js:121-127`), which also nulls
`this.scene` / `this.systems` — properties `BasePlugin` never sets.

### JSDoc lies in this file

1. **`src/plugins/ScenePlugin.js:127`** — *"This method is called automatically when the Scene
   is destroyed."* **False.** Nothing calls `destroy()` on a scene plugin. Proof in §3.
2. **`src/plugins/ScenePlugin.js:99`** — the boot-time list of listenable Scene events includes
   `resize`. **There is no `RESIZE` scene event.** `src/scene/events/index.js:11-36` has no
   such entry and no `RESIZE_EVENT.js` exists in `src/scene/events/`. (Resize is a Scale
   Manager event, `ScaleEvents.RESIZE`, which is how `CameraManager` gets it —
   `src/cameras/2d/CameraManager.js:163`.)
3. **`src/plugins/BasePlugin.js:59`** — *"On a Scene Plugin, this method [`init`] is never
   called."* This one is **true**, and it is the JSDoc that contradicts the config typedef (see
   §2).

---

## 2. Installation: what `config.plugins.scene` actually does with each field

### 2a. Config parsing

`src/core/Config.js:627-651`

```js
        var plugins = GetValue(config, 'plugins', null);
        var defaultPlugins = DefaultPlugins.DefaultScene;

        if (plugins)
        {
            //  Old 3.7 array format?
            if (Array.isArray(plugins))
            {
                this.defaultPlugins = plugins;
            }
            else if (IsPlainObject(plugins))
            {
                this.installGlobalPlugins = GetFastValue(plugins, 'global', []);
                this.installScenePlugins = GetFastValue(plugins, 'scene', []);
```

So `config.plugins.scene` → `game.config.installScenePlugins`, verbatim, unprocessed.

### 2b. `PluginManager.boot()` — the scene branch

`src/plugins/PluginManager.js:183-204`

```js
        for (i = 0; i < list.length; i++)
        {
            entry = list[i];

            // { key: 'moveSpritePlugin', plugin: MoveSpritePlugin, , mapping: 'move' }

            key = GetFastValue(entry, 'key', null);
            plugin = GetFastValue(entry, 'plugin', null);
            mapping = GetFastValue(entry, 'mapping', null);

            if (key)
            {
                if (plugin)
                {
                    this.installScenePlugin(key, plugin, mapping);
                }
                else
                {
                    console.warn('Missing `plugin` for key: ' + key);
                }
            }
        }
```

**Exactly three fields are read: `key`, `plugin`, `mapping`.**

- `start` — read for **global** plugins only (`PluginManager.js:159`). On the scene branch it
  is **never read**. Setting `start: true` on a `plugins.scene` entry does nothing.
- `data` — read for **global** plugins only (`PluginManager.js:161`). On the scene branch it is
  **never read**. It is dropped on the floor.
- `systemKey` / `sceneKey` — **never read anywhere on this path** (see the lie in §2f).

Note `installScenePlugin` is called with **three** arguments, so `addToScene` (4th param) is
`undefined` and the "install into a scene right now" branch does not run at boot.

### 2c. `installScenePlugin` — registration

`src/plugins/PluginManager.js:359-399`

```js
    installScenePlugin: function (key, plugin, mapping, addToScene, fromLoader)
    {
        if (fromLoader === undefined) { fromLoader = false; }

        if (typeof plugin !== 'function')
        {
            console.warn('Invalid Scene Plugin: ' + key);
            return;
        }

        if (!PluginCache.hasCore(key))
        {
            //  Plugin is freshly loaded
            PluginCache.register(key, plugin, mapping, true);
        }

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
    },
```

`PluginCache.register` (`src/plugins/PluginCache.js:34-39`):

```js
PluginCache.register = function (key, plugin, mapping, custom)
{
    if (custom === undefined) { custom = false; }

    corePlugins[key] = { plugin: plugin, mapping: mapping, custom: custom };
};
```

So after config boot: `corePlugins[key] = { plugin, mapping, custom: true }` and
`pm.scenePlugins` contains `key`. **No instance exists yet.**

### 2d. `addToScene` — where the instance is actually made

`src/scene/Systems.js:313-335` is the only caller:

```js
    init: function (game)
    {
        ...
        pluginManager.addToScene(this, DefaultPlugins.Global, [ DefaultPlugins.CoreScene, GetScenePlugins(this), GetPhysicsPlugins(this) ]);

        this.events.emit(Events.BOOT, this);

        this.settings.isBooted = true;
    },
```

`src/plugins/PluginManager.js:258-295`:

```js
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

### 2e. The answers, stated flatly

Given `{ key, plugin, mapping, start, data }` in `config.plugins.scene`:

| Question | Answer | Evidence |
| --- | --- | --- |
| Third constructor argument — `key` or `mapping`? | **`mapping`.** `new source.plugin(scene, this, mapKey)` where `mapKey = source.mapping`. | `PluginManager.js:273,275` |
| Written to `sys[key]` or `sys[mapping]`? | **`sys[mapping]`.** `sys[key]` is never assigned on this path. | `PluginManager.js:277` |
| Written to `scene[key]` or `scene[mapping]`? | **`scene[mapping]`**, because `source.custom === true` for anything registered via `installScenePlugin`. | `PluginManager.js:280-283`, `PluginCache.js:38` + `PluginManager.js:372` (`custom` arg = `true`) |
| What is `key` for, then? | Only two things: the `PluginCache` cache key, and the string pushed into `pm.scenePlugins` so `getDefaultScenePlugins()` hands it to every Scene. It never lands on `sys` or `scene`. | `PluginCache.js:38`, `PluginManager.js:377,325` |
| What if `mapping` is omitted? | `GetFastValue(entry,'mapping',null)` → `null` → `mapKey === null` → **`sys[null]` and `scene[null]`, i.e. the string property `"null"`.** No warning, no throw. `pluginKey` is `null`. | `PluginManager.js:191,273,277,282` — verified empirically, see below |
| What happens to `data`? | **Discarded.** The scene branch never reads it. | `PluginManager.js:189-191` (no `data` read) |
| Is `init(data)` ever called on a ScenePlugin? | **No.** `init` is only invoked from `PluginManager.createEntry` (`PluginManager.js:609`, `instance.init(entry.data)`), and `createEntry` is reachable only from `start()`/`get()` on the **global** plugin list. No scene-plugin path touches it. | `PluginManager.js:591-614`, and `BasePlugin.js:59` agrees |
| Is `start` honoured? | **No.** Not read on the scene branch. | `PluginManager.js:189-191` |

### Empirical confirmation — `mapping` omitted

A probe driving the real `PluginManager` + `PluginCache` with a headless fake `game`, feeding it
the config entry **exactly as Phaser's own typedef `@example` writes it**
(`{ key, plugin, systemKey, sceneKey, start, data }`, no `mapping`):

```
scenePlugins list        : [ 'IsoPlugin' ]
PluginCache.getCore entry: {"plugin":"[fn]","mapping":null,"custom":true}
sys own keys             : [ 'scene', 'settings', 'events', 'null' ]
scene own keys           : [ 'sys', 'null' ]
sys[null] is instance?   : true
scene["null"] === sys[null]: true
sys.IsoPlugin (the key)  : undefined
instance.pluginKey (3rd ctor arg): null
instance.booted          : false
instance.init calls      : []
```

And with `mapping: 'iso'` present:

```
[normal] sys keys      : [ 'scene', 'settings', 'events', 'iso' ]
[normal] sys.iso?      : true   sys.IsoKey?: false
[normal] scene.iso?    : true   scene.IsoKey?: false
[normal] pluginKey     : "iso"
```

### 2f. The typedef lie

`src/core/typedefs/PluginObjectItem.js:8-9,17-18`

```js
 * @property {string} [systemKey] - For a scene plugin, add the plugin to the scene's systems object under this key (`this.sys.KEY`, from the scene).
 * @property {string} [sceneKey] - For a scene plugin, add the plugin to the scene object under this key (`this.KEY`, from the scene).
...
 * @example
 * // Scene plugin
 * { key: 'WireFramePlugin', plugin: WireFramePlugin, systemKey: 'wireFramePlugin', sceneKey: 'wireframe' }
```

The same wrong shape is repeated as a source comment at `src/core/Config.js:607-609` and is
carried verbatim into the shipped declarations at `types/phaser.d.ts:96154,96158`.

**`systemKey` and `sceneKey` are dead fields on the `config.plugins.scene` path.** They belong
to the *Loader* path only — `src/loader/filetypes/ScenePluginFile.js:106`:

```js
            pluginManager.installScenePlugin(systemKey, this.data, sceneKey, this.loader.scene, true);
```

There, `systemKey` is passed as `key` and `sceneKey` as `mapping`. Anyone who copies the
official `@example` into `config.plugins.scene` gets `mapping === null` and their plugin
silently mounted at `scene.null`.

### 2g. `getDefaultScenePlugins` and the per-Scene override

`src/plugins/PluginManager.js:320-328`

```js
    getDefaultScenePlugins: function ()
    {
        var list = this.game.config.defaultPlugins;

        //  Merge in custom Scene plugins
        list = list.concat(this.scenePlugins);

        return list;
    },
```

`src/scene/GetScenePlugins.js:23-43`

```js
var GetScenePlugins = function (sys)
{
    var defaultPlugins = sys.plugins.getDefaultScenePlugins();

    var scenePlugins = GetFastValue(sys.settings, 'plugins', false);

    //  Scene Plugins always override Default Plugins
    if (Array.isArray(scenePlugins))
    {
        return scenePlugins;
    }
    ...
```

**A Scene that declares its own `plugins: [...]` array replaces the list entirely** — the
custom keys appended by `getDefaultScenePlugins()` are dropped, and the plugin is simply not
installed into that Scene. Same for a game config that passes `plugins.default: [...]`
(`Config.js:642-645`), which replaces `DefaultPlugins.DefaultScene`; `plugins.defaultMerge`
(`Config.js:646-649`) concatenates instead.

### 2h. Construction order (load-bearing)

`Systems.init` passes `[ DefaultPlugins.CoreScene, GetScenePlugins(this), GetPhysicsPlugins(this) ]`
(`Systems.js:330`) and `addToScene` walks them in array order (`PluginManager.js:258`).
`DefaultPlugins.CoreScene` is index 0 (`DefaultPlugins.js:63-74`):

```js
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

and `getDefaultScenePlugins()` puts our key at the **end** of `DefaultScene`
(`'Clock','DataManagerPlugin','InputPlugin','Loader','TweenManager','LightsPlugin'`,
`DefaultPlugins.js:91-100`).

Consequences, in our constructor: `sys.events`, `sys.cameras`, `sys.add`, `sys.displayList`,
`sys.updateList`, `sys.input`, `sys.tweens` all already **exist** (constructed). They are not
yet **booted**.

Because everyone registers `once(BOOT)` in their constructor and eventemitter3 dispatches in
registration order (verified), by the time **our** `boot()` runs, `CameraManager.boot()` has
already run — so `sys.cameras.main` and `sys.cameras.default` are populated
(`CameraManager.js:143-166`). This is the fact a camera-follow proxy rests on.

### 2i. The `isBooted` branch is unreachable

`PluginManager.js:290-293` calls `plugin.boot()` when `sys.settings.isBooted` is true. But:

- `addToScene` has exactly **one** caller in the whole tree: `Systems.js:330`.
- `settings.isBooted` starts `false` (`src/scene/Settings.js:48`) and is set `true` only at
  `Systems.js:334`, *after* `addToScene` and *after* the BOOT emit.

So in normal 4.2.1 operation that branch never fires, including for Scenes added at run-time
(`this.scene.add(...)` runs a fresh `Systems.init`). **The `once(SceneEvents.BOOT)` listener the
plugin registers in its own constructor is the only thing that ever calls `boot()`** on the
config path. A subclass whose constructor forgets `super(...)` never boots, silently.

The other path, `installScenePlugin(key, plugin, mapping, addToScene)` with a scene
(`PluginManager.js:386-398`), *does* call `instance.boot()` directly — and note its different
wiring: there the instance goes to **`addToScene.sys[key]`** and **`addToScene[mapping]`**, and
the third constructor argument is **`key`**, not `mapping`. The two install paths disagree with
each other.

### 2j. Second install of the same key is refused

`PluginManager.js:379-384` — verified empirically:

```
Scene Plugin key in use: IsoKey
[reinstall] scene3.iso installed?: false
```

Calling `this.plugins.installScenePlugin('IsoKey', IsoPlugin, 'iso', this)` from a **second**
Scene warns and returns before the `addToScene` block. The per-Scene runtime-install idiom
therefore works for the first Scene only. (It is not actually needed — the key is already in
`pm.scenePlugins`, so every Scene created afterwards gets it via `addToScene`.)

---

## 3. `Systems.destroy()` — and nothing destroys a scene plugin

`src/scene/Systems.js:800-820`

```js
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

**The exact list it nulls** (`Systems.js:814`):

```
scene, game, anims, cache, plugins, registry, sound, textures,
add, cameras, displayList, events, make, scenePlugin, updateList
```

Observations that matter:

- The list is **hard-coded**. `sys.iso` — or whatever our `mapping` is — is **not** in it and is
  never nulled. The property survives on the dead `Systems` object.
- `input`, `tweens`, `time`, `data`, `load`, `lights` are **also** not in the list, even though
  they are core plugins. They clean themselves up via their own `DESTROY` listener.
- Order matters: `emit(DESTROY)` happens **before** `removeAllListeners()`, so a
  `once(DESTROY)` listener does fire.

### Does anything call `destroy()` on an installed scene plugin? **No.**

Three pieces of code make that true:

1. **`Systems.destroy` never calls a plugin method.** Quoted above in full — it emits and nulls,
   nothing else.
2. **`SceneManager` only calls `sys.destroy()`.** `src/scene/SceneManager.js:457`
   (`sceneToRemove.sys.destroy();`) and `SceneManager.js:1721-1728`:

   ```js
        for (var i = 0; i < this.scenes.length; i++)
        {
            var sys = this.scenes[i].sys;

            sys.destroy();
        }

        this.systemScene.sys.destroy();
   ```

3. **`PluginManager.destroy` iterates the *global* list only.**
   `src/plugins/PluginManager.js:875-892`:

   ```js
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

   `this.plugins` is the **global** plugin array (`PluginManager.js:86`, populated only by
   `createEntry`, `PluginManager.js:607`). Scene plugin *instances* live on `Systems`, never in
   `this.plugins` — the class doc says so itself (`PluginManager.js:37-38`). `this.scenePlugins`
   is an array of **strings** (`PluginManager.js:377`), so there is nothing there to destroy
   either.

Verified empirically: emitting `DESTROY` on a scene whose plugin registered no `DESTROY`
listener left the plugin's log at `['boot']` — `destroy` never ran.

**Therefore the plugin must register its own `once(SceneEvents.DESTROY, this.destroy, this)`,
and the base class's empty `boot()` does not do it for you.** This is the single most
consequential gap between what `ScenePlugin`'s JSDoc promises and what the code does.

---

## 4. Scene event constants — exact names and string values

All from `src/scene/events/`, exported through `src/scene/events/index.js:11-36` as
`Phaser.Scenes.Events`.

| Export name | index.js line | Value | Defining file:line |
| --- | --- | --- | --- |
| `BOOT` | 14 | `'boot'` | `BOOT_EVENT.js:20` |
| `START` | 27 | `'start'` | `START_EVENT.js:20` |
| `SHUTDOWN` | 25 | `'shutdown'` | `SHUTDOWN_EVENT.js:25` |
| `DESTROY` | 16 | `'destroy'` | `DESTROY_EVENT.js:22` |
| `PRE_UPDATE` | 20 | `'preupdate'` | `PRE_UPDATE_EVENT.js:32` |
| `UPDATE` | 33 | `'update'` | `UPDATE_EVENT.js:32` |
| `POST_UPDATE` | 18 | `'postupdate'` | `POST_UPDATE_EVENT.js:32` |
| `RENDER` | 23 | `'render'` | `RENDER_EVENT.js:33` |

Adjacent ones we will likely need:

| Export name | index.js line | Value | Defining file:line |
| --- | --- | --- | --- |
| `READY` | 21 | `'ready'` | `READY_EVENT.js:23` |
| `PRE_RENDER` | 19 | `'prerender'` | `PRE_RENDER_EVENT.js:33` |
| `CREATE` | 15 | `'create'` | `CREATE_EVENT.js:24` |
| `ADDED_TO_SCENE` | 13 | `'addedtoscene'` | `ADDED_TO_SCENE_EVENT.js:21` |
| `REMOVED_FROM_SCENE` | 22 | `'removedfromscene'` | `REMOVED_FROM_SCENE_EVENT.js:21` |
| `PAUSE` / `RESUME` | 17 / 24 | `'pause'` / `'resume'` | `PAUSE_EVENT.js:22` / `RESUME_EVENT.js:22` |
| `SLEEP` / `WAKE` | 26 / 34 | `'sleep'` / `'wake'` | `SLEEP_EVENT.js:22` / `WAKE_EVENT.js:22` |

**There is no `RESIZE` scene event.** The full set of files in `src/scene/events/` is 22 events
plus `index.js`; `RESIZE_EVENT.js` is absent, and `index.js` has no `RESIZE` key. The mention
of `resize` in `ScenePlugin.js:99` is wrong.

Where each is emitted, in `Systems`:

- `BOOT` — `Systems.js:332`, inside `init`, once per Scene, after `addToScene`.
- `START` — `Systems.js:753`, inside `start`, **on every (re)start**.
- `READY` — `Systems.js:756`, immediately after `START`.
- `PRE_UPDATE` / `UPDATE` / `POST_UPDATE` — `Systems.js:354,356,360`, in `step`. Note the Scene's
  own `update()` runs **between** `UPDATE` and `POST_UPDATE` (`Systems.js:358`).
- `PRE_RENDER` / `RENDER` — `Systems.js:380,384`, around `this.cameras.render(...)`, and the
  display list is depth-sorted at `Systems.js:378` *before* `PRE_RENDER` fires.
- `SHUTDOWN` — `Systems.js:787`.
- `DESTROY` — `Systems.js:810`.

---

## 5. Three built-in scene plugins — the real idiom

### Do any of them `extend Phaser.Plugins.ScenePlugin`?

**No. Not one class in the entire Phaser 4.2.1 `src/` tree extends it.**

Evidence — a tree-wide grep for both the inheritance marker and the import:

```
$ grep -rn "Extends: ScenePlugin\|require('../plugins/ScenePlugin')\|require('../../plugins/ScenePlugin')" src/
(no output)

$ grep -rn "Extends: BasePlugin" src/
src/plugins/ScenePlugin.js:36:    Extends: BasePlugin,
```

The only consumer of `BasePlugin` is `ScenePlugin` itself, and `ScenePlugin` has zero consumers.
It is exported (`src/plugins/index.js:17`) purely as a public API for third parties. Class
declarations:

- `src/cameras/2d/CameraManager.js:53` — `var CameraManager = new Class({` ... no `Extends`.
- `src/tweens/TweenManager.js:65` — `var TweenManager = new Class({` ... no `Extends`.
- `src/input/InputPlugin.js:74-76` — `var InputPlugin = new Class({` / `Extends: EventEmitter,`.

Note also that all three constructors take **one** parameter, `(scene)` — e.g.
`CameraManager.js:57` `function CameraManager (scene)`. `addToScene` passes three
(`PluginManager.js:275`); the extra two are simply ignored. A custom plugin's constructor
signature is entirely free-form; the `(scene, pluginManager, pluginKey)` shape is a convention
of `ScenePlugin`, not a requirement of the manager.

### The shared idiom, five hooks

**Constructor** — grab refs, then `once(BOOT)` + **`on(START)`**:

`src/cameras/2d/CameraManager.js:66,75,130-131`
```js
        this.scene = scene;
        ...
        this.systems = scene.sys;
        ...
        scene.sys.events.once(SceneEvents.BOOT, this.boot, this);
        scene.sys.events.on(SceneEvents.START, this.start, this);
```

`src/tweens/TweenManager.js:78,87,208-209`
```js
        this.scene = scene;
        ...
        this.events = scene.sys.events;
        ...
        this.events.once(SceneEvents.BOOT, this.boot, this);
        this.events.on(SceneEvents.START, this.start, this);
```

`src/input/InputPlugin.js:91,100,389-390`
```js
        this.scene = scene;
        ...
        this.systems = scene.sys;
        ...
        scene.sys.events.once(SceneEvents.BOOT, this.boot, this);
        scene.sys.events.on(SceneEvents.START, this.start, this);
```

`BOOT` is **`once`**, `START` is **`on`** — because a Scene can be stopped and restarted many
times, but boots only once.

**`boot()`** — one-time setup **and register the DESTROY handler**:

`src/cameras/2d/CameraManager.js:143-166` (abridged; the DESTROY line is the point)
```js
    boot: function ()
    {
        var sys = this.systems;
        ...
        this.main = this.cameras[0];

        //  Create a default camera
        this.default = new Camera(0, 0, sys.scale.width, sys.scale.height).setScene(this.scene);

        sys.game.scale.on(ScaleEvents.RESIZE, this.onResize, this);

        this.systems.events.once(SceneEvents.DESTROY, this.destroy, this);
    },
```

`src/tweens/TweenManager.js:220-223` — the minimal form, and the clearest statement of the rule:
```js
    boot: function ()
    {
        this.events.once(SceneEvents.DESTROY, this.destroy, this);
    },
```

`src/input/InputPlugin.js:402-412`
```js
    boot: function ()
    {
        this.cameras = this.systems.cameras;

        this.displayList = this.systems.displayList;

        this.systems.events.once(SceneEvents.DESTROY, this.destroy, this);

        //  Registered input plugins listen for this
        this.pluginEvents.emit(Events.BOOT);
    },
```

**`start()`** — per-run wiring, always `on(UPDATE-ish)` + `once(SHUTDOWN)`:

`src/cameras/2d/CameraManager.js:199-202`
```js
        var eventEmitter = this.systems.events;

        eventEmitter.on(SceneEvents.UPDATE, this.update, this);
        eventEmitter.once(SceneEvents.SHUTDOWN, this.shutdown, this);
```

`src/tweens/TweenManager.js:243-244`
```js
        this.events.on(SceneEvents.UPDATE, this.update, this);
        this.events.once(SceneEvents.SHUTDOWN, this.shutdown, this);
```

`src/input/InputPlugin.js:431-432`
```js
        eventEmitter.on(SceneEvents.PRE_UPDATE, this.preUpdate, this);
        eventEmitter.once(SceneEvents.SHUTDOWN, this.shutdown, this);
```

**`shutdown()`** — release per-run state and remove exactly what `start()` added:

`src/cameras/2d/CameraManager.js:726-741`
```js
    shutdown: function ()
    {
        this.main = undefined;

        for (var i = 0; i < this.cameras.length; i++)
        {
            this.cameras[i].destroy();
        }

        this.cameras = [];

        var eventEmitter = this.systems.events;

        eventEmitter.off(SceneEvents.UPDATE, this.update, this);
        eventEmitter.off(SceneEvents.SHUTDOWN, this.shutdown, this);
    },
```

`src/tweens/TweenManager.js:1130-1138` is the same shape.

**`destroy()`** — call `shutdown()`, remove the `START` listener, null refs:

`src/cameras/2d/CameraManager.js:751-763`
```js
    destroy: function ()
    {
        this.shutdown();

        this.default.destroy();

        this.systems.events.off(SceneEvents.START, this.start, this);
        this.systems.events.off(SceneEvents.DESTROY, this.destroy, this);
        this.systems.game.scale.off(ScaleEvents.RESIZE, this.onResize, this);

        this.scene = null;
        this.systems = null;
    }
```

`src/tweens/TweenManager.js:1147-1155`
```js
    destroy: function ()
    {
        this.shutdown();

        this.events.off(SceneEvents.START, this.start, this);

        this.scene = null;
        this.events = null;
    }
```

`src/input/InputPlugin.js:3172-3188`
```js
    destroy: function ()
    {
        this.shutdown();
        ...
        this.scene.sys.events.off(SceneEvents.START, this.start, this);

        this.scene = null;
        this.cameras = null;
        this.manager = null;
        this.events = null;
        this.mouse = null;
    },
```

**Registration**, at the bottom of each file, with a `mapping` and `custom` defaulting to
`false`:

```js
src/cameras/2d/CameraManager.js:767  PluginCache.register('CameraManager', CameraManager, 'cameras');
src/tweens/TweenManager.js:1159      PluginCache.register('TweenManager', TweenManager, 'tweens');
src/input/InputPlugin.js:3461        PluginCache.register('InputPlugin', InputPlugin, 'input');
```

Because `custom` is `false` for these, they take the `else if (map.hasOwnProperty(mapKey))`
branch (`PluginManager.js:284-287`) and are injected into the Scene through `InjectionMap`
(`src/scene/InjectionMap.js:17-47`). Our plugin, registered with `custom: true`
(`PluginManager.js:372`), takes the direct `scene[mapKey] = plugin` branch and **bypasses the
InjectionMap entirely** — the Scene-config `map` option cannot rename it.

### Mapping names already taken

From the `PluginCache.register` grep (`src/`): `input`, `tweens`, `cameras`, `time`,
`updateList`, `make`, `add`, `displayList`, `lights`, `load`, `arcadePhysics`, `matterPhysics`,
`scenePlugin`, `data`, `events`. Scene-side names from `InjectionMap.js:19-45` additionally
include `children`, `physics`, `matter`, `scene`, `game`, `renderer`, `anims`, `cache`,
`plugins`, `registry`, `scale`, `sound`, `textures`. `iso` collides with none of them.

### Naming trap

`src/scene/ScenePlugin.js` is a **different class** from `src/plugins/ScenePlugin.js`.
`Phaser.Scenes.ScenePlugin` (`src/scene/ScenePlugin.js:32,36` — `function ScenePlugin (scene)`)
is the Scene Manager façade mapped to `this.scene`, registered under the cache key
`'ScenePlugin'` (`src/scene/ScenePlugin.js:1122`). It does **not** extend
`Phaser.Plugins.ScenePlugin`. Two consequences: grep for "ScenePlugin" hits the wrong file most
of the time, and **the PluginCache key `'ScenePlugin'` is already occupied**, so a config entry
using that `key` would be silently skipped by `if (!PluginCache.hasCore(key))`
(`PluginManager.js:369`) and then rejected by the "key in use" branch.

---

## 6. `PluginManager.removeScenePlugin`

It exists. `src/plugins/PluginManager.js:737-742`:

```js
    removeScenePlugin: function (key)
    {
        Remove(this.scenePlugins, key);

        PluginCache.remove(key);
    },
```

Two statements. It removes the key string from `this.scenePlugins` and deletes the entry from
the `corePlugins` cache (`PluginCache.js:142-148`).

**Is it usable for cleanup? No — not for anything already running.** Its own doc is honest
about it (`PluginManager.js:728-730`):

```js
     * This will not remove the plugin from any active Scenes that are already using it.
     *
     * It is up to you to remove all references to this plugin that you may hold within your game code.
```

Concretely, it does **not**:

- call `destroy()` on any instance,
- delete `sys[mapping]` or `scene[mapping]` on any live Scene,
- unregister any event listener,
- undo `registerGameObject` — the `GameObjectFactory` entry for `isoSprite` stays. That needs
  `PluginManager.removeGameObject(key, removeFromFactory, removeFromCreator)`
  (`PluginManager.js:804-820`), which calls `GameObjectFactory.remove(key)` /
  `GameObjectCreator.remove(key)`.

What it *does* achieve is preventing installation into **Scenes created afterwards** (the key is
gone from `pm.scenePlugins`, so `getDefaultScenePlugins()` stops handing it out and
`addToScene`'s `if (!PluginCache.hasCore(pluginKey)) continue;` guard, `PluginManager.js:266`,
skips it).

Also note the asymmetry: `PluginCache.destroyCustomPlugins()` (called from
`PluginManager.destroy`, `PluginManager.js:882`) clears the **customPlugins** map — the *global*
plugin store populated by `registerCustom`. Our scene plugin lives in **corePlugins** (via
`register(..., custom: true)`, `PluginManager.js:372`), which is only cleared by
`destroyCorePlugins()`, and that runs **only if `game.noReturn`** (`PluginManager.js:884-887`).
So after a normal `game.destroy()` the `corePlugins['IsoPlugin']` entry — and therefore a
reference to our plugin class — persists in module state. That is fine for a class reference,
but it means a second `new Phaser.Game()` in the same page will hit
`if (!PluginCache.hasCore(key))` as **false** and skip re-registration, keeping whatever
`mapping` the first game registered.

---

## Implications for the plugin

**1. Do not rely on `extends Phaser.Plugins.ScenePlugin` for lifecycle.** Inherit from it if we
want the ergonomics and the public-API signal (it is exported for exactly this purpose), but
understand that all it buys us is four property assignments and one `once(BOOT)`. Zero of
Phaser's own scene plugins use it. The behaviour we need — `start`, `shutdown`, `destroy` — we
write ourselves, copying the CameraManager/TweenManager idiom verbatim:

```
constructor: once(BOOT, this.boot)  +  on(START, this.start)
boot():      once(DESTROY, this.destroy)   ← the base class does NOT do this
start():     on(UPDATE|PRE_UPDATE, ...)  +  once(SHUTDOWN, this.shutdown)
shutdown():  off() exactly what start() added
destroy():   this.shutdown(); off(START); null the refs
```

If we subclass, our `destroy()` must end by calling `super.destroy()` /
`ScenePlugin.prototype.destroy.call(this)` to get the four nulls — but the *scheduling* of
`destroy()` is ours to arrange in `boot()`. Skip that and the plugin leaks the Scene, its
Systems, and every listener, for the lifetime of the page.

**2. `mapping` is mandatory, and it must be documented as the only field that matters.** With
`mapping` omitted the plugin mounts at `scene.null` with `pluginKey === null` and no warning.
Our README and our TS config helper must therefore emit `{ key, plugin, mapping }` and never
show `systemKey` / `sceneKey`, notwithstanding that Phaser's own typedef, its `.d.ts`, and the
comment in `Config.js` all say otherwise. Best defence: ship a tiny factory the user calls
instead of hand-writing the object, e.g. `isoPlugin({ mapping: 'iso' })` returning the correct
entry, so the shape cannot be got wrong. Second defence: assert in `boot()` that
`this.pluginKey` is a non-empty string and `console.warn` loudly if not — that is the only
moment we can catch it, and it costs nothing.

**3. `data` cannot be used to configure the plugin, and `init()` will never run.** Any
per-Scene isometric configuration (tile width/height, elevation, origin) has to arrive by
another route. The three that work: (a) a static/class-level default set before the game is
constructed; (b) a method called from the Scene's `create()` — `this.iso.configure({...})`;
(c) reading `this.systems.settings` in `boot()`, since arbitrary keys on the Scene config
survive into `sys.settings` and `GetFastValue` can pull them out — this is exactly how
`CameraManager.boot` reads `sys.settings.cameras` (`CameraManager.js:147`). Option (c) is the
most Phaser-native and is worth preferring; it also keeps `snapshot()` able to report where the
config came from. What we must **not** do is write a plan that passes config through `data`.

**4. `key` and `mapping` are different things and both need naming discipline.** `key` is the
global PluginCache identity (must not collide with `'ScenePlugin'`, `'InputPlugin'`,
`'CameraManager'`, …); `mapping` is what the user types (`this.iso`). Because our registration
is `custom: true`, `mapping` bypasses `InjectionMap`, so the Scene-config `map` option cannot
rename our plugin — the user's only lever is `mapping` in the game config. Say so in the docs.

**5. In `boot()` we may assume the core Scene systems are booted; in the constructor we may
not.** Construction order puts us last (§2h), and BOOT listeners fire in registration order, so
`sys.cameras.main`, `sys.displayList`, `sys.add`, `sys.input` are all live inside `boot()`. The
camera-follow proxy should be built in `boot()`, never in the constructor. Conversely, touching
`scene.sys.events` in the constructor is safe only because `EventEmitter` is CoreScene index 0 —
which is precisely why a user must never `new IsoPlugin(scene, ...)` by hand in a Scene
constructor.

**6. `snapshot()` should be callable without a booted Scene, and should report the wiring.**
Given how many ways the install can go subtly wrong (mapping null, Scene-level `plugins: [...]`
array dropping us, a second game instance inheriting a stale cache mapping), `snapshot()` is
our cheapest diagnostic. Include at minimum: `pluginKey` (i.e. the effective mapping),
whether `boot()` has run, whether the `DESTROY` listener is attached, and the projection config
with its provenance. That turns three of the footguns above into a one-line user-visible answer.

**7. Cleanup is entirely our responsibility, in both directions.** `Systems.destroy()` nulls a
hard-coded list that will never contain our mapping (§3); `removeScenePlugin` touches neither
instances nor listeners nor the GameObjectFactory (§6). So: our `destroy()` must remove every
listener we added, and if we register `isoSprite` on the factory we should expose a teardown
that pairs `PluginManager.removeScenePlugin(key)` with
`PluginManager.removeGameObject('isoSprite')`. Note `GameObjectFactory.register` is global, not
per-Scene — registering it from a per-Scene `boot()` means N Scenes re-register the same key.
Register once, guarded, and prefer doing it at module scope or behind a `hasOwnProperty` check.

**8. Document the Scene-level `plugins: [...]` override.** A user who writes
`{ key: 'Level1', plugins: ['Clock','InputPlugin'] }` silently loses our plugin in that Scene
(`GetScenePlugins.js:30-33`). This is the most likely support question we will receive, and it
produces `undefined is not an object (evaluating 'this.iso...')` with no clue as to why. It
belongs in the troubleshooting section, and `snapshot()` cannot even be reached to diagnose it —
so the docs are the only mitigation.

**9. Peer floor `^4.0.0` is confirmed safe for this subsystem.** All six relevant files are
byte-identical between 4.0.0 and 4.2.1. Nothing found here forces the floor up.

---

## Things I expected to exist and did not

- **A `RESIZE` scene event.** Referenced by `ScenePlugin.js:99`; absent from
  `src/scene/events/`. Resize must come from `ScaleEvents.RESIZE` on `sys.game.scale`, as
  `CameraManager.js:163` does.
- **Any Phaser class extending `Phaser.Plugins.ScenePlugin`.** None. The base class has no
  in-tree consumer at all.
- **Any code that destroys a scene plugin.** None.
- **A `data` / `init` channel for scene plugins.** The typedef advertises `data` for scene
  entries; the code path does not read it.
- **`systemKey` / `sceneKey` support on `config.plugins.scene`.** Documented in three places
  (source comment, typedef `@example`, shipped `.d.ts`), implemented in none.
