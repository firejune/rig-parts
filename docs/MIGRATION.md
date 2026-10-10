# Migrating from 0.16.0

0.16.0 was the last version published under the package's former name. This page is
what changed between it and 1.0.0 for a user of the command, an author of a config
and a reader of the files a build writes; what 1.0.0 holds stable is
[STABILITY.md](STABILITY.md). It comes in two parts: 0.16.0 to the release candidate
1.0.0-rc.1, then what landed between the candidate and 1.0.0. Every figure is quoted
from the pull request that measured it.

## In one paragraph

Install `rig-parts`. A config that built on 0.16.0 loads and builds unchanged: every
config change since is a new, opt-in field inside a new mesh mode. The bytes a
config without that mode builds moved once, by a declared exception (every mesh
triangle's vertex order, #133); apart from it, each change since 0.16.0 that touched
the code was measured against the tree before it on the three public examples'
builds, and moved no byte of them. Inside the automatic mode, one change after the
candidate moves declared bytes, named in *Since 1.0.0-rc.1*: the skinning envelope's
reference (#169).

## From 0.16.0 to 1.0.0-rc.1

### The package name

| | 0.16.0 | 1.0.0-rc.1 and 1.0.0 |
| --- | --- | --- |
| npm package | the former name | `rig-parts`; the alias `spine-parts` is published beside it at every version, the same files with only the `name` in `package.json` changed |
| command | the former name | `rig-parts`; the install also keeps the alias `spine-parts` as a second command on the same launcher, for the transition |
| repository | the former repository name (GitHub redirects it) | `firejune/rig-parts` |
| selftest variables | the `SPINE_PARTS_` names | `RIG_PARTS_CORPUS`, `RIG_PARTS_SELFTEST_JOBS`, each read first, with the former `SPINE_PARTS_` name read when it is not set |
| spec ids of the files authors write and this package writes | `spine-parts-requirements/1`, `spine-parts-scene/1`, `spine-parts-keypoints/1`, `spine-parts-bonemap/1`, `spine-parts-basis/1`, `spine-parts-scene-report/1` | unchanged: they name a file format, not the tool, so a file written before the rename still reads |
| public examples repository | `spine-parts-examples` | unchanged (it keeps the name it was published under) |

What to do: install with `npm install -g rig-parts` and write `rig-parts` in scripts.
A script or a dependant that names the alias `spine-parts` keeps working and keeps
receiving every release; how long the alias stays is RELEASING.md's *The alias stays
until its retirement questions have written answers*. No build output carries the
package name: a grep of all 330 files the three example builds write found neither
spelling (#142). The console does: the lines that name the tool (5 per build: the
`build`, `assemble`, `rig` twice and `check` lines) now say `rig-parts`. Where a
config uses a constraint or `--idle-keys direct`, the `why` prose this package writes
into `rig.json`'s invariants names `rig-parts` too; that prefix is the one known
output change of the rename (#142).

### rig-c, as this package sees it

The dependency is `rig-c` `^2.33.0` at 1.0.0 (`^2.31.0` at 1.0.0-rc.1; the moves
between the two are in *Since 1.0.0-rc.1*), where 0.16.0 took the same upstream
package under its former npm name at `^2.15.0`; that name is spelled only in `CHANGELOG.md`.
The upstream package was renamed on npm at 2.20.4 with the same `exports` map
(#138), and every import, probe and sentence here names `rig-c`. A project that
installed the former upstream name beside this package installs nothing more:
`rig-c` comes as a dependency. No Spine runtime is a dependency, as in 0.16.0.

### The config

**A config that built on 0.16.0 loads unchanged.** The loader's only change between
the two is one more optional key, `auto`, on `meshes.<part>`, and the objects under it;
no key was removed, renamed or made required outside it, and no CLI flag was added or
removed (`git diff v0.16.0` of `src/config.ts` and `cli.ts`). `grid` and `contour`
meshes read exactly as before, and `propose` still writes `grid`.

What an author who adopts the new mode meets (AUTHORING §3, *An automatic mesh*):

- **`meshes.<part>.auto`**, the third mesh mode (#131): the contour mesh at alpha 1
  and above, reduced and locally refined by rig-c's `reduceMesh` under declared
  bounds. Exactly one of `grid`, `contour` and `auto` per mesh.
- **`motion` is required in it** (#134): at least `maxLocalDeformation`, the bound
  the reduced mesh's motion against its unreduced source on the idle must meet
  before the part is written. A part the idle cannot deform is refused, never
  passed.
- **`maxOvershoot` and `maxUndercut` take `null`** (#139), in `sourceBounds` and in
  `targets.artFit`: measured and reported, not bounded. Leaving the field out is
  still refused by name.
- **The acceptance loop** (#141) replays a less-reduced step when the motion gate
  refuses the full reduction; it needs no field. **`motion.selection`** (#151,
  opt-in) replaces its bisection with a budgeted multi-interval search.
- **The Stage B opt-ins** (#147): `boundaryRuns`, `retriangulate`, `removalOrder`.
- **`motion.gradation`** (#150, opt-in): the author's G for rig-c's allocation
  contrast row.
- **`motion.residual`** (#152, opt-in): the skinning residual as a per-step veto.

Without any of these the mode's output is what it was before each was added: every
pull request that added one compared the opt-out run against the tree before it,
byte for byte.

### The bytes a build writes

| change | what moved | measured |
| --- | --- | --- |
| #131, the automatic mode | nothing for a config without `auto` | 330 of 330 files of the three example builds identical, main at rig-c 2.15.0 against the change at 2.19.0 |
| #133, the winding | **the declared exception**: every mesh `triangles` triple `[a, b, c]` is written `[a, c, b]` (counter-clockwise in Spine world), in `rig.json`, the compiled `skeleton.json`, `skeleton.model.json` and the render's `geometry.json`; the `TEXTURE_STRETCH` entries in `check.json` that print a triangle's vertices and edge print them in that order; `spine.sha256` follows the skeleton bytes | every rendered PNG byte-identical before and after; the triangle index, the unordered edge, the frame, the ratio and the severity unchanged |
| #134, #137 to #142, #146, #147, #150, #152 | nothing | 330 of 330 at each, against the tree before it; the console differs in the one `rigc <version>` line per build where rig-c moved |
| #172 unit 1b, one mask under `stray` | nothing for a part without `auto.source.stray`; a part that declares it now builds where its extra islands at or under the figure refused it (`REDUCE_SOURCE_FAILS_ITS_ART_BOUNDS`): the islands are cleared from the art every reader of the mesh takes, and its row gains `stray_cleared` (islands, pixels, art pixels) and its mesh line a `stray cleared` clause; the written image is the part as assembled | the selftest's `SY01`–`SY06` on a synthetic crumb part; a part without `stray` reads the very mask object it read before (`SY03`) |
| #151, the multi-interval selection | nothing without `motion.selection` | measured on the selftest's fixture configs, not the example builds: rig.json, motion.json, mesh_report.json and the printed log identical in all six configurations; #152 then measured the example builds against the tree #151 left, 330 of 330 |

What to do: a consumer that compares a build with one 0.16.0 wrote, byte for byte,
expects the #133 exception and nothing else; one that reads the meshes (a renderer,
a culling pass, rig-c's own orientation rows) now reads every triangle
counter-clockwise in Spine world, as rig-c writes its own. Spine does not cull, so
nothing draws differently.

## Since 1.0.0-rc.1

Every change below is additive to the interface: a field that was refused is now
accepted, or a build that was refused now builds; nothing a 1.0.0-rc.1 config could
say is removed or reads differently, outside the declared byte move below. No CLI
flag was added or removed.

- **Density-only regions** (#156, opt-in): an `auto.regions` entry may leave out both
  `bone` and `band` to ask rig-c for density without touching any weight. One without
  the other is refused by name (`CONFIG_REGION_BAND_NEEDS_BONE`,
  `CONFIG_REGION_BONE_NEEDS_BAND`; at 1.0.0-rc.1 the same input was refused
  `CONFIG_FIELD_PRESENT`, naming the missing field), and a region with both reads as
  before. A config without such a region builds as before.
- **The skinning envelope's reference** (#169), **the declared byte move**: under
  `motion.residual`, the envelope rig-c's reducer is sent is derived against the
  lowest common ancestor of the slot's bone and every bone the part's weights bind,
  where 1.0.0-rc.1 derived it against the slot's bone and, when a bound bone did not
  hang below it, sent no target, so the residual veto did not apply. Such a part's
  reduction, written mesh and `mesh_report.json` row move; a part whose bound bones
  all hang below the slot's bone makes the same call as before. The
  `skinning_residual` row keeps its shape: its `reference` names the bone the envelope
  was derived against, and a part whose reference is not the slot's bone carries a
  second `rule` sentence naming the rule. `ENVELOPE_BONE_NOT_BELOW_REFERENCE` keeps
  its name and its check.
- **rig-c `^2.33.0`** (#163, #166, #173, from `^2.31.0`): 2.32.1 refuses, by name, a
  refinement insertion whose triangle would read as degenerate (`MQ_DEGENERATE`)
  instead of writing it (rigc#1311); 2.32.2 no longer misrefuses a motion sample on an
  edge two triangles share (`COMPARE_UV_CARRIER_NOT_UNIQUE`, rigc#1323); 2.33.0 adds
  named interior lines, which this package does not send. The three example builds
  are byte-identical across the move (#173).

What to do: nothing for a config without `auto`. A config under `auto` that declares
`motion.residual` may write a different mesh than 1.0.0-rc.1 did, as above; a
consumer that compares builds byte for byte with 1.0.0-rc.1 expects that move and
nothing else.
