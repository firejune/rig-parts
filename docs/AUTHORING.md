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
| [spine-rigc](https://www.npmjs.com/package/spine-rigc) | compiles, gates, packs and renders every rig; spine-parts writes no Spine data itself | installed with spine-parts as a dependency (`node_modules/.bin/rigc`); with no Spine runtime beside it, it gates with its own validator, and `rigc --version` says `entry: cli_core.ts` |
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
  basis.json                what each proposed bone rests on, written beside proposal.json (§4, step 7)
  keypoints.json            optional: where the figure's joints are, for `propose --keypoints` (§3, *A posed figure*)
  out/                      what `build` writes (§5)
```

## 3. `config.json`, field by field

`src/config.ts` is the schema and the loader. Every key is known or refused
(`CONFIG_KEY_KNOWN`); a required key that is missing is `CONFIG_FIELD_PRESENT`.
There are two open doors, and nothing reads what stands behind either. An
annotation: `note`, and any key ending in `_note`, may hold a string anywhere an
object is — write a hand correction's reason there, beside the value it corrected
(the examples do). A record: any key beginning `x-` with a name after it may hold
any JSON value in the same places — a project's own provenance, such as the gate
results of a past build (`"x-status": {…}`) or the seeds a search rejected, with
reasons (`generation.x-seeds_tried`). The record test comes first, so
`x-seed_note` is a record. `xstatus`, `x_status`, `X-status` and a bare `x-` are
not record names and are refused like any unknown key. The doors are not open in
`meshes`, `regions` or `motion.blink.still`: their keys are part names, and an
`x-` key there is a part like any other. Every refusal of an unknown key, of a
retired one and of an annotation that is not a string says where a record goes.

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
| `bones` | rig; `propose --from-config` | **proposed** by `propose`, then corrected. A single bone `{name, parent, at, tip?}` or a chain `{chain, parent, points, tip}` whose links are named `<chain>0 … <chain>n`. Parents come before children. In `rig.json` each link is **turned along its chain** — `rotation` is the direction from its origin to the next link's (the last link's to `tip`) and `length` that distance (issue #73), so a physics constraint added downstream finds a lever; under `--idle-keys ctl` the link's `<link>_ctl` carries the turn and the length and the link sits at local rotation 0 beneath it. A single bone is never turned; one whose parent is a link is turned back upright |
| `meshes.<part>` | rig | **proposed**, then corrected. Exactly one of `grid` (the lattice: cell size, px — what `propose` writes) or `contour` (the outline mode, authored; the next row and "A contour mesh" below) — both, or neither, is `CONFIG_MESH_MODE`. In both modes: `r` (added to every distance before weighting: `w = 1/(d + r)²`), `segments` (a chain name, a bone name with a `tip`, or `[bone, [x0,y0], [x1,y1]]`). The segment list is the one authored decision about a layer: which bones may pull it. The slot's bone is the first segment's |
| `meshes.<part>.contour` | rig | **authored**, optional (issue #84): `{tolerance, margin, spacing, budget?, stray?, regions?}`. `tolerance` — spine-rigc's Douglas–Peucker tolerance on the traced outline, px, 0 or more; `margin` — rigc's outward offset of it, px, 0 or more; `spacing` — the background interior spacing, px, above 0; `budget` — the most vertices the mesh may have (refused above it, nothing thinned); `stray` — the largest island, in art pixels, that may be left out of the mesh (absent: none is); `regions` — local deformation regions, each `{name, shape, bone, spacing, band}` with `shape` `"circle"` (`cx, cy, r`) or `"polygon"` (`points`, 3 or more): `bone` is the region's control bone (any bone `bones` declares), `spacing` the interior spacing inside the region and its band, `band` the width the bone's weight falls across. Every length and position is **rig px**, like every other in the config; the part image is the rig less `(x − 4, y − 4)` (its box less the pad), a translation, so a length is the same number in both. A region's `cx`, `cy`, `r`, `band` and `points` are multiples of 1/256 px (`CONFIG_FIELD_TYPE` otherwise); region names are unique per mesh (`CONFIG_REGION_NAME_UNIQUE`). The alpha threshold is not a field: art is alpha above 8, the lattice's and `check`'s |
| `regions.<part>` | rig | **proposed**: the bone a rigid part rides. Every plan part is exactly one of a mesh or a region (`CONFIG_PART_ATTACHED`) |
| `motion.duration` | rig; check (the loop is measured at this time) | proposed as 4 s; a whole number of 1/12 s ticks, because `check` renders at 12 fps |
| `motion.tracks` | rig | **proposed**, then tuned. Single `{bone, prop, amp, period, phase, base?}` or chain `{chain, amps, period, phase, lag}` — one amplitude per link, link `i` at phase `phase + lag·i`. Every `period` must divide `duration` (`CONFIG_PERIOD_DIVIDES_DURATION`). A bone property is keyed by one track (`CONFIG_BONE_PROPERTY_KEYED_ONCE`): a chain keys `rotate` on every link, the blink's `eyes` group `scaley` and its `brows` group `translatey` on every member, so a single track on any of those is a second track on it — rigc would refuse it one stage later, `animation "idle" has two tracks on eye.scaley`. A chain link is turned along its chain (the `bones` row), so a `translatex`/`translatey` key on a bone whose parent is a turned link, or a `scale`/`shear` key on a turned link, would move or stretch along the link and not along the picture's axis: the rig stage refuses it (`RIG_KEY_FRAME_UNTURNED`); `rotate` is keyed on any bone |
| `motion.blink` | rig | **proposed**: `{t, eyes, brows, squash, brow_drop}`; the whole blink, `t` to `t + 0.364` s (`t + 0.314` s without brows: the brows' keys are the ones that end last), must fit inside the idle (`RIG_BLINK_INSIDE_IDLE`). The `eyes` group's `scaley` squashes every part on the eye bones about the bone's origin, the eyewhite's centre. Optional: a figure with no `eyewhite-r`/`-l` part has no eye bone, so `propose` writes no `blink` and notes `no blink: no eyewhite part (looked for: eyewhite-r, eyewhite-l), …`; with eyes and no `eyebrow-r`/`-l` part it writes the blink without `brows` and `brow_drop` and notes `blink without brows: …`. `brows` and `brow_drop` are stated together or not at all (`CONFIG_BLINK_BROWS_PAIRED`), and a group that names no bone is refused (`CONFIG_BLINK_GROUP_MEMBERS`) — rigc would refuse it one stage later, `group "eyes" declares no members` — as is a group that names one bone twice (`CONFIG_BLINK_GROUP_UNIQUE`; rigc: `group "eyes" names member "eye" twice`). An `irides-*` or `eyelash-*` part on a side with no eyewhite has no eye bone to ride: `propose` places it on `head` as a region, which the blink does not move, and notes `no eyewhite part for eye_r (looked for: eyewhite-r): iris (head:irides-r) is placed on head as a region, …`. The timing is fixed, not a field (table below) |
| `motion.blink.still` | rig | **proposed** only for a lash `propose` notes (below), then checked: `{<part>: {row, bone}}` — the rows of that region part above `row` (rig px, y down) are drawn by a second slot `<part>_still` on `bone` and do not blink; rows from `row` down keep the part's slot and blink. The part must be a region on a bone `eyes` names, `bone` one it does not (`CONFIG_STILL_OFF_THE_BLINK`), and `row` a row of the part with no art across its whole width (`RIG_STILL_ROW_CLEAR`) |
| `constraints` | rig (handed to spine-rigc as `rig.json`'s `constraints`); `compare` and the coverage lines (roles) | **authored**, optional; `propose` writes none. A list of constraints in **spine-rigc's own rig-spec shape** (`RigConstraint`: `ik`, `transform`, `path`, `physics`, `slider` — spine-rigc's `src/rig.ts` documents every field), in the order rigc applies them. The loader checks only what this package owns: each entry is an object with a `type` rigc names (`CONFIG_CONSTRAINT_TYPE_KNOWN`) and a non-empty `name`, unique within its kind as rigc finds constraints (`CONFIG_CONSTRAINT_NAME_UNIQUE`; an ik and a transform may share one); every bone it names — `bones`, an ik's `target`, a transform's `source`, a physics or slider constraint's `bone` — is a bone `bones` declares, a chain link as `<chain><i>` (`CONFIG_NAME_RESOLVES`); an ik names one bone or a bone and its child (`CONFIG_IK_BONES_PARENT_AND_CHILD`); the bone a constraint follows does not sit under a bone it drives (`CONFIG_CONSTRAINT_TARGET_DETACHED`). Every other field (`mix`, `softness`, `properties`, a path's `slot`, a slider's `animation`) and every value is rigc's to accept or refuse at the rig stage's gate, in rigc's words (`RIG_RIGC_GREEN`). A note and an `x-` record may ride on an entry; the rig stage leaves them out of what it hands rigc. Under the default `--idle-keys ctl` a two-bone ik whose child link the idle keys is refused (`RIG_IK_PAIR_UNDER_CONTROL`): run `rig --idle-keys direct` or `build --idle-keys direct` (the refusal names the flag on the command that ran; `build` forwards it to its rig stage, issue #95). Each bone a constraint follows is declared to rigc as `invariants.detached` from every bone it drives, which rigc's gate rule `A25` checks |

**A scene target is an ordinary bone.** A target the scene places — a point a hand
reaches for, a face something turns toward — is a single bone parented to `root`,
`{"name": "tgt", "parent": "root", "at": [x, y]}`, that a constraint names as its
`target` (an ik) or `source` (a transform). There is no other bone kind: it binds no
art, nothing in the idle keys it, and `compare` and the coverage lines call it a
`target`. Its `at` is where it rests; the scene moves it later. The rig stage declares
it detached from the bones its constraint drives (`invariants.detached`), so rigc's
gate refuses the built rig if it is ever re-parented under them. What `--idle-keys`
does to a constraint, measured through spine-rigc 2.10.1 on the selftest's rig
fixture (a two-link chain whose links the idle keys and a mesh is weighted to, its
4 s idle rendered at 12 fps):

| constraint on the chain | `--idle-keys ctl` | `--idle-keys direct` |
| --- | --- | --- |
| ik over both links, target under `root` | gates green; the tip misses the target by 2.58 rig px in every frame (`<link1>_ctl` stands between the links) — refused here, `RIG_IK_PAIR_UNDER_CONTROL` | gates green; tip on the target in every frame (largest gap 1.7e-7) |
| ik over one link (an aim) | gates green | gates green; the same per-frame tip distances as `ctl` (0.67 to 0.90 rig px; an aim is not a reach) |
| physics on a link (`rotate`) | gates green | gates green; the link's world rotation within 1.7e-9 degrees of `ctl`'s in every frame |
| transform on a link (`rotate` from the target) | gates green; the link's world rotation is the target's | the same |

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
`face` makes `hip`/`chest`/`neck`/`head`, the eyewhites make the eye bones (irides and
lashes ride them, or `head` on a side with no eyewhite), brows are
told apart by position, `bottomwear` makes the hip and three skirt chains,
`handwear` makes sleeve chains (one blob or two), `front hair` makes fringe chains
and a lock chain for each strand that hangs below the chin, `back hair` makes a bun
bone or two hanging chains, and `headwear`/`earwear` get a rigid bone and a pendant
chain — or, when the accessory has hanging strands, one pendulum chain per strand
(below). What it cannot know — something painted inside another layer that should
swing, hair of another shape, whether an accessory swings — is yours to add, and
`notes` in `proposal.json` says where it guessed.

**A posed figure: `propose --keypoints`.** The proposer's ratios assume a
standing figure: the hip below the chest, sleeves hanging from the shoulders. A
seated, reclining or otherwise posed figure is told where its joints are with one
explicit file (issue #75, `src/keypoints.ts`):

```json
{
  "spec": "spine-parts-keypoints/1",
  "space": { "units": "painting-px", "origin": "top-left", "y": "down" },
  "width": 1664, "height": 2432,
  "source": "what produced this file (recorded, never interpreted)",
  "people": [
    { "id": "a", "joints": {
        "neck":    { "state": "observed", "at": [826, 464] },
        "l_elbow": { "state": "occluded", "at": [1030, 926], "score": 0.4 },
        "r_ear":   { "state": "missing" } } }
  ]
}
```

The space is stated and any other is refused (`KEYPOINTS_SPACE_STATED`); `width`
and `height` are the painting's and are held to `--source` (`KEYPOINTS_IMAGE_SIZE`).
Joint names are the body-18 names of `src/skeleton.ts` (`nose`, `neck`,
`r_shoulder` … `l_ear`), and `r` / `l` are the **subject's** sides. Each joint is
`observed` (with `at`), `occluded` (`at` optional — when given it is the producer's
estimate and said as that) or `missing` (no `at`); a joint the file does not list is
missing. A `score` is the producer's and is printed beside the joint; nothing here
computes one. With more than one person, `--person <id>` names one; nothing picks.
Painting px reach rig px by the overlay's own map, `x * W/width`, `y * H/height`
(0.5 for both examples).

What a joint with a position places, as given — no ratio is applied over it:

| bone | from | when the joint has no position |
| --- | --- | --- |
| `neck` | `neck` | the rule: half way from the chin to the neck part's bottom (or 0.12 face heights below the chin), on the eye axis |
| `hip` | the midpoint of `r_hip` and `l_hip` — a point between two joints, said as that | the hip rule (bottomwear top, the waist, or 0.32 of the figure); one hip alone is said to be unused |
| `chest` | its rule, half way from neck to hip, taken along the line between the placed ends | the rule as before when neither end is a joint |
| `sleeve_<s>` | `<s>_shoulder` → `<s>_elbow` (two links), tip at `<s>_wrist`, with the two-blob rule's first two amplitudes and its chest stub laid along the upper arm — when every handwear part over 500 px holds one such wrist within 15 px of its art | the sleeve rule places every sleeve chain, and each arm joint's note says why |
| `eye_<s>`, `head`, the face box | not moved: they are measured off the parts | the note prints the eye joint's distance from the eye bone, with no bar |

Every other joint (`nose`, knees, ankles, ears; the eyes with no eyewhite) is named
with its state in one note: no bone is authored from it. Every joint the proposer
could use gets its own note — `used as given for bone X`, `used as the producer's
estimate for bone X`, or `missing: the rule "…" placed bone X instead` — after every
note the rules wrote. LINT then reads the torso by the relations the joints declare:
where `neck`, `r_hip` and `l_hip` all have a position, along the line from the neck
to the hips' midpoint the chest must fall strictly between them, the hip past the
chest, and the hip nearer the hips than the neck — these replace the two screen-y
torso lines; and each `sleeve_<s>` chain's links and tip must advance from
`<s>_shoulder` toward `<s>_wrist`. The first lines say which rule set ran and on what
basis (`lint rule set: joints …` or `lint rule set: screen — …`). The off-art check is
unchanged, and `--from-config … --keypoints` lints a corrected config the same way.
Without `--keypoints` nothing changes, byte for byte. Two rules still read the screen
under keypoints and are not this file's to change: the skirt chains hang down from
the hip, and a part no rule claims rides the trunk bone its centre is nearest by y.

**A figure with no `face` part** (turned away, or half hidden behind a partner,
so See-through found hair and a neck and no face) still gets a proposal. The face
box every rule scales by is derived from the head run's hair (`front hair`,
`back hair`: their highest top) and its `neck` (its top, and its centre x for the
axis): with `L` the span from the hair's top to the neck's top, the face is
1.067 `L` tall, its top 0.131 `L` below the hair's, its width 0.798 of its height.
Those ratios are the means of the two public examples (`demo` 1.073 / 0.105 /
0.820, `sample` 1.061 / 0.158 / 0.777) — a sample of two. On each example
re-assembled without its face, the derived box put `head` and `neck` within
5.0 px (0.038 face heights) of the with-face proposal's, `chest` and `hip` at
the same pixel. The first note says so —
`no face part: face box derived from the head run's hair (…; top y=…) and neck (…), a span of … px — … (ratios measured on the two public examples); …`
— and names each face-reading rule left with nothing to read (eye bones and blink,
brows, mouth). Correct `head` and `neck` against the overlay. With no head-run
hair or neck there is nothing to derive from, and `PROPOSE_FACE_PRESENT` still
refuses (§6).

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

### A contour mesh (`meshes.<part>.contour`, issue #84)

The lattice keeps every grid cell that holds an art pixel, so its boundary and its interior
density are one number: a finer `grid` tightens the outline and densifies the whole part at
once. A contour mesh separates them. Its outline is spine-rigc's own trace of the part's alpha
(`traceAlphaOutline` → `simplifyClosedPolygon(tolerance)` → `offsetPolygon(margin)`), its
interior vertices are the ones declared — each region's boundary, its band's outer edge and its
own `spacing` grid inside region and band, then the background `spacing` grid — and the
triangulation is a constrained Delaunay one that never crosses the outline (`src/contour.ts`).

**Weights.** A region's bone takes `g` at a vertex: 1 inside the region (its edge included),
`1 − d/band` at a distance `d` past it, 0 at `d ≥ band` (with `band` 0, a step) — linear, no
curve. The rest, `1 − g`, is shared among the segment bones exactly as the lattice shares a
vertex (`w = 1/(d + r)²`, at most 4 bones, the 0.03 floor inside that share). A vertex no
region reaches is weighted and rounded exactly as a lattice vertex at the same point would be.
With a region present: a region bone that is also a segment bone is one entry,
`g + (1 − g)·share`; when the segment share already holds 4 bones and the region's bone is not
one of them, the lightest segment bone is dropped (never `g`); the 0.03 floor is not applied
again to the scaled shares; the weights are rounded to 5 places, an entry rounding to 0 is
dropped, and the remainder goes to the heaviest entry, so each vertex sums to exactly 1
(`src/localweights.ts`, `roundShares` in `src/rig.ts`). The 1 and the 0 are decided exactly on
the 1/256 px grid; only a value in between is a floating-point figure. A region's bone counts
as a mesh bone, so an idle key on it moves to `<bone>_ctl` under `--idle-keys ctl` like a
segment bone's.

**What it reports.** `mesh_report.json`'s row for a contour mesh carries `mode: "contour"`, the
parameters it ran at, `src/contour.ts`'s whole report (outline and interior vertex counts,
triangles, coverage, overshoot and its bound, enclosed transparent area, filled-hole pixels, the
smallest angle and largest edge ratio with their triangles, the islands and pixels left out)
and, per region, the vertices its bone reaches (`g > 0`) and holds alone (`g = 1`).
`art_coverage` is over all the part's art, stray islands included. A lattice mesh's row is
unchanged.

**Refusals** — every one names the part, the value found and the value required, and every
contour refusal in a run is listed together; nothing falls back to the lattice:

| rule | means | change |
| --- | --- | --- |
| `CONTOUR_COVERAGE` | an art pixel lies outside the mesh after simplification and the margin | raise `margin` or lower `tolerance` (coverage is not monotonic in the margin — below) |
| `CONTOUR_OVERSHOOT` | the mesh reaches further than `margin + tolerance + 1` px past the art | lower `margin`; on an acute corner rigc's offset moves up to 4 × margin, so a sharp shape has a narrow window |
| `CONTOUR_BUDGET` | more vertices than `budget` | coarser `spacing` or region `spacing`, or a larger `budget` |
| `CONTOUR_ONE_ISLAND` | the art is more than one 4-connected island (every island's pixel count named); with `stray` declared, an island other than the largest above it, or a tie for the largest | `stray`, if the extra islands are stray pixels you accept not drawing; a part that is two pieces stays a lattice part, or is split |
| `CONTOUR_TRACE` | rigc's tracer refuses a diagonal pinch (two art pixels meeting at one corner), in its words | the lattice, or the art |
| `CONTOUR_SELF_INTERSECTION` | the simplified, offset outline crosses itself (a neck narrower than twice the margin), or too few vertices are left | lower `margin` or `tolerance` |
| `CONTOUR_INDEX`, `CONTOUR_GRID`, `CONTOUR_COINCIDENT_VERTICES`, `CONTOUR_ZERO_AREA_TRIANGLE`, `CONTOUR_ONE_LOOP`, `CONTOUR_TILING` | the built mesh fails a topology check (a bug, not an authoring error) | report it |
| `CONTOUR_PART_HAS_ART` | no pixel above alpha 8 | re-run assemble |
| `CONTOUR_PARAMETER` | a parameter `src/contour.ts` cannot run at: a spacing whose keep radius (half of it) snaps to 0, a polygon whose band folds it, a part over 32768 px | the named field |
| `RIG_CONTOUR_REGIONS_OVERLAP` | a vertex two regions both reach (`g > 0`); the detail names the vertex and both regions | move the regions apart or narrow a band |

**The window between coverage and overshoot**, measured in #100 on five generated shapes
(`tools/contour_survey.ts`): the smallest margin that covered every art pixel was 0 at
tolerance 0.5, at most 0.5 px at tolerance 1, at most 0.75 px at 1.5 and at most 1.5 px at 2;
the overshoot bound closes the window from above on acute corners (a two-horned crescent refused
overshoot from margin 1 at tolerance 1, and at tolerance 3 no margin passed); at tolerance 3 a
2 px spike lost its width and no margin brought it back. On the public examples, tolerance 1
and margin 1 built every part that has one island and no pinch (step 2's measurements, in its
pull request).

**When not to use it.** A part that is two pieces (the demo's earring: 411 and 358 px) — keep
the lattice, which bridges islands, or split the part. A part with a diagonal pinch (the demo's
hairpin; on three more of the examples' parts a pinch is what refuses once their stray pixels
are left out) — rigc's tracer refuses it. A part with a neck narrower than twice the margin. And a part
nothing deforms locally: at tolerance 1 the contour outline is dense, and on the examples' parts
the contour mesh used more vertices than the lattice at the same spacing (#100), with thinner
triangles — smallest angles 0.72°–8.28° against the lattice's 12.09°–45° — and a higher
`TEXTURE_STRETCH` severity in the idle (demo 1.388 → 1.677, sample 1.227 → 1.84, ceiling
1.927, with every part that builds switched). The mode is for a part with a declared soft region
inside a stable surround; on the generated fixture of `tools/local_compare.ts` it reached a
local shape error (0.336 px at most, 63 vertices) the lattice reached only at grid 2, with 1025
vertices (`tools/local_compare.ts`'s tables, in step 2's pull request).

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
| `full` | 8 `propose --from-config`, `propose --compare`, `compare` (a side that states a `key`), `rig`, 9 `build` | `key`, `assemble.rig_scale`, `assemble.plan`, `bones`, `meshes`, `regions`, `motion` | for `build`, the `assemble` row's too: its assemble stage reads through that loader after this one |

A missing field is `CONFIG_FIELD_PRESENT` naming it; a missing `generation` names
the fields the block holds, and a missing `assemble.plan` names
`assemble --propose-plan`, which prints one. `build` runs `rig`, so it asks the
full loader before its assemble stage writes anything.

0. **The painting (optional).** `spine-parts comfy paint --config config.json --out inputs --host <url>`
   generates `painting_<seed>.png` on a ComfyUI box; any other route to a painting
   skips this step and leaves `generation` out. Config: the `paint` row.
1. **The full image.** `spine-parts inputs --source inputs/painting.png --config config.json --out inputs`
   writes `st_input_full.png`, the painting centred on a white square of its longer
   side: white left and right of a portrait painting, above and below a landscape
   one. The pad is See-through's input only; `propose --head-box` and `assemble` map
   the full run back through it, so the rig stays in the painting's pixels — unlike
   a painting padded to a square by hand, whose padding becomes part of the rig.
   Config: the `layers` row, `head_box` not yet. A translucent painting is refused
   (`INPUTS_PAINTING_OPAQUE`).
2. **See-through, full run** (external).
3. `spine-parts layers inputs/layers/full` — read it. A refusal here is about the
   files, not the art (§6, *Reading the inputs*). A `WARN` line is about the art: a
   layer See-through made that is not plausibly part of the figure, which step 6
   leaves out (§6, *Plausibility*). It refuses nothing.
4. `spine-parts propose --head-box --full inputs/layers/full --canvas <W>x<H>` →
   `seethrough.head_box`. Run `spine-parts inputs` again: it now also writes
   `st_input_head.png`, the painting cropped to that box at its exact size.
5. **See-through, head run** (external), on that crop. See-through's own second,
   head stage does not replace it: that stage's layers are pasted back at the full
   run's scale on every route that was read (README *Getting See-through layers*),
   so the full run's eyes stay at its density — 22×13 px for the demo's right eye
   white at `resolution` 1024, against 60×38 px in the head run.
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
   `bones`, `meshes`, `regions` and `motion` into the config. Then read what
   was looked at. After the LINT summary, one `coverage <bone> [<role>]:` line
   per bone says `checked, clean` (and which checks read it), `checked, LINT`,
   or `not checked` and why — its role (a `control` binds nothing and may sit
   off the art by design; the role is `src/structure.ts`'s, as `compare`
   prints it), a single bone named as a segment or an explicit
   `[bone, from, to]` segment (the off-art check reads only chain links), a
   region, a mesh that names no part, a torso bone absent, a chain the joints
   declare no line for — and a `coverage:` summary counts the three apart.
   A `not checked` bone is one nothing verified: look at it on
   `landmarks.png`. `work/basis.json` (spec `spine-parts-basis/1`) says, per
   proposed bone, what its origin and its stated tip rest on: `joint` (which,
   with its state and score as the keypoint file declared them), `mask` (which
   part, which measure), `ratio` (which rule, which constants) or `derived`
   (which bones), and `fallback` when a rule stood a value in because what it
   reads was empty; `frame` says where the face box, the eye axis and line,
   the figure and the torso came from. A `ratio` bone or one with a
   `fallback` is a guess to check first. Add `--compare config.json` to have
   each bone also say whether the config's differs (origin, tip, parent, in
   px) or is `proposal only`, and `config_only` list the bones the proposal
   lacks. No confidence is computed. Config for
   `assemble`: the `assemble` row — no rig section yet, because this `propose`
   drafts them from the parts `assemble` writes.
   For a posed figure (seated, reclining), add `--keypoints keypoints.json` (and
   `--person <id>` when the file holds more than one person): the joints it gives
   place the neck, hip, chest and sleeves (§3, *A posed figure*).
8. Correct, then `spine-parts propose … --from-config config.json` to redraw the
   config's own bones and LINT them — every chain link against its mesh's art, and
   the single bones `hip` and `chest` against each other and the figure (a config
   without them prints a `note:` that those lines did not run); repeat until it
   prints no LINT line (exit 0). Add the same `--keypoints` to lint by the joints.
   Config from here on: the `full` row.
   `spine-parts compare --left work/proposal.json --right config.json` says what the
   correction changed, bone by bone: each origin, parent, tip, length and direction
   as its own figure, and the bones renamed, added or removed by name (§5). It reads
   no parts and no painting, and fails only on a bone a `--map` file's `required`
   list names that is missing (exit 1). A proposal is read under the loader's own
   rules for `bones`, `meshes`, `regions` and `motion`.
9. `spine-parts build --config config.json --source inputs/painting.png --full … --head … --out out [--loop]`
   — assemble, rig and check in one process. `propose` is not part of it, on purpose:
   a proposal is a draft, and the config you corrected is the input.
   `--idle-keys direct` is forwarded to the rig stage as `rig` takes it; a config
   with a two-bone ik over chain links the idle keys needs it (§3, `constraints`).
   `spine-parts compare --left config.json --right out/rig/rig.json` reads the rig
   the build wrote against the config it came from: the rig's stage carries it into
   rig px, so every origin reads 0, each chain link's tip, length and direction its
   config's, and every `<bone>_ctl` the rig stage inserted is the bone between a
   keyed mesh bone and its parent (§5).
10. **What a scene requires (optional).** When the motion a scene asks of the rig
    is known — a hand that stays on a cup, a sleeve that takes half an arm's turn, a
    joint that must stay inside a range — write it into a
    `spine-parts-requirements/1` file and hand it to `check` (or `build`):
    `spine-parts check --rig out/rig --parts out --out out/scene --requirements scene.json`.
    Every bar in it is yours; `check` supplies none, solves nothing and poses every
    frame through spine-rigc (§7, *Declared requirements*). A rig composed of
    several characters is measured the same way, `--rig` naming the composed spec.

The selftest runs this order, with the README's flags, on each fetched example from
a config holding only `key`, `seethrough` and `assemble.rig_scale`, pasting each
proposal in as the steps above say (`RL01`); every step must exit 0.

## 5. After each stage: what to read

| stage | read | green looks like | a common red |
| --- | --- | --- | --- |
| `layers` | the table, then the `WARN` lines | every tag the plan will need has opaque pixels; one `face` in the head run; `0 WARN line(s)` | a run whose layer PNG is not its box's size (`LAYERS_PNG_MATCHES_BBOX`); a `WARN  PLAN_LAYER_…` line (§6, *Plausibility*) |
| `sheet` of both runs | the tile list (and the sheet, if you can see) | eyes, irises, lashes and brows as left/right pairs in the head run | a head box that cut off an ornament: move `head_box`, re-run the head crop |
| `assemble` | one line per part, the `pixels:` totals (opaque = visible + occluded; taken; visible but not projected), then `recomposite vs source: mean \|d\|, within 8, error px > 40, uncovered error px`, then `uncovered holes (8-connected): N` and the largest five as `uncovered hole K: <px> px at x,y wxh (between "<part>" <px> px, …)`; and look at `render/recomposite_error_rig.png` | on the examples: `sample` 0.84 / 98.0 % / 4,512 / 1,185, 259 holes, the largest 94 px; `demo` 2.39 / 95.8 % / 11,050 / 1,564, 453 holes, the largest 70 px (default rule) — many slivers along part edges, no hole a region could hide | one large hole: part of the figure is in no layer — a plan entry is missing, hair left the head crop sideways (the demo's `hair_back` is taken from the full run for that reason), or See-through split one garment into two and left the space between them in neither (a skirt as two trouser legs); the `between` parts say where. When neither run holds it at all, an `assemble.patches` entry cuts it from the painting (below) |
| `propose` | `note:` lines, `LINT` lines, the `coverage` lines, `landmarks.png`, `basis.json` | no LINT line: every chain link lies on its mesh's art, and the hip is below the chest and the figure's top quarter; the `coverage:` summary says how many bones that verdict covers — a `not checked` bone was read by no check (its line says why), and a `ratio` or `fallback` bone in `basis.json` is a guess | a link off the art (a bone on the background) — move it onto the layer; `LINT hip at [x, y] is not below chest at [x, y]: …` or `LINT hip at [x, y] is above 0.25 of the figure height (figure y T..B, so hip y must be at least L): a hip at the shoulders` — move `hip` down to the waist (and `chest` between it and the neck); a `hanging strand … -- no chain proposed` note — that strand hangs stiff until you add a chain down the x and rows it names (§3); a `no blink: …` or `blink without brows: …` note — the idle will not blink (or its brows will not drop), because no part came from an `eyewhite` (or `eyebrow`) layer; the note names the tags looked for; a `no eyewhite part for eye_<s> …` note — the iris and lash parts it names ride `head` and do not blink, because no `eyewhite-<s>` part made that side's eye bone: take the eyewhite from the other run, or keep them on `head`; a `no face part: face box derived from …` note (always the first) — `head`, `neck` and every face-height scale come from a box guessed off the hair and neck (§3): check `head` and `neck` on `landmarks_head.png` and move them; when it adds `the blink shuts the eyes over no face part`, read `BLINK_NO_HOLE` after `check` — an eye with no face under it can open a hole (the `sample` with only its face removed: 587 px). Under `--keypoints`: the `lint rule set:` line first (joints, or screen and why), then the joint notes — `missing: the rule "…" placed bone X instead` is a bone still guessed; `not used — …` names why an arm's joints did not place its sleeve; `LINT chest at … is not between the neck joint …`, `LINT hip at … is not past chest …`, `LINT hip at … is nearer the neck joint …` and `LINT <chain><i> at … does not advance from <s>_shoulder toward <s>_wrist` are the joint-frame lines: move that bone between, past or along the joints they name |
| `compare` | one line per pair (origin, parent, tip, length, direction — or SKIP and why), then the per-row summary, the unmapped bones of each side, `required:`, each side's roles and the `controls:` line | proposal against the config you corrected: the rows you changed and no others. Config against the `rig.json` `build` writes for it: measured on both examples, every origin within 6.19e-7 px (the rig's offsets are written to 6 places) and every chain link's tip and length within 4.99e-4 px (`length` is written to 3), printed to three places as `0.000` (a signed figure as `+0.000` or `-0.000`); `parent … is the right's ancestor at depth 2, <bone>_ctl between` for every keyed mesh bone, no `DIFFERENT` and no `NOT MAPPED` | `parent DIFFERENT: left a, right b` — a bone hangs from another parent than the other side's; `frames not related` — a rig with no stage (`skeleton.width`/`height`), two configs at different `rig_scale`: the distance rows SKIP, so declare the frame in a `--map` file if the author knows it; `FAIL  STRUCTURE_REQUIRED_PRESENT` — a bone the map requires is missing through its pairs |
| `rig` (inside `build`) | one line per mesh: vertices, triangles, bones, influences, `cover`; the `bones` line; the `idle keys` line; then rigc's gate lines (with A15's declared SKIP under `--idle-keys direct`); in `rig.json`, each chain link's (or its `_ctl`'s) `length` and `rotation` | `cover 1.00000` on every mesh, both gate summaries `0 failed` (the compile and the packed pages); every link's `length` the distance to the next link and `rotation` its direction (Spine degrees, counter-clockwise, y up, local to the parent), every offset under it — a child bone's `x, y`, a weight's bind `x, y`, a region's `x, y` — in that turned frame, and a region on a link carrying `rotation` that turns it back upright. Nothing moved: `flattenRig` (`src/rig.ts`) turns every offset back and gives the unturned numbers | `RIG_LATTICE_ONE_LOOP`: change that mesh's `grid` |
| `check` (inside `build`) | the gate lines verbatim, the pack line, `loop:`, `seam:`, the six judgement lines, `RECOMPOSITE_HOLES` and, under `--source`, `SETUP_POSE_VS_SOURCE` (§7), `check.json`; the last line says how many of the nine bars measured and names the ones that said SKIP | `check: PASS; 9 of 9 bar(s) measured, 0 skipped` on the examples, and a judgement line SKIP only where the character lacks what it reads; on a rig spec with no `parts.json` or no `idle` (a merged rig, §7 *Measuring a rig spine-parts did not assemble*), PASS with the skipped bars named | `CHECK_SEAM_WITHIN_BAR` or `CHECK_LOOP_CLOSES` (§6) |
| `check --requirements` (and `build --requirements`) | after the lines above, one line per declared requirement, `NAME: PASS`, `FAIL` or `NOT MEASURABLE — …` with its figures, the bar as declared and the worst frame; then `requirements: N declared — M measured (P PASS, F FAIL), K NOT MEASURABLE; not declared: <kinds>`; `check.json`'s `requirements` block; the renders under `requirements/` (§7, *Declared requirements*) | every line PASS and `0 NOT MEASURABLE`; a follow's `released_copy` says whether rigc's consumer-driven door was taken on the throwaway copy | `CHECK_REQUIREMENT_MET` (a figure past its bar; the line names the frame) or `CHECK_REQUIREMENT_MEASURABLE` (the quantity is undefined in the frames: a tip or an axis on a bone of length 0, an aim with no line, a follow no frame of which reaches its least drive); the last line then reads `check: FAIL — B bar(s) not met, R declared requirement(s) not PASS` |
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
13,645,503 B lossless, 1,706,719 B indexed and 1,812,288 B GIF, both palette files at
max 57, mean 1.601 — the two share one quantiser, so their error is the same by
construction and the size is the difference. That is `--seam silhouette` (the README's
animation, spine-rigc 2.1.3, and 2.10.1 to the byte); with `--pack-shape rect` the same
build writes 13,645,350, 1,706,520 and 1,812,238 B, and with `--page-edges pot
--pack-shape rect` 13,645,519, 1,706,785 and 1,812,625 B, all at the same error (2.10.1
reproduces both). The loop shows the blink closed: the
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

**Page edges.** `rig`, `check` and `build` pack through `rigc build --pack
--page-edges <v>`, and hand the value to rigc verbatim. The default is `free`,
the least-area page the parts need. `--page-edges pot` is the opt-out: a power of
two on both edges, which is the page every build wrote before this flag. The pack
line says which one ran, because rigc writes `, page edges free` after the padding under
`free`. Measured on the two examples by `tools/atlas_population.ts` with rigc 1.5.1, and
again with rigc 2.0.3, 2.1.3 and 2.10.1 under `--pack-shape rect` (the frames table
by the same idle render), which reproduced every figure in both tables and the one
check figure below (2.10.1: pages, atlases, idle frames and `check.json` byte-identical
to 2.1.3's):

| build | page | covered | page opaque | page / figure |
| --- | --- | --- | --- | --- |
| demo, `pot` | 1024x2048 | 56.3 % | 36.8 % | 2.651 |
| demo, `free` | 967x1338 | 91.2 % | 59.7 % | 1.636 |
| sample, `pot` | 512x2048 | 49.7 % | 28.7 % | 3.294 |
| sample, `free` | 479x1166 | 93.4 % | 53.9 % | 1.755 |

rigc's help states the cost: *"a smaller page, at the cost of region attachments
sampling within 1 LSB of the loose build rather than exactly"*. On these builds
every one of the 49 idle frames differs from the `pot` build, by at most 1 level
in any channel:

| example | idle frames that differ | pixels that differ (all 49 frames) | max \|d\| |
| --- | --- | --- | --- |
| demo | 49 of 49 | 2,373 | 1 |
| sample | 49 of 49 | 651 | 1 |

Only one check figure moved. It has no bar: sample's reported screen-space face
mean in `STILL_REGIONS_DARK`, 11.475 under `pot` and 11.472 under `free`. Every
barred figure and every status is the same under both. The atlas rigc writes says
`filter: Linear, Linear` and has no `repeat` line, so choose `pot` for a consumer
that mipmaps or repeats the page.

**Pack shape.** `rig`, `check` and `build` also hand rigc `--pack-shape <v>`
verbatim (spine-rigc 2.1.0 and later). `rect` keeps every region's cell apart, the
only packing before 2.1. `polygon`, the default here (rigc's own is `rect`), packs a
region that only meshes draw by its emitted hull, so a neighbour may sit inside its
rectangle where the hull is not, with the padding kept between footprints; a region
attachment stays its rectangle. rigc gates the result on the packed pages with
`A49_PACKED_FOOTPRINTS_DO_NOT_OVERLAP` (SKIP on the compile pass, where every part has
its own page; PASS on the packed pass, both shapes, both examples). The pack line ends
`, shape rect` or `, shape polygon` under either, and `check.json`'s `pack_mode` records
both flags. Measured on the two examples with spine-rigc 2.1.3, and again with 2.10.1,
whose pages, atlases, idle frames and `check.json` are byte-identical to 2.1.3's under
both shapes and both edges (the full entry, spine-core 4.3.13 beside it),
`spine-parts build` with `--page-edges free` and each shape, the table columns by
`tools/atlas_population.ts`:

| build | page | page area | covered | page opaque | page / figure |
| --- | --- | --- | --- | --- | --- |
| demo, `rect` | 967x1338 | 1,293,846 | 91.2 % | 59.7 % | 1.636 |
| demo, `polygon` | 922x1348 | 1,242,856 (−3.9 %) | 95.0 % | 62.1 % | 1.571 |
| sample, `rect` | 479x1166 | 558,514 | 93.4 % | 53.9 % | 1.755 |
| sample, `polygon` | 477x1151 | 549,027 (−1.7 %) | 95.0 % | 54.8 % | 1.725 |

Covered is Σ region rectangles over page area, as rigc prints it; under `polygon` the
rectangles may overlap where a hull leaves room, so it is not a union and can exceed
100 %. Page opaque is the measure of what the page holds. Under `--page-edges pot` the
shape changes nothing on these two examples: both shapes write 1024x2048 and 512x2048,
and the idle frames are identical.

The cost, from `rect` to `polygon` (the idle `check` renders, `rigc render --animation
idle --fps 12 --max 640`, compared frame by frame, max over R, G, B and A):

| example | idle frames that differ | pixels that differ (all 49 frames) | max \|d\| |
| --- | --- | --- | --- |
| demo | 49 of 49 | 2,594 | 1 |
| sample | 49 of 49 | 740 | 1 |

That is the class `free` already costs (the table above, measured by the same
comparison), a little larger. No figure in `check.json` moved but `pack_mode`: every
bar, every status and every reported figure is the same under both shapes.
`--pack-shape rect` gives back the page and atlas 0.7.0 wrote: on both examples
they are byte-identical to rigc 2.0.3's `--page-edges free` build of the same rig (the
skeleton JSON differs only in its relative `images` path), and selftest `CK53` holds
`rect` to rigc's own rectangle page.

The hull ceiling (spine-parts #58: hull area over rectangle area, 0.812 on demo and
0.814 on sample) is not what the packer realises here: the hollows inside the meshes'
rectangles are worth only what fits into them. On the polygon pages, read off the
atlas, demo's packed rectangles overlap in 21 pairs (17 a region attachment inside a
mesh's rectangle, 4 a mesh inside another's) and sample's in 12 (10 and 2); no two
region attachments overlap. Meshes in place of regions would be rigc's stage 2 of
polygon packing (firejune/rigc#1093), which rigc measured and folded: on the three
production rigs most favourable to it, it adds 0.15 % of the rectangle area over
stage 1 at tolerance 0, and nothing at the mesher's tolerance 1 or under `pot`; on
these two examples −0.3 to −1.3 points. No build converts a region attachment.

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

**`rig --idle-keys ctl|direct`** (and `build --idle-keys`, which forwards the
value to its rig stage; without the flag, or with `ctl`, a build writes and prints
what it did before `build` took the flag). spine-rigc's `A15_IDLE_NO_MESH_BONE_KEYS`
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
bone. No stage runs `validate`: the gate is `rigc build`, which reads the rig spec
and its declaration, and is green on both (`RG19`).

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
| `CONFIG_KEY_KNOWN`, `CONFIG_KEY_RETIRED`, `CONFIG_FIELD_PRESENT`, `CONFIG_FIELD_TYPE` | an unknown key (a retired one says what replaces it), a missing one, a wrong type; a project's own record under a plain key, or an annotation (`note`, `<name>_note`) holding something other than a string | the named field; a record goes under a key beginning `x-` (any JSON, read by nothing), a remark under `note` or `<name>_note` (a string) — §3 |
| `CONFIG_HEAD_BOX_SQUARE` | `seethrough.head_box` is not a non-empty square | `head_box` — take `propose --head-box`'s |
| `CONFIG_TAG_KNOWN`, `CONFIG_PART_NAME`, `CONFIG_PART_UNIQUE` | a plan entry names no v3 tag, a part name that is not a file name, or a part or layer twice — a patch named like a plan part or another patch included | `assemble.plan`, `assemble.patches` |
| `CONFIG_NAME_RESOLVES` | a parent, segment, region, track, blink member, blink still part or bone, extend part or patch `draw.before` names nothing declared above it; or a constraint's `bones`, `target`, `source` or `bone` names a bone `bones` does not declare (the detail names the constraint and lists the bones that exist) | the named reference, or the declaration it needs |
| `CONFIG_BONE_UNIQUE` | a bone or chain declared twice, or `root` declared | `bones` |
| `CONFIG_PART_ATTACHED` | a plan part with neither or both of a mesh and a region; a patch with a mesh, or with no region | `meshes` / `regions` |
| `CONFIG_PATCH_BOX` | an `assemble.patches` box with `x1 <= x0` or `y1 <= y0` | that patch's `box` (`x1`, `y1` are exclusive) |
| `CONFIG_AMPS_MATCH_CHAIN` | a chain track's `amps` is not one per link | that track's `amps` |
| `CONFIG_PERIOD_DIVIDES_DURATION` | a period that is not a whole fraction of the idle — the loop could not close | that track's `period`, or `motion.duration` |
| `CONFIG_BLINK_GROUP_MEMBERS` | `motion.blink.eyes` or `motion.blink.brows` is `[]`: a group with no members, which rigc refuses at the gate | a figure with no eyewhite part has nothing to blink: leave `motion.blink` out; one with no eyebrow part: leave `brows` and `brow_drop` out |
| `CONFIG_BLINK_GROUP_UNIQUE` | `motion.blink.eyes` or `motion.blink.brows` names one bone more than once; the detail gives the bone and every index it sits at. rigc refuses it at the gate (`group "eyes" names member "eye" twice`) | name each bone once: the group keys every member it names |
| `CONFIG_BONE_PROPERTY_KEYED_ONCE` | two tracks key one bone property: two single tracks, a single track on a chain link's `rotate`, or a single track on a blink member's `scaley` (`eyes`) or `translatey` (`brows`); the detail names the property and every track by its config path. rigc refuses it at the gate (`animation "idle" has two tracks on eye.scaley; merge them into one track`) | merge them into one track, or key another property or bone |
| `CONFIG_BLINK_BROWS_PAIRED` | `motion.blink.brows` without `brow_drop`, or `brow_drop` without `brows` | state both or neither |
| `CONFIG_STILL_OFF_THE_BLINK` | a `motion.blink.still` entry names a region on a bone the blink's `eyes` does not name (nothing to hold still), or its `bone` is one the blink's `eyes` names (the still piece would blink) | that entry's part, or its `bone` — the eye bone's parent, `head` as proposed |
| `CONFIG_CONSTRAINT_TYPE_KNOWN` | a `constraints` entry's `type` is not one of spine-rigc's five: `ik`, `transform`, `path`, `physics`, `slider` (spelled as rigc spells them; `IK` is not `ik`) | that entry's `type` |
| `CONFIG_CONSTRAINT_NAME_UNIQUE` | two `constraints` entries of one kind share a `name`; rigc finds a constraint by its kind and its name, so an ik and a transform may share one | rename one |
| `CONFIG_IK_BONES_PARENT_AND_CHILD` | an ik's `bones` are two bones of which the second is not the first's child, or more than two. spine-core's solver applies one bone or two (`IkConstraint.update`), and its two-bone solve places the second bone as the first's child (`apply2`): measured through spine-rigc 2.10.1, such an ik gates green and leaves the tip 15.6 to 17.3 rig px off its target in every frame, and a three-bone ik gates green and moves nothing | one bone (an aim), or a bone and its child |
| `CONFIG_CONSTRAINT_TARGET_DETACHED` | the bone an ik follows (`target`) or a transform reads (`source`) is one of the bones that constraint drives, or sits under one (the detail gives the line of parents) — driving them would move what they follow | a bone beside the chain; a scene target is a single bone parented to `root` (§3) |

### inputs

| rule | means | change |
| --- | --- | --- |
| `INPUTS_SOURCE_PRESENT` | no such painting | `--source` |
| `INPUTS_PAINTING_OPAQUE` | the painting has a pixel below alpha 255 | the painting |
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
| `HEADBOX_FACE_PRESENT`, `HEADBOX_RUN_SQUARE`, `HEADBOX_CANVAS_SIZE`, `HEADBOX_FITS_CANVAS` | the full run has no face or is not square; `--canvas` is not a positive size; or the painting cannot hold the proposed box at its size — its shorter side is the bound (shrinking it would cut the head) | `--full`, `--canvas`, or the painting |
| `PROPOSE_SOURCE_PRESENT`, `PROPOSE_PNG_PRESENT`, `PROPOSE_PNG_MATCHES_BOX` | the painting or a part PNG is missing, or a PNG is not its box | `--source`, `--parts` (re-run assemble) |
| `PROPOSE_FACE_PRESENT` | no part comes from a `face` layer, and the face-less fallback cannot derive a face box either: it needs the head run's `neck` and at least one head-run `front hair`/`back hair` part whose top is above the neck's, and the message names the half that is missing. With both, `propose` does not refuse — it derives the box and says so in its first note (§5) | `assemble.plan`: take the face, or the head run's hair and neck |
| `PROPOSE_ACCESSORY_BODY` | an accessory has nothing above its pendant rows to hang its bone on | that part's plan entry, or author its bones by hand |
| `KEYPOINTS_FILE_PRESENT`, `KEYPOINTS_IS_JSON`, `KEYPOINTS_KEY_KNOWN`, `KEYPOINTS_FIELD_PRESENT`, `KEYPOINTS_FIELD_TYPE` | the `--keypoints` file is absent, not JSON, has a key this reader does not know, lacks one of `spec`, `space`, `width`, `height`, `source`, `people`, or holds a value of the wrong type (a size that is not a whole positive px count, an empty `source`, no people) | the keypoint file (§3, *A posed figure*) |
| `KEYPOINTS_SPEC_KNOWN`, `KEYPOINTS_SPACE_STATED` | the file is not `spine-parts-keypoints/1`, or states a space other than painting-px, origin top-left, y down | convert the file to that space; it is not read as if it were in it |
| `KEYPOINTS_JOINT_KNOWN`, `KEYPOINTS_JOINT_STATE`, `KEYPOINTS_POSITION_STATED`, `KEYPOINTS_POSITION_INSIDE` | a joint name outside body-18, a state outside observed / occluded / missing, an observed joint with no `at` or a missing one with one, or a position outside the `width`x`height` image | that joint |
| `KEYPOINTS_PERSON_UNIQUE`, `KEYPOINTS_PERSON_CHOSEN` | two people share an id; or the file holds more than one person and no `--person` names one, or `--person` names none of them (the message lists the ids) | `--person <id>` |
| `KEYPOINTS_IMAGE_SIZE` | the file's `width`x`height` is not the `--source` painting's | a file measured on this painting |
| `PARTS_*` (`PARTS_FILE_PRESENT`, `PARTS_IS_JSON`, `PARTS_KEY_KNOWN`, `PARTS_FIELD_PRESENT`, `PARTS_FIELD_TYPE`, `PARTS_NAME_UNIQUE`, `PARTS_FROM_KNOWN`, `PARTS_BOX_INSIDE_RIG`, `PARTS_COUNTS_ADD_UP`, `PARTS_HOLES_LARGEST_FIRST`, `PARTS_HOLE_PART_KNOWN`) | the `parts.json` read is not assemble's contract (`PARTS_COUNTS_ADD_UP`: `visible_px + occluded_px` is not `opaque_px`, `visible_not_projected_px` is above `visible_px`, or the `recomposite` block's figures disagree — more uncovered than error pixels, a hole larger than its box, the wrong number of holes listed, listed areas that do not sum to `uncovered_error_px`; the last two codes are the block's order and its border names, §5) | re-run assemble; do not edit `parts.json` |

### rig

| rule | means | change |
| --- | --- | --- |
| `RIG_PART_PRESENT`, `RIG_PART_ATTACHED` | a `meshes`/`regions` key that is not in `parts.json`, a part with neither, or a `painting:` part with a mesh | the config and the plan must name the same parts; a patch is a region |
| `RIG_PNG_PRESENT`, `RIG_PNG_MATCHES_BOX`, `RIG_PART_HAS_ART` | a part's PNG is missing, the wrong size, or has no art pixel | re-run assemble |
| `RIG_NAME_RESOLVES`, `RIG_SEGMENT_DEFINED`, `RIG_CHAIN_POINTS` | a segment names an undeclared bone, a bone with no `tip` and no next link, or a chain too short to make a link | that bone's `tip`, or write the segment out as `[bone, [x0,y0], [x1,y1]]` |
| `RIG_LATTICE_ONE_LOOP` | the lattice over a part does not close into one outline even after the repair passes | that mesh's `grid` |
| `RIG_CONTROL_NAME_FREE` | a keyed, mesh-weighted bone needs `<bone>_ctl` and that name is taken | rename the declared bone |
| `RIG_KEY_FRAME_UNTURNED` | a `translate` key on a bone whose parent is a chain link turned along its chain, or a `scale`/`shear` key (a track, or the blink's `eyes`/`brows` group) on a turned link: the key would act along the link's axis, not the picture's; the detail names the track, the bone and the turn | key the chain's own parent, or key `rotate`; a link whose turn is 0 (a level chain) keeps every key |
| `RIG_IK_PAIR_UNDER_CONTROL` | under `--idle-keys ctl` (the default), a two-bone ik's second bone is keyed by the idle and weighted to by a mesh, so the rig stage keys it through `<bone>_ctl`, which then stands between the pair: the ik gates green and its tip misses the target in every frame (§3's table) | `--idle-keys direct` on the command that ran — `rig --idle-keys direct` or `build --idle-keys direct`, as the line says — which keys the link in place |
| `RIG_BLINK_INSIDE_IDLE` | the blink runs outside the idle | `motion.blink.t` |
| `RIG_BLINK_HOLD_SPANS_A_FRAME` | the tree's `BLINK.hold` is shorter than one frame at `IDLE_FPS`, so for some `motion.blink.t` no idle frame — and no frame of the loop — shows the closed eye; the detail counts the phases that miss and names the first | nothing in the config: `BLINK.hold` in `src/motion.ts`, at least `1/IDLE_FPS` s (§3) |
| `RIG_STILL_ROW_INSIDE_PART`, `RIG_STILL_ROW_CLEAR`, `RIG_STILL_PIECES_HAVE_ART`, `RIG_STILL_NAME_FREE` | a `motion.blink.still` row that is not strictly inside the part, that crosses art (a cut through art changes the render even at rest), that leaves one piece with no art, or whose `<part>_still` slot name another part already has | that entry's `row` — a row with no art between the crease and the lash line — or rename the other part |
| `RIG_RIGC_GREEN` | spine-rigc refused the rig; its own FAIL or compile-error line is quoted, and nothing was written. A `constraints` field rigc does not read, or a value it refuses, is this line in rigc's words (`constraint "aim" (ik) has a key this compiler does not read: "mixx" (did you mean "mix"?)`), as is `A25_DETACHED_BONE_PARENTAGE` on a declared scene target | the field rigc's line names — spine-rigc's own AUTHORING §5 maps each of its assertions (`node_modules/spine-rigc/docs/AUTHORING.md`) |

### check and build

| rule | means | change |
| --- | --- | --- |
| `CHECK_RIGC_PRESENT` | no `rigc` binary found (every place looked is listed) | `bun install` |
| `CHECK_INPUT_PRESENT` on `…/parts.json` | `--parts` named a directory without `parts.json` — most often `parts/` itself — or, without `--parts`, the rig directory has none while the directory above it does (build's layout, `<out>/rig` under `<out>/parts.json`). The detail says it: "--parts names the directory holding parts.json and parts/, not parts/ itself (after build, that is build's --out, whose rig is <out>/rig); without --parts it is --rig", and names the parent when the parent holds `parts.json`. With neither (no `--parts`, and no `parts.json` beside `rig.json` or above it), the rig is measured without parts and nothing is refused (§7) | `--parts` — the directory above `parts/` |
| `CHECK_INPUT_PRESENT`, `CHECK_INPUT_IS_JSON`, `CHECK_PART_PNG_PRESENT`, `CHECK_PART_PNG_MATCHES_BOX`, `CHECK_PART_SLOT_PRESENT`, `CHECK_RIG_STAGE_PRESENT`, `CHECK_RIG_STAGE_IS_THE_CANVAS`, `CHECK_RIG_ROOT_BONE`, `CHECK_IDLE_PRESENT` | the rig directory is incomplete or disagrees with `parts.json` (`CHECK_PART_SLOT_PRESENT`: a part with no slot of its own name, which the judgement lines render it by). `motion.json` is required even with no animation in it, because `rigc build` takes `--motion` (a spec with `"animations": {}` builds green); `CHECK_IDLE_PRESENT` is an `idle` that is there with no positive `duration` — an absent `idle` is measured around (§7) | re-run rig (`build` does both) |
| `CHECK_SOURCE_SIZE` | the painting `--source` names is not this rig's: no single `rig_scale` takes its width and height to the stage's (assemble makes the canvas `trunc(w × rig_scale)` x `trunc(h × rig_scale)`), or, with `parts.json` read, its `scale_rig_per_source` does not; or the stage is not whole pixels. Refused before anything is built | the painting the rig was made from — the stage's own size, or the painting `assemble` was given |
| `CHECK_SOURCE_PNG` | `--source` names a file that does not read as a PNG | a PNG |
| `CHECK_SOURCE_GRID` | the setup-pose still and its black-tinted twin (the coverage `SETUP_POSE_VS_SOURCE` reads) did not come back on one grid over one opaque background | a rigc problem; report it |
| `CHECK_RIGC_VERSION` | `rigc --version` is below 1.4.0, or prints no version: its `render` has no `--geometry`, which `TEXTURE_STRETCH` reads. Refused before anything is built | `bun install` (this package depends on spine-rigc ^2.10.1), or put a newer `rigc` first on `PATH` |
| `CHECK_RIGC_ENTRY`, `CHECK_RIGC_ENTRY_READS` | `rigc --version` names no entry (a rigc below 2.0.0), or names one in neither launcher form (`entry: cli.ts — @esotericsoftware/spine-core <v> present`, `entry: cli_core.ts — @esotericsoftware/spine-core absent — …`); `check.json`'s `rigc_entry` records the one that gated the build | `bun install` |
| `CHECK_RIGC_GREEN` | a rigc step failed; its line is quoted | as `RIG_RIGC_GREEN` |
| `CHECK_LOOP_LAST_FRAME_AT_DURATION` | the idle's last frame does not sit at `duration` | `motion.duration` — a whole number of 1/12 s |
| `CHECK_LOOP_CLOSES` | frame 0 and the frame at `duration` differ (max and first pixel quoted) | a track whose last key is not its first |
| `CHECK_SEAM_WITHIN_BAR` | the setup pose does not reproduce the flat stack of parts | usually a region or mesh placed off its part; compare with `recomposite_rig.png` |
| `CHECK_BREATH_VISIBLE` | the torso (`topwear`), rendered alone, barely moves over the idle — or the feet (`footwear`), rendered alone, move at all | the chest's breath tracks (`motion.tracks` on `chest`), or the torso mesh's `segments`; for the feet, the bone their region rides (`regions.<part>`, `root` in both examples) |
| `CHECK_BLINK_NO_HOLE` | with the blink held shut, the eyewhite box shows the page where the open eye had art | the layer under the eye: the `face` part has no art there. Take the face from the other run, or add a part under the eye; `motion.blink.squash` only hides the hole less |
| `CHECK_CHAIN_LAG` | a rotate track leads (or does not lag) the keyed bone above it, or a chain link swings less than the link above | that chain track's `phase`/`lag` (a positive `lag`, a child `phase` above its parent's) or its `amps` (non-decreasing toward the tip) |
| `CHECK_TIP_OVER_ROOT` | a `handwear`/`bottomwear` part's lower half travels less than 1.4725 times as far as its upper half | the chain track's `amps` (grow toward the tip), or the mesh's `segments` (the chain must be among them) |
| `CHECK_STILL_REGIONS_DARK` | over the face outline, carried into the frame of the bone the face's slot rides: something moves there that the head does not carry, above twice the resampler's own error on this rig (both figures quoted, with the screen-space one beside them); over the feet, the heat map is brighter than the ceiling | on the face: a mesh over it weighted to a bone the head does not carry (`segments`), or a swinging part (a bang, a chain) whose art crosses the face outline; on the feet: a mesh weighted to a swinging bone, or a region on the wrong bone |
| `CHECK_TEXTURE_STRETCH` | a mesh triangle's edge, in some idle frame, is more than 1.926544 times its rest length or less than 1/1.926544 of it (the mesh, triangle, its three vertices, the edge and the frame are named); or a rest edge has length 0 | the chain tracks' `amps` on the bones that mesh is weighted to (the stretch grows with them), or the mesh's `segments` — a vertex blending two bones that swing against each other |
| `CHECK_SEAM_FRAME_SIZE`, `FRAMES_SIDECAR`, `CHECK_GEOMETRY_FILE` | rigc's render is not what its `frames.json` says, or its `geometry.json` is not a whole `rigc-geometry/1` export of the frames beside it (a frame count, a mesh whose vertex count differs from its rest entry; for the face half, another viewport than `frames.json`'s, other frame indices, the head bone or a feature's bone missing from a frame, a non-finite transform or time) | a rigc problem; report it |
| `LOOP_ENCODE` | the loop encoder refused a frame (translucent pixel in a GIF, a size change) | the frames; for a translucent frame write the lossless or the indexed APNG, which keep alpha |
| `CHECK_PACK_LINE_READS` | rigc printed a `pack:` line that is not `pack: <page> <W>x<H>, <N> region(s), <P>% covered, padding <D>`, then `, page edges free` or nothing, then `, shape rect`, `, shape polygon` or nothing (spine-rigc 2.1 prints the shape; 1.5–2.0 printed none, read as `rect`); an unknown shape is this refusal; the line is quoted | a rigc this package does not know the output of; report it, with `rigc --version` |
| `CHECK_PACK_PAGE_EDGES` | the pack line disagrees with the `--page-edges` the build was run with — its `, page edges free` clause is there under `pot` or missing under `free`, or a `pot` page is not a power of two on both edges | a rigc problem; report it, with `rigc --version` |
| `CHECK_PACK_SHAPE` | the pack line disagrees with the `--pack-shape` the build was run with — it ends `, shape rect` under `polygon` or `, shape polygon` under `rect`, or it has no shape clause (the 1.5–2.0 form, read as `rect`) under `polygon` | a rigc older than 2.1.0 on `PATH`: rigc 2.0.3 takes `--pack-shape` without a word, packs by rectangles and prints the form with no shape clause, so this refusal is what catches it — `bun install` (this package depends on spine-rigc ^2.10.1); otherwise a rigc problem, report it with `rigc --version` |
| `BUILD_ARTIFACT_PRESENT` | the packed build lacks its `.json`, `.atlas` or page | a rigc problem; report it |
| `REQUIREMENTS_FILE` | `--requirements` names no file, or one that does not parse as a JSON object. Refused before anything is built (by `build`, before assemble) | the path of a `spine-parts-requirements/1` file |
| `REQUIREMENTS_FIELD` | a field of the file is missing, of the wrong type, or not one the format reads: `spec`, `fps` (no default), `requirements`, each requirement's `name` (letters, digits, underscores; once each), `kind`, `animation` and its kind's fields — every bar among them (`within_px`, `fraction`, `tolerance`, `least_drive` above 0, `within_degrees` from 0 to 180, `lo_degrees` ≤ `hi_degrees`, `within_ratio` ≥ 1) — and each target's `bone`, `animation` and exactly one of `at` and `keys` (times strictly increasing). `note`, `*_note` (strings) and `x-…` (any value) are read by nothing, as in the config | write the field; the bar is yours |
| `REQUIREMENTS_RESOLVES` | a bone, an `ik` or `transform` constraint (by name and `constraint_type`, as spine-rigc resolves it), a slot, a mesh attachment or an animation the file names is not in `rig.json` or `motion.json` — the detail lists the ones that are; or an animation whose name cannot be a directory. Refused before anything is built | the name as the rig spells it |
| `REQUIREMENTS_CONSTRAINT_DRIVES` | a `follow` names a bone its constraint does not constrain, or a property it does not drive: an `ik` drives `rotate` only; a `transform` drives `rotate` when a `to` names `rotate`, `translate` when one names `x` or `y` | the constraint's own bone and property |
| `REQUIREMENTS_TARGET_PARENT` | a scene target's bone is the root or is not parented to it, or the root is not at rest at the origin, or the animation keys the root — a stage point is a bone's position only under a root that stands still at the origin | a bone under the root for the scene to place |
| `REQUIREMENTS_TARGET` | a scene target places one bone twice for one animation, places it for an animation no requirement measures, has a key outside the animation's `[0, duration]`, or sits in a group the animation translates | one placement per bone and animation, inside it, for an animation a requirement reads |
| `CHECK_REQUIREMENTS_FRAMES` | a requirement render did not write every frame rigc sampled, or the as-declared, released and full renders of a follow sampled different frames | a rigc problem; report it |
| `CHECK_REQUIREMENT_MET` | a declared requirement measured outside its bar; the figure, its frame and the bar are quoted | the rig or its motion (§7, *Declared requirements*) — or the bar, if the scene asks less |
| `CHECK_REQUIREMENT_MEASURABLE` | a declared requirement is NOT MEASURABLE: what it asks is undefined in the frames, and the reason is quoted. Not a pass | the declaration (a bone with a length, a target off the bone's origin, a least drive the constraint reaches) or the rig |

## 7. The bars `check` enforces, and what only an eye answers today

`check.json`'s `PASS` is true exactly when all of these hold (the reference
implementation's bars) — each one that measured; a rig with no `parts.json` or no
`idle` skips the ones that read it, by name (*Measuring a rig spine-parts did not
assemble*, at the end of this section):

- `gate_spine-html.txt`: every summary line `(N passed, 0 failed)` — the packed build
  under the `spine-html` profile, gated once over the compile and once over the packed
  pages on disk. There is no `spine` gate of its own: `spine-html` holds every rule
  `spine` measures (on the demo, rigc 1.5.1 and 2.0.3: `validate --profile spine`'s 14
  measured rules are all among the build's 23, the 15 others not in `spine`; rigc
  2.1.3 and 2.10.1: the same 14 among the build's 24, which adds
  `A49_PACKED_FOOTPRINTS_DO_NOT_OVERLAP` on the packed pass, 16 not in `spine`; `CH09`
  holds it on every fetched example);
- **seam**: the setup-pose render against the flat composite of `parts/`: mean
  max-channel |d| ≤ 1.0 of 255, and at most 50 pixels over 40;
- **loop**: idle frame 0 against the frame at `t = duration`: max |d| exactly 0.

On the examples: `sample` 23/23, seam 0.207 with 0 pixels over 40, loop 0;
`demo` (default rule) 23/23, seam 0.326 with 2 pixels over 40, loop 0.

A green gate cannot see a wrong animation, so `check` also writes six **judgement
lines** (issue #11; `TEXTURE_STRETCH`, issue #31), each a key of `check.json` and a console line
`NAME: PASS|FAIL|SKIP — <figures and bars>`, read the same way as the lines above: a
FAIL makes `PASS` false and prints its own `FAIL  CHECK_<NAME>` line (§6); a SKIP
says why the rig gave the line nothing to read, and is neither a pass nor a failure —
report it as not verified. Every region is chosen by the See-through tag in
`parts.json`'s `from`, never by a part's name. Heat is a pixel's largest per-channel
change from idle frame 0, in levels of 255, on the idle's 640-pixel grid.

Each bar follows one rule: a floor is half the weaker example's figure and a ceiling
twice the worse one's, so the weaker example clears it by a factor of two; a bar the
model itself fixes (a part on an unkeyed bone does not move, a lag is above 0, a hole
is 0 pixels) is that value, not a margin — and where the model's value is an error
the rig itself measures (a face the head carries is still in the head's frame up to
the resampler's error), the bar is that measurement times the same two. A bar is set once, from the figures of the day it was set, and is not chased: the torso floor 3.809 is half of sample's 7.618, which reads 7.617 since the chain links are turned (issue #73), a factor of 1.9997. The figures are this port's, measured on
the two examples [observed]:

| line | measures | bar | `demo` | `sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| `BREATH_VISIBLE` | `topwear` parts rendered alone (`rigc render --slot`): heat mean over their box; `footwear` parts alone: heat max over theirs | torso mean ≥ 3.809; feet max ≤ 0 | 15.251; 0 | 7.617; 0 | no `topwear` or no `footwear` part |
| `BLINK_NO_HOLE` | the setup pose with every `scaley` track on the eyewhite slots' bones held at its closed value, against the setup pose, at full size: pixels in the eyewhite box that show the page where the open eye had art | 0 px | 0 | 0 | no `eyewhite` part, or no `scaley` track on its bones goes below its first key |
| ″ (reported) | the same box: each closed-eye pixel's max-channel distance to the nearest colour the open eye's box holds — max, and pixels over 40 | none | 15; 0 | 11; 0 | as above |
| `CHAIN_LAG` | `motion.json`'s rotate tracks read as sines (DFT of the keys: period, amplitude, phase) and arranged by the bone tree — a keyed bone's parent is its nearest keyed ancestor | every lag ≥ 0.001 cycle; amplitude non-decreasing down each unbranched chain | lags 0.040 (neck to head) to 0.120; 12 chains | lags 0.040 to 0.100; 9 chains | no rotate track under another of the same period |
| `TIP_OVER_ROOT` | each `handwear`/`bottomwear` part alone: how far the centroid of its art travels in the lower half of its box against the upper half | ratio ≥ 1.4725 | `bottomwear` 2.945, `sleeves` 3.716 | `bottomwear` 4.396, `sleeves` 12.475 | no such part |
| `STILL_REGIONS_DARK` | the face outline **in the head's own frame**: each idle frame sampled (bilinear) where the head bone has carried each setup-pose pixel of the region, the heat taken over those samples. The head bone is the bone the `face` parts' slot rides in `rig.json`, and its per-frame world transform is `rigc render --geometry`'s. The region is the frame pixels whose whole footprint — 1 + 1/scale rig px each way, what the rasteriser's and this sampler's bilinear taps can reach — is `face` on top of the flat stack, clear by that reach of where `eyewhite`, `irides`, `eyelash`, `eyebrow` and `mouth` go in the head's frame over the idle. `resampler_heat_mean` is the same figure off the whole rig moved rigidly as the idle moves the head (the root keyed to the head's motion, every other key dropped), where every pixel is still in the head's frame by construction. `screen_heat_mean`/`max` over `screen_px` are the screen-space figures this line held until issue #33 (where `face` is on top, less the features' setup boxes), reported. The feet (where `footwear` is on top): the idle's heat in screen space — they ride the root, which the idle does not move, so the screen is their own frame | face `head_frame_heat_mean` ≤ 2 × `resampler_heat_mean` (`mean_ceiling`); feet mean ≤ 3.244 | face 1.321 ≤ 2.292 (resampler 1.146; screen 16.988); feet 1.622 | face 0.884 ≤ 1.765 (resampler 0.883; screen 11.475); feet 0 | no `face` and no `footwear` part (one of the two absent leaves that half unmeasured; so do face parts on two slot bones, or idle frames with no `geometry.json`) |
| `TEXTURE_STRETCH` | every mesh triangle's three edges in every idle frame, read from the `geometry.json` the idle render writes (`rigc render --geometry`, spine-rigc 1.4.0 or later): skinned length over rest length, the rest being the setup pose's bones with no deform. The figure is the rig's worst max(ratio, 1/ratio); each mesh's largest and smallest ratio, with triangle, vertices, edge and frame, is the detail | max(ratio, 1/ratio) ≤ 1.926544 | 1.388: `hair_back` triangle 449, edge 42-43 at 0.720 in frame 26 (largest stretch 1.291, frame 2) | 1.227: `sleeves` triangle 169, edge 126-51 at 0.815 in frame 28 (largest stretch 1.196, frame 5) | the rig draws no mesh, or the render wrote no `geometry.json` |

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

Under `--source <painting.png>`, a second reported line, also never a FAIL
(issue #77):

| line | reports | bar | `demo` | `sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| `SETUP_POSE_VS_SOURCE` | the setup pose against the painting, by `assemble`'s own `measureRecomposite` over the stage's pixels — `mean_abs` and `within_share` (mean channel, within 8), `error_px` (max channel over 40), `uncovered_error_px` (of those, where the pose has alpha 128 or less), `hole_count` and the largest hole's box — with `painting_px`, `stage_px`, `render_px` and `render_scale` beside them. The painting is resampled onto the stage as assemble resamples it (lanczos3, alpha dropped). rigc renders onto an opaque grey, so the pose over white and its alpha are read off a second still of the same pose with every slot tinted black; both are carried onto the stage with the seam's map turned round (bilinear) | none — status `REPORTED`; assemble applies no bar to the figures it measures, so none is derived here | 3.146 / 93.43 % / 12,399 / 1,732, 518 holes, the largest 61 px at 351,157 6x20 (assemble's recomposite: 2.391 / 95.81 % / 11,050 / 1,564, 453) | 1.095 / 97.30 % / 5,348 / 1,239, 313 holes, the largest 88 px at 479,416 6x29 (assemble's: 0.835 / 97.95 % / 4,512 / 1,185, 259) | not written without `--source` |

The figures are assemble's by construction, not a second definition beside them;
what differs is what they are taken of — the pose rigc draws, not the flat stack —
and the gap between the two columns above is that drawing: the render's resampling at
its scale (0.942 on the demo, 1.012 on the sample) and the warp back onto the stage,
which soften every part edge by a pixel or two. It moves with the render's grid
[observed, the demo's still rendered at four sizes: mean 2.663 at scale 1.0003, 3.091
at 1.0073, 3.146 at 0.942, 3.186 at 1.884], so compare the line with itself across
rigs or edits, and with `RECOMPOSITE_HOLES` for where a hole is, not digit for digit
with the recomposite. On the examples the line reads the same with and without
`parts.json` (the still's grid does not move).

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
- **Stretch is read on edges, both ways, and the ceiling doubles |ln r|.** Compression
  distorts a texture as much as stretch — an edge at half its rest length squeezes
  the texels on it by the factor an edge at twice its length spreads them — so the
  figure is max(ratio, 1/ratio), and on both examples the worst triangle is a
  compression (demo 0.720, sample 0.815). The ceiling rule is applied to the quantity
  whose zero means "nothing happened", as it is for heat: for a ratio that is |ln r|,
  so twice demo's |ln 1.388| is ln(1.388²) = ln 1.926544 and sample clears it by 3.2
  times. Doubling the ratio itself (2.776) was rejected: its zero is not at 1, and it
  passes an edge drawn at 2.7 times its rest length. The rest is the art's own
  proportions — on both examples every rest edge equals its `uvs` edge times the
  attachment's size to within 2.4e-5, the uvs' six-decimal rounding.
- **The face is measured in the head's frame, and its bar is the model's (issue #33).**
  Until #33 the face half read the screen-space heat map, where the head's intended
  roll lights the outline on both examples (16.988 and 11.475, the figures now
  reported as `screen_heat_mean`; sample's read 11.472 once the page edges
  defaulted to `free`, *Page edges* in §5, and 11.475 again since the chain links
  are turned, issue #73, which moved both torso means down by 0.001 too), so its ceiling was twice the worse example,
  33.976 — a ceiling a smooth fixture face sliding two rig pixels stayed under (24.8;
  eight pixels measured 85.5). The judgement means *nothing moves on the face that
  the head does not move*, so the heat is now taken after each frame's face region is
  carried back through the head bone's transform. A region the head carries is then
  still up to the resampler's error, and nothing more. That error depends on the art
  and the scale — 1.146 on the demo, 0.883 on the sample, 0.47 on the selftest's
  smooth fixture face — so no one constant can be the bar: it is measured on the same
  rig, off a throwaway animation that moves the whole rig rigidly as the idle moves
  the head, and the ceiling is twice that (the tree's one margin). The calibration is
  its own `rigc build`: sharing the setup still's build widened the still's viewport
  (rigc fits it to every animation a skeleton holds) and moved the seam.
- **The region is the pixels that read the face and nothing else.** A pixel at the
  outline's rim, or next to a feature, reads a neighbour's art through the two
  bilinear taps, and that neighbour moving lights it with nothing on the face moving:
  measured over the rim, a fixture face that does not move at all over a breathing
  torso read 1.533 against a bar of 0 (its head never moves, so its resampler error is
  exactly 0), and the proposer's own strand fixture went red on the brows the blink
  drops below their setup boxes. So the region keeps only pixels whose whole
  footprint is the face (228 of the demo's 515 screen-space pixels, 271 of the
  sample's 453), clear of where each feature goes in the head's frame over the idle
  (its setup box carried by its own bone and back through the head's). Measured over
  the rim instead, both examples sat at 1.31 and 1.34 times their calibration, and
  that excess was the bangs' art sliding over the rim.
- **What the examples show in the head's frame.** The sample is still to its
  calibration (0.884 against 0.883). The demo reads 1.15 times it (1.321 against
  1.146), and most of that is the calibration's own noise, not motion: the face
  rendered alone (`--slot face`), rigid on the head by construction, reads 1.296 on
  the idle's grid against 1.146 on the calibration's — rigc fits each render's
  viewport to its own animation, so the two grids sit at a different sub-pixel phase
  on the art (13 %). The rest, 0.025, is `hair_front`: rendered without it the figure
  is the face-alone one. Both clear the bar, the demo by a factor of 1.74 and the sample by 2.00.
- **What the line now catches, and where it stops.** The selftest's fixture face,
  a mesh weighted wholly to a bone that slides two rig pixels under its head, reads
  27.886 against a ceiling of 0 on a still head (screen space 26.901, which the
  retired 33.976 passed) and 27.936 against 0.94 on a rolling one. The same plant on
  the real examples, at their render scale of about 0.5 (one rig pixel is half a frame
  pixel): two pixels read 3.216 on the sample (ceiling 1.765, red) and 2.181 on the
  demo (2.292, green); one pixel reads 1.614 and 1.526 (both green). A smooth skin
  interior sliding half a frame pixel changes little, and the rim that shows it most is
  the rim the region leaves out. The line also does not judge a face that moves with
  the bone its own slot rides: that is the head moving, whatever the bone, so a face
  region on the wrong bone is the feet half's and the eye's to catch, not this line's.
- **The feet stay in screen space.** They ride the root, which the idle does not key,
  so the screen is their own frame. On the demo the long skirt swings over the shoes,
  which lights 1.622.

Nothing is left that only an eye answers. "No visible texture stretch" left this list
with issue #31 (`TEXTURE_STRETCH`), and "the face outline held still in the head's own
frame" with issue #33 (the face half of `STILL_REGIONS_DARK`, above).

### Measuring a rig spine-parts did not assemble

`check` takes a rig spec — `rig.json` and `motion.json`, the `rigc-rig/1` and
`rigc-motion/1` pair `rigc build` compiles — not a compiled `skeleton.json`, because
the gate is `rigc build`. A rig merged from several spine-parts outputs outside the
package (prefixed names, one root, a plate region at slot 0) is such a spec, with no
`parts.json` beside it and possibly no `idle`. Each bar then measures exactly when what
it reads is there, and says SKIP with the reason when it is not:

| bar or line | reads | SKIP when |
| --- | --- | --- |
| the gate | the rig spec | never — it always runs, on whatever the spec declares |
| loop | the `idle` | no `idle` in `motion.json` (`check.json`: `loop_max_diff` null, `skipped.loop` the reason) |
| seam | `parts.json` and `parts/` | no `parts.json` (`seam_*` null, `skipped.seam` the reason) |
| `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK` | `parts.json`'s tags and the idle | either missing, or as in the table above |
| `CHAIN_LAG`, `TEXTURE_STRETCH` | the idle (and `rig.json`) | no `idle`, or as in the table above |
| `RECOMPOSITE_HOLES` | `parts.json`'s `recomposite` block | no `parts.json`, or no block |
| `SETUP_POSE_VS_SOURCE` | the rig spec and the painting | no `--source` |

`PASS` reads every bar that measured, and the last console line says how many did:
`check: PASS; 1 of 9 bar(s) measured, 8 skipped (loop, seam, …)` is a rig whose gate is
green and nothing else was looked at. Without an idle no idle is rendered
(`idle_frames/`, `contact.png` and `motion_heat.png` are not written). The demo's own
rig directory, copied away from its `parts.json`, reads `4 of 9`: the gate, the loop,
`CHAIN_LAG` and `TEXTURE_STRETCH`.

### Declared requirements (`--requirements`)

The bars above are this package's. What a *scene* asks of the rig's motion — that
a hand stays on a cup, that a sleeve takes half of what an arm's constraint asks of
it, that a joint stays inside a range — is the scene's knowledge (issue #87), so it
travels in a file `check` is given, `--requirements <file>` (`build` forwards it).
Every bar in it is the author's; a missing one is refused by name. Nothing here
solves, guesses a value or chooses a bar: every pose is spine-rigc's, read from the
world transforms `rigc render --geometry` writes (`rigc-geometry/1`). Coordinates in
the file are stage px, y down, as in the config; a stage pixel is one Spine world
unit (the stage box maps to the world by a translation and the y flip,
`src/coords.ts`); angles are degrees.

```json
{
  "spec": "spine-parts-requirements/1",
  "fps": 12,
  "targets": [{ "bone": "cup", "animation": "reach", "keys": [{ "t": 0, "at": [44, 32] }, { "t": 1, "at": [50, 32] }] }],
  "requirements": [
    { "name": "HAND_ON_CUP", "kind": "contact", "animation": "reach", "bone": "forearm", "point": "tip", "target": { "bone": "cup", "point": "origin" }, "within_px": 0.5 },
    { "name": "SLEEVE_HALF", "kind": "follow", "animation": "reach", "constraint": "sleeve_tf", "constraint_type": "transform", "bone": "sleeve", "property": "rotate", "fraction": 0.5, "tolerance": 0.05, "least_drive": 2 },
    { "name": "EYES_ON_CUP", "kind": "aim", "animation": "reach", "bone": "gaze", "target": { "bone": "cup", "point": "origin" }, "within_degrees": 3 },
    { "name": "ELBOW", "kind": "range", "animation": "reach", "bone": "forearm", "lo_degrees": -10, "hi_degrees": 150 },
    { "name": "SLEEVE_SKIN", "kind": "stretch", "animation": "reach", "slot": "sleeve", "attachment": "sleeve", "within_ratio": 1.3 }
  ]
}
```

**Four outcomes, never merged** (#87):

| outcome | when | what it does to the run |
| --- | --- | --- |
| not declared | the file states no requirement of that kind | the summary line names the kind; not a pass, not a skip of something asked. Without `--requirements` nothing is read, written or printed for it |
| refused | the file cannot be read against the rig (§6, `REQUIREMENTS_*`) | refused by name before anything is built (exit 1) |
| not measurable | it reads and the rig builds, and the quantity is undefined in the frames | `NAME: NOT MEASURABLE — <why>` with the figures that show it, `CHECK_REQUIREMENT_MEASURABLE`; the run does not PASS |
| measured | otherwise | `PASS` or `FAIL` against the author's bar, with the figures and the worst frame; a FAIL is `CHECK_REQUIREMENT_MET` |

**The five kinds**, each over every frame of its animation sampled at the file's `fps`:

| kind | declares | measures | not measurable when |
| --- | --- | --- | --- |
| `contact` | `bone`, `point` (`origin` or `tip`), `target` (`{ "bone", "point" }` or `{ "stage": [x, y] }`), `within_px` | the largest distance between the two points, and its frame; a tip is the origin plus `length` along the bone's x axis | a tip on a bone of length 0, on either side |
| `aim` | `bone`, `target`, `within_degrees` | the largest angle between the bone's axis and the line from its origin to the target; the distance is not judged | the bone has length 0; a frame whose target sits on the origin has no line and is not counted, and with no line on any frame the requirement is not measurable |
| `range` | `bone`, `lo_degrees`, `hi_degrees` | the bone's world rotation less its parent's (the world's, for the root), less the same at the setup pose, as a signed shortest angle: the least and the greatest, and their frames | — |
| `stretch` | `slot`, `attachment` (a mesh), `within_ratio` | `TEXTURE_STRETCH`'s own per-mesh measure (imported, not rewritten): the mesh's worst max(ratio, 1/ratio) over the frames | a rest edge of length 0; no frame shows the mesh |
| `follow` | `constraint`, `constraint_type` (`ik` or `transform`), `bone`, `property` (`rotate` or `translate`), `fraction`, `tolerance`, `least_drive` | below | no frame's drive reaches `least_drive` (the line prints the largest drive there was) |

**`follow`**, #87's definition to the letter: "bone A takes a fraction `f` of what
constraint C asks of it" is measured from three poses of the same rig over the same
frames, each posed by spine-rigc and differing in one thing only — *as declared*, the
rig as written, `A(t)`; *released*, C's mix for that property forced to 0 and every
key of that mix in the animation removed, `A0(t)`; *full*, forced to 1, keys removed,
`A1(t)`. For `translate` A is the bone's world origin; for `rotate`, `atan2(c, a)` in
degrees, every difference a signed shortest angle (the line notes a largest drive
over 90°: a drive beyond 180° is not told from its complement). The drive is
`d(t) = A1(t) − A0(t)`; a frame counts when `|d(t)| ≥ least_drive`; the measured
fraction is `F = Σ⟨A(t) − A0(t), d(t)⟩ / Σ|d(t)|²` over the frames that count; PASS
when `|F − fraction| ≤ tolerance`. The line also carries the frames that counted, the
largest drive and its frame, and the largest residual `|A − A0 − F·d|` and its frame
— figures with no bar. It measures the realised follow, not the number in `mix`: a
keyed mix, a later constraint on the bone or physics on it show up in `A(t)` alone.
"Keys removed" is written as every key of that mix holding the forced value (its
curve channel's two value numbers with it), which poses what removing them under a
setup mix of that value poses, while every other field those keys state stays as
written. An ik's mix is `mix`; a transform's is `mixRotate` for `rotate`, and `mixX`
and `mixY` for `translate`.

The released copy rests muted throughout whenever no other animation keys that mix,
and spine-rigc's gate refuses that — `A47_IK_CONSTRAINT_NOT_MUTED_THROUGHOUT`,
`A48_TRANSFORM_CONSTRAINT_NOT_MUTED_THROUGHOUT`. When rigc refuses the released copy
for that constraint and for nothing else, the copy — never the rig under test —
declares it in `invariants.consumerDrivenMix`, rigc's own door for a mix the consumer
drives, and the line's `released_copy` says so; the full copy drops the constraint's
own declaration if the rig has one, since at 1 it rests live. Any other red line from
a copy is refused, `CHECK_RIGC_GREEN`, quoting rigc.

**Scene targets.** A `targets` entry names a bone whose parent is the root and gives
it a stage point (`"at": [x, y]`) or stage points at stated times (`"keys"`), linear
between them, the first held before and the last after, for one named animation.
`check` writes it onto a throwaway copy — the bone's setup position is the first
point, the rest are translate keys from it, through the one y door, and the
animation's own translation tracks on that bone are dropped — and poses the copy
through spine-rigc; a follow's released and full copies carry the same placement. A
root that is not at rest at the origin, or that the animation moves, is refused,
because the stage point would not be the bone's position. In a rig composed of
several characters, a target can simply be another character's bone, named as the
composed rig names it.

**Where it is written**, under `--out`: `requirements/as-declared/<animation>/` (the
render each requirement on that animation reads: the rig under test's own build, or a
copy with its scene targets placed), and, per follow, `requirements/released/<name>/`
and `requirements/full/<name>/` — each a `rigc render` frame set with its
`geometry.json`. The copies' specs and builds are scratch, removed before the stage
returns. `check.json` gains `requirements` — `fps`, the summary and each line by name
— before `PASS`, and `PASS` needs every declared requirement to PASS.

The selftest holds each kind and outcome to a hand value on a generated rig
(`fixtures/reqrig.ts`): a two-bone ik that reaches its scene target holds its contact
and one 5 px short fails it at the frame it is short; an aim-only one-bone ik with a
far target passes and is not judged on distance; a follow at mix 0.5 measures 0.5 on
an ik and on a transform, and the same ik with its mix keyed 0, 1, 1 measures
3.5 / 5 = 0.7 and fails a declared 0.5; a follow whose target asks nothing and a tip
on a bone of length 0 are NOT MEASURABLE and the run is not PASS (`CK68`–`CK79`,
`RQ01`–`RQ22`).

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
Since issue #33 `check` runs one more `rigc build` and one more idle render (the face
calibration, §7); the idle's `geometry.json` is the one issue #31 already writes. The `build` row
was not re-measured: A/B against the tree before that change, alternating on one
machine under a load average of 5 to 11, the difference in user + sys was +5.6 and
+0.8 s on the demo and +6.5 and −1.6 s on the sample over two rounds — inside what
the load moves the same build by (the pre-change demo build alone took 43.6 to
45.8 s there).
