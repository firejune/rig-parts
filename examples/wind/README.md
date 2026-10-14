# wind

A generated full-body character — prompted as an adult woman with very long deep blue
twin tails reaching the knees, large red hair ribbons with long trailing ends, a white
blouse with long fitted sleeves and a red collar bow, a very wide flared tiered skirt
above the knees, white thighhighs and red ankle boots — made for this repository with a
public checkpoint (Hassaku XL (Illustrious) v1.3 Style A) and no LoRA, on a pose file
(`pose.json`) with the arms held out from the skirt and the legs apart, so that
`rig-parts painting` passes it (issue #372, [docs/PAINTING.md](../../docs/PAINTING.md)).
`config.json`'s `generation` block is the record `comfy paint` reads, and its `seed_note`
says how seed 372108 was chosen from 24. Its heavy inputs (the painting, the two images
See-through was fed, and the `full` and `head` See-through layer sets), the full
generation record and the 24 candidates' table live in the
[parts-examples](https://github.com/rig-c/parts-examples) repository (`wind/`), which
also holds the licence; `bun run fetch-examples` copies the inputs into `inputs/` here
(gitignored).

## Why it exists

- **A figure for wind.** Cloth and hair that move by physics under a side gust need
  something to move: two long tails, a wide two-layer skirt. It is the first example
  whose cloth and hair are drafted by the cloth recipe (`propose --cloth`, issue #364,
  [AUTHORING §3](../../docs/AUTHORING.md), *Recipe: cloth and hair that answer the
  world*) instead of keyed chains.
- **The painting recipe, met.** PAINTING.md's recipe is this painting's generation
  block and pose file: the forearms clear of the skirt and the legs apart, which the
  repainted `demo` does not pass.
- **Limbs for a gait.** The arms and legs are cut at their joints (`limbs`, issue #349),
  so a walk or a run can be retargeted onto the rig: `propose --keypoints keypoints.json`
  drafted them from the joints `rig-parts painting` read.
- **The README loop, uncorrected.** Every rig section of the config — `bones`,
  `meshes`, `regions`, `limbs`, `motion` and `constraints` — is `proposal.json`'s, value
  for value. What the config authors is what the loop's steps ask for: `seethrough`
  (with the head box `propose --head-box` gave), `assemble.plan` and
  `extend_below_crop` as `assemble --propose-plan` wrote them, and the `cloth` block;
  beside it, `keypoints.json`. No patch: the largest uncovered hole after `assemble` is
  79 px.

## What is tracked

- `config.json` — the config the build reads.
- `pose.json` — the pose file `generation.control.skeleton` names (the one
  parts-examples records in `wind/pose.json`).
- `keypoints.json` — the joints `propose --keypoints` drafted the limbs from: the wrists,
  knees and ankles read by eye off the painting at full resolution on a 50 px grid, the
  hips (under the skirt) `occluded` at the pose file's points x2, the head and shoulders
  the pose file's x2. They are the joints `rig-parts painting` passed (its gap lines are
  the ones parts-examples' `wind/generation.json` records); the pose file scaled to the
  painting is the control skeleton, not where the limbs were painted, and with it the
  loop's `--from-config` step prints a LINT line.
- `proposal.json` — what `rig-parts propose --parts <parts> --source painting.png
  --keypoints keypoints.json --cloth config.json` writes, where `<parts>` is this
  config assembled with `limbs` left out: the proposer drafts limbs from the parts
  before their cut (selftest `CH06`, `CH18`, `PR52`).
- `sheets/` — `rig-parts sheet` contact sheets: the painting with the full run's
  layers, with the head run's layers, and with the 28 parts of the `expected/` build
  (the 22 the plan makes, the four limb layers cut into ten).
- `expected/rig.json` is the flat form: every bone unturned, which is `flattenRig`
  (`src/rig.ts`) of the built rig. A build's `rig/rig.json` turns each chain link along
  its chain, so it carries `rotation` and `length` on the links, and the offsets under
  them in the turned frame, where this file holds unturned offsets only: a plain diff of
  the two shows those bones and the weights bound to them as changed, and the build is
  not broken. The chain suite (`CH03`) compares this file with `flattenRig(built)`, not
  with the built file; compare the same way.
- `expected/` — **this port's own build**: `rig-parts build --config
  examples/wind/config.json --source inputs/painting.png --full inputs/layers/full
  --head inputs/layers/head --out <dir>`, the call the chain suite makes. No reference
  implementation saw this character, so the chain suite holds the tree to its own
  output — a determinism check, not a port check. `parts.json`, `motion.json`,
  `mesh_report.json`, `check.json` and `gate_spine-html.txt` are the build's files as
  written; `rig.json` is the build's `rig/rig.json` carried to the flat form by
  `flattenRig` (`src/rig.ts`), as for `scarf`.

There is no `animations.json`. `demo` and `scarf` carry named gestures (issue #224);
this example's motion beyond the idle is the consumer's environment, which the recipe
answers and does not key.

## The cloth recipe it was built with

```json
"cloth": {
  "bottomwear": { "chains": 4, "links": 3, "split": { "at": 1, "into": 2 }, "damping": 0.85, "alternate_damping": 0.7,
                  "wind": [2, 10], "gravity": [5, 30], "translate": 0.2, "swing": { "scales": [1.3, 1, 1, 1.3] } },
  "back hair":  { "chains": 1, "links": 3, "split": { "at": 1, "into": 2 }, "wind": [1, 8], "gravity": [4, 24] },
  "front hair": { "chains": 1, "links": 3, "wind": [1, 6], "gravity": [2, 12], "translate": 0.2 }
}
```

These are AUTHORING §3's recipe block, value for value, but for `back hair`'s
`chains`; `length_ratio` and `strength` are left out, so the recipe's own defaults
(0.5; 100 / 100 / 50) are what is built.

- **`back hair`, one tree a side.** With the block's two trees a side, the inner tree of
  each side roots on the eye line over the face, where the back hair has no pixel, and
  `propose` prints two LINT lines: `hairback_r1_0 at [323, 162] is off the art of mesh
  'hair_back'` and `hairback_l0_0 at [496, 162] is off the art of mesh 'hair_back'`, so
  the loop's `--from-config` step exits 1. One tree a side — one per tail — roots at
  `[288, 162]` and `[530, 162]` and prints none; each tail forks into two branches after
  its first link.
- **`front hair`.** No strand of this fringe hangs below the chin, so the recipe drafts
  no lock; the fringe's three columns, `bang_r`, `bang_c` and `bang_l`, take physics on
  both links (the edge's strength on the outer two), as the recipe says.
- **The rig.** 76 bones, 28 slots, 6 meshes (the limb parts are regions, each rigid on
  its one bone); 44 physics constraints (one per tree link
  but the skirt trees' first links, which the swing drives; one on the swing; and a
  translate flutter on the last link of each of the eight skirt branches and the three
  fringe columns), 4 transform constraints (the swing onto each skirt tree's first
  link). `check` passes, 11 of 13 bars measured: `FEET_STAY_LEVEL` and
  `STRESS_OFF_CHAIN` say SKIP by name (no frame of the idle turns a leg; every limb
  segment is rigid on its one bone by `LIMB_ONE_BONE`).

## Under an explicit environment

Measured once on the build in `expected/` (rig-c 2.54.0, `rigc render --environment`,
the idle at 60 fps, 201 frames over 3.333 s, the environment set from t = 0 and held,
gravity (0, 1) throughout, no hip key, no stimulus). A move is the largest distance
between one vertex (or bone tip) in the setting's frame and in the calm frame at the
same frame index, over all 201 frames; every figure had settled by about t = 1.8 s.
The hem is the 15 of `bottomwear`'s 130 mesh vertices in the lowest tenth of the mesh's
rest height; the skirt's height is `bottomwear`'s part box, 178 rig px
(`expected/parts.json`). The back hair tip is the end of each of the four last links,
`hairback_r0a_1`, `hairback_r0b_1`, `hairback_l0a_1`, `hairback_l0b_1`; each tail runs
about 683 rig px from its root to its tip.

| setting | hem, largest move against calm | of the skirt's height | hem's largest rise | back hair tip, largest move (at t = 3.333 s) |
| --- | --- | --- | --- | --- |
| calm, wind (0, 0) | 0 | 0 % | 0 | 0 |
| wind (1, 0) | 15.310 rig px | 8.60 % | 6.690 rig px | 90.661 rig px (77.496) |
| wind (3, 0) | 49.435 rig px | 27.77 % | 19.500 rig px | 257.892 rig px (218.312) |
| wind (10, 0) | 141.114 rig px | 79.28 % | 49.593 rig px | 603.549 rig px (485.442) |

`rigc render` and `check` pose under spine-core's default world, wind (1, 0) and
gravity (0, 1), so `check.json`'s figures are the idle under that breeze:
`TEXTURE_STRETCH` severity 1.727 (`bottomwear`, ceiling 1.926544), `TIP_OVER_ROOT`
`bottomwear` ratio 3.622.

## Known limits

- **The ribbons' loops are painted beside the tails.** The ribbons wrapped round the
  tails are See-through's `headwear` layer, the part `hairpin`; since issue #391 it rides
  the links of the tails it lies on — `head`'s span, `hairback_r0_0`, `hairback_r0a_0`,
  `hairback_r0b_0`, `hairback_l0_0`, `hairback_l0a_0` and `hairback_l0b_0`, read off the
  overlap — and has no bone or pendant of its own. Of its 32,314 px, 17,264 lie off the
  hair as painted, so they are drawn over no hair at calm too. Of the ribbon painted over
  the tail, the pixels drawn where the tail has no hair (rig-c 2.54.0, `rigc render
  --environment`, idle frame 200 of 200 at 60 fps, 0.916 px per rig px) are 30 at calm
  and 230 at wind (10, 0) — before the change, 2,429 and 8,363 — every one of the 230
  within 3.6 px of the hair's edge, where the two meshes' lattices differ.
- **A strong wind lengthens the tails instead of bending them.** At wind (10, 0) the
  right tail's tip stretches into a wisp and the skirt's right frill edge shears
  (issue #392). The hem's largest move against calm, as a share of the skirt's 178 rig
  px, is 8.6 % at wind 1, 27.8 % at wind 3 and 79.3 % at wind 10; the back hair's tip
  moves 90.7, 257.9 and 603.5 rig px (rig-c 2.54.0 `render --environment`, gravity
  (0, 1), idle frame 200 of 200 at 60 fps).
- **One back-hair tree per side, not the recipe's documented two.** With two per side
  `propose` printed two LINT lines, the inner trees' roots off the hair; whether the
  default or the LINT is wrong is issue #390.
- **The idle does not close with its physics.** As for every example with physics, the
  loop bar reads the idle's ends with the 44 physics constraints left out
  (`loop physics:`), and `build --loop --lead-in <n>` is how to encode a loop that
  starts where the physics has settled.
- **No stop at the legs.** The legs are limb chains now, but the skirt's trees do not
  collide with them; the recipe's stop at the legs is not drafted (AUTHORING §3, *Not
  in this recipe*), and a gait's hip motion can carry the hem through a thigh.
- **No caps were painted.** `assemble` names the pixels each joint's cap is missing
  (`limb cap:` lines: 66 and 72 px at the elbows, 9 and 19 at the knees, 12 and 20 at
  the ankles); none is painted in, so a bent joint can show a gap that size.
