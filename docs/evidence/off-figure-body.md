# A body that is not the figure, inside a garment layer (issue #324, Stage A)

> Measured on `@rig-c/parts` 1.13.1 with rig-c 2.47.1 (`bun.lock` at this commit), over the four public examples (`bun run fetch-examples`, parts-examples 842c5b3) and the trailer's figure (`rig-c/trailer` 6e2de45, `inputs/layers`), both runs (`full`, `head`) of each. The exam's two paintings, which the card also names, are not on this page. Every figure below is `tools/offfigure_survey.ts`'s; two runs wrote the same bytes.

**Answer: no.** No reading measured here separates a planted off-figure body from every real garment with margin. The card's own "if none does" applies: close it with this table. Nothing in `src/` changes.

## The line, stated before measuring

- **Body layers** (the card's list): `face`, `neck`, `handwear-r`, `handwear-l`, `legwear`. **Garment layers**: `topwear`, `bottomwear`, `neckwear`, `headwear`, `footwear`. Opaque is alpha above 8 (`OPAQUE_ALPHA_ABOVE`). A garment is **judged** at the plausibility rules' own bar, at least `PLAUSIBLE_JUDGED_AREA_RATIO` (0.05x) the rest of its figure (`layerFigures`); smaller ones are listed, not judged. `rig-parts layers` reads any run, so both runs count.
- **R1 outside_hull**: the share of the garment's opaque px strictly outside the convex hull of the run's body px (integer points, exact cross products) — the card's first candidate.
- **R2 detached**: the largest 8-connected component of the garment holding no px on or 8-adjacent to a body px, as a share of the garment — the card's second candidate.
- **R3 outside_piece**: the largest 8-connected component of R1's px, as a share of the garment — R1's px taken as one body rather than a scatter.
- **Plants**, built from the card's shape alone (a large solid body inside `topwear` where the figure is not), never from a consumer's file: on each figure's full run, a filled 2:1 rectangle of f x topwear's opaque px, f in {0.25, 0.5, 1}, ORed into topwear — `left` / `right` with its inner edge on the body's box edge, vertically centred on topwear's centroid; `seat` centred on topwear's centroid x with its top on topwear's bottom row (under a seated figure). A plant clipped below 90 % of its area is "no room" and not read.
- **Separates**: at a size and placement, the plants' minimum is above 2x the judged real garments' maximum and above it by at least 10 points. The card is answered yes only if one reading separates both side placements at f = 0.5 on every figure; `seat` is reported either way.

## Corrected on the way

The first run read every layer **as read**, as stated above, and placed every plant against the body px's box. Two findings came of it, and both are kept on the page rather than replaced:

1. **As read, the body's hull is the canvas.** See-through leaves specks of alpha above 8 far from the figure — an empty tag still carries a 40–80 px marker at the canvas corner (the `cleanGhosts` doc says the same), and `face`, `neck` and `legwear` of every full run reach (0, 0)–(1023, 1023). R1 and R3 are then 0 on every layer and every plant: the "raw" columns below. The readings as the card states them see nothing.
2. **The plants had no room.** The box the stated placement read was the canvas, so the first run's 45 plants were all "no room".

The second form, **cleaned** (introduced after the first run, and labelled so), reads every layer through the plan's own `cleanGhosts` and keeps of each body layer only its 8-connected components of at least `PROPOSE_MIN_PX` (150) px — the plan's per-tag floor, applied per component, because `cleanGhosts` keeps a 40..149 px speck (e.g. a 53 px piece of the scarf full run's `neck`). Plants are placed against the cleaned body in both forms. No constant was introduced: 150 and the ghost rule are the tree's.

## What the table says

- **R1 / R3, cleaned, cannot separate: real garments lie outside the body's hull as much as a plant does.** The judged real maximum is 99.7 % (the trailer head run's `headwear`); the head runs' `topwear` reaches 88.7 % (scarf) because a head run's body is mostly its face. Confined to full runs it is still 77.2 % (demo `footwear`) and 75.1 % (reference-demo `bottomwear`, a floor-length ball gown — the card's "skirt" case, real). A plant as large as the **whole** topwear, beside the figure, reads 50.0–55.6 % (R1) and 47.9–51.4 % (R3). Under a seated figure (`seat`) a plant reads at most 0.5 % on demo, reference-demo, reference-sample and the trailer at f = 0.25 and 0.5 (scarf: 21.8 % and 32.3 %): the legs' hull covers it.
- **R2, either form, never fires on a real judged garment (max 0.0 % cleaned, 0.1 % raw), and misses every plant that touches the figure.** Of the 10 side plants at f = 0.5, 6 clear the line (demo both sides, reference-sample both, reference-demo right, trailer right); the other 4 lie on or next to a body px and read 0.0 %, as does every `seat` plant. A body that touches the figure — the card's figure on furniture does — is one component with it.
- **Not adopted, said because it is the obvious narrowing**: confined to `topwear` on full runs, cleaned R1's real maximum is 14.8 % (scarf) and a side plant at f = 0.5 reads at least 33.3 %, which clears the line. It was not stated before measuring, it holds one tag of five on five figures, `bottomwear` of the same kind of painting reads 75.1 %, and 4 of the 5 `seat` plants at f = 0.5 read at most 0.4 % under it.

## Not measured, and what the population lacks

- The exam's two paintings (not read in this pass).
- **No real off-figure body is in the population.** The trailer's figure sits on a swing, but its painting was generated without one (`inputs/config.json`'s negative prompt names `chair, bench, … swing`); the seat is the film's. The plants are the only positives.
- **No long coat and no cape.** The widest garment is reference-demo's ball gown. A cape that flares sideways would sit where the side plants sit; the table cannot say it would read differently.

## Re-running

    bun run fetch-examples
    git clone https://github.com/rig-c/trailer <dir>    # 6e2de45
    bun tools/offfigure_survey.ts trailer=<dir>/inputs/layers

## The tables (the tool's output, unedited)

### Real garment layers

Raw: the layers as read. Cleaned: every layer through `cleanGhosts`; of a body layer, only its components of `PROPOSE_MIN_PX` px or more.

| figure | run | layer | opaque px | x rest of figure | judged | raw R1 | raw R2 | raw R3 | cleaned R1 | cleaned R2 | cleaned R3 |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| demo | full | topwear | 24910 | 0.134 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| demo | full | bottomwear | 55159 | 0.331 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| demo | full | neckwear | 77 | 0.000 | no | 1.3% | 0.0% | 1.3% | 100.0% | 100.0% | 100.0% |
| demo | full | headwear | 4020 | 0.020 | no | 0.0% | 51.8% | 0.0% | 99.9% | 52.0% | 51.9% |
| demo | full | footwear | 15120 | 0.079 | yes | 0.0% | 0.0% | 0.0% | 77.2% | 0.0% | 77.2% |
| demo | head | topwear | 116080 | 0.234 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| demo | head | bottomwear | 148810 | 0.326 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| demo | head | neckwear | 69 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| demo | head | headwear | 20641 | 0.036 | no | 0.0% | 48.0% | 0.0% | 94.0% | 48.0% | 48.0% |
| demo | head | footwear | 73 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-demo | full | topwear | 31500 | 0.080 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-demo | full | bottomwear | 248454 | 1.172 | yes | 0.0% | 0.0% | 0.0% | 75.1% | 0.0% | 75.1% |
| reference-demo | full | neckwear | 74 | 0.000 | no | 1.4% | 0.0% | 1.4% | 100.0% | 100.0% | 100.0% |
| reference-demo | full | headwear | 9253 | 0.024 | no | 0.0% | 0.0% | 0.0% | 96.4% | 0.0% | 96.4% |
| reference-demo | full | footwear | 11627 | 0.030 | no | 0.0% | 0.0% | 0.0% | 86.8% | 0.0% | 86.8% |
| reference-demo | head | topwear | 159037 | 0.236 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-demo | head | bottomwear | 81 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-demo | head | neckwear | 77 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-demo | head | headwear | 76377 | 0.122 | yes | 0.0% | 0.0% | 0.0% | 97.4% | 0.0% | 97.4% |
| reference-demo | head | footwear | 77 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-sample | full | topwear | 22106 | 0.160 | yes | 0.0% | 0.1% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-sample | full | bottomwear | 78666 | 0.677 | yes | 0.0% | 0.0% | 0.0% | 19.5% | 0.0% | 9.9% |
| reference-sample | full | neckwear | 78 | 0.001 | no | 1.3% | 0.0% | 1.3% | 100.0% | 100.0% | 100.0% |
| reference-sample | full | headwear | 78 | 0.001 | no | 1.3% | 0.0% | 1.3% | 100.0% | 100.0% | 100.0% |
| reference-sample | full | footwear | 7288 | 0.050 | no | 0.0% | 0.0% | 0.0% | 89.8% | 0.0% | 89.8% |
| reference-sample | head | topwear | 150135 | 0.287 | yes | 0.9% | 0.0% | 0.9% | 74.2% | 0.0% | 74.2% |
| reference-sample | head | bottomwear | 76 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-sample | head | neckwear | 81 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-sample | head | headwear | 79 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| reference-sample | head | footwear | 77 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| scarf | full | topwear | 95461 | 1.201 | yes | 0.0% | 0.0% | 0.0% | 14.8% | 0.0% | 7.3% |
| scarf | full | bottomwear | 13188 | 0.096 | yes | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| scarf | full | neckwear | 76 | 0.001 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| scarf | full | headwear | 78 | 0.001 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| scarf | full | footwear | 4832 | 0.036 | no | 0.0% | 0.0% | 0.0% | 97.3% | 0.0% | 97.3% |
| scarf | head | topwear | 278199 | 0.581 | yes | 0.5% | 0.0% | 0.5% | 88.7% | 0.0% | 88.7% |
| scarf | head | bottomwear | 76 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| scarf | head | neckwear | 80 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| scarf | head | headwear | 83 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| scarf | head | footwear | 77 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| trailer | full | topwear | 29166 | 0.148 | yes | 0.0% | 0.0% | 0.0% | 0.6% | 0.0% | 0.6% |
| trailer | full | bottomwear | 30855 | 0.153 | yes | 0.0% | 0.0% | 0.0% | 20.1% | 0.0% | 20.1% |
| trailer | full | neckwear | 78 | 0.000 | no | 1.3% | 0.0% | 1.3% | 100.0% | 100.0% | 100.0% |
| trailer | full | headwear | 8284 | 0.040 | no | 0.0% | 90.8% | 0.0% | 92.0% | 91.3% | 91.3% |
| trailer | full | footwear | 9936 | 0.048 | no | 0.0% | 0.0% | 0.0% | 78.9% | 0.0% | 78.9% |
| trailer | head | topwear | 146487 | 0.272 | yes | 0.0% | 0.0% | 0.0% | 53.2% | 0.0% | 48.9% |
| trailer | head | bottomwear | 73 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| trailer | head | neckwear | 67 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| trailer | head | headwear | 99290 | 0.184 | yes | 0.0% | 0.0% | 0.0% | 99.7% | 0.0% | 99.7% |
| trailer | head | footwear | 77 | 0.000 | no | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | 100.0% |

### Planted topwear (full runs)

| figure | f | place | intended px | planted px | raw R1 | raw R2 | raw R3 | cleaned R1 | cleaned R2 | cleaned R3 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| demo | 0.25 | left | 6216 | 6216 | 0.0% | 20.0% | 0.0% | 20.0% | 20.0% | 20.0% |
| demo | 0.25 | right | 6216 | 6216 | 0.0% | 20.0% | 0.0% | 20.0% | 20.0% | 20.0% |
| demo | 0.25 | seat | 6216 | 6216 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| demo | 0.5 | left | 12482 | 12482 | 0.0% | 33.4% | 0.0% | 33.4% | 33.4% | 33.4% |
| demo | 0.5 | right | 12482 | 12482 | 0.0% | 33.4% | 0.0% | 33.4% | 33.4% | 33.4% |
| demo | 0.5 | seat | 12482 | 12482 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| demo | 1 | left | 24864 | 24864 | 0.0% | 50.0% | 0.0% | 50.0% | 50.0% | 50.0% |
| demo | 1 | right | 24864 | 24864 | 0.0% | 50.0% | 0.0% | 50.0% | 50.0% | 50.0% |
| demo | 1 | seat | 24864 | 24864 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-demo | 0.25 | left | 7875 | 7875 | 0.0% | 0.0% | 0.0% | 20.0% | 0.0% | 20.0% |
| reference-demo | 0.25 | right | 7875 | 7875 | 0.0% | 20.0% | 0.0% | 20.0% | 20.0% | 20.0% |
| reference-demo | 0.25 | seat | 7875 | 7875 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-demo | 0.5 | left | 15753 | 15753 | 0.0% | 0.0% | 0.0% | 33.4% | 0.0% | 33.4% |
| reference-demo | 0.5 | right | 15753 | 15753 | 0.0% | 33.3% | 0.0% | 33.4% | 33.4% | 33.4% |
| reference-demo | 0.5 | seat | 15753 | 15753 | 0.0% | 0.0% | 0.0% | 0.3% | 0.0% | 0.2% |
| reference-demo | 1 | left | 31500 | 31500 | 0.0% | 0.0% | 0.0% | 50.0% | 0.0% | 50.0% |
| reference-demo | 1 | right | 31500 | 31500 | 0.0% | 0.0% | 0.0% | 50.0% | 0.0% | 50.0% |
| reference-demo | 1 | seat | 31500 | 31500 | 0.0% | 0.0% | 0.0% | 15.1% | 0.0% | 7.8% |
| reference-sample | 0.25 | left | 5512 | 5512 | 0.0% | 20.0% | 0.0% | 20.0% | 20.0% | 20.0% |
| reference-sample | 0.25 | right | 5512 | 5512 | 0.0% | 20.0% | 0.0% | 20.0% | 20.0% | 20.0% |
| reference-sample | 0.25 | seat | 5512 | 5512 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-sample | 0.5 | left | 11026 | 11026 | 0.0% | 33.3% | 0.0% | 33.3% | 33.3% | 33.3% |
| reference-sample | 0.5 | right | 11026 | 11026 | 0.0% | 33.3% | 0.0% | 33.3% | 33.3% | 33.3% |
| reference-sample | 0.5 | seat | 11026 | 11026 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| reference-sample | 1 | left | 22050 | 22050 | 0.0% | 49.9% | 0.0% | 50.0% | 50.0% | 50.0% |
| reference-sample | 1 | right | 22050 | 22050 | 0.0% | 49.9% | 0.0% | 50.0% | 50.0% | 50.0% |
| reference-sample | 1 | seat | 22050 | 22050 | 0.0% | 0.0% | 0.0% | 0.2% | 0.0% | 0.1% |
| scarf | 0.25 | left | 23871 | 23871 | 0.0% | 0.0% | 0.0% | 31.8% | 0.0% | 25.8% |
| scarf | 0.25 | right | 23871 | 23871 | 0.0% | 0.0% | 0.0% | 31.8% | 0.0% | 20.0% |
| scarf | 0.25 | seat | 23871 | 23871 | 0.0% | 0.0% | 0.0% | 21.8% | 0.0% | 10.6% |
| scarf | 0.5 | left | 47740 | 47740 | 0.0% | 0.0% | 0.0% | 43.1% | 0.0% | 38.1% |
| scarf | 0.5 | right | 47740 | 47740 | 0.0% | 0.0% | 0.0% | 43.2% | 0.0% | 33.3% |
| scarf | 0.5 | seat | 47740 | 47740 | 0.0% | 0.0% | 0.0% | 32.3% | 0.0% | 15.7% |
| scarf | 1 | left | 95484 | 86982 | 0.0% | 0.0% | 0.0% | 55.3% | 0.0% | 51.4% |
| scarf | 1 | right | 95484 | 87636 | 0.0% | 0.0% | 0.0% | 55.6% | 0.0% | 47.9% |
| scarf | 1 | seat | 95484 | 95484 | 0.0% | 0.0% | 0.0% | 48.2% | 0.0% | 44.4% |
| trailer | 0.25 | left | 7260 | 7260 | 0.0% | 0.0% | 0.0% | 20.4% | 0.0% | 20.0% |
| trailer | 0.25 | right | 7260 | 7260 | 0.0% | 19.9% | 0.0% | 20.4% | 20.0% | 20.0% |
| trailer | 0.25 | seat | 7260 | 7260 | 0.0% | 0.0% | 0.0% | 0.5% | 0.0% | 0.5% |
| trailer | 0.5 | left | 14535 | 14535 | 0.0% | 0.0% | 0.0% | 33.7% | 0.0% | 33.3% |
| trailer | 0.5 | right | 14535 | 14535 | 0.0% | 33.3% | 0.0% | 33.7% | 33.3% | 33.3% |
| trailer | 0.5 | seat | 14535 | 14535 | 0.0% | 0.0% | 0.0% | 0.4% | 0.0% | 0.4% |
| trailer | 1 | left | 29040 | 29040 | 0.0% | 0.0% | 0.0% | 50.2% | 0.0% | 49.9% |
| trailer | 1 | right | 29040 | 29040 | 0.0% | 49.9% | 0.0% | 50.2% | 49.9% | 49.9% |
| trailer | 1 | seat | 29040 | 29040 | 0.0% | 0.0% | 0.0% | 1.9% | 0.0% | 1.6% |

### The line

A reading separates a placement at size f when the plants' minimum is above 2x the judged real garments' maximum (every run) and above it by at least 10.0%.

| form | reading | real judged max (where) | f | place | plants read | plants over the line | plant min (where) | separates |
| --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 0.25 | left | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 0.25 | right | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 0.25 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 0.5 | left | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 0.5 | right | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 0.5 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 1 | left | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 1 | right | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R1 outside_hull | 0.9% (reference-sample head topwear) | 1 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 0.25 | left | 5 of 5 | 2 | 0.0% (reference-demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 0.25 | right | 5 of 5 | 4 | 0.0% (scarf) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 0.25 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 0.5 | left | 5 of 5 | 2 | 0.0% (reference-demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 0.5 | right | 5 of 5 | 4 | 0.0% (scarf) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 0.5 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 1 | left | 5 of 5 | 2 | 0.0% (reference-demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 1 | right | 5 of 5 | 3 | 0.0% (reference-demo) | no |
| raw | R2 detached | 0.1% (reference-sample full topwear) | 1 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 0.25 | left | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 0.25 | right | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 0.25 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 0.5 | left | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 0.5 | right | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 0.5 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 1 | left | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 1 | right | 5 of 5 | 0 | 0.0% (demo) | no |
| raw | R3 outside_piece | 0.9% (reference-sample head topwear) | 1 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 0.25 | left | 5 of 5 | 0 | 20.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 0.25 | right | 5 of 5 | 0 | 20.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 0.25 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 0.5 | left | 5 of 5 | 0 | 33.3% (reference-sample) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 0.5 | right | 5 of 5 | 0 | 33.3% (reference-sample) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 0.5 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 1 | left | 5 of 5 | 0 | 50.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 1 | right | 5 of 5 | 0 | 50.0% (demo) | no |
| cleaned | R1 outside_hull | 99.7% (trailer head headwear) | 1 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 0.25 | left | 5 of 5 | 2 | 0.0% (reference-demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 0.25 | right | 5 of 5 | 4 | 0.0% (scarf) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 0.25 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 0.5 | left | 5 of 5 | 2 | 0.0% (reference-demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 0.5 | right | 5 of 5 | 4 | 0.0% (scarf) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 0.5 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 1 | left | 5 of 5 | 2 | 0.0% (reference-demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 1 | right | 5 of 5 | 3 | 0.0% (reference-demo) | no |
| cleaned | R2 detached | 0.0% (demo full topwear) | 1 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 0.25 | left | 5 of 5 | 0 | 20.0% (trailer) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 0.25 | right | 5 of 5 | 0 | 20.0% (trailer) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 0.25 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 0.5 | left | 5 of 5 | 0 | 33.3% (trailer) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 0.5 | right | 5 of 5 | 0 | 33.3% (trailer) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 0.5 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 1 | left | 5 of 5 | 0 | 49.9% (trailer) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 1 | right | 5 of 5 | 0 | 47.9% (scarf) | no |
| cleaned | R3 outside_piece | 99.7% (trailer head headwear) | 1 | seat | 5 of 5 | 0 | 0.0% (demo) | no |
