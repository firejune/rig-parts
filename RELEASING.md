# Releasing

After the first publish, the cut is one click: merge the release pull request.
Everything either side of that click is
[`.github/workflows/release.yml`](.github/workflows/release.yml), and no npm
credential exists on any machine — the publish authenticates over OIDC (npm
trusted publishing). The first publish is the exception, and it is done by hand;
see *The first publish*.

## The loop

Every push to `main` runs `release.yml`, which hands the new commits to
[release-please](https://github.com/googleapis/release-please-action):

- **Nothing releasable since the last tag** → nothing happens. Types
  release-please hides (`docs`, `test`, `ci`, `build`, `chore`, `refactor`,
  `style`) do not open a release pull request on their own. **Visibility is what
  makes a type releasable**, which is why `release-please-config.json` writes
  the whole `changelog-sections` list out: the default node list plus `check` →
  *Instrument*, so instrument work on shipped sources gets its own changelog
  line. Overriding the array replaces the default, so dropping a row hides that
  type.
- **Something releasable** → it opens or updates a pull request titled
  `release: vX.Y.Z` with three generated changes: the `package.json` version,
  `CHANGELOG.md`, and `.release-please-manifest.json`. `feat` bumps the minor;
  `fix`, `perf` and `check` bump the patch; a breaking marker bumps the minor
  while the package is pre-1.0 (`bump-minor-pre-major`). To force a version,
  put `Release-As: X.Y.Z` in a commit footer.
- **That pull request is merged** → the merge is a push to `main`, so the
  workflow runs again: release-please tags `vX.Y.Z`, cuts the GitHub release,
  and the same run publishes.

Squash-merge the release pull request, so the commit on `main` keeps its
`release: vX.Y.Z` subject.

⚠️ **A shipped file can change under a hidden type.** The package is an
allowlist (`files`) plus what npm always adds — `package.json`, `README.md`,
`LICENSE` — so a `docs:` edit to the README changes what `npm install` hands
somebody while release-please is told to ignore it. The `ships` job in
[`ci.yml`](.github/workflows/ci.yml) compares what a pull request changed
against what `npm pack --dry-run` packs at both ends and refuses that landing;
its remedy is a visible type or a `Release-As:` footer in a commit message.
**The list of packed files is not written here**: ask `npm pack --dry-run`.

## One-time setup (owner, GitHub)

**Settings → Actions → General → Workflow permissions → tick "Allow GitHub
Actions to create and approve pull requests."** While it is off release-please
cannot open the release pull request at all.

`release-please-config.json` needs a `bootstrap-sha` — the commit release-please
stops reading history at on its first run — set once, to the commit that
introduces these files. It is deliberately absent from the file as first
written, because that commit does not exist until the file is committed; the
owner adds it in the commit after.

## The first publish, by hand

npm trusted publishing is configured on a package's settings page, and the page
does not exist until the package does. So the first version under a name goes up
by hand, from the tagged tree, and every version after it is the workflow's. That
was 0.1.0 under the package's former name; under `rig-parts` it is the first
version cut after the rename, with that version's tag in place of `v0.1.0` below:

```sh
npm login                        # once per machine; `npm whoami` to check
git checkout v0.1.0              # the tagged tree
bun install --frozen-lockfile
npm publish                      # runs prepublishOnly, then asks for the OTP
```

`prepublishOnly` runs `bun run typecheck && bun run lint && bun run selftest`
before npm packs anything, so a tree that fails its own gates cannot be
published by the workflow or by hand. `publishConfig.access` already says
`public`. The alias goes out after it, from the same tree, as a tarball (*Two
names, one tree* below):

```sh
npm publish "$(bun scripts/alias_tarball.ts pack --name spine-parts --out ../alias)"
```

Confirm with `bun run smoke -- --source registry --version 0.1.0 --case clean
--alias spine-parts`.

### Two names, one tree

Every version is published under two names: `rig-parts`, the `name` in
`package.json`, and the alias `spine-parts`, the name the package shipped under
up to 0.16.0, kept so an install or a dependant that names it keeps receiving
every release. The two carry the same files; the one difference is the `name`
line of `package.json`.

- **The alias is published from a tarball, after the gated publish, in the same
  job.** `release.yml`'s step *Publish the alias spine-parts* runs
  [`scripts/alias_tarball.ts`](scripts/alias_tarball.ts)` pack`, which packs the
  checkout the gated publish just published from into the runner's temp
  directory, rewrites the one `"name"` line of the extracted `package.json`,
  packs it again, and prints the path only after `compare` reads it as the
  package's files byte for byte but for that line. `npm publish <that tarball>`
  publishes it. The checkout is never modified.
- **No lifecycle script runs on the alias, by design.** `npm publish <tarball>`
  runs none, so `prepublishOnly` gates the first publish and only that one. A
  second gated publish would need the package renamed in the checkout, and the
  gate would then pass a modified tree rather than the tagged commit; the alias
  is that commit's files, which is what the gate's verdict is about.
- **The name is written once for a program to read**: `ALIAS` in
  `scripts/alias_tarball.ts`. The selftest's `AL01` holds `release.yml`'s pack
  step and both confirmation calls to it, and the alias publish to run after the
  gated one in the same job, from the tarball the pack step printed.

#### The alias stays until its retirement questions have written answers

The alias is kept for as long as links from outside this repository point at
it — the npm page, forum threads, articles, badges other READMEs copied. It
**never gets its own version**: every version goes out under both names from
the one gated tree, and no version goes out under the alias alone. Retiring it — deprecating it,
un-publishing it, or letting the name fall behind the package's version line —
is not a release step and not a convention; it is a separate card, which opens
only after three things are written down:

1. **npm history** — what is lost when the alias stops: download history, the
   package page, the provenance links of every version published under it.
2. **External links** — an inventory of what points at the alias name, and
   where each one resolves after the rename and after a retirement (GitHub
   redirects the repository URL; nothing but the alias covers the npm page).
3. **What the alias says** — one sentence in the README naming the package's
   current name (*Requirements*; the alias carries the same README). No
   `npm deprecate`: a banner on every install is a retirement wearing an
   alias's name.

The same policy holds for every package of the toolchain: `rig-c` (renamed on
npm at 2.20.4; its former name is spelled only in `CHANGELOG.md`, `TY11`),
`rig-parts` and the alias `spine-parts` beside it, and `spine-html` → `rig-play`.

Confirm a cut by hand: `npm view rig-parts version` and `npm view spine-parts version`
print the same version, and the smoke's `--alias` compares the two tarballs the
registry serves.

### The registry side (owner, npmjs.com), after the first publish

One trusted-publisher form per name — npmjs.com → **rig-parts** → **Settings** →
**Trusted Publisher** → *GitHub Actions*, and the same under
the alias `spine-parts` — both pinned to the same workflow, with the same fields:

- Organization or user: `firejune`
- Repository: `rig-parts`
- Workflow filename: `release.yml`
- Environment name: *blank* (the workflow declares none)
- Allowed actions: `npm publish`

The fields are case-sensitive and npm does not validate them on save, so a typo
surfaces only as a failed publish. Then **Settings → Publishing access →
Require two-factor authentication and disallow tokens**: trusted publishing
presents no token, so it costs the automation nothing, and it closes the
unattended path.

A form is matched against the repository name and the workflow filename the
run's OIDC token carries, so a form saved before the repository was renamed
names the old repository; read both forms after a rename. Until a name's form
matches, its publish is refused, and because the alias step runs after the
package's publish, a refused package publish stops the cut before the alias.

Two properties of that configuration are load-bearing in the workflow:

- Both publish steps must live in **`release.yml`**. Renaming the file, or moving
  either publish into another workflow, breaks that name's trusted publisher until
  its form is updated to match.
- It must run on a **GitHub-hosted runner**. npm does not support trusted
  publishing from self-hosted runners.

`publishConfig.provenance` is deliberately not set: provenance can only be
attested from a run holding an OIDC token, so setting it would fail the manual
publish. The workflow passes `--provenance` on the command line instead.

## Cutting a release

1. Land the work on `main` with conventional-commit subjects.
2. Wait for the `release` run to open or update the `release: vX.Y.Z` pull
   request, and read its diff — the version and the changelog are the review.
3. **Approve its `ci` run.** A `pull_request` run started by `GITHUB_TOKEN`
   lands in `action_required`, so the required check reads as blocked until a
   human approves it (**Approve and run** in the Actions tab, or `gh api -X POST
   repos/firejune/rig-parts/actions/runs/<id>/approve`). A `workflow_dispatch`
   run on the same commit does not satisfy a required check: it is matched by
   the run that reported it, not by the SHA.
4. **Merge it.** That is the cut.
5. Watch the second `release` run: it tags, releases, publishes under both
   names, and then confirms the published package installs and runs and that the
   alias carries its files, waiting up to 15 minutes for the registry.

## Whether the tarball runs

What the package *holds* and whether it *works* are two facts. **The gate is
the `installs` job in `ci.yml`**, on every pull request and push to `main`: it
runs `bun run smoke` ([`scripts/install_smoke.ts`](scripts/install_smoke.ts)),
which packs a tarball from the branch, installs it into an empty directory,
generates a fixture with the INSTALLED package's own codec and PSD writer, and
runs `--version`, the installed `rigc --version` (which must name the core
entry), `layers` on a wrapper directory and on a PSD, `sheet`, and `check` on a
generated two-part rig from the install. Four packages are broken on purpose —
`src/layers.ts` out of the pack, `rig-c` out of `dependencies`, `ag-psd`
out of `dependencies`, `@esotericsoftware/spine-core` added to `dependencies` —
each patched into an extraction of the tarball, never the checkout; a plant case
is green only when the smoke went red at the step it names, naming what went
missing. A correct package installed at a path with spaces and non-ASCII in it
must pass too.

⚖️ **The registry half is a confirmation, not the gate**: the last step of
`release.yml` runs the same script with `--source registry --alias spine-parts`
after both publishes. It is not the gate because its own firing cannot be
observed without publishing something broken. `--alias` fetches the same version
under the alias and holds its unpacked files to the package's with
`scripts/alias_tarball.ts compare`, rather than installing it a second time. Its
exits:

| exit | what it means | what to do |
| --- | --- | --- |
| `0` | the published package installs and runs, and the alias carries its files | nothing |
| `1` | the registry served it and a case went red on it, or the alias differs beyond its name | read the named fault; the cut needs a follow-up |
| `2` | no case ran | a broken invocation, not a verdict |
| `3` | the registry did not serve the version, or the alias, inside `--wait` — the confirmation was NOT taken | re-run it: Actions → release → Run workflow, with the version |

The dispatch runs the `confirm` job only; the job holding release-please, the
tag and `npm publish` runs only on a push, so a re-run cannot re-cut anything.
