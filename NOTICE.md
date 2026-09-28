# Third-party notices

spine-parts' own code is MIT (see `LICENSE`). It depends on, reads the output
of, or reimplements the behaviour of the third-party work below, each under its
own terms. Naming a project here identifies where something comes from; it does
not imply that its authors endorse spine-parts.

Every statement below is either quoted from the named source or marked
**[observed]** with the date and the place it was read. Upstream terms can
change; check the source when it matters.

## 1. See-through

spine-parts takes See-through's output as its input. **spine-parts does not
vendor, embed or redistribute See-through code or weights**: the user runs
See-through by one of the routes in the README (*See-through routes*) and points
spine-parts at what it wrote.

- Project: [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)
- Paper: Jian Lin, Chengze Li, Haoyun Qin, Kwun Wang Chan, Yanghua Jin, Hanyuan
  Liu, Stephen Chun Wang Choy, Xueting Liu, *See-through: Single-image Layer
  Decomposition for Anime Characters*, SIGGRAPH 2026,
  [arXiv:2602.03749](https://arxiv.org/abs/2602.03749)
- Licence: Apache License 2.0 — **[observed 2026-09-27]** the repository's
  licence as GitHub reports it.

### The ComfyUI wrapper

- Project: [jtydhr88/ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through)
- Licence: **[observed 2026-09-27]** there is no `LICENSE` file in the
  repository (`LICENSE` on the default branch `master` returns 404, and GitHub
  reports no licence); `pyproject.toml` declares `license = "MIT"`.

spine-parts reads the wrapper's `layers.json` manifest format; it contains no
wrapper code.

### Weights

| Weights | Licence as stated on the model card | Observed |
| --- | --- | --- |
| [`layerdifforg/seethroughv0.0.2_layerdiff3d`](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d) | `license:apache-2.0` tag | 2026-09-27, Hugging Face model API |
| (same card, after its 2026-09-28 commit *"Add licence terms, NOTICE and base model metadata"*) | `license:openrail++` tag; the card's *Licence* section says the maintainers' own contributions are Apache-2.0 and the weights also inherit the licences of the models they are derived from — Animagine XL 4.0 / Stable Diffusion XL 1.0 (CreativeML Open RAIL++-M) and LayerDiffuse (CreativeML Open RAIL-M) | 2026-09-28, Hugging Face model API and card |
| [`layerdifforg/seethroughv0.0.1_marigold`](https://huggingface.co/layerdifforg/seethroughv0.0.1_marigold) | no licence tag on the card | 2026-09-27, Hugging Face model API |
| (same card, after its 2026-09-28 revision) | `license:openrail++` tag | 2026-09-28, Hugging Face model API |

Maintainer statement, on the Hugging Face discussion
[`layerdifforg/seethroughv0.0.2_layerdiff3d/discussions/1`](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d/discussions/1)
(user `24yearsold`, 2026-04-07): *"Yes all our models are aligned with our main
repo to use Apache 2.0."* The 2026-09-28 card revision above narrows that: Apache-2.0 for the maintainers' contributions, with the base models' Open RAIL terms inherited. spine-parts does not distribute these weights; a user who fetches them accepts the terms the card states on the day they fetch.

### Training data

The paper describes its own supervision this way: *"we introduce a scalable
engine that bootstraps high-quality supervision from commercial Live2D models,
capturing pixel-perfect semantics and hidden geometry."* That is the paper's
description of how See-through was trained. spine-parts does not use,
include or redistribute any of that data, any Live2D model, or anything derived
from them beyond the layers See-through itself writes for the user's own image.

## 2. Spine Runtimes, through spine-rigc

spine-parts depends on [`spine-rigc`](https://www.npmjs.com/package/spine-rigc)
(MIT, same author), which compiles and validates Spine skeleton data and links
`@esotericsoftware/spine-core`, part of the
[Spine Runtimes](https://github.com/EsotericSoftware/spine-runtimes), under the
[Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license).
spine-rigc's [NOTICE.md](https://github.com/firejune/rigc/blob/main/NOTICE.md)
sets out the chain in full; briefly, as a restatement of Esoteric Software's
terms and not a term of this project:

1. What spine-parts produces is input to spine-rigc, whose output **is Spine
   skeleton data**.
2. Playing Spine skeleton data in a product requires a Spine Runtime, and the
   Spine Runtimes License requires **each user of such a product to own a
   Spine Editor license**.
3. spine-rigc links `spine-core`, and spine-parts depends on spine-rigc, so the
   same obligation applies to running the stages of spine-parts that call it.

spine-parts also imports spine-rigc's own modules directly, by deep path: its PNG codec
(`tools/plate.ts`, `src/png.ts`), its 5x7 label font (`tools/font5x7.ts`) and
its coordinate conversion (`src/transform.ts`). Those are spine-rigc's MIT code.

## 3. Checkpoints

Generating the painting is an **optional** adapter (`spine-parts comfy paint`).
The checkpoint, any LoRA and any ControlNet it runs are the user's: spine-parts
ships none and downloads none, and the terms that govern an image they produce
are the terms of those models. A painting from any other source works the same
way.

The images this repository ships — `assets/demo-*` and `assets/sample-parts.png`
— and the public examples' paintings were generated with
`ponyDiffusionV6XL_v6StartWithThisOne.safetensors`,
[Pony Diffusion V6 XL](https://civitai.com/models/257749), with no LoRA. The
checkpoint itself is not redistributed. **[observed 2026-09-27]** CivitAI's model
API reported for it `allowCommercialUse: ["Image", "RentCivit"]`,
`allowNoCredit: false`, `allowDerivatives: true` and
`allowDifferentLicense: false`: generated images may be used commercially and
the model must be credited, which this line and the
[spine-parts-examples](https://github.com/firejune/spine-parts-examples) README do.

## 4. Behaviour reimplemented, not code copied

The raster operations in `src/raster/` reproduce the documented behaviour of
calls the reference implementation made, so that the port measures the same
numbers — [OpenCV](https://github.com/opencv/opencv) (Apache-2.0),
[SciPy](https://github.com/scipy/scipy) (BSD-3-Clause) and
[Pillow](https://github.com/python-pillow/Pillow) (MIT-CMU). They are written in
TypeScript for this package and contain none of those projects' code; each
function's comment says which call it stands in for and what was measured.

## 5. npm dependencies

| Package | Licence | Why |
| --- | --- | --- |
| [`spine-rigc`](https://www.npmjs.com/package/spine-rigc) | MIT | compile, gate, render and check; its PNG codec, font and coordinate conversion |
| ↳ [`@esotericsoftware/spine-core`](https://www.npmjs.com/package/@esotericsoftware/spine-core) | Spine Runtimes License | spine-rigc's round trip (section 2) |
| [`ag-psd`](https://www.npmjs.com/package/ag-psd) | MIT | reading an upstream See-through `.psd` |
| ↳ [`pako`](https://www.npmjs.com/package/pako) | MIT AND Zlib | ag-psd's deflate |
| ↳ [`base64-js`](https://www.npmjs.com/package/base64-js) | MIT | ag-psd's base64 |

Development only, not installed with the package: `typescript` (Apache-2.0),
`eslint` (MIT), `typescript-eslint` (MIT), `@types/bun` (MIT).
