# TypeScript surface dossier — what a consumer's compiler sees

**Subject:** `phaser@4.2.1` → `types/phaser.d.ts` (8.0 MB, 148 652 lines)
**Source root (4.2.1):** `/Users/xsec/projects/phaser/platformer/node_modules/phaser`
**Drift root (4.0.0):** `/Users/xsec/projects/phaser/first-game/node_modules/phaser`
**Compiler used for every experiment:** `typescript@5.7.3`
(`/Users/xsec/projects/phaser/plugins/isometric-view/node_modules/.bin/tsc`)
**Date:** 2026-07-28

> **Path note.** The task specified the deliverable path as `undefined/typescript-surface.md`
> and both source roots as `undefined` — the orchestrator's variable substitution failed.
> I located the real roots by filesystem search (`find / -type d -name phaser -path '*node_modules*'`)
> and wrote the dossier to the project's own `docs/` directory, which is the only sane
> destination (the literal intended path was inside `node_modules/`, which `pnpm install`
> would erase). Every `path:line` below is relative to the 4.2.1 root above unless it starts
> with `/`.

Everything in this file was either read out of the real file at the cited line or produced by
running `tsc` against a scratch program. Where a claim rests on an experiment, the scratch
files are under
`/private/tmp/claude-501/-Users-xsec-projects-phaser-plugins-isometric-view/e82fdc91-db9b-4898-9a0e-d171fa789907/scratchpad/`
(`libcheck/` and `aug/`).

---

## 0. The one-line answer to "is phaser.d.ts a module?"

**It is not.** It is a *global script* declaration file, and that single fact decides the whole
augmentation strategy.

```
$ grep -n "^import \|^export \|^declare module\|^declare namespace\|^declare global" types/phaser.d.ts
40:declare namespace Phaser {
148648:declare module 'phaser' {
```

There is **no top-level `import` and no top-level `export`** anywhere in the file. The only
`export` is the one nested inside the ambient module declaration at the very bottom:

`types/phaser.d.ts:148648-148651`
```ts
declare module 'phaser' {
    export = Phaser;

}
```

`types/phaser.d.ts:40`
```ts
declare namespace Phaser {
```

So the file simultaneously:

1. Puts a namespace called `Phaser` into the **global** declaration space (line 40), and
2. Declares an ambient module `'phaser'` whose export *is* that global namespace (line 148648).

`package.json` confirms `types/phaser.d.ts` is the entry the compiler will actually load:

`package.json`
```json
"types": "./types/phaser.d.ts",
"exports": { ".": { "types": "./types/phaser.d.ts", ... } }
```

(`types/index.d.ts` exists but is **not** the entry point, and it is broken: it
`/// <reference types="./SpinePlugin" />` etc., and none of those files exist in `types/`.
Nothing loads it, so it is harmless — but do not point anything at it.)

### Consequences, all verified

- **`declare global` is REQUIRED, not optional.** Our package's `.ts`/`.d.ts` files contain
  `import`/`export`, so they are modules; a module cannot contribute to the global declaration
  space except through `declare global`.
- **The global `Phaser` namespace is only in scope once *some* file in the program pulls
  `phaser` in.** A standalone file that uses `Phaser.Scene` with no import anywhere in the
  program fails:
  ```
  globalleak.ts(1,22): error TS2503: Cannot find namespace 'Phaser'.
  globalleak.ts(2,18): error TS2304: Cannot find name 'Phaser'.
  ```
  Add a sibling file that does `import Phaser from 'phaser'` and both errors vanish — the
  namespace becomes visible program-wide. Practical rule: our public entry must import
  `phaser` (a bare `import 'phaser'` suffices) so consumers who only import *us* still get
  the global.
- **Every import form works.** `import Phaser from 'phaser'`, `import * as Phaser from 'phaser'`,
  under `--module esnext --moduleResolution bundler` (with and without `verbatimModuleSyntax`
  and `isolatedModules`), and under `--module node16`. All four combinations: zero errors.
  Resolution is genuinely happening — a bogus member gives
  `error TS2339: Property 'ThisDoesNotExist' does not exist on type 'typeof Phaser'`.
  The usual `export =` / `esModuleInterop` friction does **not** apply here, because the
  export target is a namespace that is *also* global.

---

## 1. `Phaser.Plugins.ScenePlugin` — constructor, `scene`, `systems`

### 1.1 Which `ScenePlugin`?

There are **two** classes named `ScenePlugin` in the namespace and they are unrelated:

| Line | Fully-qualified name | What it is |
|---|---|---|
| `types/phaser.d.ts:120787` | `Phaser.Plugins.ScenePlugin` | the base class **we extend** |
| `types/phaser.d.ts:129729` | `Phaser.Scenes.ScenePlugin` | the `this.scene` scene-manager façade |

`types/phaser.d.ts:129729-129747` (the *wrong* one — note it has non-nullable, non-protected
`scene`/`systems`, which is exactly the shape someone half-remembering would expect):
```ts
        class ScenePlugin {
            constructor(scene: Phaser.Scene);
            scene: Phaser.Scene;
            systems: Phaser.Scenes.Systems;
```
If the plan ever writes `extends Phaser.ScenePlugin` or picks this one by autocomplete, the
error will be confusing. Always spell it `Phaser.Plugins.ScenePlugin`.

### 1.2 The declared shape

`types/phaser.d.ts:120787`
```ts
        class ScenePlugin extends Phaser.Plugins.BasePlugin {
```

`types/phaser.d.ts:120794`
```ts
            constructor(scene: Phaser.Scene, pluginManager: Phaser.Plugins.PluginManager, pluginKey: string);
```

`types/phaser.d.ts:120797-120802`
```ts
            /**
             * A reference to the Scene that has installed this plugin.
             * Only set if it's a Scene Plugin, otherwise `null`.
             * ...
             */
            protected scene: Phaser.Scene | null;
```

`types/phaser.d.ts:120805-120810`
```ts
            /**
             * A reference to the Scene Systems of the Scene that has installed this plugin.
             * Only set if it's a Scene Plugin, otherwise `null`.
             * ...
             */
            protected systems: Phaser.Scenes.Systems | null;
```

`types/phaser.d.ts:120818`
```ts
            readonly pluginKey: string;
```

Inherited from `Phaser.Plugins.BasePlugin` (`types/phaser.d.ts:120281`):

`types/phaser.d.ts:120292` and `:120298`
```ts
            protected pluginManager: Phaser.Plugins.PluginManager;
            protected game: Phaser.Game;
```

**Answer: yes to both.** `scene` and `systems` are `protected` **and** `| null`.
`pluginManager` and `game` are `protected` but **not** nullable — an asymmetry with no basis in
the implementation, since `BasePlugin.destroy` nulls all four
(`src/plugins/BasePlugin.js:121-127`).

### 1.3 What that costs us — measured

`aug/nullprobe.ts` compiled with `--strict --skipLibCheck`:

```
nullprobe.ts(6,16): error TS2531: Object is possibly 'null'.        // this.systems.events
nullprobe.ts(7,17): error TS2531: Object is possibly 'null'.        // this.scene.cameras
nullprobe.ts(15,12): error TS2445: Property 'scene' is protected and only accessible
                                    within class 'ScenePlugin' and its subclasses.
```

So:
- **Inside** `IsoPlugin` (a subclass), `protected` is fine — no guard needed for visibility.
- **Every** dereference of `this.scene` / `this.systems` needs `!` or a narrowing guard.
- **Outside** the class (e.g. a camera-follow proxy that takes an `IsoPlugin` and reads
  `plugin.scene`), `protected` bites: TS2445. Our proxy must go through a **public** accessor
  we add ourselves, not through the inherited `scene`.

### 1.4 What the implementation actually does — the nullability is a lie in practice

`src/plugins/ScenePlugin.js:40-83`
```js
    function ScenePlugin (scene, pluginManager, pluginKey)
    {
        BasePlugin.call(this, pluginManager);
        ...
        this.scene = scene;            // :55
        ...
        this.systems = scene.sys;      // :68
        ...
        this.pluginKey = pluginKey;    // :81

        scene.sys.events.once(SceneEvents.BOOT, this.boot, this);   // :83
    }
```

Both are assigned **unconditionally in the constructor**. They can only become `null` after
`destroy()`:

`src/plugins/ScenePlugin.js:135-141`
```js
    destroy: function ()
    {
        this.pluginManager = null;
        this.game = null;
        this.scene = null;
        this.systems = null;
    }
```

**Two findings fall out of this:**

**(a) The `| null` is post-mortem-only.** During `boot()` and every normal frame,
`this.scene`/`this.systems` are guaranteed non-null. A single `!` is honest here; a runtime
guard would be dead code. The JSDoc's "Only set if it's a Scene Plugin, otherwise `null`" is
describing `BasePlugin` (a global plugin never gets them) and has been copied onto
`ScenePlugin`, where it is false.

**(b) Nothing calls `destroy()` on a Scene Plugin.** The .d.ts asserts otherwise:

`types/phaser.d.ts:120856`
```
             * and Plugin Manager. This method is called automatically when the Scene is destroyed.
```

The only `.destroy()` invocation in the whole plugin subsystem is over **global** plugins:

`src/plugins/PluginManager.js:877-880`
```js
        for (var i = 0; i < this.plugins.length; i++)
        {
            this.plugins[i].plugin.destroy();
        }
```
(`this.plugins` is the global-plugin list; the scene-plugin list is `this.scenePlugins`, and it
holds *keys*, not instances.)

And `Systems.destroy` (`src/scene/Systems.js:800-820`) only emits the event and nulls its own
property list:
```js
        events.emit(Events.DESTROY, this);
        events.removeAllListeners();
        var props = [ 'scene', 'game', 'anims', ..., 'updateList' ];
```
— no iteration over installed plugins.

**Implication:** `IsoPlugin` must wire its own teardown in `boot()`:
`this.systems!.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this)`. If the plan
relies on the documented automatic call, the plugin leaks its listeners and its spatial index
for the lifetime of the game.

**(c) `boot` is already wired by the base constructor** (`src/plugins/ScenePlugin.js:83`).
`IsoPlugin` must **override** `boot()`, never re-subscribe to `SceneEvents.BOOT` — doing both
runs boot twice.

---

## 2. `Phaser.Scene` and `Phaser.GameObjects.GameObjectFactory` — can we merge into them?

### 2.1 Both are CLASSES

`types/phaser.d.ts:130440`
```ts
    class Scene {
        constructor(config?: string | Phaser.Types.Scenes.SettingsConfig);     // :130445
        sys: Phaser.Scenes.Systems;                                            // :130450
        ...
        add: Phaser.GameObjects.GameObjectFactory;                             // :130513
        make: Phaser.GameObjects.GameObjectCreator;                            // :130520
        scene: Phaser.Scenes.ScenePlugin;                                      // :130527
```

`types/phaser.d.ts:26890`
```ts
        class GameObjectFactory {
            constructor(scene: Phaser.Scene);                                  // :26895
```

Neither is an `interface`. Both are `class` declarations nested in `declare namespace Phaser`.

### 2.2 Does interface→class merging apply, and does our form work?

**Yes to both, and I ran it rather than trusting the handbook.** TypeScript permits an
`interface X` to merge with a `class X` in the same declaration space; the interface's members
are added to the *instance type* of the class. A namespace-nested class is no exception —
what matters is that the augmenting `interface` lands in the same nested declaration space,
which `declare global { namespace Phaser { ... } }` achieves.

`aug/pkg/index.d.ts` (written to look exactly like a shipped `.d.ts`):
```ts
import Phaser from 'phaser';
export declare class IsoPlugin extends Phaser.Plugins.ScenePlugin { snapshot(): { n: number }; }
export declare class IsoSprite extends Phaser.GameObjects.Sprite { isoX: number; isoY: number; isoZ: number; }
declare global {
  namespace Phaser {
    interface Scene { iso: IsoPlugin }
    namespace GameObjects {
      interface GameObjectFactory {
        isoSprite(x: number, y: number, z: number, texture: string): IsoSprite;
      }
    }
  }
}
```

`aug/pkgconsumer.ts`:
```ts
export class F extends Phaser.Scene {
  create() {
    const p: IsoPlugin = this.iso;                     // resolves
    const s = this.add.isoSprite(0, 0, 0, 'k');        // resolves
    return [p.snapshot(), s.isoX];
  }
}
```

Result: **zero errors.** `--strict --skipLibCheck --target ES2020 --lib ES2020,DOM
--module ESNext --moduleResolution bundler`.

Note also that merging `iso` onto the *base* `Scene` does not trip
`strictPropertyInitialization` in consumer subclasses — `class F extends Phaser.Scene` never
has to initialise `iso`.

### 2.3 Two forms that DO NOT work — both worth putting in the plan as prohibitions

**(a) `declare namespace Phaser` at the top level of a module file.**

`aug/wrongaug.ts`:
```ts
import Phaser from 'phaser';
export class IsoPlugin extends Phaser.Plugins.ScenePlugin { snap(){ return 1; } }
declare namespace Phaser { interface Scene { iso: IsoPlugin } }
```
```
wrongaug.ts(1,8): error TS2440: Import declaration conflicts with local declaration of 'Phaser'.
wrongconsumer.ts(3,61): error TS2339: Property 'iso' does not exist on type 'D'.
```
Loud failure. Fine — you cannot ship this by accident.

**(b) `declare module 'phaser' { namespace Phaser { interface Scene { ... } } }` — SILENT NO-OP.**

`aug/moduleaug.ts`:
```ts
import 'phaser';
declare module 'phaser' {
  namespace Phaser { interface Scene { iso2: number } }
}
```
```
moduleaugconsumer.ts(3,61): error TS2339: Property 'iso2' does not exist on type 'E'.
```
The augmentation file itself compiles **clean**. It creates a namespace `Phaser` *nested inside*
the ambient module `'phaser'`, which is a different entity from the global `Phaser`. This is the
dangerous one: it looks right, it type-checks, and it does nothing. Several Phaser-3-era plugins
in the wild use this form.

**(c) Non-module `.d.ts` with `declare global`** — a `.d.ts` with no import/export is already
global, and TS 5.7 accepts a `declare global` block there without TS2669. It works, but it is
a redundancy; prefer the module form so the augmentation travels with the package's own
declarations.

### 2.4 `GameObjectFactory`'s instance members are `protected` — and there is an escape hatch

The `registerGameObject` JSDoc, reproduced verbatim in the .d.ts, instructs you to use
`this.scene`, `this.displayList`, `this.updateList` inside the factory callback:

`types/phaser.d.ts:120712-120714`
```
             * this.scene - A reference to the Scene that owns the GameObjectFactory.
             * this.displayList - A reference to the Display List the Scene owns.
             * this.updateList - A reference to the Update List the Scene owns.
```

All five instance members are nonetheless declared **`protected`**:

`types/phaser.d.ts:27125-27145`
```ts
            protected scene: Phaser.Scene;
            protected systems: Phaser.Scenes.Systems;
            protected events: Phaser.Events.EventEmitter;
            protected displayList: Phaser.GameObjects.DisplayList;
            protected updateList: Phaser.GameObjects.UpdateList;
```
(matching `src/gameobjects/GameObjectFactory.js:41,51,61,97,98`)

Public members you may also want:
`types/phaser.d.ts:27155` `existing<G extends (...)>(child: G): G;`
`types/phaser.d.ts:27163` `static register(factoryType: string, factoryFunction: Function): void;`
`types/phaser.d.ts:27169` `static remove(factoryType: string): void;`

**The escape hatch:** TypeScript's `protected` check is scoped to *class bodies*. A free
function with a **`this`-parameter annotation** is not a class body, and the check does not
apply. Minimal repro (`scratchpad/protfn.ts`):
```ts
declare class K { protected p: number; }
export function viaThis(this: K) { return this.p; }      // NO ERROR
export function viaParam(k: K) { return k.p; }           // error TS2445
```
```
protfn.ts(3,43): error TS2445: Property 'p' is protected and only accessible within class 'K' and its subclasses.
```
Only line 3 errors.

Applied to the real thing (`aug/factoryprobe.ts`), this compiles with **exit code 0**:
```ts
pm.registerGameObject('isoSprite', function (this: Phaser.GameObjects.GameObjectFactory, x: number, y: number) {
  const s = new Phaser.GameObjects.Sprite(this.scene, x, y, 'k');
  this.displayList.add(s);
  this.updateList.add(s);
  return s;
});
```

**So the plan's factory callback MUST be a `function` expression with an explicit
`this: Phaser.GameObjects.GameObjectFactory` parameter.** An arrow function would (a) lose the
`this` binding that Phaser relies on and (b) leave no legal way to reach `displayList`. There is
no `as any` needed and none should be written.

---

## 3. `registerGameObject` / `removeGameObject` — declared `void`, actually return `this`

### Declared

`types/phaser.d.ts:120722`
```ts
            registerGameObject(key: string, factoryCallback?: Function, creatorCallback?: Function): void;
```

`types/phaser.d.ts:120731`
```ts
            removeGameObject(key: string, removeFromFactory?: boolean, removeFromCreator?: boolean): void;
```

### Implemented

`src/plugins/PluginManager.js:778-791`
```js
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

`src/plugins/PluginManager.js:804-820`
```js
    removeGameObject: function (key, removeFromFactory, removeFromCreator)
    {
        if (removeFromFactory === undefined) { removeFromFactory = true; }
        if (removeFromCreator === undefined) { removeFromCreator = true; }
        ...
        return this;
    },
```

### The mismatch, stated precisely

Both methods **return `this` (the `PluginManager`)** at runtime
(`PluginManager.js:790` and `:819`). Neither the JSDoc block above them nor the generated
`.d.ts` records a return value — the JSDoc has **no `@return` tag at all**:

`src/plugins/PluginManager.js:771-777` (the complete tag list above `registerGameObject`)
```
     * @method Phaser.Plugins.PluginManager#registerGameObject
     * @since 3.8.0
     *
     * @param {string} key - ...
     * @param {function} [factoryCallback] - ...
     * @param {function} [creatorCallback] - ...
     */
```
— and the same omission at `:797-803` for `removeGameObject`. So `tsgen` emitted `void`. This is a
lie by omission propagated mechanically from JSDoc into the declarations.

Measured consequence (`aug/consumer.ts:18`):
```
consumer.ts(18,61): error TS2339: Property 'removeGameObject' does not exist on type 'void'.
```

**Implication for verbatim code:** do not chain. Write
```ts
this.pluginManager.registerGameObject('isoSprite', factoryFn);
this.pluginManager.registerGameObject('isoTile', tileFactoryFn);
```
as separate statements. A chained form would work at runtime and fail `tsc`, which is the worst
combination for a plan that an implementer transcribes without judgement.

(Third `return this;` at `:641` is `removeGlobalPlugin`'s neighbour — same family of omission,
not relevant to us.)

---

## 4. `Phaser.GameObjects.Sprite` — constructor, and `depth` as the `useDefineForClassFields` trap

### 4.1 Constructor

`types/phaser.d.ts:66456`
```ts
        class Sprite extends Phaser.GameObjects.GameObject implements Phaser.GameObjects.Components.Alpha, ..., Phaser.GameObjects.Components.Depth, ..., Phaser.GameObjects.Components.Visible {
```

`types/phaser.d.ts:66465`
```ts
            constructor(scene: Phaser.Scene, x: number, y: number, texture: string | Phaser.Textures.Texture, frame?: string | number);
```

Note `texture` accepts a `Phaser.Textures.Texture` instance, not just a string key — and `frame`
is `string | number`. An `IsoSprite` subclass that narrows `texture` to `string` is a valid
narrowing but will not accept everything `Sprite` does; the plan should mirror the full union.

### 4.2 `depth` is declared as a PROPERTY

`types/phaser.d.ts:67060-67070`
```ts
            /**
             * The depth of this Game Object within the Scene. Ensure this value is only ever set to a number data-type.
             * ...
             * Setting the depth will queue a depth sort event within the Scene.
             */
            depth: number;
```
`types/phaser.d.ts:67084`
```ts
            setDepth(value: number): this;
```

**It is a plain data property in the `.d.ts`, not an accessor pair.** This is the whole finding.

### 4.3 `depth` is an ACCESSOR at runtime

`src/gameobjects/components/Depth.js:28` and `:45-62`
```js
    _depth: 0,
    ...
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

The mixin is applied to `Sprite`:
`src/gameobjects/sprite/Sprite.js:58-61`
```js
    Mixins: [
        Components.Alpha,
        Components.BlendMode,
        Components.Depth,
```

and Phaser's `Class` helper installs descriptors on the prototype with `defineProperty`:
`src/utils/Class.js:112`
```js
            Object.defineProperty(ctor.prototype, k, def);
```

**Empirically confirmed** (`scratchpad/protoprobe5.cjs`, which loads the real `Depth.js` through
the real `Class.js`):
```
depth      ACCESSOR (get/set)
_depth     data (number)
setDepth   data (function)
plain assignment  -> _depth = 5 | depth getter = 5
Object.defineProperty (what useDefineForClassFields:true emits) -> _depth = 0 | own depth = 7 | prototype setter bypassed: true
```

### 4.4 The trap, and why the compiler will not save us

A subclass field `depth = 0` under **define** semantics emits `Object.defineProperty(this,
'depth', {value: 0, ...})`, which installs an **own data property** that shadows the prototype
accessor forever. The setter — and therefore `displayList.queueDepthSort()` — never runs again.
For an isometric plugin whose entire reason to exist is writing a computed depth key every
frame, this is a total, silent failure of render ordering.

**TypeScript is silent, and I proved exactly why.** `scratchpad/accessor-vs-prop.ts`:
```ts
declare class BaseAccessor { get depth(): number; set depth(v: number); }
declare class BaseProp { depth: number; }
class DA extends BaseAccessor { depth = 0; }   // expect an error
class DP extends BaseProp     { depth = 0; }   // Phaser's case
```
```
accessor-vs-prop.ts(3,33): error TS2610: 'depth' is defined as an accessor in class 'BaseAccessor',
                                          but is overridden here in 'DA' as an instance property.
```
Only `DA` errors. **TS2610 is the exact guardrail for this bug, and Phaser's `.d.ts` disables it**
by declaring `depth` as a property instead of an accessor pair. Against the real `Phaser.GameObjects.Sprite`
(`aug/udcf.ts`), `class A extends Phaser.GameObjects.Sprite { depth = 0 }` compiles with **exit
code 0** under `--useDefineForClassFields true` *and* under `false`.

The emit differs, and the difference is the bug:

`--target ES2020 --useDefineForClassFields false` →
```js
export class A extends Phaser.GameObjects.Sprite {
    constructor() { super(...arguments); this.depth = 0; }   // assignment: setter RUNS
}
```
`--target ES2022 --useDefineForClassFields true` →
```js
export class A extends Phaser.GameObjects.Sprite {
    depth = 0;                                               // [[Define]]: setter BYPASSED
}
```
Note that at ES2022 the field syntax passes through untouched — it is then the *JS engine* that
applies define semantics. Downlevelling is not a defence at ES2022+; only
`useDefineForClassFields: false` is, and that flag is ignored for native class-field syntax
only when the target forces it. The repo already sets it:
`tsconfig.base.json` → `"useDefineForClassFields": false`, `"target": "ES2020"`. **Keep both.**

### 4.5 The full collision list for a `Sprite` subclass

Every accessor installed on `Sprite.prototype` by its mixins (`src/gameobjects/sprite/Sprite.js:58-75`),
found by scanning each component for a `name: { ... get: function` descriptor:

| Property | Defined at |
|---|---|
| `alpha` | `src/gameobjects/components/Alpha.js:147` |
| `alphaTopLeft` / `alphaTopRight` / `alphaBottomLeft` / `alphaBottomRight` | `Alpha.js:185 / 215 / 245 / 275` |
| `blendMode` | `src/gameobjects/components/BlendMode.js:62` |
| **`depth`** | `src/gameobjects/components/Depth.js:45` |
| `displayOriginX` / `displayOriginY` | `src/gameobjects/components/Origin.js:72 / 97` |
| `displayWidth` / `displayHeight` | `src/gameobjects/components/Size.js:73 / 98` |
| `tint` / `isTinted` | `src/gameobjects/components/Tint.js:293 / 320` |
| `scale` / `scaleX` / `scaleY` | `src/gameobjects/components/Transform.js:125 / 157 / 188` |
| `angle` / `rotation` | `src/gameobjects/components/Transform.js:224 / 251` |
| `visible` | `src/gameobjects/components/Visible.js:44` |

`Phaser.GameObjects.GameObject` itself contributes **no** accessors, and `Sprite` adds only the
private `_defaultRenderNodesMap` (`Sprite.js:123`).

`x`, `y`, `z`, `w` are **plain data properties** on the prototype
(`Transform.js:78, 88, 101, 111` — `x: 0,` `y: 0,` `z: 0,` `w: 0,`), so a field named `x` merely
shadows a prototype default, which is what Phaser does anyway. They are safe; the table above is
not.

**Rule for the plan:** `IsoSprite` may declare `isoX`, `isoY`, `isoZ` and any other *new* name as
class fields (verified clean in `aug/plugin.ts`), but must never declare a field whose name
appears in the table. To re-type one, use `declare depth: number;` (type-only, emits nothing —
verified in `aug/plugin.ts` as `class DepthOverride`).

---

## 5. Does `types/phaser.d.ts` typecheck under `strict` with `skipLibCheck: false`?

**No. It produces exactly 2 errors — but 2 errors is still a failed build, so
`skipLibCheck: true` is mandatory.**

Method: `scratchpad/libcheck/` — an `entry.ts` containing only
`/// <reference path=".../types/phaser.d.ts" />` plus one exported const, and a tsconfig with
`strict: true, skipLibCheck: false, types: []`.

```
$ tsc --noEmit -p tsconfig.json
exit=2
```

**Total: 2 errors.** Both, verbatim:

```
types/phaser.d.ts(22,45): error TS2526: A 'this' type is available only in a non-static member
                                        of a class or interface.

types/phaser.d.ts(124835,21): error TS2416: Property 'run' in type 'SubmitterMeshToQuad' is not
                                            assignable to the same property in base type 'SubmitterQuad'.
  Type '(drawingContext: DrawingContext, gameObject: GameObject, parentMatrix: TransformMatrix,
   transformerNode: TransformerVertex, normalMap?: WebGLTextureWrapper | undefined,
   normalMapRotation?: number | undefined) => void' is not assignable to type
   '(drawingContext: DrawingContext, gameObject: GameObject, parentMatrix: TransformMatrix,
   element: object | undefined, texturerNode: RenderNode, transformerNode: Object | RenderNode, ...'.
    Types of parameters 'normalMap' and 'texturerNode' are incompatible.
      Type 'RenderNode' is missing the following properties from type 'WebGLTextureWrapper':
       renderer, webGLTexture, isRenderTexture, mipLevel, and 20 more.
```

The first is a generator bug at the very top of the file:

`types/phaser.d.ts:22`
```ts
declare function setFlipV(value?: boolean): this;
```
— a *free function* with a `this` return type, emitted because `tsgen` hoisted a mixin method's
JSDoc to the top level. `types/matter.d.ts` (pulled in by the `/// <reference types="./matter" />`
on line 2) contributes **zero** errors.

### 5.1 The far bigger number: `lib` must include `DOM`

Same program, `lib: ["ES2020"]` only (which is **exactly what `tsconfig.base.json` currently
declares**):

```
$ tsc --noEmit -p tsconfig.nodom.json
337
```
Breakdown: `335 × TS2304` (`Cannot find name 'HTMLElement' / 'SVGPathElement' /
'CanvasRenderingContext2D' / …`), plus the same TS2526 and TS2416.

```
types/matter.d.ts(3423,34): error TS2304: Cannot find name 'HTMLElement'.
types/phaser.d.ts(4500,43): error TS2304: Cannot find name 'CanvasRenderingContext2D'.
```

`skipLibCheck: true` suppresses all 337 (they are all inside `.d.ts` files), so the build will be
green either way — but the shell package genuinely needs DOM types the moment it touches
`HTMLCanvasElement`, `PointerEvent`, or a `CanvasRenderingContext2D` in its own code.

`/Users/xsec/projects/phaser/plugins/isometric-view/tsconfig.base.json` today:
```json
"target": "ES2020",
"lib": ["ES2020"],
"strict": true,
"noUncheckedIndexedAccess": true,
"skipLibCheck": true,
"useDefineForClassFields": false,
"verbatimModuleSyntax": true,
"isolatedModules": true,
```
`skipLibCheck: true` and `useDefineForClassFields: false` are already correct and must not be
"cleaned up". **`lib` must gain `"DOM"` for the shell package** (the pure-maths `core` package
should keep `["ES2020"]` — it has no Phaser import and no DOM need, and leaving DOM out is a
cheap structural guard on the "core has zero Phaser" invariant).

### 5.2 Version drift

Same experiment against **Phaser 4.0.0** (`/Users/xsec/projects/phaser/first-game/node_modules/phaser`):
**5 errors**, a different set:
```
types/phaser.d.ts(82871,19): error TS2300: Duplicate identifier 'FontFile'.
types/phaser.d.ts(82901,19): error TS2300: Duplicate identifier 'FontFile'.
types/phaser.d.ts(83272,109): error TS2724: 'Phaser.Types.Loader.FileTypes' has no exported member named 'PCTAtlasFileConfig'.
types/phaser.d.ts(85509,66): error TS2724: ...
types/phaser.d.ts(85509,117): error TS2724: ...
```
The count changes between patch releases. `skipLibCheck: true` is not a workaround for one bad
release; it is a permanent requirement for any package that depends on `phaser`.

**No drift on anything load-bearing**, 4.0.0 vs 4.2.1:

| Fact | 4.0.0 | 4.2.1 |
|---|---|---|
| `declare namespace Phaser` (global, no top-level import/export) | `:47` | `:40` |
| `declare module 'phaser' { export = Phaser }` | `:143495` | `:148648` |
| `class ScenePlugin extends Phaser.Plugins.BasePlugin` | `:116025` | `:120787` |
| `protected scene: Phaser.Scene \| null` | `:116040` | `:120802` |
| `protected systems: Phaser.Scenes.Systems \| null` | `:116048` | `:120810` |
| `registerGameObject(...): void` | `:115960` | `:120722` |
| `type PluginObjectItem` | `:91714` | `:96138` |
| `ScenePluginObjectItem` occurrences | 0 | 0 |

---

## 6. The `plugins.scene` config type — it is NOT called `ScenePluginObjectItem`

### 6.1 The expected name does not exist

```
$ grep -c "ScenePluginObjectItem" types/phaser.d.ts
0
```
Nor anywhere in `src/`. **`Phaser.Types.Plugins.ScenePluginObjectItem` does not exist.**

`Phaser.Types.Plugins` (`types/phaser.d.ts:102675-102725`) contains exactly three types, none of
them the config-array item:
```ts
        namespace Plugins {
            type CorePluginContainer = { key: string; plugin: Function; mapping?: string; custom?: boolean; };
            type CustomPluginContainer = { key: string; plugin: Function; };
            type GlobalPlugin = { key: string; plugin: Function; active?: boolean; mapping?: string; };
        }
```
These describe the **PluginCache's** internal records, not the Game Config.

### 6.2 The real type is `Phaser.Types.Core.PluginObjectItem`

`types/phaser.d.ts:95826` (inside `Phaser.Types.Core.GameConfig`)
```ts
                plugins?: Phaser.Types.Core.PluginObject | Phaser.Types.Core.PluginObjectItem[];
```

`types/phaser.d.ts:96119-96136`
```ts
            type PluginObject = {
                /** Global plugins to install. */
                global?: Phaser.Types.Core.PluginObjectItem[] | null;
                /** Scene plugins to install. */
                scene?: Phaser.Types.Core.PluginObjectItem[] | null;
                /** The default set of scene plugins (names). */
                default?: string[];
                /** Plugins to *add* to the default set of scene plugins. */
                defaultMerge?: string[];
            };
```

`types/phaser.d.ts:96138-96167`
```ts
            type PluginObjectItem = {
                /** A key to identify the plugin in the Plugin Manager. */
                key?: string;
                /** The plugin itself. Usually a class/constructor. */
                plugin?: any;
                /** Whether the plugin should be started automatically. */
                start?: boolean;
                /** For a scene plugin, add the plugin to the scene's systems object under this key (`this.sys.KEY`, from the scene). */
                systemKey?: string;
                /** For a scene plugin, add the plugin to the scene object under this key (`this.KEY`, from the scene). */
                sceneKey?: string;
                /** If this plugin is to be injected into the Scene Systems, this is the property key map used. */
                mapping?: string;
                /** Arbitrary data passed to the plugin's init() method. */
                data?: any;
            };
```

Every field is optional and `plugin` is `any`, so **TypeScript will accept a completely wrong
config**. It compiles our README snippet without complaint (`aug/consumer.ts`):
```ts
export const cfg: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  plugins: { scene: [{ key: 'IsoPlugin', plugin: Object, mapping: 'iso' }] }
};
```
— zero errors, including `plugin: Object`, which is nonsense. The type provides no protection;
the README has to be right on its own.

### 6.3 `systemKey` and `sceneKey` are DEAD in the `plugins.scene` array

The typedef advertises them, and even ships an example that uses them:

`src/core/typedefs/PluginObjectItem.js:16-18`
```
 * @example
 * // Scene plugin
 * { key: 'WireFramePlugin', plugin: WireFramePlugin, systemKey: 'wireFramePlugin', sceneKey: 'wireframe' }
```
(the same example is echoed at `src/core/Config.js:608`)

The code that consumes `config.installScenePlugins` reads only three fields:

`src/plugins/PluginManager.js:187-197`
```js
            // { key: 'moveSpritePlugin', plugin: MoveSpritePlugin, , mapping: 'move' }

            key = GetFastValue(entry, 'key', null);           // :189
            plugin = GetFastValue(entry, 'plugin', null);     // :190
            mapping = GetFastValue(entry, 'mapping', null);   // :191

            if (key)
            {
                if (plugin)
                {
                    this.installScenePlugin(key, plugin, mapping);   // :197
                }
```

`systemKey`, `sceneKey` **and `start`** are never read on this path (`start` *is* read for global
plugins, at `:159`). A repo-wide grep confirms the only consumers of `systemKey`/`sceneKey` are
the **loader** path — `this.load.scenePlugin()`:

```
src/loader/filetypes/ScenePluginFile.js:101:  var systemKey = GetFastValue(config, 'systemKey', key);
src/loader/filetypes/ScenePluginFile.js:102:  var sceneKey  = GetFastValue(config, 'sceneKey', key);
src/loader/filetypes/ScenePluginFile.js:106:  pluginManager.installScenePlugin(systemKey, this.data, sceneKey, this.loader.scene, true);
```
plus their typedefs. **Nothing else in `src/` mentions them.**

**So the only field that maps `IsoPlugin` onto the Scene is `mapping`.** The README snippet must be:
```js
plugins: {
  scene: [
    { key: 'IsoPlugin', plugin: IsoPlugin, mapping: 'iso' }
  ]
}
```
A snippet that used `sceneKey: 'iso'` would typecheck, look idiomatic, match the framework's own
documented example — and produce `scene.undefined = plugin` at runtime.

### 6.4 What `mapping` actually does (and a genuine framework inconsistency)

Config-array path — `src/plugins/PluginManager.js:273-284`:
```js
                var mapKey = source.mapping;

                var plugin = new source.plugin(scene, this, mapKey);

                sys[mapKey] = plugin;

                //  Scene level injection
                if (source.custom)
                {
                    scene[mapKey] = plugin;
                }
```
`installScenePlugin` registers with `PluginCache.register(key, plugin, mapping, true)`
(`:372` — note the trailing `true` = `custom`), so `source.custom` is true for us and **both**
`scene.iso` and `scene.sys.iso` are set from `mapping`. The third constructor argument
(`pluginKey`) receives `mapping`, not `key`.

Runtime path — `src/plugins/PluginManager.js:386-398`:
```js
        if (addToScene)
        {
            var instance = new plugin(addToScene, this, key);   // :388

            addToScene.sys[key] = instance;                     // :390

            if (mapping && mapping !== '')
            {
                addToScene[mapping] = instance;                 // :394
            }

            instance.boot();                                    // :397
        }
```
Here the systems key is **`key`**, and `pluginKey` receives **`key`**.

The two paths therefore disagree about what `sys.X` is named and about what `this.pluginKey`
holds. Neither JSDoc nor `.d.ts` mentions this. Consequences for us:

- Never read `this.pluginKey` as though it were a stable identifier — its value depends on how
  the plugin was installed. If `snapshot()` wants to name itself, use a hard-coded constant.
- Never document `this.sys.iso` as guaranteed. Document `this.iso` (set from `mapping` in the
  config path, from `mapping` in the loader path) — that one is consistent.
- Omitting `mapping` from a config entry yields `mapKey === null` → `sys[null] = plugin` and
  `scene[null] = plugin`. **`mapping` is de-facto required**, despite being optional in the type.

---

## 7. Implications for the plugin

**On the augmentation file (the highest-risk artefact in the plan).**
The form is settled and measured: a **module** `.d.ts`/`.ts` (it must contain an `import` or
`export`) containing `declare global { namespace Phaser { interface Scene { iso: IsoPlugin }
namespace GameObjects { interface GameObjectFactory { isoSprite(...): IsoSprite } } } }`. Ship
this in the package's own declarations so it activates on `import 'phaser-isometric'`. Two rival
forms must be named and forbidden in the plan text, because one of them fails *silently*:
`declare module 'phaser' { namespace Phaser { ... } }` compiles clean and augments nothing.
Add a `tsd`/`expect-type` test that asserts `this.iso` and `this.add.isoSprite` resolve — it is
the only thing standing between us and a package whose types quietly do nothing.

**On `ScenePlugin`.** `scene`/`systems` are `protected` and `| null` in the types but
unconditionally assigned in the constructor and only nulled by `destroy()`. Inside the class,
use `!` freely; it is honest, not a shortcut. Outside the class, `protected` is a hard wall —
so the camera-follow proxy cannot read `plugin.scene`, and `IsoPlugin` must expose whatever the
proxy needs through public members of its own. And because **nothing calls `destroy()` on a
scene plugin**, `boot()` must subscribe to `Phaser.Scenes.Events.DESTROY` (and `SHUTDOWN` for
the restartable case) and do its own teardown. `boot` itself is already wired by the base
constructor — override it, never re-subscribe.

**On `IsoSprite` and `depth`.** This is the single most dangerous line the plan can contain.
`depth` is a real accessor on `Sprite.prototype` whose setter is what queues the display-list
depth sort; the `.d.ts` declares it a plain property, which switches off TS2610, the exact
diagnostic that exists to catch this. A field named `depth` in `IsoSprite` compiles clean under
every setting and silently kills render ordering under ES2022 semantics. Keep
`useDefineForClassFields: false` and `target: ES2020` in `tsconfig.base.json`, never declare a
field whose name is in the §4.5 table, always write computed depth through `setDepth()` or
plain assignment, and add a runtime test that asserts
`Object.getOwnPropertyDescriptor(instance, 'depth') === undefined` after construction. That
assertion is cheap and it is the only mechanical guard available, since the compiler will not
help.

**On the factory registration.** `registerGameObject` returns `this` but is typed `void`, so the
plan must emit one statement per registration and never chain. The factory callback must be a
`function` expression with an explicit `this: Phaser.GameObjects.GameObjectFactory` parameter —
that annotation is simultaneously what gives Phaser the right `this` at runtime and what
(through a genuine TS quirk, verified in §2.4) makes the `protected` `displayList`/`updateList`/
`scene` legally reachable. No cast is needed and none should appear.

**On tsconfig.** `skipLibCheck: true` is mandatory and permanent — 2 errors on 4.2.1, 5 on
4.0.0, and the set changes between patch releases. The shell package needs `"lib": ["ES2020",
"DOM"]`; the current `["ES2020"]` produces 337 errors the instant `skipLibCheck` is relaxed and
will not let the shell touch a canvas. Keep `core` on `["ES2020"]` without DOM as a structural
guard on its purity.

**On the README config snippet.** `Phaser.Types.Plugins.ScenePluginObjectItem` does not exist;
the type is `Phaser.Types.Core.PluginObjectItem`, every field is optional, `plugin` is `any`, so
the compiler will validate nothing. Only `key`, `plugin` and `mapping` are read on the Game
Config path — `sceneKey`, `systemKey` and `start` are dead there, even though Phaser's own
typedef ships an example using `sceneKey`. `mapping` is de-facto required. Document `this.iso`
(from `mapping`); do not promise `this.sys.iso`, and do not build `snapshot()` around
`this.pluginKey`, whose value differs between the config and loader install paths.

**On testing the shell at all.** Importing *any* Phaser module in a bare Node process throws
before your code runs — `require('.../gameobjects/components/Depth.js')` transitively pulls in
device detection and dies with `ReferenceError: window is not defined`
(`src/device/OS.js:153`), then `ReferenceError: Image is not defined`
(`src/device/CanvasFeatures.js:33`). The shell package's vitest config needs
`environment: 'jsdom'` (or `happy-dom`) from the first test. The `core` package, having zero
Phaser imports, can stay on `node` — another reason the two-package split earns its keep.
