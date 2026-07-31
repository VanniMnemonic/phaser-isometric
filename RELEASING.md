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

Since `0.2.0` it also runs the installed **`bin`** through
`node_modules/.bin/phaser-isometric`, which is the only place where three things
are simultaneously real: the `#!` line in `dist/cli.js` (the vitest suite
launches the file with `node`, which works without one), the executable bit that
npm sets at install time rather than we at pack time, and the
`npx phaser-isometric` promise the documentation puts in front of a reader. It
also checks that the installed command reports the manifest's version, which is
what makes "it is by construction the version you installed" an executed fact
rather than a sentence.

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

## 4. `npm login`, and the three errors that do not say what they mean

Publishing needs an authenticated npm session. Check with `npm whoami` — it
must print the intended publishing account — and run `npm login` if it errors.
This is a blocking, manual, interactive step: it cannot be scripted or assumed
done.

**A login does not stay done.** The token npm's web flow writes to `~/.npmrc`
expires; during the `0.2.0` release it stopped being accepted about eleven
hours after it was issued, with no warning and no change on this machine.
`npm whoami` is a per-release check, not a one-time setup step.

The `0.2.0` release took five attempts. Every one of them failed for a reason
this document already named, because **none of the error messages points at
its own cause**. The signatures, so the next one costs a minute instead of an
hour:

| What npm prints | What is actually wrong | Fix |
| --- | --- | --- |
| `Cannot read properties of null (reading 'prerelease')`, usually with `npm warn gitignore-fallback` | `npm publish` ran from the **repo root**, whose manifest is private and has no `version`; npm parses it to `null` and crashes before it can tell you | Run from `packages/plugin`. Put the `cd` and the `npm publish` **on one line** — a two-line paste loses the `cd` and lands you here again |
| `code EOTP` — `This operation requires a one-time password`, with a URL to open | The shell has **no TTY**, so npm cannot print the URL and then wait for the browser challenge. It gives up instead. Opening the URL afterwards does nothing: that process is gone | Publish from a real terminal window, not from a non-interactive shell (this includes running it through a coding agent's shell) |
| `404 Not Found - PUT https://registry.npmjs.org/<name>` | **Not** a missing package. npm answers `404` instead of `403` when credentials lack write access, so as not to reveal private packages. Here it meant the token had expired | `npm whoami` first — if it returns `401`, `npm login` |

The tell that separates the last two: a valid session that merely needs the
second factor reaches `EOTP`. A session with no valid credentials never gets
that far, so **`404` without a preceding `EOTP` means the token, not the
package**.

## 5. Move the release out of `[Unreleased]` in `CHANGELOG.md`

`CHANGELOG.md` lives at the repository root and, like this file, deliberately
does not ship in the tarball — npm's own always-included set is `package.json`,
`README` and `LICENSE`, and `files` in `packages/plugin/package.json` is frozen
by an equality assertion in `packaging.test.ts`, so adding to it is a
deliberate packaging change, not a side effect of writing a changelog entry.
GitHub and npm's web UI both read it from the repository.

Before publishing: move whatever sits under `[Unreleased]` into a dated version
section, and check that the "Known limitations" list still matches what SKILL.md
says. A changelog that lags the docs is worse than none — it reads as
authoritative.

## 6. What `0.1.0` commits to, and what it does not

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
- [ ] `CHANGELOG.md` has this version in a dated section, not in `[Unreleased]`
- [ ] `npm whoami` succeeds (logged in as the intended publishing account) —
      re-checked for THIS release, not carried over from the last one
- [ ] `npm publish` is run from `packages/plugin`, not the repo root, with the
      `cd` on the same line as the command
- [ ] `npm publish` is run from an interactive terminal — a non-TTY shell
      cannot complete the 2FA browser challenge and fails with `EOTP`
