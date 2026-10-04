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
does not exist until the package does. So `spine-parts@0.1.0` goes up by hand,
from the tagged tree, and every version after it is the workflow's:

```sh
npm login                        # once per machine; `npm whoami` to check
git checkout v0.1.0              # the tagged tree
bun install --frozen-lockfile
npm publish                      # runs prepublishOnly, then asks for the OTP
```

`prepublishOnly` runs `bun run typecheck && bun run lint && bun run selftest`
before npm packs anything, so a tree that fails its own gates cannot be
published by the workflow or by hand. `publishConfig.access` already says
`public`. Confirm with `bun run smoke -- --source registry --version 0.1.0
--case clean`.

### The registry side (owner, npmjs.com), after the first publish

npmjs.com → **spine-parts** → **Settings** → **Trusted Publisher** → *GitHub
Actions*:

- Organization or user: `firejune`
- Repository: `spine-parts`
- Workflow filename: `release.yml`
- Environment name: *blank* (the workflow declares none)
- Allowed actions: `npm publish`

The fields are case-sensitive and npm does not validate them on save, so a typo
surfaces only as a failed publish. Then **Settings → Publishing access →
Require two-factor authentication and disallow tokens**: trusted publishing
presents no token, so it costs the automation nothing, and it closes the
unattended path.

Two properties of that configuration are load-bearing in the workflow:

- The publish step must live in **`release.yml`**. Renaming the file, or moving
  the publish into another workflow, breaks the trusted publisher until the form
  is updated to match.
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
   repos/firejune/spine-parts/actions/runs/<id>/approve`). A `workflow_dispatch`
   run on the same commit does not satisfy a required check: it is matched by
   the run that reported it, not by the SHA.
4. **Merge it.** That is the cut.
5. Watch the second `release` run: it tags, releases, publishes, and then
   confirms the published package installs and runs, waiting up to 15 minutes
   for the registry.

## Whether the tarball runs

What the package *holds* and whether it *works* are two facts. **The gate is
the `installs` job in `ci.yml`**, on every pull request and push to `main`: it
runs `bun run smoke` ([`scripts/install_smoke.ts`](scripts/install_smoke.ts)),
which packs a tarball from the branch, installs it into an empty directory,
generates a fixture with the INSTALLED package's own codec and PSD writer, and
runs `--version`, the installed `rigc --version` (which must name the core
entry), `layers` on a wrapper directory and on a PSD, `sheet`, and `check` on a
generated two-part rig from the install. Four packages are broken on purpose —
`src/layers.ts` out of the pack, `spine-rigc` out of `dependencies`, `ag-psd`
out of `dependencies`, `@esotericsoftware/spine-core` added to `dependencies` —
each patched into an extraction of the tarball, never the checkout; a plant case
is green only when the smoke went red at the step it names, naming what went
missing. A correct package installed at a path with spaces and non-ASCII in it
must pass too.

⚖️ **The registry half is a confirmation, not the gate**: the last step of
`release.yml` runs the same script with `--source registry` after the publish.
It is not the gate because its own firing cannot be observed without publishing
something broken. Its exits:

| exit | what it means | what to do |
| --- | --- | --- |
| `0` | the published package installs and runs | nothing |
| `1` | the registry served it and a case went red on it | read the named fault; the cut needs a follow-up |
| `2` | no case ran | a broken invocation, not a verdict |
| `3` | the registry did not serve the version inside `--wait` — the confirmation was NOT taken | re-run it: Actions → release → Run workflow, with the version |

The dispatch runs the `confirm` job only; the job holding release-please, the
tag and `npm publish` runs only on a push, so a re-run cannot re-cut anything.
