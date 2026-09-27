---
name: spine-parts
description: Turn one anime character painting and its See-through layer decomposition into a verified Spine 4.3 rig — measured parts, weighted meshes, bone chains and a looping idle — with spine-parts, which gates everything through spine-rigc before it is written. Use for a request to rig or animate a single character painting in Spine, to run or read spine-parts layers, sheet, assemble, propose, rig, check, loop or build, or to write or fix a spine-parts config.json. Not for cutting art into parts by hand, for authoring a rig from loose PNGs (that is the rigc skill), for expressions or lip-sync, or for running See-through itself.
license: MIT
compatibility: Requires Bun 1.2 or later. The tool is the npm package spine-parts (bunx spine-parts, or bun add -d spine-parts); spine-rigc is installed with it. See-through is run separately.
---

# spine-parts — a painting to a Spine rig, for agents

spine-parts merges See-through's two layer runs over one painting into rig-space
parts, authors a rig spec and a motion spec over them, and hands those to
spine-rigc, which compiles, gates, packs and renders. You cannot see the painting,
the layers or the rig. The printed lines, `docs/AUTHORING.md` and the files each
stage writes are the whole interface.

## Non-negotiables

- **spine-rigc's round trip is never bypassed.** spine-parts writes no Spine data
  itself; `rig` writes only after rigc's build and validate are green, and `build`'s
  artifact is what rigc wrote. There is no flag that skips it, and none may be added.
- **No value is invented.** A missing config field is a refusal naming it. Take a
  value from the command that proposes it (`propose --head-box`,
  `assemble --propose-plan`, `propose`) or decide it yourself — never guess one
  because the tool refused.
- **The refusal is the instruction.** `FAIL  RULE: object — detail` names the object,
  the value found and the value required; AUTHORING §6 maps every rule to the field
  or input that has to change.
- **Green is not "looks right".** `check` measures the gates, the seam and the loop;
  seven judgements still need an eye (AUTHORING §7, issue #11). Say which you could
  not verify rather than reporting them as passed.

## The loop

1. `spine-parts inputs --source <painting> --config config.json --out <dir>` writes
   `st_input_full.png`, the painting on a white square. The config needs only `key`,
   `seethrough` and `assemble.rig_scale` at this point. Run See-through on it — any
   route; the optional `comfy seethrough` adapter only talks to a ComfyUI box.
2. `spine-parts layers <full run>` — read the table.
3. `spine-parts propose --head-box --full <full run> --canvas <W>x<H>` → put
   `head_box` in the config, run `inputs` again (it now also writes
   `st_input_head.png`, the crop at that box), and run See-through on the crop.
4. `spine-parts assemble --propose-plan …` → `config.assemble.plan` and
   `extend_below_crop`.
5. `spine-parts assemble … --out work`, then `spine-parts propose --parts work/rig
   --source <painting> --out work` → copy `bones`, `meshes`, `regions`, `motion`
   from `proposal.json` into the config.
6. Correct against `render/landmarks.png` and `note:` lines; `propose …
   --from-config config.json` until it prints no `LINT` line.
7. `spine-parts build --config … --source … --full … --head … --out out --loop`.
   It stops at the first stage that refuses, printing that stage's lines under
   `[assemble]`, `[rig]` or `[check]`. Fix what the FAIL line names and build again.
8. Read `out/check/check.json`. The artifact is the three paths the build prints
   last: `check/build/skeleton.json`, `skeleton.atlas` and the packed page. Report
   them with the pack line and the check figures verbatim.

`--seam silhouette` repairs more of the seam on white garments than the default
`near-white` (the demo: 11,050 → 9,540 recomposite error pixels); the default is
the reference implementation's rule. Name the rule you used in your report.

## What this will not do

- Run See-through or generate the painting itself. The optional `comfy seethrough`
  and `comfy paint` commands drive a ComfyUI box you name; nothing else here reaches
  a GPU or the network.
- Give a layer two depths: a layer in front of another in one place and behind it in
  another is right in the still and wrong in motion.
- Expressions, lip-sync, or any animation but one looping `idle`.
- Write animated WebP: `loop` writes GIF and APNG.
- Know what the art does not tag: a swinging element painted inside another layer,
  hair of an unfamiliar shape, whether an accessory swings. Those are yours to add.
- Promise a success rate. Two public characters and eight private ones check green;
  that is all that has been measured.

## Where to read next

[docs/AUTHORING.md](https://github.com/firejune/spine-parts/blob/main/docs/AUTHORING.md)
first — every config field, the command order, what to read after each stage, every
refusal. It is in the installed package at `node_modules/spine-parts/docs/AUTHORING.md`,
the copy that matches the version you run. A `RIG_RIGC_GREEN` or `CHECK_RIGC_GREEN`
line quotes spine-rigc's own assertion; spine-rigc's guide for those is
`node_modules/spine-rigc/docs/AUTHORING.md`, and its `rigc` skill covers the compiler.
