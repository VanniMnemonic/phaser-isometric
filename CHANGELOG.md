# Changelog

All notable changes to `phaser-isometric` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) —
with the caveat that **below `1.0.0` a minor release may break the API**. No
real game has exercised this surface yet; `1.0.0` is the version that promises
it will not move under you.

## [Unreleased]

Nothing yet.

## [0.2.0] — 2026-07-31

**Nothing in this release breaks.** The public surface of `phaser-isometric` and
the `exports` map are byte-identical to `0.1.0`; the version moves because two
things were added. Said explicitly because, below `1.0.0`, a minor release is
*permitted* to break, so "0.2.0" alone would leave a reader guessing.

### Added

- **`npx phaser-isometric diagnose`** — a command that prints a decision-grade
  card about a projection and depth configuration: the matrix and its
  determinant, how far that matrix sits from singular, the depth layout with the
  exact row at which keys stop being distinguishable, the world bounds for a
  grid, the round-trip error, and warnings. One call instead of five, and no
  browser.

  It ships **inside this package**, deliberately, rather than as a separate MCP
  server: there is no second artifact, and therefore no way for the oracle to
  disagree with the version you installed. `--json` returns the same facts as
  data. `--strict` makes warnings exit 2 for CI; without it a warning is printed
  and the exit code stays 0. A rejected configuration exits 1 and prints the
  symptom and the correction as **two separate fields**, never glued into one
  sentence.

  What is a *warning* is a configuration that will surprise you later — tile
  centres on half pixels, an `elevationStep` of 0 (which a raw `matrix` spec
  silently defaults to), a near-singular matrix, a grid reaching past the row the
  depth layout was validated for. What is an *error* is a configuration the
  constructors already reject. Three conditions considered for the warning list
  were dropped because they can never fire: `det === 0`, a fractional origin and
  an exhausted depth headroom all throw at construction.

- **`buildDiagnosis`, on `phaser-isometric/core` only.** Like `buildDebugModel`,
  it is a model-builder for tooling, so the plugin entry a Scene imports does not
  re-export it — and a test walks the import graph of `dist/index.js` to prove
  the game bundle never carries it.

### Changed

- Nothing. `0.1.0` code compiles and runs unmodified.

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

[Unreleased]: https://github.com/VanniMnemonic/phaser-isometric/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/VanniMnemonic/phaser-isometric/releases/tag/v0.2.0
[0.1.0]: https://github.com/VanniMnemonic/phaser-isometric/releases/tag/v0.1.0
