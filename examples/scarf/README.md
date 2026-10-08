# scarf

A generated full-body character — prompted as an adult woman with shoulder-length
straight black hair, a very long red knitted scarf wrapped once around the neck
whose two ends hang free down the front of the body, a beige knit sweater, a dark
green pleated skirt, black tights and brown loafers — made for this repository with
a public checkpoint (Pony Diffusion V6 XL) and no LoRA; `config.json`'s `generation`
block is the whole record, and its `seed_note` says how seed 72004 was chosen from
72001–72006. Its heavy inputs (the painting, the two images See-through was fed, and
the `full` and `head` See-through layer sets) live in the
[spine-parts-examples](https://github.com/firejune/spine-parts-examples) repository,
which also holds the licence; `bun run fetch-examples` copies them into `inputs/`
here (gitignored).

## Why it exists

- **A hanging element the other two lack.** The scarf is painted inside the
  `topwear` layer; the proposer's two `robe` chains (`robe_r`, `robe_l`, four links
  each) run down that part's two sides, where the scarf ends hang to the thighs, and
  the idle swings them.
- **The first character run through the pipeline with the proposal unedited.** The
  config's `bones`, `meshes` and `motion` are `proposal.json`'s, value for value, but
  for one mesh mode (below), and its `regions` are the proposal's for every part but
  the two shoe patches. Every other hand correction is an `assemble.patches` entry
  (below), with its reason in `assemble.patches_note`.
- **The one mixed-mode example.** `meshes.bottomwear` is tracked in contour mode —
  `contour {tolerance 1, margin 1, spacing 12, stray 4}`, spacing the proposal's grid —
  while every other mesh keeps the proposal's lattice; its `note` says why. Issue #118
  measures `TIP_OVER_ROOT` exactly from the posed geometry, and on this short skirt
  (195x116 rig px) the proposal's lattice fails it: the art in the lower half of the
  box travels 0.137 rig px against the upper half's 0.113 (ratio 1.207, bar 1.4725).
  The same part in contour mode, with the same segments, weighting radius and idle,
  passes: 0.145 against 0.083 (ratio 1.738). The amplitudes the proposal declared are
  not raised; what fails is the lattice's weighting of this part, not the motion. A
  pixel reading of the lattice build at `--max` up to 8000 (the part alone, so the
  motion spans pixels) converges on about 1.27 from above, below the bar.
- **Two rules came from it.** Issue #119's fringe push-back: the `topwear` layer ends
  inside the left sleeve in a fringe below alpha 250 coloured scarf red, which drew as
  a red line down the sleeve; `assemble` now prints, on this config,
  `fringe pushed back: "topwear" 1006 px, where the painting shows "handwear_l" 726 px,
  "bottomwear" 257 px, "hair_side_r" 10 px, "hair_side_l" 7 px, "hair_back" 6 px`.
  And the shoe patches: the tights fade out above the shoe collars, leaving holes no
  run holds.

## What is tracked

- `config.json` — the config the build reads.
- `proposal.json` — what `spine-parts propose --parts <build> --source painting.png`
  writes on the parts of the build in `expected/` (selftest `CH06`, `PR52`). #119
  moved the first two points of the `robe_l` chain by 1 and 2 px from what the
  proposer wrote on the parts assembled before it (`[503, 410]`, `[513, 541]` →
  `[502, 410]`, `[511, 541]`); the config followed the proposal in those two values.
- `sheets/` — `spine-parts sheet` contact sheets, written by this port as PNG (demo's
  and sample's are the reference implementation's JPEGs): the painting with the full
  run's layers, the painting with the head run's layers, and the painting with the
  24 assembled parts of the `expected/` build.
- `expected/` — **this port's own build**, rebuilt by issue #118 (which moved
  `bottomwear` to contour mode and `TIP_OVER_ROOT` to the geometry; `parts.json` did
  not move):
  `spine-parts build --config examples/scarf/config.json --source
  inputs/painting.png --full inputs/layers/full --head inputs/layers/head --out
  <dir>`, the call the selftest's chain suite makes. The reference implementation
  never saw this character, so there is no reference output to compare with: the
  chain suite holds the tree to its own earlier output — a determinism check, not a
  port check. `parts.json` (`assemble`), `motion.json` and `mesh_report.json`
  (`rig`), and `check.json` and `gate_spine-html.txt` (`check`) are the build's files
  as written; `rig.json` is the build's `rig/rig.json` carried to its flat form by
  `flattenRig` (`src/rig.ts`), the form the reference wrote and demo's and sample's
  `expected/rig.json` are in, so the chain suite (`CH03`) and the structure suite
  (`ST25`) read all three examples the same way. Issue #126 turned every mesh triangle counter-clockwise in Spine world, the winding rig-c reads a mesh in (the reference, and this port before it, wrote them clockwise there). The declared exception, and nothing else: every mesh `triangles` triple `[a, b, c]` is `[a, c, b]` in `rig.json`; the `check.json` `TEXTURE_STRETCH` entries that print a triangle's vertices and edge print them in that order (16 here, 52 over the three examples; the triangle, frame and figures are unchanged); and the untracked `skeleton.model.json`'s `spine.sha256`, which follows the skeleton bytes. Every rendered frame of the build is pixel-equal before and after.

## The four patches

Each patch answers an `uncovered hole N:` line of `assemble` (re-measured on this
tree with the patches left out of a scratch copy of the config; the boxes are the
ones `patches_note` records):

| patch | box (rig px) | draw | region | the line that asked for it |
| --- | --- | --- | --- | --- |
| `hair_side_r` | 349,81 – 416,214 | `back` | `head` | `uncovered hole 1: 976 px at 351,83 63x129 (between "hair_back" 172 px, "topwear" 22 px, "hair_front" 20 px)` |
| `hair_side_l` | 456,126 – 484,216 | `back` | `head` | `uncovered hole 2: 244 px at 458,128 24x86 (between "hair_back" 101 px, "topwear" 12 px)` |
| `shoe_gap_r` | 370,1090 – 410,1131 | before `shoes` | `root` | with the hair patches in: `uncovered hole 5: 62 px at 372,1095 8x34` and `uncovered hole 2: 111 px at 397,1092 11x37` (both between `shoes` and `legwear`) |
| `shoe_gap_l` | 416,1089 – 458,1150 | before `shoes` | `root` | with the hair patches in: `uncovered hole 1: 125 px at 418,1095 18x45` and `uncovered hole 3: 82 px at 447,1091 9x57` (both between `shoes` and `legwear`) |

All four take `"alpha": "silhouette"`; each box is its hole (or the union of its two
holes) grown by 2 px. The side hair is in neither run (the head run's back hair stops
inside it, the full run's is haze); the proposer, run on the patched parts, proposes
`hip` for the two shoe patches, and the config keeps them on `root`, the shoes' own
bone. With all four, the recomposite's uncovered error is 1,365 px in 291 holes, the
largest 63 px at 347,803 3x60 beside `topwear` (`check.json`, `RECOMPOSITE_HOLES`;
2,921 px with no patch, 1,752 px with the hair patches alone).

## Known limits

- **The centre scarf end is stiff.** It hangs inside `topwear`, whose mesh is weighted
  to `chest`, `hip` and the `robe_r` and `robe_l` chains on the two side ends; no
  chain runs down the centre, so it moves only with the torso.
- **The short skirt moves little.** Its hem travels 0.145 rig px over the idle — 0.077
  frame px at `--max 640`. Until issue #118 `check` read `TIP_OVER_ROOT` off rendered
  pixels, and in that regime the figure was set by the render grid: the lattice build
  read 0.901 to 6.401 over `--max` 620–660 (4.537, a PASS, at 640), the contour build
  1.344 to 5.689. `check` now measures it from `geometry.json`, which no render size
  enters, so `--max` no longer moves the figure: 1.207 on the lattice and 1.738 on the
  contour build, at every size.
- **No neck part.** The scarf covers the neck and `assemble --propose-plan` proposes
  none, so the face-less fallback of issue #76 has nothing to derive a face from: with
  the face plan entries removed, `propose` refuses with `PROPOSE_FACE_PRESENT` naming
  the missing neck (selftest `EX02`), where demo and sample get a fallback proposal
  (`PR53`).

## Both mesh modes

`expected/` is the mixed build: every mesh on the proposal's lattice but `bottomwear`
in contour mode. The lattice build is the same command on a scratch copy of
`config.json` with `bottomwear` back on `grid: 12` (the proposal's), and the contour
build one whose every mesh's `grid` is replaced by
`contour: {tolerance: 1, margin: 1, spacing: <that grid>, stray: 4}` — #108's
parameter set. The three builds' `check`, `TIP_OVER_ROOT` measured from the geometry
(issue #118):

| | lattice | mixed (`expected/`) | contour |
| --- | --- | --- | --- |
| `check` | FAIL, `TIP_OVER_ROOT`; 9 of 9 bars measured | PASS, 9 of 9 bars measured | PASS, 9 of 9 bars measured |
| seam | mean 0.211, 2 px over 40 | mean 0.211, 2 px over 40 | mean 0.214, 2 px over 40 |
| `TEXTURE_STRETCH` severity (ceiling 1.926544) | 1.106, `bottomwear` | 1.098, `hair_front` | 1.144, `hair_front` |
| `TIP_OVER_ROOT` `bottomwear`: upper / lower half, rig px; ratio | 0.113 / 0.137; 1.207 | 0.083 / 0.145; 1.738 | 0.083 / 0.145; 1.738 |
| pack (`build`'s last pack line) | 393x1273, 24 regions, 95.5% covered | 392x1270, 24 regions, 96.0% covered | 377x1264, 24 regions, 100.2% covered |

Per mesh part: V (hull) · enclosed px² · overshoot px · smallest angle° from
`bun tools/contour_survey.ts scarf=<lattice build>`, and the stretch severity from each
build's `check.json` (`TEXTURE_STRETCH.per_mesh`):

| part | grid | lattice | contour | stretch, lattice / contour |
| --- | --- | --- | --- | --- |
| `hair_back` | 12 | 159 (52) · 3455 · 12.53 · 39.81 | 151 (57) · 566 · 2 · 8.48 | 1.027 / 1.027 |
| `hair_front` | 8 | 143 (58) · 1773 · 9.22 · 32.01 | 119 (50) · 422.5 · 2 · 9.46 | 1.098 / 1.144 |
| `handwear_r` | 9 | 382 (120) · 4579 · 10.44 · 37.87 | 291 (65) · 917 · 2 · 4.4 | 1.021 / 1.021 |
| `handwear_l` | 8 | 478 (132) · 4168 · 9.22 · 41.19 | 364 (55) · 962 · 2 · 2.6 | 1.022 / 1.027 |
| `topwear` | 29 | 239 (84) · 30230 · 32.20 · 17.24 | 283 (153) · 2599.5 · 2 · 3.69 | 1.051 / 1.095 |
| `bottomwear` | 12 | 182 (54) · 3563 · 13.04 · 42.51 | 179 (69) · 528.5 · 2 · 7.7 | 1.106 / 1.036 |

All six parts build in both modes; over them the lattice uses 1583 vertices and
encloses 47768 px² of transparent area, the contour mesh 1387 and 5996.
