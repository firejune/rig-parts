# Authoring a character with spine-parts

This is the guide an agent authors from. It assumes you cannot see the painting,
the layers or the rig: what you have is this page, the tool's printed lines, and
the files it writes. Every refusal the tool prints names a rule, an object, the
value found and the value required — §6 maps each rule to the field or input that
has to change.

The worked example throughout is [`examples/sample`](../examples/sample): its
`config.json` is a complete, loading config, `proposal.json` is what the proposer
wrote for it, and `expected/` is what the reference implementation produced from
the same inputs — except `check.json`, which this port's `build` regenerates since
the reference has no judgement lines (§7). `bun run fetch-examples` puts its painting and See-through layers
into `examples/sample/inputs/`.

## 1. Prerequisites

| what | why | how |
| --- | --- | --- |
| [Bun](https://bun.sh) 1.2 or later | spine-parts and spine-rigc are Bun programs | `npm install -g spine-parts` installs the command; it says so if Bun is missing |
| [spine-rigc](https://www.npmjs.com/package/spine-rigc) | compiles, gates, packs and renders every rig; spine-parts writes no Spine data itself | installed with spine-parts as a dependency (`node_modules/.bin/rigc`) |
| [See-through](https://github.com/shitagaki-lab/see-through), somewhere | the layer decomposition is the input | any route in README *Getting See-through layers*; it runs twice per character, outside this tool |
| a GPU, wherever See-through runs | See-through is a diffusion model | nothing in spine-parts itself uses a GPU |

The painting is yours to bring: a PNG of one character, front-facing, full body,
taller than wide, on a plain light background. How it was made is not read by any
stage (`config.generation` is recorded for the optional adapter only).

## 2. The folder

Nothing in spine-parts requires a layout; every command takes paths. The one the
examples use, and the one this guide assumes:

```
<key>/
  config.json               the character config (§3)
  inputs/painting.png       the painting
  inputs/st_input_full.png  what See-through's full run was fed: the painting, white-padded to a square
  inputs/st_input_head.png  what its head run was fed: the square crop at seethrough.head_box
  inputs/layers/full/       the full run (wrapper form: layers.json + parts/<tag>.png), or full.psd
  inputs/layers/head/       the head run, the same
  proposal.json             what `propose` wrote (§4, step 7)
  out/                      what `build` writes (§5)
```

## 3. `config.json`, field by field

`src/config.ts` is the schema and the loader. Every key is known or refused
(`CONFIG_KEY_KNOWN`); a required key that is missing is `CONFIG_FIELD_PRESENT`.
The one open door is annotation: `note`, and any key ending in `_note`, may hold a
string anywhere an object is, and nothing reads it — write a hand correction's
reason there, beside the value it corrected (the examples do).

**Coordinates** in `bones`, `meshes` and `motion` are **rig pixels, y down, origin
top-left** — the parts' own space, which is the painting times `assemble.rig_scale`.
`root` is added by the rig stage at the bottom centre of the rig canvas; never
declare it.

"Where it comes from" is one of: **proposed** (a command prints or writes a value
you copy and check), **authored** (you decide it), **recorded** (a fact about a run,
read by no CPU stage).

| field | read by | where it comes from |
| --- | --- | --- |
| `key` | every stage's report | authored; the examples use the directory name |
| `generation.*` | the optional `comfy` adapter only; no CPU stage | recorded: checkpoint, LoRAs, sampler, prompt parts, `latent`, `seed`, `control` |
| `seethrough.resolution` | assemble — each run's canvas must be `resolution` square (`ASSEMBLE_RUN_CANVAS`) | recorded from the See-through runs; 1024 in both examples |
| `seethrough.steps`, `.seed`, `.offload` | no CPU stage | recorded from the runs |
| `seethrough.head_box` | inputs (cuts the head image there; optional at the first call); assemble — where the head run sits on the painting | **proposed** by `propose --head-box` from the full run, square, source pixels, shifted inside the painting when needed; the head run must then be fed exactly that crop |
| `assemble.rig_scale` | assemble | authored; rig pixels per source pixel. 0.5 in both examples (a 1664x2432 painting makes an 832x1216 rig) |
| `assemble.plan` | assemble; also the list every `meshes`/`regions` key must come from | **proposed** by `assemble --propose-plan`. `[part name, "full" \| "head", See-through tag]`, in draw order back to front. Names are free; roles come from the tag |
| `assemble.extend_below_crop` | assemble | **proposed** with the plan: `{part, run, tag}` — a head-run part that reaches the bottom of the head crop is continued from a full-run layer, whole connected components |
| `assemble.patches` | assemble; `meshes`/`regions` keys may name them too | **authored**, optional: `[{name, box, alpha, draw}]` — an extra part cut from the **painting** itself, for figure no See-through layer holds (a hem both runs dropped). `box` is `[x0, y0, x1, y1]` in **rig** pixels, `x1`/`y1` exclusive — the space of `parts.json` and `recomposite_rig.png`, where the hole is found; `alpha` is `"silhouette"` (the painting's figure silhouette inside the box, the one `--seam silhouette` uses) or `"box"` (the whole box); `draw` is `"back"`, `"front"` or `{"before": "<plan part>"}`. A patch is always a region: its bone is `regions.<name>`, in the one place every region's bone lives, and a `meshes` entry for it is refused. See §5 for how to place one |
| `bones` | rig; `propose --from-config` | **proposed** by `propose`, then corrected. A single bone `{name, parent, at, tip?}` or a chain `{chain, parent, points, tip}` whose links are named `<chain>0 … <chain>n`. Parents come before children |
| `meshes.<part>` | rig | **proposed**, then corrected. `grid` (lattice cell size, px), `r` (added to every distance before weighting: `w = 1/(d + r)²`), `segments` (a chain name, a bone name with a `tip`, or `[bone, [x0,y0], [x1,y1]]`). The segment list is the one authored decision about a layer: which bones may pull it. The slot's bone is the first segment's |
| `regions.<part>` | rig | **proposed**: the bone a rigid part rides. Every plan part is exactly one of a mesh or a region (`CONFIG_PART_ATTACHED`) |
| `motion.duration` | rig; check (the loop is measured at this time) | proposed as 4 s; a whole number of 1/12 s ticks, because `check` renders at 12 fps |
| `motion.tracks` | rig | **proposed**, then tuned. Single `{bone, prop, amp, period, phase, base?}` or chain `{chain, amps, period, phase, lag}` — one amplitude per link, link `i` at phase `phase + lag·i`. Every `period` must divide `duration` (`CONFIG_PERIOD_DIVIDES_DURATION`) |
| `motion.blink` | rig | **proposed**: `{t, eyes, brows, squash, brow_drop}`; the whole blink, `t` to `t + 0.364` s (`t + 0.314` s without brows: the brows' keys are the ones that end last), must fit inside the idle (`RIG_BLINK_INSIDE_IDLE`). The `eyes` group's `scaley` squashes every part on the eye bones about the bone's origin, the eyewhite's centre. Optional: a figure with no `eyewhite-r`/`-l` part has no eye bone, so `propose` writes no `blink` and notes `no blink: no eyewhite part (looked for: eyewhite-r, eyewhite-l), …`; with eyes and no `eyebrow-r`/`-l` part it writes the blink without `brows` and `brow_drop` and notes `blink without brows: …`. `brows` and `brow_drop` are stated together or not at all (`CONFIG_BLINK_BROWS_PAIRED`), and a group that names no bone is refused (`CONFIG_BLINK_GROUP_MEMBERS`) — rigc would refuse it one stage later, `group "eyes" declares no members`. The timing is fixed, not a field (table below) |
| `motion.blink.still` | rig | **proposed** only for a lash `propose` notes (below), then checked: `{<part>: {row, bone}}` — the rows of that region part above `row` (rig px, y down) are drawn by a second slot `<part>_still` on `bone` and do not blink; rows from `row` down keep the part's slot and blink. The part must be a region on a bone `eyes` names, `bone` one it does not (`CONFIG_STILL_OFF_THE_BLINK`), and `row` a row of the part with no art across its whole width (`RIG_STILL_ROW_CLEAR`) |

The blink's timing is the tree's (`BLINK` in `src/motion.ts`), in seconds after
`motion.blink.t`:

| phase | eyes (`scaley` 1 → `squash` → 1) | brows (`translatey` 0 → `-brow_drop` → 0) | easing |
| --- | --- | --- | --- |
| shut | 0.07 | 0.08 | `shut` |
| hold | **0.084** (the reference: 0.04) | **0.084** (the reference: 0.04) | none |
| open | 0.16 | 0.20 | `open` |

The holds are the one departure from the reference implementation, and the reason is
the loop (issue #32). `check` renders the idle at 12 fps, a frame every 0.083333 s, and
the loop is encoded from those frames. A 0.04 s hold is shorter than a frame, so it
held a frame only for some `t`: at the examples' 2.3 s the eyes were shut from 2.37 s to
2.41 s, between frames 28 (2.333 s, `scaley` 0.8356) and 29 (2.417 s, 0.2435), and over
every key time the 6-decimal grid can write, 129,999 of the 250,000 phases against the
frame grid showed no closed frame. A closed window at least one frame long holds a frame
wherever it starts, so the hold is 1/12 s rounded up to the third place; the brows' hold
grew by the same 0.044 s, so they still reach their drop 0.01 s after the lids shut and
leave it 0.01 s after the lids open. The rig stage refuses a hold under one frame by
name (`RIG_BLINK_HOLD_SPANS_A_FRAME`, §6), counted over the same 250,000 phases.

The proposer's reach (from `src/propose.ts`): roles come from each part's tag —
`face` makes `hip`/`chest`/`neck`/`head`, the eyewhites make the eye bones, brows are
told apart by position, `bottomwear` makes the hip and three skirt chains,
`handwear` makes sleeve chains (one blob or two), `front hair` makes fringe chains
and a lock chain for each strand that hangs below the chin, `back hair` makes a bun
bone or two hanging chains, and `headwear`/`earwear` get a rigid bone and a pendant
chain — or, when the accessory has hanging strands, one pendulum chain per strand
(below). What it cannot know — something painted inside another layer that should
swing, hair of another shape, whether an accessory swings — is yours to add, and
`notes` in `proposal.json` says where it guessed.

Two rules read the figure rather than one tag, and each says so in a note:

- **The hip.** It sits 0.14 face heights below `bottomwear`'s top edge — unless
  that is above 0.25 of the figure's height (every part's union, top row to bottom
  row), which is a long robe tagged `bottomwear` that starts at the collar. Then
  the note `hip: <part> (<from>) starts at y=…, so its top + 0.14 face heights
  (y=…) is above 0.25 of the figure height (y=…, figure y …): its top edge is not
  the waist` is followed by one of `hip from the waist: silhouette narrowest at
  y=170 (width 51 px, shoulders 80 px at y=96), hip 0.14 face heights below it` —
  the torso layers (`neck`, `neckwear`, `topwear`, `bottomwear`, `legwear`,
  `footwear`) at their narrowest between the shoulder line (their widest row
  within one face height below the neck) and the figure's middle, and at most
  0.8 of the shoulders — or `hip from 0.32 of figure height (no waist found: …)`,
  naming why. Without `bottomwear` the hip is 0.32 of the figure height, as before
  (`no bottomwear: hip from 0.32 of figure height`). Neither published example
  meets either branch: their hips sit at 0.436 (`demo`) and 0.342 (`sample`) of
  their figures.
- **Clasped hands.** When every `handwear` part together is one blob (over
  500 px) at most half the shoulders' width and centred within a quarter of it
  of the eye axis, it is the hands clasped in front, not two sleeves: it rides
  `hip` as a region, no sleeve chain is made, and the note reads `handwear is one
  blob (<parts>) WxH px centred at x=…: at most 0.5 of the shoulder width (… px
  at y=…) and within 0.25 of it of the eye axis x=…, so clasped hands: a region on
  hip, no sleeve chains`. Two sleeves hanging from the shoulders are at least as
  wide as them: the examples' one-blob sleeves are 1.51 and 1.58 shoulder widths,
  and keep their two chains.

**Hanging strands** (tassels, cords, drop earrings) on a `headwear` or `earwear`
layer — the two tags the proposer has an accessory rule for; any other tag rides a
trunk bone as a region and says so in its own note. A strand is an 8-connected
sub-shape of the layer's **pendant rows** (the run of rows at the bottom narrower
than 35 % of its widest row; the whole layer for `earwear` or a layer that is over
80 % pendant) that is at least **3×** as tall as wide, at least **0.2** of the
layer's height and at least **10** rows. On the public examples nothing is one: the
demo's hairpin pendant sub-shapes measure 0.54 and 0.89 tall-per-wide and its
earrings 1.04 and 1.08, so both proposals are unchanged. Every layer with strands
gets exactly one note carrying each strand's column centroid, first–last row and
width, and what became of it (two of the selftest's fixtures, PR12 and PR15):

    crown (head:headwear): 2 hanging strands at x=7,92, y 16-55,16-55, width 5,5 -> pendulum chains hairpin_strand0_, hairpin_strand1_
    veil (full:headwear): 1 hanging strand at x=20, y 120-159, width 5 -- no chain proposed (it rides the head as a region)

`-- no chain proposed` is the line to act on: that strand hangs stiff unless you add
a chain. It is written for a second layer of the tag (a region cannot swing) and for
a strand whose chain would leave the art (`...; no chain proposed at x=151 (a chain
down it would run off the art)`). The chain rule: `<bone>_strand<k>_` (links
`<bone>_strand<k>_0`, `_1`), two links at the strand's top row and 0.45 of the way
down, each at the strand's column centroid in a 24-row band, tip on its last row —
the reference tassel's shape and sway (`amps [4, 7]`, period 2, phase 0.2, lag
0.12). On a layer with a body it hangs from the layer's bone, as the tassel does,
and the mesh adds one segment of that bone across the body's full width at its mean
row, so the body stays on its bone (on the selftest's crown: 0.55 px off it over the
idle with that segment, 1.07 without; the tassel tips swing 5.0). On an all-pendant
layer each chain hangs from `head`, with a `head` stub above each strand. Strands
replace the single pendant chain: a chain at the mean x of two strands hangs between
them.

**The lash that carries a crease** (issue #26). See-through sometimes paints the
double-eyelid crease into the `eyelash` layer, and the blink squashes the whole layer
about the eye bone — so the crease is squashed with it, on one eye and not the other.
`propose` notes an `eyelash-r`/`-l` part that reaches more than 35 % of its own height
above its eyewhite's top, or is more than 1.2 times the height of its pair; on the two
examples the four lashes reach 17-26 % (4-6 px, the lash line itself) and the pairs are
1.00 and 1.04 apart, so neither is noted. When such a lash has a row between its top and
the eyewhite's top with no art across its whole width, the lowest such row is proposed as
`motion.blink.still` on `head`, and the rows above it stop blinking; when it has none, the
note says so and nothing is cut — clear a row between the crease and the lash line in the
part, or leave the crease to blink. The cut has to be a clear row: two pieces cut through
art are each resampled against their own transparent edge, and on the demo example a cut
through its lash line changed 36 px of the setup-pose render (up to 7 levels, at render
scale 0.942) and up to 21 levels in the idle frames where the head rolls; a clear-row cut
changed none, at rest or rolled. The eye bone is not moved: scaling about the eyewhite's
top edge instead would close the eye upward onto the upper lid and still move whatever sits
above it by (1 − squash) × its height above the pivot, so the cut, not the pivot, is what
holds the crease.

## 4. The command order

Two steps are external: the See-through runs (by any route; the optional `comfy seethrough` adapter is only a client for a ComfyUI box). Everything else is this tool.

**What the config holds at each step.** The config fills in as the loop runs, and
each step reads it through the loader for that point, which requires exactly what
the step reads. `src/config.ts` states it once (`CONFIG_REQUIRES`), the loaders take
their required keys from there, and the selftest compares this table with it
(`AS15`). Every loader refuses unknown and retired keys and checks `generation`
whenever it is present; a section a later step writes may already be there, and an
early loader does not read it.

| loader | steps | requires | the step also refuses without |
| --- | --- | --- | --- |
| `paint` | 0 `comfy paint` | `key`, `generation` | — |
| `layers` | 1 and 4 `inputs`, 6 `assemble --propose-plan` | `key`, `seethrough`, `assemble.rig_scale` | `seethrough.head_box`, for `--propose-plan` only (`ASSEMBLE_FIELD_PRESENT`) |
| `assemble` | 7 `assemble` | `key`, `seethrough`, `assemble.rig_scale`, `assemble.plan` | `seethrough.head_box` (`ASSEMBLE_FIELD_PRESENT`) |
| `full` | 8 `propose --from-config`, `propose --compare`, `rig`, 9 `build` | `key`, `assemble.rig_scale`, `assemble.plan`, `bones`, `meshes`, `regions`, `motion` | for `build`, the `assemble` row's too: its assemble stage reads through that loader after this one |

A missing field is `CONFIG_FIELD_PRESENT` naming it; a missing `generation` names
the fields the block holds, and a missing `assemble.plan` names
`assemble --propose-plan`, which prints one. `build` runs `rig`, so it asks the
full loader before its assemble stage writes anything.

0. **The painting (optional).** `spine-parts comfy paint --config config.json --out inputs --host <url>`
   generates `painting_<seed>.png` on a ComfyUI box; any other route to a painting
   skips this step and leaves `generation` out. Config: the `paint` row.
1. **The full image.** `spine-parts inputs --source inputs/painting.png --config config.json --out inputs`
   writes `st_input_full.png`, the painting centred on a white square as tall as it is.
   Config: the `layers` row, `head_box` not yet. A landscape or translucent
   painting is refused (`INPUTS_PAINTING_PORTRAIT`, `INPUTS_PAINTING_OPAQUE`).
2. **See-through, full run** (external).
3. `spine-parts layers inputs/layers/full` — read it. A refusal here is about the
   files, not the art (§6, *Reading the inputs*). A `WARN` line is about the art: a
   layer See-through made that is not plausibly part of the figure, which step 6
   leaves out (§6, *Plausibility*). It refuses nothing.
4. `spine-parts propose --head-box --full inputs/layers/full --canvas <W>x<H>` →
   `seethrough.head_box`. Run `spine-parts inputs` again: it now also writes
   `st_input_head.png`, the painting cropped to that box at its exact size.
5. **See-through, head run** (external), on that crop.
6. `spine-parts assemble --propose-plan --source … --full … --head … --config config.json`
   → paste `plan` and `extend_below_crop` into `config.assemble`. Config: the
   `layers` row, with `head_box`.
   Read `notes`: a layer left out by a plausibility rule is named there with its
   figures and the rule (§6, *Plausibility*).
7. `spine-parts assemble … --out work` — read its `uncovered hole` lines and look at
   `work/render/recomposite_error_rig.png` (§5): red is painting no part holds, which
   no later stage can see — then
   `spine-parts propose --parts work/rig --source inputs/painting.png --out work` →
   `work/proposal.json` and `work/render/landmarks.png` (+ `_head`). Copy
   `bones`, `meshes`, `regions` and `motion` into the config. Config for
   `assemble`: the `assemble` row — no rig section yet, because this `propose`
   drafts them from the parts `assemble` writes.
8. Correct, then `spine-parts propose … --from-config config.json` to redraw the
   config's own bones and LINT them — every chain link against its mesh's art, and
   the single bones `hip` and `chest` against each other and the figure (a config
   without them prints a `note:` that those lines did not run); repeat until it
   prints no LINT line (exit 0). Config from here on: the `full` row.
9. `spine-parts build --config config.json --source inputs/painting.png --full … --head … --out out [--loop]`
   — assemble, rig and check in one process. `propose` is not part of it, on purpose:
   a proposal is a draft, and the config you corrected is the input.

The selftest runs this order, with the README's flags, on each fetched example from
a config holding only `key`, `seethrough` and `assemble.rig_scale`, pasting each
proposal in as the steps above say (`RL01`); every step must exit 0.

## 5. After each stage: what to read

| stage | read | green looks like | a common red |
| --- | --- | --- | --- |
| `layers` | the table, then the `WARN` lines | every tag the plan will need has opaque pixels; one `face` in the head run; `0 WARN line(s)` | a run whose layer PNG is not its box's size (`LAYERS_PNG_MATCHES_BBOX`); a `WARN  PLAN_LAYER_…` line (§6, *Plausibility*) |
| `sheet` of both runs | the tile list (and the sheet, if you can see) | eyes, irises, lashes and brows as left/right pairs in the head run | a head box that cut off an ornament: move `head_box`, re-run the head crop |
| `assemble` | one line per part, the `pixels:` totals (opaque = visible + occluded; taken; visible but not projected), then `recomposite vs source: mean \|d\|, within 8, error px > 40, uncovered error px`, then `uncovered holes (8-connected): N` and the largest five as `uncovered hole K: <px> px at x,y wxh (between "<part>" <px> px, …)`; and look at `render/recomposite_error_rig.png` | on the examples: `sample` 0.84 / 98.0 % / 4,512 / 1,185, 259 holes, the largest 94 px; `demo` 2.39 / 95.8 % / 11,050 / 1,564, 453 holes, the largest 70 px (default rule) — many slivers along part edges, no hole a region could hide | one large hole: part of the figure is in no layer — a plan entry is missing, hair left the head crop sideways (the demo's `hair_back` is taken from the full run for that reason), or See-through split one garment into two and left the space between them in neither (a skirt as two trouser legs); the `between` parts say where. When neither run holds it at all, an `assemble.patches` entry cuts it from the painting (below) |
| `propose` | `note:` lines, `LINT` lines, `landmarks.png` | no LINT line: every chain link lies on its mesh's art, and the hip is below the chest and the figure's top quarter | a link off the art (a bone on the background) — move it onto the layer; `LINT hip at [x, y] is not below chest at [x, y]: …` or `LINT hip at [x, y] is above 0.25 of the figure height (figure y T..B, so hip y must be at least L): a hip at the shoulders` — move `hip` down to the waist (and `chest` between it and the neck); a `hanging strand … -- no chain proposed` note — that strand hangs stiff until you add a chain down the x and rows it names (§3); a `no blink: …` or `blink without brows: …` note — the idle will not blink (or its brows will not drop), because no part came from an `eyewhite` (or `eyebrow`) layer; the note names the tags looked for |
| `rig` (inside `build`) | one line per mesh: vertices, triangles, bones, influences, `cover`; the `bones` line; the `idle keys` line; then rigc's gate lines (with A15's declared SKIP under `--idle-keys direct`) | `cover 1.00000` on every mesh, both gates `0 failed` | `RIG_LATTICE_ONE_LOOP`: change that mesh's `grid` |
| `check` (inside `build`) | the gate lines verbatim, the pack line, `loop:`, `seam:`, the five judgement lines and `RECOMPOSITE_HOLES` (§7), `check.json` | `check: PASS`, and a judgement line SKIP only where the character lacks what it reads | `CHECK_SEAM_WITHIN_BAR` or `CHECK_LOOP_CLOSES` (§6) |
| `loop` (inside `build --loop`, or `loop --frames … --out …`) | the dropped-duplicate line, each file's line, then `loop: idle.png N B (lossless); idle-indexed.png N B (max …, mean …); idle.gif N B (max …, mean …)` | `f0048.png equals f0000.png byte for byte, so it is dropped` | `LOOP_ENCODE` (§6) |

`loop` writes three files from one frame set, and they are not interchangeable.
`idle.png` (`loop --out x.png`) is the lossless APNG: every frame decodes to the
rendered frame byte for byte, so it is the exactness record. `idle-indexed.png`
(`loop --out x.png --palette`) is an indexed APNG — colour type 3, one palette for
every frame (255 median-cut colours and one transparent entry, alpha graded per
entry, no dithering, filter None) — and is the small file to show. `idle.gif`
(`loop --out x.gif`) is the same median cut in a GIF. The indexed APNG and the GIF
print their palette error, per channel over R, G and B of every frame (and alpha's
max for the APNG); a figure is a measurement of the file, not a bar. On the demo:
13,645,519 B lossless, 1,706,785 B indexed and 1,812,625 B GIF, both palette files at
max 57, mean 1.601 — the two share one quantiser, so their error is the same by
construction and the size is the difference. The loop shows the blink closed: the
eyes' hold is at least one 12 fps frame (below), so whatever `motion.blink.t` is, one
idle frame lands inside it, and `check.json`'s `BLINK_NO_HOLE.idle_frames_closed`
names it — `[29]` on both examples.

`--seam near-white` (the default) is the reference implementation's rule: where the
flat stack of parts differs from the painting by more than 60, the top part takes the
painting's colour — except where the painting is near-white, which protects the page
and also every white garment. `--seam silhouette` protects near-white pixels only
outside the figure. On the demo it lowered recomposite error pixels from 11,050 to
9,540 and changed no check bar; on the sample it changed nothing. The default stays
the reference's so the examples stay comparable with it.

`--project core` (the default) is the reference's projection rule: a layer takes the
painting's pixel only inside its top-most `alpha >= 250` area eroded by a 5x5 square,
so a part a few pixels wide (a lash, a brow, an iris) takes none. `--project visible`
keeps the erosion only along a rim where a later layer of the run is in front, and
takes every other top-most `alpha >= 250` pixel; neither rule takes a fringe pixel
(alpha below 250). On the examples it lowered the pixels that are visible but not
projected from 36,227 to 22,476 (`sample`) and 76,801 to 49,672 (`demo`), recomposite
error pixels from 4,512 to 4,116 and 11,050 to 9,820, and the check seam from 0.207 to
0.206 and 0.326 to 0.325, with no other check figure changed. The default stays the
reference's so the examples stay comparable with it. `build` takes both flags.

**`rig --idle-keys ctl|direct`.** spine-rigc's `A15_IDLE_NO_MESH_BONE_KEYS`
(profile `spine-html`) refuses an idle that keys a bone a mesh is weighted to. `ctl`
(the default, the reference's answer) gives every such bone a same-origin
`<bone>_ctl` parent and moves its keys there, which passes A15 on any spine-rigc;
the stage prints `idle keys ctl: N mesh-driving bone(s) keyed …`. `direct` keys the
bones themselves and writes `invariants.idleDrivesMeshes: { "why": … }` into
`rig.json` (spine-rigc 1.3.0 or later), so A15 reports
`SKIP  A15_IDLE_NO_MESH_BONE_KEYS: declared by the rig (…): idle keys N bone(s) that
drive M mesh attachment(s) totalling V vertices …`, which the stage prints; with no
mesh-driving bone keyed it declares nothing, because rigc refuses a declaration
that switches nothing off. The two write the same slots, skins and keys (`RG18`).
Measured on the examples with `bun tools/idle_cost.ts` (spine-parts #13): `direct`
has 41 bones for the demo's 72 and 32 for the sample's 56; every shown mesh moves on
every idle frame under both (8 of 8 and 6 of 6, so 0 a dirty-skip renderer could
skip); the pose costs 14.8 against 15.3 us per frame (demo) and 8.3 against 8.8 us
(sample), the difference all in `updateWorldTransform`; the rendered idle frames
differ by at most one level in a channel. The default stays `ctl`: the examples'
`expected/rig.json` and `motion.json` are the reference's output, and the
declaration is in the rig spec only, so `rigc validate <build> --profile spine-html`
run on a `direct` build (it has no rig spec to read) refuses A15 once per keyed
bone. `check` validates the build under `spine` only, where A15 is not in the
profile, and is green on both.

**Patching a hole no layer holds.** When an `uncovered hole` stays large after the
plan is right — both See-through runs dropped a piece of the figure, red in
`recomposite_error_rig.png` — add an `assemble.patches` entry:
the box round the hole in rig pixels, `alpha: "silhouette"` so the page round the
figure is not taken, and a `regions.<name>` bone. Draw it `"back"` (or
`{"before": …}` the part it belongs under) and let the box **reach under its
neighbours**: on the selftest's hem fixture a box that only abutted them raised
`check`'s seam from 0.323 to 0.86 with 16 px over 40, and one reaching two rows
under each measured 0.267 with none [observed] — two regions that merely meet
leave a resampled edge between them in the render. The patch is config, so every
`build` cuts it again; it is never a file added after the build. Re-run `assemble`
and read `uncovered error px` again: a patch covering `n` of the uncovered error
pixels lowers it by exactly `n` (the selftest's `AS17` plants that and counts it).

`parts.json` holds one record per part, in draw order: the plan's, with each patch
where its `draw` puts it (`"back"` patches first in their own order, each
`{"before": X}` patch immediately behind `X`, `"front"` patches last). Its counts:

| field | counts |
| --- | --- |
| `opaque_px` | the part PNG's pixels with alpha above 8 |
| `visible_px` | of those, the ones no later layer of their See-through run is opaque (alpha >= 250) in front of — a pixel copied in below the head crop is judged in its extend layer's run |
| `occluded_px` | the rest of `opaque_px`: art the painting does not show, See-through's synthesis by necessity |
| `projected_core_px` | the projection rule's candidates: top-most `alpha >= 250`, eroded (`core`) or kept off a front rim (`visible`) |
| `source_px_taken` | of those, the ones that took the painting's pixel (the reference's count, before any merge) |
| `visible_not_projected_px` | visible pixels whose colour did not come from projection — too thin for the core, a fringe, a rim, refused for drift, or a merge ring |
| `refused_drift_px` | candidates refused because See-through's pixel and the painting's differ by more than 90 |
| `merged_px` | pixels brought in below the head crop, and the ring that closes their seam |
| `seam_override_px` | pixels the seam pass recoloured to the painting |

A part's `from` is `<full|head>:<tag>` — the See-through run and tag, which every
role (`propose`) and every judgement-line region (`check`) is read from — or, for a
patch, `painting:<its own name>`. **A patch is 100 % source**: every pixel is the
painting's, so it is all visible and all taken — `visible_px`, `projected_core_px`
and `source_px_taken` equal `opaque_px`, and `occluded_px`,
`visible_not_projected_px`, `refused_drift_px` and `merged_px` are 0. The reader
refuses a `painting:` record that says anything else, or that names another part
(`PARTS_FROM_KNOWN`, `PARTS_COUNTS_ADD_UP`). No tag rule reads a patch: `propose`
puts it on the nearest trunk bone as a region with a note, and `check` counts it
in no region.

`visible_px + occluded_px = opaque_px`, and every projected pixel is visible; the stage
refuses (`ASSEMBLE_COUNTS_ADD_UP`) rather than write counts that break either, and the
reader refuses a record that breaks them (`PARTS_COUNTS_ADD_UP`). The three visibility
counts are this port's: a `parts.json` the reference wrote has none of them and still
reads, but a record with only some of them is refused. The `pixels:` line after the
per-part lines prints their totals.

After the records, `parts.json` holds a `recomposite` block (this port's too; the
reference's files have none and still read): the flat stack of every part, composited
on white in plan order, against the painting resampled into the rig.

| field | holds |
| --- | --- |
| `mean_abs` | mean over pixels of the mean-channel \|d\|, to 3 places |
| `within_limit`, `within_share` | the share of pixels (to 4 places) whose mean-channel \|d\| is at most `within_limit` (8) |
| `error_limit`, `error_px` | pixels whose max-channel \|d\| is above `error_limit` (40) |
| `covered_alpha`, `uncovered_error_px` | of those, the ones where no part has alpha above `covered_alpha` (128) |
| `hole_count` | the 8-connected components of the uncovered error pixels |
| `holes_listed`, `holes` | the largest `holes_listed` (5) of them, largest first (ties: top row, then left column), each `{px, x, y, w, h, borders}`: its area, its box in rig pixels (y down), and every part with a covered pixel 8-adjacent to it, as `{part, px}` — how many such pixels it covers — most first, then plan order; `borders` is empty for a hole that touches no part |

The areas of every hole sum to `uncovered_error_px`; the reader refuses a block whose
figures disagree (`PARTS_COUNTS_ADD_UP`), whose holes are not largest first
(`PARTS_HOLES_LARGEST_FIRST`), whose box leaves the rig (`PARTS_BOX_INSIDE_RIG`) or
whose border names no part of the file (`PARTS_HOLE_PART_KNOWN`).

`recomposite_error_rig.png`, beside `recomposite_rig.png` (`render/` under `assemble
--out`, the top of `build --out`), is the same measurement as a picture at rig size:
**red** (255, 0, 0) is an uncovered error pixel — painting that no part holds;
**blue** (0, 0, 255) a covered error pixel — a part there, in a colour more than 40
off; every other pixel is the painting in light grey (`192 + luma / 4`, so 192 to
255). The painting is dimmed rather than dropped so a hole reads against the figure it
falls in at contact-sheet size, and grey so no painting pixel can be either flag
colour. Opaque, and the same bytes on every run.

## 6. Refusals: the rule, and what has to change

Every refusal is `FAIL  RULE: object — detail`. Inside `build` it is printed under the
stage's prefix (`[assemble]   FAIL  …`), and the build stops there.

### Reading the inputs

| rule | means | change |
| --- | --- | --- |
| `LAYERS_INPUT_KIND` | the path is neither a directory with `layers.json`, a `layers.json`, nor a `.psd` | the `--full`/`--head` path |
| `LAYERS_MANIFEST_PRESENT`, `LAYERS_MANIFEST_IS_JSON`, `LAYERS_FIELD_PRESENT`, `LAYERS_KEY_KNOWN` | the wrapper's `layers.json` is missing, unparsable, or not the wrapper's shape | the run's output directory; re-export it |
| `LAYERS_PNG_PRESENT`, `LAYERS_PNG_UNAMBIGUOUS`, `LAYERS_PNG_DECODES`, `LAYERS_PNG_MATCHES_BBOX` | a layer's PNG is missing, found in two places, not a PNG, or not its box's size | the run's files |
| `LAYERS_TAG_KNOWN`, `LAYERS_NAME_UNIQUE`, `LAYERS_BBOX_INSIDE_CANVAS` | a layer name that is no See-through v3 tag, a repeated name, a box off the canvas | the run (these are See-through's own outputs) |
| `PSD_FILE_PRESENT`, `PSD_PARSES`, `PSD_IS_RGB8`, `PSD_HAS_LAYERS`, `PSD_LAYER_PLAIN`, `PSD_LAYER_HAS_PIXELS` | the `.psd` is missing, unreadable, not 8-bit RGB, has no layer, or has a layer that is hidden, not at full opacity, or without pixels | the `.psd` |
| `ASSEMBLE_SOURCE_PRESENT`, `ASSEMBLE_SOURCE_DECODES` | the painting is missing or not a PNG | `--source` |
| `SHEET_SOURCE_PRESENT`, `SHEET_PNG_PRESENT` | `sheet`'s painting, or a part PNG a `parts.json` lists, is missing | `--source`, `--layers` |

### Plausibility (`WARN` in `layers`, a note in `assemble --propose-plan`)

See-through writes every tag, and on some seeds it paints a layer the character does
not have: **[observed]** on one full-figure seed (issue #21), a `wings` layer of
490,296 px, mostly translucent grey that had absorbed the white background, on a
character with no wings. Proposed as an ordinary part it became an 832 x 1096 part and
the recomposite error rose to mean |d| 15.01. These are not refusals — the files are
fine — so `layers` prints a `WARN` line and exits 0, and `--propose-plan` leaves the
layer out of the plan, out of the head-run fallback and out of `extend_below_crop`.

`layers` prints three figures for every layer, each over its **opaque** pixels (alpha
above 8, the table's `opaque_px`), on the layer as read:

| column | figure |
| --- | --- |
| `translucent` | the share of opaque pixels with alpha below 128 |
| `background` | the share of opaque pixels whose own colour (straight alpha) has a min channel above 235 — the seam rule's "near-white", applied to the layer |
| `area` | opaque pixels over the opaque pixels of the union of every **other** layer of the run ("the rest of the figure"); `-` when no other layer has any |

Not over alpha above 0: See-through hazes whole canvases at alpha 1..8 (the demo's
full-run face is 99.1 % translucent that way and 4.2 % over its opaque pixels). Not
over the whole union: a layer is part of it, so it could never be more than 1x.

| rule | crossed when | [observed] on the two examples' 116 layers (four runs) |
| --- | --- | --- |
| `PLAN_LAYER_TRANSLUCENT` | judged, and `translucent` above 50 % | the most translucent judged layer is 17.8 % (sample, full run, `front hair`) |
| `PLAN_LAYER_BACKGROUND` | judged, `background` above 50 %, and `translucent` above 25 % | the most background-coloured judged layer is 21.9 % (demo, head run, `topwear`, a white dress); of judged layers above 10 % background, the most translucent is 5.6 % (demo, full run, `handwear-r`) |
| `PLAN_LAYER_OVERSIZED` | `area` above 4x | the largest is 1.681x (demo, head run, `back hair`, which fills the crop) |

**Judged** means `area` at least 0.05x (or `-`). The two colour rules skip smaller
layers on purpose: **[observed]** all 27 example layers of 150 px or more that are above
25 % translucent are small features — lashes, brows, mouths, noses, ears, irises, eye
whites, an earring — antialiased strokes that are mostly rim, and the largest of them is
0.011x; 23 of the 116 layers are judged. The background rule needs translucency too,
because an opaque white garment has the page's colour and is a real part.

No example layer crosses a rule, so their proposals are unchanged. For the haze the
selftest plants (`PL03`, `PL06`: near-white, four pixels in five at alpha 40, 2.000x the
rest of the figure), the `WARN` line and the note say the same thing:

```
  WARN  PLAN_LAYER_TRANSLUCENT: layer "wings" — 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure; at most 50% translucent (alpha below 128) for a layer at least 0.05x the rest of the figure is required, so --propose-plan leaves it out
"wings: full run layer 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure -> not proposed by PLAN_LAYER_TRANSLUCENT (…), PLAN_LAYER_BACKGROUND (…)"
```

A full-run hair layer the head-run hair would have been extended from says `-> not
extended below the crop by …` instead. **Change:** nothing, when the character does not
have that part. When it does (a real translucent veil, a real white cape that the run
drew faintly), the layer is See-through's best attempt at it: add the entry to
`assemble.plan` by hand and read `assemble`'s `recomposite vs source` figures — or re-run
See-through with another seed.

### The config

| rule | means | change |
| --- | --- | --- |
| `CONFIG_FILE_PRESENT`, `CONFIG_IS_JSON` | no such file, or not JSON | `--config` |
| `CONFIG_KEY_KNOWN`, `CONFIG_KEY_RETIRED`, `CONFIG_FIELD_PRESENT`, `CONFIG_FIELD_TYPE` | an unknown key (a retired one says what replaces it), a missing one, a wrong type | the named field |
| `CONFIG_HEAD_BOX_SQUARE` | `seethrough.head_box` is not a non-empty square | `head_box` — take `propose --head-box`'s |
| `CONFIG_TAG_KNOWN`, `CONFIG_PART_NAME`, `CONFIG_PART_UNIQUE` | a plan entry names no v3 tag, a part name that is not a file name, or a part or layer twice — a patch named like a plan part or another patch included | `assemble.plan`, `assemble.patches` |
| `CONFIG_NAME_RESOLVES` | a parent, segment, region, track, blink member, blink still part or bone, extend part or patch `draw.before` names nothing declared above it | the named reference, or the declaration it needs |
| `CONFIG_BONE_UNIQUE` | a bone or chain declared twice, or `root` declared | `bones` |
| `CONFIG_PART_ATTACHED` | a plan part with neither or both of a mesh and a region; a patch with a mesh, or with no region | `meshes` / `regions` |
| `CONFIG_PATCH_BOX` | an `assemble.patches` box with `x1 <= x0` or `y1 <= y0` | that patch's `box` (`x1`, `y1` are exclusive) |
| `CONFIG_AMPS_MATCH_CHAIN` | a chain track's `amps` is not one per link | that track's `amps` |
| `CONFIG_PERIOD_DIVIDES_DURATION` | a period that is not a whole fraction of the idle — the loop could not close | that track's `period`, or `motion.duration` |
| `CONFIG_BLINK_GROUP_MEMBERS` | `motion.blink.eyes` or `motion.blink.brows` is `[]`: a group with no members, which rigc refuses at the gate | a figure with no eyewhite part has nothing to blink: leave `motion.blink` out; one with no eyebrow part: leave `brows` and `brow_drop` out |
| `CONFIG_BLINK_BROWS_PAIRED` | `motion.blink.brows` without `brow_drop`, or `brow_drop` without `brows` | state both or neither |
| `CONFIG_STILL_OFF_THE_BLINK` | a `motion.blink.still` entry names a region on a bone the blink's `eyes` does not name (nothing to hold still), or its `bone` is one the blink's `eyes` names (the still piece would blink) | that entry's part, or its `bone` — the eye bone's parent, `head` as proposed |

### inputs

| rule | means | change |
| --- | --- | --- |
| `INPUTS_SOURCE_PRESENT` | no such painting | `--source` |
| `INPUTS_PAINTING_PORTRAIT`, `INPUTS_PAINTING_OPAQUE` | the painting is wider than tall, or has a pixel below alpha 255 | the painting |
| `INPUTS_HEAD_BOX_INSIDE` | `seethrough.head_box` leaves the painting (the crop is not padded) | `head_box` — take `propose --head-box`'s |

### The optional ComfyUI adapter (`comfy paint`, `comfy seethrough`)

| rule | means | change |
| --- | --- | --- |
| `COMFY_HOST_GIVEN`, `COMFY_REACHABLE`, `COMFY_REQUEST_OK` | no `--host`/`COMFY_HOST`, nothing answering there, or a non-200 answer | the host, or the box |
| `COMFY_NODE_PRESENT`, `COMFY_INPUT_KNOWN`, `COMFY_INPUT_SET`, `COMFY_CHOICE_PRESENT` | the box's `/object_info` lacks a node class the graph uses, an input it sets, an input it must set, or a model file it names | install the node or model on the box, or the config value naming it |
| `COMFY_QUEUE_EMPTY`, `COMFY_PROMPT_ACCEPTED`, `COMFY_HISTORY_WITHIN`, `COMFY_RUN_OK` | someone else's job kept the queue busy past `--wait`, the box rejected the graph, the job did not finish within `--timeout`, or it ended in error (quoted) | `--wait`/`--timeout`, or what the quoted error names |
| `COMFY_HISTORY_OUTPUTS`, `COMFY_VIEW_PRESENT`, `COMFY_MANIFEST_NAMED`, `COMFY_MANIFEST_IS_THIS_RUN`, `COMFY_LAYER_NAME` | the job's outputs are missing, unreadable, belong to another run, or name a layer that is not a plain file name | the wrapper's version on the box; report it |
| `COMFY_IMAGE_PRESENT`, `COMFY_OUT_EMPTY`, `COMFY_OUT_FREE` | no `--image`, an `--out` that already holds files, or a seed whose painting is already on disk | `--image`, `--out`, `--seed0` |
| `CONFIG_FIELD_PRESENT` on `config.generation`, `COMFY_PAINTING_SIZE` | `comfy paint` was given a config with no `generation` block (the line names the fields it holds), or the painting that came back is not twice the latent | `config.generation` |

### assemble

| rule | means | change |
| --- | --- | --- |
| `ASSEMBLE_FIELD_PRESENT` | `seethrough.head_box` is missing | `propose --head-box` proposes it (§3) |
| `ASSEMBLE_SOURCE_PORTRAIT` | the painting is wider than tall | the painting |
| `ASSEMBLE_RIG_SIZE` | `rig_scale` makes an empty rig | `assemble.rig_scale` |
| `ASSEMBLE_HEAD_BOX_INSIDE` | the head box is outside the painting | `head_box` — `propose --head-box` holds it inside |
| `ASSEMBLE_RUN_CANVAS` | a run's canvas is not `resolution` square | `seethrough.resolution`, or the run |
| `ASSEMBLE_PLAN_TAG_IN_RUN`, `ASSEMBLE_EXTEND_TAG_IN_RUN` | an entry takes a tag its run does not hold (the detail lists what it does hold) | that entry's run or tag |
| `ASSEMBLE_PART_OPAQUE` | a part ended with no opaque pixel | drop the entry, or take the tag from the other run |
| `ASSEMBLE_PATCH_BOX_INSIDE` | a patch's box reaches past the rig (the painting times `rig_scale`; the detail gives the size) | that patch's `box` — it is in rig pixels, not painting pixels |
| `ASSEMBLE_PATCH_OPAQUE` | a patch takes no pixel: a `"silhouette"` patch whose box holds none of the figure | move the box onto the figure, or `"alpha": "box"` |
| `ASSEMBLE_COUNTS_ADD_UP` | a part's visible and occluded counts do not add up to its opaque pixels, or a projected pixel is not visible — an assembler bug, not an input problem | report it with the part named; nothing was written |

### propose

| rule | means | change |
| --- | --- | --- |
| `HEADBOX_FACE_PRESENT`, `HEADBOX_RUN_SQUARE`, `HEADBOX_CANVAS_SIZE`, `HEADBOX_CANVAS_PORTRAIT`, `HEADBOX_FITS_CANVAS` | the full run has no face or is not square; `--canvas` is not a positive size or is landscape; or the painting cannot hold the proposed box at its size (shrinking it would cut the head) | `--full`, `--canvas`, or the painting |
| `PROPOSE_SOURCE_PRESENT`, `PROPOSE_PNG_PRESENT`, `PROPOSE_PNG_MATCHES_BOX` | the painting or a part PNG is missing, or a PNG is not its box | `--source`, `--parts` (re-run assemble) |
| `PROPOSE_FACE_PRESENT` | no part comes from a `face` layer; every other rule scales by it | `assemble.plan` |
| `PROPOSE_ACCESSORY_BODY` | an accessory has nothing above its pendant rows to hang its bone on | that part's plan entry, or author its bones by hand |
| `PARTS_*` (`PARTS_FILE_PRESENT`, `PARTS_IS_JSON`, `PARTS_KEY_KNOWN`, `PARTS_FIELD_PRESENT`, `PARTS_FIELD_TYPE`, `PARTS_NAME_UNIQUE`, `PARTS_FROM_KNOWN`, `PARTS_BOX_INSIDE_RIG`, `PARTS_COUNTS_ADD_UP`, `PARTS_HOLES_LARGEST_FIRST`, `PARTS_HOLE_PART_KNOWN`) | the `parts.json` read is not assemble's contract (`PARTS_COUNTS_ADD_UP`: `visible_px + occluded_px` is not `opaque_px`, `visible_not_projected_px` is above `visible_px`, or the `recomposite` block's figures disagree — more uncovered than error pixels, a hole larger than its box, the wrong number of holes listed, listed areas that do not sum to `uncovered_error_px`; the last two codes are the block's order and its border names, §5) | re-run assemble; do not edit `parts.json` |

### rig

| rule | means | change |
| --- | --- | --- |
| `RIG_PART_PRESENT`, `RIG_PART_ATTACHED` | a `meshes`/`regions` key that is not in `parts.json`, a part with neither, or a `painting:` part with a mesh | the config and the plan must name the same parts; a patch is a region |
| `RIG_PNG_PRESENT`, `RIG_PNG_MATCHES_BOX`, `RIG_PART_HAS_ART` | a part's PNG is missing, the wrong size, or has no art pixel | re-run assemble |
| `RIG_NAME_RESOLVES`, `RIG_SEGMENT_DEFINED`, `RIG_CHAIN_POINTS` | a segment names an undeclared bone, a bone with no `tip` and no next link, or a chain too short to make a link | that bone's `tip`, or write the segment out as `[bone, [x0,y0], [x1,y1]]` |
| `RIG_LATTICE_ONE_LOOP` | the lattice over a part does not close into one outline even after the repair passes | that mesh's `grid` |
| `RIG_CONTROL_NAME_FREE` | a keyed, mesh-weighted bone needs `<bone>_ctl` and that name is taken | rename the declared bone |
| `RIG_BLINK_INSIDE_IDLE` | the blink runs outside the idle | `motion.blink.t` |
| `RIG_BLINK_HOLD_SPANS_A_FRAME` | the tree's `BLINK.hold` is shorter than one frame at `IDLE_FPS`, so for some `motion.blink.t` no idle frame — and no frame of the loop — shows the closed eye; the detail counts the phases that miss and names the first | nothing in the config: `BLINK.hold` in `src/motion.ts`, at least `1/IDLE_FPS` s (§3) |
| `RIG_STILL_ROW_INSIDE_PART`, `RIG_STILL_ROW_CLEAR`, `RIG_STILL_PIECES_HAVE_ART`, `RIG_STILL_NAME_FREE` | a `motion.blink.still` row that is not strictly inside the part, that crosses art (a cut through art changes the render even at rest), that leaves one piece with no art, or whose `<part>_still` slot name another part already has | that entry's `row` — a row with no art between the crease and the lash line — or rename the other part |
| `RIG_RIGC_GREEN` | spine-rigc refused the rig; its own FAIL or compile-error line is quoted, and nothing was written | the field rigc's line names — spine-rigc's own AUTHORING §5 maps each of its assertions (`node_modules/spine-rigc/docs/AUTHORING.md`) |

### check and build

| rule | means | change |
| --- | --- | --- |
| `CHECK_RIGC_PRESENT` | no `rigc` binary found (every place looked is listed) | `bun install` |
| `CHECK_INPUT_PRESENT` on `…/parts.json` | `--parts` named a directory without `parts.json` — most often `parts/` itself. The detail says it: "--parts names the directory holding parts.json and parts/, not parts/ itself (after build, that is build's --out, whose rig is <out>/rig); without --parts it is --rig", and names the parent when the parent holds `parts.json` | `--parts` — the directory above `parts/` |
| `CHECK_INPUT_PRESENT`, `CHECK_INPUT_IS_JSON`, `CHECK_PART_PNG_PRESENT`, `CHECK_PART_PNG_MATCHES_BOX`, `CHECK_PART_SLOT_PRESENT`, `CHECK_RIG_STAGE_PRESENT`, `CHECK_RIG_STAGE_IS_THE_CANVAS`, `CHECK_RIG_ROOT_BONE`, `CHECK_IDLE_PRESENT` | the rig directory is incomplete or disagrees with `parts.json` (`CHECK_PART_SLOT_PRESENT`: a part with no slot of its own name, which the judgement lines render it by) | re-run rig (`build` does both) |
| `CHECK_RIGC_GREEN` | a rigc step failed; its line is quoted | as `RIG_RIGC_GREEN` |
| `CHECK_LOOP_LAST_FRAME_AT_DURATION` | the idle's last frame does not sit at `duration` | `motion.duration` — a whole number of 1/12 s |
| `CHECK_LOOP_CLOSES` | frame 0 and the frame at `duration` differ (max and first pixel quoted) | a track whose last key is not its first |
| `CHECK_SEAM_WITHIN_BAR` | the setup pose does not reproduce the flat stack of parts | usually a region or mesh placed off its part; compare with `recomposite_rig.png` |
| `CHECK_BREATH_VISIBLE` | the torso (`topwear`), rendered alone, barely moves over the idle — or the feet (`footwear`), rendered alone, move at all | the chest's breath tracks (`motion.tracks` on `chest`), or the torso mesh's `segments`; for the feet, the bone their region rides (`regions.<part>`, `root` in both examples) |
| `CHECK_BLINK_NO_HOLE` | with the blink held shut, the eyewhite box shows the page where the open eye had art | the layer under the eye: the `face` part has no art there. Take the face from the other run, or add a part under the eye; `motion.blink.squash` only hides the hole less |
| `CHECK_CHAIN_LAG` | a rotate track leads (or does not lag) the keyed bone above it, or a chain link swings less than the link above | that chain track's `phase`/`lag` (a positive `lag`, a child `phase` above its parent's) or its `amps` (non-decreasing toward the tip) |
| `CHECK_TIP_OVER_ROOT` | a `handwear`/`bottomwear` part's lower half travels less than 1.4725 times as far as its upper half | the chain track's `amps` (grow toward the tip), or the mesh's `segments` (the chain must be among them) |
| `CHECK_STILL_REGIONS_DARK` | the heat map is brighter than the ceiling over the face outline or over the feet | the part that moves there: a mesh weighted to a swinging bone (`segments`), or a region on the wrong bone |
| `CHECK_SEAM_FRAME_SIZE`, `FRAMES_SIDECAR` | rigc's render is not what its `frames.json` says | a rigc problem; report it |
| `LOOP_ENCODE` | the loop encoder refused a frame (translucent pixel in a GIF, a size change) | the frames; for a translucent frame write the lossless or the indexed APNG, which keep alpha |
| `BUILD_ARTIFACT_PRESENT` | the packed build lacks its `.json`, `.atlas` or page | a rigc problem; report it |

## 7. The bars `check` enforces, and what only an eye answers today

`check.json`'s `PASS` is true exactly when all of these hold (the reference
implementation's bars):

- `gate_spine-html.txt`: every summary line `(N passed, 0 failed)` — the packed build
  under the `spine-html` profile;
- `gate_spine.txt`: the same, `rigc validate` of that build under the `spine` profile;
- **seam**: the setup-pose render against the flat composite of `parts/`: mean
  max-channel |d| ≤ 1.0 of 255, and at most 50 pixels over 40;
- **loop**: idle frame 0 against the frame at `t = duration`: max |d| exactly 0.

On the examples: `sample` 23/23 and 14/14, seam 0.207 with 0 pixels over 40, loop 0;
`demo` (default rule) 23/23 and 14/14, seam 0.326 with 2 pixels over 40, loop 0.

A green gate cannot see a wrong animation, so `check` also writes five **judgement
lines** (issue #11), each a key of `check.json` and a console line
`NAME: PASS|FAIL|SKIP — <figures and bars>`, read the same way as the lines above: a
FAIL makes `PASS` false and prints its own `FAIL  CHECK_<NAME>` line (§6); a SKIP
says why the rig gave the line nothing to read, and is neither a pass nor a failure —
report it as not verified. Every region is chosen by the See-through tag in
`parts.json`'s `from`, never by a part's name. Heat is a pixel's largest per-channel
change from idle frame 0, in levels of 255, on the idle's 640-pixel grid.

Each bar follows one rule: a floor is half the weaker example's figure and a ceiling
twice the worse one's, so the weaker example clears it by a factor of two; a bar the
model itself fixes (a part on an unkeyed bone does not move, a lag is above 0, a hole
is 0 pixels) is that value, not a margin. The figures are this port's, measured on
the two examples [observed]:

| line | measures | bar | `demo` | `sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| `BREATH_VISIBLE` | `topwear` parts rendered alone (`rigc render --slot`): heat mean over their box; `footwear` parts alone: heat max over theirs | torso mean ≥ 3.809; feet max ≤ 0 | 15.252; 0 | 7.618; 0 | no `topwear` or no `footwear` part |
| `BLINK_NO_HOLE` | the setup pose with every `scaley` track on the eyewhite slots' bones held at its closed value, against the setup pose, at full size: pixels in the eyewhite box that show the page where the open eye had art | 0 px | 0 | 0 | no `eyewhite` part, or no `scaley` track on its bones goes below its first key |
| ″ (reported) | the same box: each closed-eye pixel's max-channel distance to the nearest colour the open eye's box holds — max, and pixels over 40 | none | 15; 0 | 11; 0 | as above |
| `CHAIN_LAG` | `motion.json`'s rotate tracks read as sines (DFT of the keys: period, amplitude, phase) and arranged by the bone tree — a keyed bone's parent is its nearest keyed ancestor | every lag ≥ 0.001 cycle; amplitude non-decreasing down each unbranched chain | lags 0.040 (neck to head) to 0.120; 12 chains | lags 0.040 to 0.100; 9 chains | no rotate track under another of the same period |
| `TIP_OVER_ROOT` | each `handwear`/`bottomwear` part alone: how far the centroid of its art travels in the lower half of its box against the upper half | ratio ≥ 1.4725 | `bottomwear` 2.945, `sleeves` 3.716 | `bottomwear` 4.396, `sleeves` 12.475 | no such part |
| `STILL_REGIONS_DARK` | the idle's heat over the face outline (where `face` is the top part of the flat stack, less the boxes of `eyewhite`, `irides`, `eyelash`, `eyebrow` and `mouth`) and over the feet (where `footwear` is on top); max reported | face mean ≤ 33.976; feet mean ≤ 3.244 | 16.988; 1.622 | 11.475; 0 | no `face` and no `footwear` part (one of the two absent leaves that half unmeasured) |

After them, one **reported line** with no bar:

| line | reports | bar | `demo` | `sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| `RECOMPOSITE_HOLES` | `parts.json`'s `recomposite` block (§5), read rather than measured: `error_px`, `uncovered_error_px`, `hole_count`, and the largest hole's `px`, `box` (`x,y wxh`) and `borders` (`<part> <px> px`) | none — status `REPORTED`, never FAIL, and `PASS` does not read it | 1,564 px in 453 holes; largest 70 px at 351,155 6x22, `hair_back` 53 px, `hair_front` 12 px | 1,185 px in 259 holes; largest 94 px at 479,412 7x34, `sleeves` 42 px, `topwear` 40 px, `bottomwear` 6 px | `parts.json` has no `recomposite` block (the reference's files) |

It exists because no gate can see what it reports. The seam compares the setup pose
with the flat stack **of the parts**, so a pixel of the painting that no part holds is
missing from both sides and the seam passes over it — a white gap between two legs
See-through made of one skirt built green with 7,671 uncovered pixels (issue #25). The line puts that class of defect into
`check.json`, where an agent that reads only `check.json` sees it. It is not a bar for
the reason the colour-patch half of `BLINK_NO_HOLE` is not one: no threshold is
derivable from the examples — both hold hundreds of holes of a few dozen pixels along
part edges, and whether a hole matters depends on where it is, which the box and the
bordering parts say and a count cannot. Read it as a figure, quote it in a report, and
look at `recomposite_error_rig.png` when the largest hole is more than a sliver.

What each figure is, and is not:

- **The seam is the answer to "at rest, no gap, white rim or doubled line between
  layers".** A gap shows the page, a rim a colour no part has there, a doubled line a
  part drawn off its place; each changes the setup-pose render against the flat stack,
  which is what the seam bar measures. No separate line is written for it.
- **The blink is measured at the setup pose, not in an idle frame.** Since issue #32
  an idle frame does fall inside the closed window — on both examples the eyes are
  fully shut from 2.37 s to 2.454 s and `idle_frames_closed` is `[29]` (2.417 s) — but
  that frame also carries the idle's sway, so it is not a comparison of what the blink
  alone changed. rigc's `render` takes no time, so the closed pose is a throwaway
  animation holding the blink tracks' closed value, built and rendered beside the
  seam's still on the same grid. `idle_frames_closed` is what says the loop shows the
  closed eye; before #32 it was `[]` on both examples, with the 0.04 s hold between
  frames 28 and 29.
- **The colour-patch figure is not reliable enough for a bar.** "Nearest colour in the
  open eye's box" counts a legitimate colour the open eye never showed (skin under the
  lid) as a patch, and a patch the open eye happened to contain as none. It is
  reported, and 15 and 11 on the examples are what a clean lid looks like.
- **A lag is read modulo half a cycle.** A sine's sign is half a cycle of phase, and
  the keys cannot tell `amp −0.6, phase 0.2` from `amp 0.6, phase 0.7` — the mirrored
  chains of both examples are written the first way — so the reading folds a step into
  (−¼, ¼] of a cycle and reports amplitudes unsigned. A lag of a quarter cycle or more
  cannot be told from a lead. Tracks whose keys are not a sampled sine are listed as
  `unread`, and a keyed bone under a keyed ancestor of another period (the demo's
  tassel under the head) is listed in `other_period` and not compared.
- **Tip over root is a centroid, not a displacement.** Art entering or leaving a half
  moves its centroid too. The halves' mean heat was the brief's first choice and was
  rejected: heat is texture times motion, and on the demo's sleeves the lower half's
  mean heat is 1.1 times the upper half's while its centroid travels 3.7 times as far.
  The halves split the box across its rows, which assumes the part hangs — true of a
  front-facing standing figure, the only input this tool takes.
- **The face ceiling is weak, and the reason is in the examples.** The head rolls, so
  the face outline is lit in both (16.988 and 11.475); twice the worse is a ceiling a
  smooth face sliding two rig pixels stays under (the selftest's fixture measures 24.8
  at that slide and 85.5 at eight). A face-outline instrument that removes the head's
  own motion needs the head bone's world transform per frame, which rigc's `render`
  does not export. The feet half has the same shape on the demo: its long skirt swings
  over the shoes, which lights 1.622.

Still only an eye answers, each a missing instrument rather than a question to ask:

- **no visible texture stretch** (it appears when amplitudes grow): the measure is a
  mesh triangle's deformed edge length over its rest length, frame by frame, and
  nothing this package runs gives deformed vertices — spine-parts does not link
  `spine-core`, and rigc's `render` exports pixels, not vertices;
- **the face outline held still in the head's own frame** (above): the heat map
  without the head's roll.

## 8. What one character costs

| step | sample | demo | source |
| --- | --- | --- | --- |
| painting (GPU) | 20.2 s | 18.3 s | `generation.json` `elapsed_s`, in [spine-parts-examples](https://github.com/firejune/spine-parts-examples) |
| See-through full run (GPU) | 194.9 s | 198.5 s | `inputs/layers/full/meta.json` `elapsed_s` |
| See-through head run (GPU) | 170.9 s | 171.4 s | `inputs/layers/head/meta.json` `elapsed_s` |
| `build` (CPU, user + sys) | 14.6 s | 30.7 s | measured with `/usr/bin/time -p` on an Apple M4 machine under other load, rigc's child processes included; wall clock 12.7 s and 27.5 s |

About 6.5 minutes of GPU and under a minute of CPU per character, before any hand
correction. The GPU figures are one run each on one machine; the painting's figure
excludes choosing among seeds (the demo was chosen from eighteen candidates).
