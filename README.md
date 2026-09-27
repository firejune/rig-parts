# spine-parts

> **0.1.0 — skeleton; the assemble/propose/rig/check stages land next.** What
> exists today: the two input readers, the layer table, the contact sheet, the
> config and `parts.json` contracts, and the raster library the later stages
> stand on. Every other command is registered and exits 2 saying it is not
> implemented in this version.

**AI Spine 2D rigging from one anime painting and its See-through layer
decomposition.** spine-parts takes a single character painting plus the layers
[See-through](https://github.com/shitagaki-lab/see-through) decomposed it into,
and is built to turn them into Spine-ready character parts: `parts/*.png`, a
`parts.json` recording where every part came from and what was measured, and a
rig spec and motion spec for [spine-rigc](https://github.com/firejune/rigc) —
weighted meshes over the layers, chains for what hangs, one `idle` — which
spine-rigc then compiles, gates, renders and checks.

It is a tool for AI agents that cannot see the image. Every stage prints named,
numeric findings; a failure names the object, the value found and the value
required; nothing is written after a red; and no value is invented where the
input is silent.

## What it takes in

- **One painting** — a PNG of the character, front-facing, full body.
- **Its See-through layers**, in either form See-through reaches a user in:
  - the **ComfyUI wrapper form**: a directory holding `layers.json` and one RGBA
    PNG per layer (flat beside the manifest, as the wrapper writes it, or under
    `parts/<tag>.png`);
  - an **upstream `.psd`**: one pixel layer per tag, the layer name being the
    tag, the stacking order being the draw order.
- **A character config** (`config.json`) — the part plan, bones, which bones
  may pull which layer, and the idle's sines. Its schema is `src/config.ts`,
  which documents every field; the loader refuses an unknown or missing field by
  name.

## What it gives out

Today:

```sh
spine-parts layers <dir | layers.json | file.psd>
```

prints every layer of a decomposition — draw order, name, tag group, box, size,
opaque pixels, depth — and refuses, by name, a missing PNG, an unknown tag, a
PNG whose size is not its box, and anything else outside the input contract.

```sh
spine-parts sheet --source painting.png --layers <path> [--layers <path> ...] --out sheet.png
```

writes a contact sheet — the painting, then every layer or part on a
checkerboard, labelled — and prints the same information as text.

```sh
spine-parts inputs --source painting.png --config config.json --out <dir>
```

cuts the two images See-through is fed: the painting centred on a white square
(`st_input_full.png`) and, when the config sets `seethrough.head_box`, that
box at its exact size (`st_input_head.png`). Pure raster, no GPU.

**The optional ComfyUI adapter.** For a user who has a ComfyUI box, two
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

Next (not in this version): `assemble` (rig-space `parts/*.png` + `parts.json`),
`propose` (bones, meshes and an idle for the config), `rig` (`rig.json` +
`motion.json`), `check` (spine-rigc's gate plus seam and loop measurements),
and `build` (all of it).

## See-through routes

See-through is required; how you run it is not. spine-parts does not vendor,
embed or redistribute See-through code or weights — run it by any of these and
point spine-parts at the output:

| Route | Where | Output spine-parts reads |
| --- | --- | --- |
| Hugging Face Space | [24yearsold/see-through-demo](https://huggingface.co/spaces/24yearsold/see-through-demo) (ZeroGPU; upstream states 1-2 extractions a day for a registered user) | the `.psd` it produces |
| ModelScope demo | [ljsabc/See-Through](https://modelscope.cn/studios/ljsabc/See-Through), linked from the upstream README | the `.psd` it produces |
| Upstream CLI | `python inference/scripts/inference_psd.py --srcp <image> --save_to_psd` in a checkout of [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through) | the `.psd` in `workspace/layerdiff_output/` |
| ComfyUI wrapper | [jtydhr88/ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through) on your own ComfyUI box; `spine-parts comfy seethrough` drives it (optional) | the `layers.json` + PNGs it writes |

**See-through is required; ComfyUI is not.** The wrapper is one route among
four, and `spine-parts comfy` is only a convenience for that route: every
stage after See-through reads files, whichever route wrote them.

## What this does not do

These are limits of the approach the tool ports, measured on the reference
implementation, and they are stated so nobody reads more into a green run:

- **No joint caps.** Parts are See-through's layers, not cut limbs; nothing
  builds overlap caps at joints.
- **No expression or lip-sync.** The mouth is one layer; there is no mouth
  shape set, and no expression axes.
- **One depth value per layer.** See-through gives each layer a single
  `depth_median`, so a layer that is in front of another in one place and behind
  it in another cannot be drawn correctly when it moves; the flat still can be
  made to match the painting, the motion cannot.
- **No success-rate claim.** The reference implementation was carried through
  on a small private set of characters, one See-through seed each. That is an
  existence proof, not a rate, and none is claimed.
- **Occluded pixels are See-through's synthesis**, not the artist's; nothing
  here makes them faithful to what the painting would have shown.

## Requirements

[Bun](https://bun.sh) 1.2 or later. `npm install -g spine-parts` installs the
`spine-parts` command; it hands off to Bun and says so in one sentence if Bun
is not on PATH.

Using spine-rigc's output in a product requires a Spine Editor license — see
[NOTICE.md](NOTICE.md), which also records every third-party licence this
package touches.

## Development

```sh
bun install
bun run typecheck    # tsc --noEmit, strict
bun run lint         # one rule: no explicit any
bun run fetch-examples  # the public examples' paintings and layers, into examples/*/inputs (needs a network)
bun run selftest     # every gate's negative controls, on fixtures it generates; reads the examples when fetched
bun run smoke        # pack, install into an empty directory, run from the install (needs a network)
```

[CLAUDE.md](CLAUDE.md) is the doctrine, [CONTRIBUTING.md](CONTRIBUTING.md) the
practice, [RELEASING.md](RELEASING.md) the cut.

## Licence

MIT — see [LICENSE](LICENSE). Third-party terms: [NOTICE.md](NOTICE.md).
