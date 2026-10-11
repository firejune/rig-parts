# demo

A generated full-body character — prompted as an adult woman in a white and pink
frilled idol dress with long puffy sleeves and a layered skirt, very long pink twin
tails, a large ribbon hair bow, a star hair ornament and dangling star earrings —
painted for this repository by issue #227 to replace the clasped-hands painting the
README showed until then (now the fixture `examples/reference-demo`). It is the
README's picture. It was made with a public checkpoint, Hassaku XL (Illustrious)
v1.3 Style A, and no LoRA, on a pose file (`pose.json`, issue #198) that holds the
arms away from the body and the hands apart and open, and the painting was given
one hand-detailer pass. `config.json`'s `generation` block is the painting step's
record and its `x-hand_detailer` the detailer's; its `seed_note` says how seed 71006
was chosen. Its heavy inputs (the painting, the two images See-through was fed, and
the `full` and `head` See-through layer sets) live in the
[parts-examples](https://github.com/rig-c/parts-examples) repository, which also
holds the generation record, the candidate table (sixteen paintings, each with a
one-line reading of its hands), the detailer's graph and mask, and the licence and
the credit line it requires; `bun run fetch-examples` copies them into `inputs/`
here (gitignored).

## Why it exists

- **Hands that read as hands.** The painting it replaces was painted on the
  `stand_clasp` skeleton by a checkpoint that cannot draw interlocked fingers; its
  hands did not read as hands above a thumbnail. This one was chosen by reading a
  crop of each hand at full resolution. No figure chose it: the layer WARN count
  the older examples were chosen on cannot see fingers.
- **The proposal, two corrections.** The config's `bones`, `meshes`, `regions` and
  `motion` are `proposal.json`'s, value for value, but for the points of two chains
  (below); its `assemble.plan` is `assemble --propose-plan`'s but for one entry
  (below); its `seethrough.head_box` is `propose --head-box`'s as printed.

## What is tracked

- `config.json` — the config the build reads.
- `pose.json` — the pose file `generation.control.skeleton` names, read beside the
  config by `comfy paint`; the copy in parts-examples is the same file.
- `proposal.json` — what `rig-parts propose --parts <build> --source painting.png`
  writes on the parts of the build in `expected/` (selftest `CH06`, `PR52`).
- `sheets/` — `rig-parts sheet` contact sheets, PNG: the painting with the full
  run's layers, with the head run's layers, and with the 23 assembled parts of the
  `expected/` build (the last is also `assets/demo-parts.png`).
- `expected/` — **this port's own build**, as for `scarf`:
  `rig-parts build --config examples/demo/config.json --source
  inputs/painting.png --full inputs/layers/full --head inputs/layers/head --out
  <dir>`, the call the selftest's chain suite makes. The reference implementation
  never saw this character, so there is no reference output to compare with: the
  chain suite holds the tree to its own output at the commit that added it — a
  determinism check, not a port check. `parts.json` (`assemble`), `motion.json` and
  `mesh_report.json` (`rig`), and `check.json` and `gate_spine-html.txt` (`check`)
  are the build's files as written; `rig.json` is the build's `rig/rig.json`
  carried to its flat form by `flattenRig` (`src/rig.ts`), the form every example's
  `expected/rig.json` is in.

## The two corrections

**`hair_back` from the full run** (`assemble.plan_note`). The proposed head box,
1125x1125 at `[268, 0, 1393, 1125]` (it ran 269 px above the painting and
`propose --head-box` shifted it down), is still narrower than the twin tails. With
the proposed plan, `hair_back` from the head run, `assemble` printed
`uncovered error px: 2992` with the two largest holes the tail tips beside the
crop — `uncovered hole 1: 464 px at 692,384 18x69` and
`uncovered hole 2: 373 px at 123,385 13x66`, each between `hair_back` and the page.
From the full run: 2,939 px, the largest hole 48 px. `reference-demo` records the
same edit for the same reason.

**The two outer skirt chains** (the `note` on `skirt_r` and `skirt_l`). The proposal
put `skirt_r` at x 363, 340, 327 and tip 354, and `skirt_l` at 461, 486, 505 and tip
473 — within 90 px of the centre line (x 416) of a skirt 449 px wide. The two sides
of the skirt were then weighted to the still `hip`, and the three chains swinging
together turned the skirt about its middle: one side rose as the other fell, art
crossed the box's fixed mid-line, so the upper half's centroid travelled 0.537 rig px
and the lower half's 0.237, and `check` failed `TIP_OVER_ROOT` (ratio 0.442 against
1.4725) — where, followed pixel by pixel through the posed triangles at idle frame
30, the art of the lower half had moved 1.295 rig px on average and the upper half's
0.099. The bar reads fixed halves by definition (AUTHORING §7), so the skirt has to
stop turning, not the bar. Moved, each joint sits
0.8 of the way from the skirt's centre to its edge in its row (the `bottomwear` art
at alpha above 128, rows 440, 508 and 575), and each tip at the same share in row
610, the hem's last full-width row (the proposal's row 643 holds only the 96 px
centre frill): `skirt_r` `[326, 440]`, `[274, 508]`, `[241, 575]`, tip
`[268, 610]`; `skirt_l` `[498, 440]`, `[551, 508]`, `[589, 575]`, tip `[559, 610]`.
`TIP_OVER_ROOT` reads 2.425 (0.391 upper, 0.948 lower) and `propose --from-config`
prints no LINT line. `skirt_c`, the link counts and the idle tracks are the
proposal's. What else was tried on the same parts, each one change on the proposal,
and what `TIP_OVER_ROOT` read for `bottomwear`:

| change | ratio |
| --- | --- |
| none (the proposal) | 0.442 |
| `bottomwear` in contour mode, spacing 25 (`scarf`'s correction) | 0.449 |
| the `chest` segment taken off `bottomwear` | 0.441 |
| `meshes.bottomwear.r` 25 | 0.445 |
| `exponent` 4 | 0.522 |
| `rule: "heat"` | refused, `RIG_HEAT_ISLAND_SOURCE` (a 2 px island at rig 630,583) |
| the two outer chains' joints at 0.6 of their rows' half-width, tips left in row 643 (at 0.6 of row 610's) | 1.098 |
| the same at 0.8 | 2.629 |
| the same at 0.95 | 3.679 |
| at 0.8, tips in row 610 (tracked) | 2.425 |

The README loop pasted uncorrected stops where the README says to read
`check.json`, naming `bottomwear` on `CHECK_TIP_OVER_ROOT` and nothing else
(selftest `RL01`).

## The build, by figure

`check` 9 of 9 bars measured, PASS:

| | |
| --- | --- |
| gate | `50 assertions: 24 measured (24 passed, 0 failed), 26 skipped, 0 not in profile "spine-html"` |
| pack | `skeleton.png 1051x972, 23 region(s), 96.9% covered, padding 2, page edges free, shape polygon` |
| seam | mean 0.147, 0 px over 40, frame scale 0.943777 |
| loop | max \|d\| 0 |
| `TIP_OVER_ROOT` | `bottomwear` 2.425, `handwear_r` 6.93, `handwear_l` 6.521 (floor 1.4725) |
| `TEXTURE_STRETCH` | severity 1.097, `hair_front` (ceiling 1.926544) |
| `BLINK_NO_HOLE` | idle frame 29 closed, hole 0 px |
| `RECOMPOSITE_HOLES` | error px 14,570; uncovered 2,939 in 1,020 holes, the largest 48 px at 204,519 27x25 beside `bottomwear` |
| meshes | 9, 1,192 vertices (`mesh_report.json`) |

`--seam silhouette` changes little here: recomposite error pixels 14,570 → 14,534,
uncovered 2,939 under both. The README's animation is the default build's.

## Known limits

- **The hands are part of the sleeves.** See-through puts each forearm and hand
  in its `handwear` layer, so the hands swing with the sleeve chains and are not
  posed on their own.
- **The skirt's centre swings least.** `skirt_c` keeps the proposal's points and
  amplitudes; the two moved chains carry the sides.
- **Earrings are rigid.** The proposer found the earring's pendant top off the art
  and proposed no chain (its note); the earrings ride `head`.
