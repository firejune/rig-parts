# Contributing

spine-parts is small and opinionated, and most of the opinions are written
down — [CLAUDE.md](CLAUDE.md) is the doctrine, and it is worth ten minutes before
a first patch.

## Issues are the ledger

Open an issue before a substantial change. Open questions live in issues rather
than a backlog file, so an issue is where a decision gets its reasons attached
and where the next reader finds them.

A good defect report names three things:

1. what you gave spine-parts — the command line, and the smallest input that
   reproduces it (a `layers.json` with one layer is usually enough; do not
   attach art you may not share);
2. what it printed, verbatim, including the rule name on every `FAIL` line;
3. what you expected instead.

⚠️ **A wrong output that came back green is the most valuable report there
is.** The tool exists to turn silent wrongness into a named failure, so "it
said green and the parts are wrong" is a bug here even when every check behaved
as written.

## Before you open a pull request

```bash
bun run typecheck    # tsc --noEmit, strict
bun run lint         # one rule: @typescript-eslint/no-explicit-any, as an error
bun run selftest     # every gate's negative controls, on fixtures it generates
```

`bun run selftest` needs no arguments and no assets. Without `--corpus`, and
without the public examples' inputs fetched (`bun run fetch-examples`, which
CI runs first), the corpus suite reports a HOLE rather than a result, and the
summary says so.

A fourth needs a network, because it installs packages:

```bash
bun run smoke        # pack, install into an empty directory, run from the install
```

Reach for it before pushing anything that touches `files` in `package.json`,
`bin/`, a runtime import that crosses a directory, or a dependency — the changes
a green checkout cannot see. Its three planted broken packages run beside the
green cases, so a run that passes has watched the check fail three times.

## What a change has to clear

- **No `any`, no `as any`, in `src/` or `cli.ts`.**
- **A new check needs a planted failure.** A gate nobody has seen fail is not a
  gate: every check needs a case in `selftest.ts` that makes it fire, beside a
  positive control. A check with nothing to measure reports SKIP, never a pass.
- **Never invent a value.** A missing number is a refusal naming the field.
- **A raster op says what it reproduces.** A new op in `src/raster/` names the
  OpenCV / SciPy / PIL call whose semantics it matches and what it was measured
  against; a deviation goes in its doc comment.
- **Nothing from the private corpus.** No image, layer, manifest, config or
  character name from it — CLAUDE.md, *Where the private oracle lives*. The
  public examples under `examples/` are not it, and the same section says why.
- **English only**, in every tracked file.
- **Determinism is a contract.** Fixed key order, stable sorts, no clock, no
  randomness in `src/` outside `src/comfy/`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) with a scope —
`feat(layers):`, `fix(raster):`, `check(selftest):`, `docs(readme):`. Subject and
body in English. The subject is what release-please reads: `feat` bumps the
minor, `fix`, `perf` and `check` bump the patch, everything else is invisible to
the release. See [RELEASING.md](RELEASING.md).

⚠️ **A landing that changes a file inside the published package has to be
visible to the release.** The package is the `files` allowlist plus what npm
always adds (`package.json`, `README.md`, `LICENSE`); `npm pack --dry-run`
prints it. The `ships` job in CI refuses a landing that changes a packed path
under a type release-please hides. Either remedy clears it: a type the
changelog shows, or a `Release-As:` footer in a **commit message on the
branch** (the squash body is made of the commits, not the pull request body).

Keep one unit of work per commit.

## Licence

Contributions are accepted under the MIT licence in [LICENSE](LICENSE).
spine-parts depends on spine-rigc; `spine-core` is this repository's development
dependency, for the round trip in the selftest and CI. [NOTICE.md](NOTICE.md) sets
out what that means.
