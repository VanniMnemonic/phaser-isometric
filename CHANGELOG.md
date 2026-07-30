# Changelog

All notable changes to `phaser-isometric` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) —
with the caveat that **below `1.0.0` a minor release may break the API**. No
real game has exercised this surface yet; `1.0.0` is the version that promises
it will not move under you.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-07-30

First public version.

### Added

- **`IsoPlugin`, a Phaser 4 Scene plugin** reached as `this.iso`, installed via
  `isoScenePlugin({ projection })`. It owns four things Phaser 4 does not do
  correctly on an isometric map: a projection whose round trip is exact, a
  depth key that can never tie, elevation-aware picking that agrees with a real
  click to the pixel, and view culling — of which Phaser 4 performs none.
- **`IsoSprite` and `this.add.isoSprite(gx, gy, texture, frame?)`**, a Sprite
  that knows its cell, its elevation and its band.
- **`phaser-isometric/core`**, the same maths with **no Phaser import at all**,
  so a level generator, a unit test, or a server can agree with the client
  about which cell a click named. An AST guard in the test suite fails the
  build if a Phaser import ever appears in it.
- **`phaser-isometric/debug`**, an on-screen overlay drawing cell outlines,
  coordinate and depth-key labels, and the culled region — `createIsoDebug(iso,
  opts)`. Its geometry lives in the core, so it is testable without a browser.
- **An agent-facing `SKILL.md`** shipped inside the package, plus `llms.txt`.
  Their Quick Start is not prose: it is `examples/quickstart/src/main.ts`,
  a project the CI compiles, injected by a generator with a drift gate, and
  installed verbatim into a virgin project by the tarball gate. A wrong Quick
  Start is a red build.

### Known limitations

- **Two `Phaser.Game` instances on one page share one plugin registration.**
  `PluginCache` is a module-level singleton. A second Game asking for a
  different projection silently gets the first one's. The plugin emits a
  `console.warn` naming both ways out. Documented in SKILL.md gotcha 1.
- `setRoundPixels` has no effect under WebGL at **any** camera zoom other than
  exactly 1 — a Phaser constraint, not this plugin's. Documented in SKILL.md.
- Not in scope for v1: pathfinding, movement, collision, occlusion, Tiled
  import, physics, multi-level maps.

### Performance

Measured, with its conditions attached, in README.md's "Performance" section.
The headline number is asserted by `examples/e2e/bench.spec.ts`, so it cannot
drift away from the documents that quote it — but that benchmark is excluded
from CI, because its baseline was recorded on one specific machine.

Re-measured on an idle machine immediately before this release, per
`RELEASING.md` section 3. The 8.3 ms median frame period reproduced
**identically in all eighteen runs across the two campaigns**. The two
secondary ranges did move, both downward, and the documents were corrected to
match: per-frame cost `0.19-0.25` → **`0.17-0.25 ms`**, baseline `~0.06-0.07` →
**`~0.05-0.07 ms`**. The ratio claim of 2.5-5x held unchanged, measured at
2.74-4.67x.

[Unreleased]: https://github.com/VanniMnemonic/phaser-isometric/compare/main...HEAD
[0.1.0]: https://github.com/VanniMnemonic/phaser-isometric/releases/tag/v0.1.0
