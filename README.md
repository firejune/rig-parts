# spine-parts

**AI-authored Spine 2D character rigs from one anime painting, verified before they
are written.** spine-parts takes a single character painting and the layers
[See-through](https://github.com/shitagaki-lab/see-through) decomposed it into,
merges them into measured rig-space parts, authors weighted meshes, bone chains
and a looping idle over them in [spine-rigc](https://github.com/firejune/rigc)'s
spec, and hands that spec to spine-rigc to compile, gate, pack, render and check.
It is built for agents that cannot see the image: every stage prints named,
numeric findings, a refusal names the object, the value found and the value
required, nothing is written after a red, and no value is invented where the
input is silent.

## What you get

<p align="center">
  <img src="https://raw.githubusercontent.com/firejune/spine-parts/main/assets/demo-source.png" alt="The demo painting: a generated full-body character in a white and pink frilled dress with long pink twin tails, standing with her hands clasped" height="420" />
  <img src="https://raw.githubusercontent.com/firejune/spine-parts/main/assets/demo-idle.png" alt="The same character as a Spine rig, breathing, blinking once and swaying her hair, sleeves and skirt in a four-second loop" height="420" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/firejune/spine-parts/main/assets/demo-parts.png" alt="Contact sheet of the painting and the 22 assembled parts it was split into: hair, dress, sleeves, shoes, face, eyes, brows, mouth and ornaments" width="100%" />
</p>

<p align="center"><em>
The painting was generated for this repository with a public checkpoint (Pony
Diffusion V6 XL) and no LoRA; its generation record, See-through layers and licence
are in <a href="https://github.com/firejune/spine-parts-examples">spine-parts-examples</a>.
See-through ran twice, once on the whole figure and once on a square head crop.
Then one command: <code>spine-parts build --seam silhouette --loop</code>. The
proposer's bones, meshes, regions and motion were used <b>unedited</b>. Two input-stage
edits were made by hand for the reference run this example reproduces: the head box
was shifted down into the canvas (its proposal ran 118 px above the top edge;
<code>propose --head-box</code> now makes that shift itself), and <code>hair_back</code>
is taken from the full run, because the twin tails leave the head crop sideways
(a plan edit). <code>check</code> printed, verbatim:<br/>
<code>49 assertions: 23 measured (23 passed, 0 failed), 26 skipped, 0 not in profile "spine-html"</code><br/>
<code>49 assertions: 14 measured (14 passed, 0 failed), 20 skipped, 15 not in profile "spine"</code><br/>
<code>loop: idle 49 frame(s) at 12 fps, f0000 vs f0048 (t = 4s): max |d| 0 (0 required)</code><br/>
<code>seam: setup pose at 714x1216, scale 0.9422: mean |d| 0.324 (&lt;= 1.0), 2 px over 40 (&lt;= 50), 0 px over 80 (reported)</code><br/>
<code>pack: skeleton.png 1024x2048, 22 region(s), 56.3% covered, padding 2</code><br/>
<code>--seam silhouette</code> repaired the navy blobs the default rule leaves on the white
blouse (recomposite error pixels 11,050 → 9,540); the default stays
<code>near-white</code>, the reference implementation's rule, so the examples stay
comparable with it. The loop is <code>spine-parts loop --palette</code>'s indexed APNG, 48 frames at
12 fps, 1,706,785 bytes, one 256-entry palette at a measured error of max 57, mean 1.601
per channel over every frame (the lossless APNG beside it, the exactness record, is
13,645,519 bytes; the GIF, at the same error, 1,812,625). Frame 29 (2.417 s) is the
closed eye: the blink holds for 0.084 s, one 12 fps frame rounded up, where the
reference implementation held 0.04 s and no frame of its loop showed the eyes shut
(issue #32); the painting is shown at half size, resampled and written
by this package's PNG codec (nothing here encodes JPEG). <code>spine-parts sheet</code>
made the contact sheet.
</em></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/firejune/spine-parts/main/assets/sample-parts.png" alt="Contact sheet of the sample character's painting and its 20 parts" width="560" />
</p>

<p align="center"><em>
The plain fixture, <code>examples/sample</code>: same checkpoint, no LoRA, and a rig
built from its own proposal with no hand edit at all —
<code>seam: … mean |d| 0.207 (&lt;= 1.0), 0 px over 40 (&lt;= 50)</code>, loop max |d| 0.
</em></p>

## What it takes in

- **One painting** — a PNG of one character, front-facing, full body, taller than
  wide.
- **Its See-through layers, twice**: one run on the whole figure (the painting padded
  white to a square) and one on a square crop around the head, because the eyes of a
  full-figure run are too small to separate. Either form See-through reaches you in
  is read:
  - the **ComfyUI wrapper form** — a directory holding `layers.json` and one RGBA PNG
    per layer (flat beside the manifest, or under `parts/<tag>.png`);
  - an **upstream `.psd`** — one pixel layer per tag, the layer name being the tag,
    the stacking order being the draw order.
- **A character config** (`config.json`) — the part plan, the head box, the bones,
  which bones may pull which layer, and the idle's sines. `src/config.ts` is its
  schema and documents every field; the loader refuses an unknown or a missing field
  by name. [docs/AUTHORING.md](docs/AUTHORING.md) says where each value comes from.

## What it gives out

`spine-parts build` ends the way a Spine editor export does — with **one packed atlas
page** (issue #2):

| path under `--out` | what |
| --- | --- |
| `check/build/skeleton.json`, `skeleton.atlas`, `skeleton.png` | **the artifact** — Spine 4.3 skeleton data and one packed page, written by `rigc build --pack` and gated under both profiles |
| `parts/*.png`, `parts.json`, `recomposite_rig.png`, `recomposite_error_rig.png` | the loose parts, each cropped to its alpha box; the record of where every part came from, how many of its pixels were re-taken from the painting, and the recomposite's uncovered holes with their boxes; the flat stack of parts; its error map — red where no part covers a pixel the painting has, blue where a part covers it in the wrong colour |
| `rig/` | `rig.json` and `motion.json` in spine-rigc's spec, `mesh_report.json`, the padded `images/` |
| `check/` | both gate files verbatim, the idle's frames and their `geometry.json` (skinned vertices per frame), `contact.png`, `motion_heat.png`, `check.json` |
| `idle.png`, `idle-indexed.png`, `idle.gif` | with `--loop`: the idle as a lossless APNG (the exactness record), an indexed APNG with one shared palette (the small one) and a GIF; the last two print their palette error |

The last lines of a green build are the pack line, printed beside the Spine example
export's `spineboy.png` as a yardstick (a reference, not a bar), and the three
artifact paths — here for `examples/sample`:

```
build: PASS — the packed atlas is the artifact; parts/ and rig/ are the intermediates it was made from
  pack: skeleton.png 512x2048, 20 region(s), 49.7% covered, padding 2; page opaque 28.7% (alpha > 0) — spineboy yardstick 1024x256, 40 region(s), 45.8% opaque (alpha > 0), a reference and not a bar
  out/check/build/skeleton.json
  out/check/build/skeleton.atlas
  out/check/build/skeleton.png
```

The packer is spine-rigc's, and no other: a packed region is a lossless copy, and an
atlas written by anything else would have no oracle behind it.

## Painting → parts → rig → browser

| stage | tool | what it owns |
| --- | --- | --- |
| painting + See-through layers → parts and specs | **spine-parts** | the merge of two runs, the measurements, the rig spec and motion spec |
| specs → Spine skeleton data | **[spine-rigc](https://github.com/firejune/rigc)** | compile, the round trip through `spine-core`, the named assertions, the packer, the renderer |
| skeleton data → a page | **[spine-html](https://github.com/firejune/spine-html)**, a sibling project | a DOM renderer; rigc's `spine-html` profile is its policy, and every build here is gated under that profile as well as under `spine` |

spine-parts never writes Spine data itself. Everything on disk under `check/build/`
was written by spine-rigc after its own gate passed.

## Getting See-through layers

See-through is required; how you run it is not. spine-parts does not vendor, embed or
redistribute See-through code or weights — run it by any of these and point
spine-parts at what it wrote:

| Route | Where | Output spine-parts reads |
| --- | --- | --- |
| Hugging Face Space | [24yearsold/see-through-demo](https://huggingface.co/spaces/24yearsold/see-through-demo) (ZeroGPU; upstream states 1-2 extractions a day for a registered user) | the `.psd` it produces |
| ModelScope demo | [ljsabc/See-Through](https://modelscope.cn/studios/ljsabc/See-Through), linked from the upstream README | the `.psd` it produces |
| Upstream CLI | `python inference/scripts/inference_psd.py --srcp <image> --save_to_psd` in a checkout of [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through) | the `.psd` in `workspace/layerdiff_output/` |
| ComfyUI wrapper | [jtydhr88/ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through) on your own ComfyUI box; the optional `comfy` adapter (`spine-parts comfy seethrough`) drives it | the `layers.json` + PNGs it writes |

**The head run is needed on every route that was read.** See-through's model
already separates the head in a second stage of its own: it crops the head the
first stage found, runs the face tags on that crop at the same `resolution`, and
pastes the result back **resized to the full image's scale**. So the face comes
back at the full run's pixel density whichever route ran it, and the separate
head run on `st_input_head.png` is what gives the eyes more pixels
(read on 2026-09-28 at see-through `a25a549` and wrapper 0.5.0 `98d754b`):

- *Hugging Face Space* — the same two-stage code, with `resolution` capped at
  1280 (768 by default): the head run is still needed.
- *ModelScope demo* — its code was not read, so what the head run adds on that
  route has not been measured.
- *Upstream CLI* — the `.psd` frame is the `resolution`-sided square the first
  stage ran on (1280 by default), and the head stage is pasted into it at that
  scale: the head run is still needed.
- *ComfyUI wrapper* — `SeeThrough_GenerateLayers` runs both stages with no input
  to change the second, at most `resolution` 2048, which on the examples' 2432 px
  square is 1.19 source px per layer px against 0.77 and 0.47 for their head
  crops; at the 1024 the examples ran, the full run's right eye white is 22×13 px
  and the head run's 60×38: the head run is still needed.

**See-through is required; ComfyUI is not.** The wrapper is one route among
four, and `spine-parts comfy` is only a convenience for that route: every
stage after See-through reads files, whichever route wrote them. On the two
public examples each run took 171–199 s through the wrapper (each run's
`meta.json`, in [spine-parts-examples](https://github.com/firejune/spine-parts-examples)).

### The two images See-through is fed: `inputs`

```sh
spine-parts inputs --source painting.png --config config.json --out <dir>
```

cuts the two images See-through is fed: the painting centred on a white square
(`st_input_full.png`) and, when the config sets `seethrough.head_box`, that
box at its exact size (`st_input_head.png`). Pure raster, no GPU.

### The optional ComfyUI adapter

For a user who has a ComfyUI box, two
commands drive it; nothing else in the pipeline needs one:

```sh
spine-parts comfy paint --config config.json --out <dir> --host http://<box>:8188
spine-parts comfy seethrough --image st_input_full.png --out layers/full --host http://<box>:8188 --offload
```

`comfy paint` generates `painting_<seed>.png` from the config's inline
`generation` block — checkpoint, LoRAs, sampler, and an optional OpenPose
control skeleton it draws itself — and records the prompts verbatim beside it.
`comfy seethrough` runs the [ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through)
wrapper on one image and writes the wrapper form `layers` reads. The host comes
from `--host` or `COMFY_HOST` and has no default; before anything is uploaded
the graph is checked against the box's `/object_info`, so a missing node class
or model is refused by name, and the adapter waits for an empty queue rather
than queueing behind someone else's job.

## The loop, for an agent

```sh
spine-parts inputs --source painting.png --config config.json --out inputs   # st_input_full.png
#    See-through on st_input_full.png (external, or `spine-parts comfy seethrough`) -> layers/full
spine-parts layers layers/full                      # every layer: box, opaque px, depth, plausibility figures; WARN lines
spine-parts propose --head-box --full layers/full --canvas 1664x2432
#    -> seethrough.head_box into config.json
spine-parts inputs --source painting.png --config config.json --out inputs   # now st_input_head.png too
#    See-through on st_input_head.png (external, or `spine-parts comfy seethrough`) -> layers/head
spine-parts sheet --source painting.png --layers layers/full --layers layers/head --out sheets/layers.png
spine-parts assemble --propose-plan --source painting.png --full layers/full --head layers/head --config config.json
#    -> assemble.plan and extend_below_crop
spine-parts assemble --source painting.png --full layers/full --head layers/head --config config.json --out work
#    -> work/rig: parts.json and parts/; the config holds no bones, meshes, regions or motion yet
#    -> read the `uncovered hole N:` lines and look at work/render/recomposite_error_rig.png:
#       red is painting that no part holds, and no later gate can see it
#    -> a large red hole neither run holds? add an assemble.patches entry (cut from the painting) and assemble again
spine-parts propose --parts work/rig --source painting.png --out work
#    -> proposal.json and render/landmarks.png; correct it, copy bones/meshes/regions/motion into config.json
spine-parts propose --parts work/rig --source painting.png --out work --from-config config.json
#    -> LINT lines; exit 1 while any remain
spine-parts build --config config.json --source painting.png --full layers/full --head layers/head --out out --loop
#    -> read out/check/check.json; every FAIL line names what has to change
```

At each step the config holds only what that step reads; the one table of what
that is, step by step, is [docs/AUTHORING.md §4](docs/AUTHORING.md#4-the-command-order).
The selftest runs this block in order, command by command, on each fetched example,
from a config holding only what the first step reads (`RL01`).

`propose` is deliberately not a step of `build`: the proposal is a draft to correct
against its overlay, and a config with bones is `build`'s input. `rig`, `check` and
`loop` are the same stages one at a time. [docs/AUTHORING.md](docs/AUTHORING.md) is
the guide an agent authors from — every config field, what to look at after each
stage, what each refusal means and which field it points at — and
[`skills/spine-parts/SKILL.md`](skills/spine-parts/SKILL.md) is the same loop as an
agent skill.

## Commands

| command | does |
| --- | --- |
| `inputs --source <png> --config <json> --out <dir>` | the two images See-through is fed: the painting on a white square, and the head box's crop once the config has one |
| `comfy paint --config --out [--host]` | optional: generate the painting on a ComfyUI box from the config's `generation` block |
| `comfy seethrough --image --out [--host]` | optional: run the ComfyUI See-through wrapper on one image and write the form `layers` reads |
| `layers <dir \| layers.json \| file.psd>` | print every layer of a decomposition: draw order, name, tag group, box, size, opaque pixels, depth, and its translucent, background and area figures; a `WARN` line for a layer `--propose-plan` will leave out |
| `sheet --source <png> --layers <path>… --out <png>` | a labelled contact sheet of the painting and every layer or part |
| `assemble --propose-plan …` | propose `assemble.plan` and `extend_below_crop` from the two runs, leaving out an implausible layer with a note naming the rule |
| `assemble --source --full --head --config --out [--seam] [--project]` | merge the two runs into rig-space parts, `parts.json`, the recomposite and its error map, and list the uncovered holes |
| `propose --head-box --full <run> --canvas WxH` | propose `seethrough.head_box` from the full run, held inside the painting |
| `propose --parts --source --out [--compare <config>]` | propose bones, meshes, regions and an idle; draw the overlay |
| `propose … --from-config <config>` | draw and LINT the config's current bones |
| `rig --config --parts --out [--idle-keys ctl\|direct]` | author `rig.json` + `motion.json`, written only after spine-rigc's round trip is green; `--idle-keys` says whether the idle's keys on mesh-driving bones go through `<bone>_ctl` parents (default) or stay on the bones with `invariants.idleDrivesMeshes` declared |
| `check --rig --out [--parts]` | build packed, gate under both profiles, render the idle, measure seam, loop and the six judgement lines (mesh texture stretch among them, from the idle's `render --geometry`), and report the recomposite's holes from `parts.json` |
| `loop --frames <dir> --out <file.gif \| file.png> [--palette]` | encode a rendered idle as a looping GIF, lossless APNG, or indexed APNG (`--palette`) |
| `build --config --source --full --head --out [--seam] [--project] [--loop]` | assemble, rig and check in one process, stopping at the first refusal |

`spine-parts --help` has every flag. Exit codes: 0 done, 1 input refused (every
reason is a FAIL line), 2 a usage error or a command this version does not implement.

## What it does not do

These are limits of the approach, stated so nobody reads more into a green run:

- **One depth value per layer.** See-through gives each layer a single depth, so a
  layer that is in front of another in one place and behind it in another is drawn
  right in the still (the painting's own pixels are projected onto it) and wrong once
  it moves.
- **No expression or lip-sync.** The mouth is one layer; there is no mouth-shape set
  and no expression axis.
- **Occluded pixels are See-through's synthesis**, not the artist's. How much of a rig
  that is, is below.
- **No success rate is claimed.** Ten characters have been measured stage by stage
  against the reference implementation this package ports — the two public examples
  here and eight private ones, one See-through seed each — and all ten check green
  on the gates, the seam and the loop. The judgement lines `check` added since
  (issue #11) have been measured on the two public examples only. That is an
  existence proof, not a rate.
- **`loop` writes GIF and APNG (lossless and indexed), not WebP**: an animated WebP needs a VP8/VP8L
  encoder, which this package does not carry.
- **The proposer reads tags, not pictures.** A swinging element painted inside another
  layer (a sash tail in the skirt), hair that is none of the shapes it knows, and
  whether an accessory swings are the corrector's to add. The one accessory shape it
  measures is a hanging strand on a headwear or earwear layer: each gets a pendulum
  chain, and a strand it cannot chain is named in a note rather than left stiff.

### How much of a rig the model painted

`parts.json` splits each part's opaque pixels (`opaque_px`) into `visible_px` — no
later layer of its See-through run is opaque in front of them — and `occluded_px`,
and counts the visible ones whose colour was not taken from the painting
(`visible_not_projected_px`). On the two public examples, from the totals of their
`expected/parts.json` (the default `--project core`):

| | opaque px | occluded | visible, not projected | taken from the painting |
| --- | --- | --- | --- | --- |
| `sample` | 298,632 | 79,143 (26.5 %) | 36,227 (12.1 %) | 183,262 (61.4 %) |
| `demo` | 767,102 | 202,346 (26.4 %) | 76,801 (10.0 %) | 487,955 (63.6 %) |

The occluded share is art the painting does not show — a back-hair layer, a neck, the
parts of an ear under the hair — and is See-through's synthesis by necessity; it is
what the decomposition is for. The visible-but-not-projected share is synthesis where
the painting was there to be taken: a part too thin for the reference rule's 5x5
eroded core, an anti-aliased fringe below alpha 250, a rim beside a layer in front, a
pixel refused for drift. `--project visible` keeps the erosion only along a rim with a
layer in front, which takes that share to 22,476 (7.5 %) on `sample` and 49,672 (6.5 %)
on `demo` (from the `parts.json` of a `--project visible` build). On the eleven thin
head parts — brows, lashes, irises, eye whites, ears, mouth — it takes 296 of
`sample`'s 1,289 visible pixels where `core` takes 110, and 824 of `demo`'s 2,162
where `core` takes 343. What neither rule takes is the fringe: a per-pixel
classification of those parts under `visible`, recorded with the change that added
the flag, puts 813 of `sample`'s 993 still-unprojected pixels and 879 of `demo`'s
1,338 below alpha 250.

## Requirements

[Bun](https://bun.sh) 1.2 or later. `npm install -g spine-parts` installs the
`spine-parts` command; it hands off to Bun and says so in one sentence if Bun is not
on `PATH`. spine-rigc comes with it as a dependency.

## Licence posture

spine-parts is MIT, and it depends on spine-rigc, which links Esoteric Software's
`spine-core`: using what it produces in a product requires a Spine Editor licence, as
any Spine data does. [NOTICE.md](NOTICE.md) records that chain and every other
third-party term this package touches, See-through's included.

## Development

```sh
bun install
bun run typecheck        # tsc --noEmit, strict
bun run lint             # one rule: no explicit any
bun run fetch-examples   # the public examples' paintings and layers, into examples/*/inputs (needs a network)
bun run selftest         # every gate's controls; with the examples fetched, build on each of them against its expected/
bun run smoke            # pack, install into an empty directory, run from the install (needs a network)
```

[CLAUDE.md](CLAUDE.md) is the doctrine, [CONTRIBUTING.md](CONTRIBUTING.md) the
practice, [RELEASING.md](RELEASING.md) the cut.

## Licence

MIT — see [LICENSE](LICENSE). Third-party terms: [NOTICE.md](NOTICE.md).
