# Releasing phaser-isometric

This file is for whoever runs `npm publish`, not for consumers of the package —
it is deliberately not part of `packages/plugin/package.json`'s `files` field
and never ships in the tarball.

Do these in order. Every item exists because skipping it once already cost
someone real time on this project.

## 1. `pnpm check` must be green

```
pnpm check
```

This runs, in order: `build`, `test`, `typecheck`, `docs:check`, and the
Playwright browser gate (`e2e`, benchmark excluded). It is the same sequence
CI runs on every push and PR. If any step is red, stop here — nothing below
this line is meaningful on top of a build that does not even compile or test
clean.

## 2. `pnpm verify:tarball` must pass

```
pnpm verify:tarball
```

This is deliberately **not** in CI — it needs network access, several minutes,
and a real Chromium browser, none of which belong in a per-push gate. That
does not make it optional before a publish: it is the *only* check in this
repository that packs the real tarball with `pnpm pack`, installs it into a
fresh Vite + TypeScript project created **outside** this monorepo, typechecks
it, builds it, and opens the built page in a browser to confirm it actually
draws something. Every other test in this repo runs against the workspace,
where pnpm resolves `phaser-isometric` to the source tree regardless of what
the package's `exports` map says — so a broken `exports` entry, a `.d.ts` that
was never emitted, or a path that only works from inside the monorepo would
pass every other check and still hand a real `npm install` a broken package.
Because this package deliberately does not ship its `src/` (see `files` in
`packages/plugin/package.json`), this tarball gate is the only thing standing
between an `exports` typo and a published, broken 0.1.0.

Run it clean before every publish. It cleans up its own tarball and temp
project on both success and failure — if you see either left on disk, the run
did not finish, not that it is safe to ignore.

## 3. Re-run the benchmark on an idle machine before re-quoting any number

The performance numbers currently in `SKILL.md`, `README.md` and `llms.txt`
(8.3 ms median frame period at 500 active `IsoSprite`s) are true **as
measured** — on an idle Apple M1 Max laptop, nothing else running. They are
not a property of the code alone. Measured directly on the same hardware
while it was busy with other work, the same benchmark produced a 10.6 ms
median — a fully different number, from the identical commit, on the same
machine, with no code change in between. The gap is the machine, not the
plugin.

Before quoting a performance number anywhere in the shipped docs — after
touching anything on the hot path, or simply because a release is a natural
point to re-verify a claim rather than assume it still holds — re-run
`pnpm e2e` including the `@bench` test on a machine doing nothing else, and
update the number (and the "conditions" sentence that travels with it) if it
moved. Never copy a number measured on a machine under load; it will read as
true and will not be.

## 4. `npm login`

Publishing needs an authenticated npm session. As of this writing, `npm
login` has **not** been run on this development machine — check with
`npm whoami` before assuming otherwise, and log in if it errors. This is a
blocking, manual, interactive step: it cannot be scripted or assumed done.

## 5. What `0.1.0` commits to, and what it does not

The version is `0.1.0`. Below `1.0.0`, semver explicitly permits a breaking
change inside a minor release — `0.1.0` to `0.2.0` is allowed to change or
remove public API with no major bump. Publishing at `0.1.0` is therefore a
statement that **the API can still move**: no real game has exercised it yet,
and early feedback may reshape a signature, a default, or an export. Treat
any consumer-facing decision made under time pressure as reversible until
`1.0.0`, and say so if asked — a consumer discovering this the hard way, after
depending on an 0.x contract as if it were stable, is a worse outcome than
reading it here first.

## Checklist

- [ ] `pnpm check` is green
- [ ] `pnpm verify:tarball` passes against the tarball about to be published
- [ ] Any performance number about to be re-quoted was re-measured on an idle
      machine in this release cycle
- [ ] `npm whoami` succeeds (logged in as the intended publishing account)
- [ ] `npm publish` is run from `packages/plugin`, not the repo root
