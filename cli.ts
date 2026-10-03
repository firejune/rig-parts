#!/usr/bin/env bun
/**
 * spine-parts — one painting and its See-through layers in, Spine-ready parts
 * and rig specs out, verified through spine-rigc.
 *
 * Every command prints named, numeric findings and nothing else an agent has
 * to interpret: a refusal is a `FAIL` line naming the rule, the object, the
 * value found and the value required. Exit codes are part of that interface:
 *
 *   0  the command did what it says
 *   1  it refused its input — every refusal is printed as a FAIL line
 *   2  a usage error, or a command this version does not implement
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE, HOLES_LISTED, PROJECT_RULES, type ProjectRule, proposeFields, proposePlan, SEAM_RULES, type SeamRule } from './src/assemble.ts';
import { assembleStage, build, checkStage, ERROR_MAP_FILE, loopStage, readRuns, readSource, rigStage } from './src/build.ts';
import { DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, findRigc, PACK_SHAPES, type PackShape, PAGE_EDGES, type PageEdges, PARTS_HOME_SENTENCE, RIGC_GEOMETRY_VERSION, type RigcRunner, SEAM_MEAN_BAR, SEAM_PX_BAR, SEAM_PX_LEVEL, SPINEBOY_YARDSTICK, TEXTURE_STRETCH_CEILING } from './src/check.ts';
import { ComfyClient, resolveHost, runPainting, runSeeThrough } from './src/comfy/index.ts';
import { type CharacterConfig, loadConfig, loadEarlyConfig } from './src/config.ts';
import { PartsError, problemLine } from './src/errors.ts';
import { proposeHeadBox } from './src/headbox.ts';
import { makeInputs } from './src/inputs.ts';
import { DEFAULT_IDLE_KEYS, IDLE_KEYS, type IdleKeys } from './src/rig.ts';
import { figuresPhrase, implausibleRules, layerFigures, type LayerSet, pct, readLayers, ruleSummary, times } from './src/layers.ts';
import { checkProposal, compare, compareLines, drawLandmarks, HIP_MIN_FRACTION, lint, lintLine, type PartSet, propose, readPartSet, serializeProposal } from './src/propose.ts';
import { readPng, writePng } from './src/raster/png.ts';
import { buildSheet, defaultCaption, type Tile, tilesFrom } from './src/sheet.ts';

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

function version(): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? '(no version field)';
}

/**
 * The commands a later version will carry, registered now so the surface and
 * the help are honest about what exists. Each one exits 2 with the same
 * sentence, and the selftest holds every name here to that. Empty in this
 * version — every command is real — and kept so the next one has a place.
 */
const LATER: ReadonlyArray<[string, string]> = [];

const HELP = `spine-parts ${version()} — Spine-ready parts from one painting and its See-through layers

usage:
  spine-parts layers <dir | layers.json | file.psd>
      Read a See-through decomposition — the ComfyUI wrapper form (a directory
      holding layers.json and one PNG per layer) or an upstream .psd — and print
      every layer: draw order, name, tag group, box, size, opaque pixels, depth,
      and three plausibility figures over its opaque pixels — translucent share
      (alpha below 128), background share (min channel above 235) and area as a
      multiple of the rest of the figure (the other layers' union). A layer that
      crosses a plausibility rule gets a WARN line naming the rule and the bar;
      --propose-plan leaves it out. Refuses, by name, a missing file, an
      unknown tag, a PNG whose size is not its box, and anything else outside
      the input contract — never a WARN.

  spine-parts sheet --source <painting.png> --layers <path> [--layers <path> ...]
                    --out <sheet.png> [--cell <px>] [--cols <n>]
      A contact sheet: the painting, then every layer or part, each on a
      checkerboard and labelled with its name, size and opaque pixel count.
      --layers takes anything \`layers\` reads, or a parts.json (its PNGs are read
      from parts/ beside it). --cell defaults to 220, --cols to 8; both are
      printed. The same information is printed as text.

  spine-parts propose --parts <dir> --source <painting.png> --out <dir> [--compare <config.json>]
      Propose bones, meshes, regions and an idle from the assembled parts (<dir>
      holds parts.json and parts/). Roles come from each part's See-through tag,
      never its name. Writes <out>/proposal.json (config-shaped: bones, meshes,
      regions, motion with its blink — and a blink.still cut for a lash that
      reaches far above its eyewhite, when a clear row allows one; no blink
      when no part is an eyewhite, and no brows in it when no part is an
      eyebrow, each said in a note; an iris or lash on a side with no
      eyewhite rides head, said in a note — and notes)
      and the overlay to correct against, <out>/render/landmarks.png and
      landmarks_head.png. Prints every
      note and a LINT line for each chain link that lies off its mesh's art, for a
      hip that is not below the chest, and for a hip above ${HIP_MIN_FRACTION} of the figure's
      height (the shoulders); a headwear/earwear layer with hanging strands
      gets one pendulum chain per strand and a note with each strand's x, rows
      and width ("-- no chain proposed" is the one to act on; AUTHORING §3).
      --compare prints each shared bone's distance, proposal to config, in px.

  spine-parts propose --parts <dir> --source <painting.png> --out <dir> --from-config <config.json>
      Draw the config's CURRENT bones instead (<out>/render/landmarks_config.png
      and _head) and LINT them. Exits 1 when any LINT line is printed.

  spine-parts propose --head-box --full <dir | layers.json | file.psd> --canvas <W>x<H>
      Propose seethrough.head_box (source px, square) from the full run's
      layers for a painting of WxH px, held inside the painting; a shift is
      printed when one was needed.

  spine-parts rig --config <config.json> --parts <dir> --out <dir> [--idle-keys ctl|direct]
                  [--page-edges pot|free] [--pack-shape rect|polygon]
      Author the rig: unrotated bones at the config's landmarks (a chain makes
      <chain>0..n), a square lattice mesh over every part in config.meshes
      weighted by distance to its candidate bone segments, a region for every
      part in config.regions (a motion.blink.still part as two: the rows above
      its row on a second slot <part>_still, which the blink does not move),
      and one idle of sines and a blink whose closed hold is at least one
      12 fps frame, so the idle frames and the loop show the eyes shut
      (RIG_BLINK_HOLD_SPANS_A_FRAME otherwise); no blink when the config
      states no motion.blink, and a blink group that names no bone, or one
      bone twice, is refused by the loader, CONFIG_BLINK_GROUP_MEMBERS or
      CONFIG_BLINK_GROUP_UNIQUE, before rigc starts, as are two tracks on one
      bone property, CONFIG_BONE_PROPERTY_KEYED_ONCE. --parts is the
      directory holding parts.json and parts/<name>.png. The result is built
      through spine-rigc (profile spine-html, packed with --page-edges and
      --pack-shape as for check; rigc's build gates the compile and the packed pages on disk) in a
      scratch directory first, and --out receives images/*.png, rig.json,
      motion.json and mesh_report.json only when it is green. Prints one line
      per mesh and the rigc gate lines.
      --idle-keys says where the idle's keys on a bone a mesh is weighted to go:
      ctl (the default) keys a same-origin <bone>_ctl parent instead, which
      passes A15_IDLE_NO_MESH_BONE_KEYS on any spine-rigc; direct keys the bone
      itself and declares invariants.idleDrivesMeshes in rig.json, which needs
      spine-rigc 1.3.0 or later and makes A15 a SKIP that prints its cost (the
      stage prints that SKIP line). The pose is the same to one level of float
      rounding, and so is the per-frame mesh work (AUTHORING §5).
  spine-parts check --rig <dir> --out <dir> [--parts <dir>] [--page-edges pot|free]
                    [--pack-shape rect|polygon]
      Build, gate, render and measure a rig through spine-rigc's CLI (the rigc at
      node_modules/.bin/rigc, or on PATH). --rig holds rig.json and motion.json
      (with an "idle").
      ${PARTS_HOME_SENTENCE}.
      Both are only read. Into --out:
      build/ (rigc build --profile spine-html --pack --page-edges <value>
      --pack-shape <value>: the packed atlas is the artifact), gate_spine-html.txt (the gate lines
      verbatim), idle_frames/ (rigc render --animation idle --fps 12 --max 640
      --geometry: the frames and geometry.json, the skinned vertices and
      every bone's world transform per frame),
      contact.png, motion_heat.png and check.json (with rigc_entry, the rigc
      entry that gated the build, and pack_mode, the two pack flags). PASS needs every gate summary
      "0 failed", the seam (setup pose vs the flat composite of parts/) at mean
      |d| <= ${SEAM_MEAN_BAR.toFixed(1)} with <= ${SEAM_PX_BAR} px over ${SEAM_PX_LEVEL}, and the loop (idle frame 0 vs the
      frame at t = duration) at max |d| 0. Then six judgement lines, each in
      check.json and on the console as NAME: PASS|FAIL|SKIP with its figures and
      bars (AUTHORING §7): BREATH_VISIBLE (the topwear moves, the footwear does
      not, each rendered alone), BLINK_NO_HOLE (the setup pose with the blink
      held shut shows no background inside the eyewhite box), CHAIN_LAG (every
      rotate track lags its keyed ancestor and amplitude grows down each
      chain, read off motion.json), TIP_OVER_ROOT (each handwear/bottomwear
      part's lower half travels further than its upper half),
      STILL_REGIONS_DARK (the face outline in the frame of the bone the face's
      slot rides, at most twice the resampler's own error on this rig — read
      off the whole rig moved rigidly as the idle moves that bone — with the
      screen-space figure reported beside it; the feet in screen space) and
      TEXTURE_STRETCH (every mesh triangle's edges over the idle against their
      rest length, max(ratio, 1/ratio) <= ${TEXTURE_STRETCH_CEILING}; the worst
      triangle is named by slot, triangle, vertices, edge and frame).
      Needs spine-rigc ${RIGC_GEOMETRY_VERSION} or later, whose render writes
      geometry.json; an older rigc is refused, CHECK_RIGC_VERSION, before
      anything is built.
      Regions come from parts.json's See-through tags; a line with nothing to
      read says SKIP and why — neither a pass nor a failure — and PASS needs
      every line that measured to be PASS. Then RECOMPOSITE_HOLES: REPORTED,
      read from parts.json's recomposite block (uncovered error px, hole count,
      the largest hole's box and the parts bordering it) — a line with no bar,
      never a FAIL, because a pixel no part holds is missing from both sides of
      the seam; SKIP when parts.json has no such block. Prints the pack line
      beside the spineboy yardstick (${SPINEBOY_YARDSTICK}), a reference and not
      a bar. Exit 0 on PASS, 1 on FAIL — every FAIL line names the bar, the value
      and the value required.
      --page-edges is handed to rigc verbatim and defaults to ${DEFAULT_PAGE_EDGES}: the
      least-area page the parts need (on the two public examples, rect, 967x1338
      and 479x1166, where pot writes 1024x2048 and 512x2048), at the cost rigc
      states — region attachments sample within 1 LSB of the loose build
      rather than exactly (measured on both examples: every idle frame within
      1 level of the pot build's; AUTHORING §5, Page edges). pot is a power of two on both edges, for a consumer
      that mipmaps or repeats the page (the atlas declares filter Linear,
      Linear and no repeat). rigc's pack line carries ", page edges free" under
      free; a line that disagrees with the value passed, or a pot page that is
      not a power of two, is refused, CHECK_PACK_PAGE_EDGES.
      --pack-shape is handed to rigc verbatim and defaults to ${DEFAULT_PACK_SHAPE}:
      a region only meshes draw is packed by its emitted hull, so a neighbour
      may sit inside its rectangle where the hull is not (on the two public
      examples, under free, 922x1348 and 477x1151 where rect writes 967x1338
      and 479x1166), at the cost of the same 1-level class as free (measured
      on both examples: every idle frame within 1 level of the rect build's;
      AUTHORING §5, Pack shape). rect keeps every region's cell apart and
      writes the page earlier releases wrote. rigc's pack line ends
      ", shape rect" or ", shape polygon"; a line that disagrees with the
      value passed is refused, CHECK_PACK_SHAPE.

  spine-parts loop --frames <dir> --out <file.png | file.gif> [--palette]
      Encode a frame set rigc render wrote (its --out directory, or the set
      directory inside it) as a looping animation: .png writes an APNG
      (acTL/fcTL/fdAT, lossless — the exactness record), .png with --palette an
      indexed APNG (colour type 3, one palette for every frame: 255 median-cut
      colours plus one transparent entry, alpha graded per entry, no dithering,
      filter None — the README-sized file), .gif a GIF89a (the same 255-colour
      median cut, no dithering, LZW, delays rounded so the loop's length is
      exact). The indexed APNG and the GIF print their palette error, per
      channel over every frame. The fps is read from frames.json. When the last
      frame equals frame 0 it is dropped, and the output says so: the loop wraps
      onto frame 0 itself. Animated WebP is not written — it needs a VP8/VP8L
      encoder, out of scope.

  spine-parts assemble --source <painting.png> --full <dir|psd> --head <dir|psd>
                       --config <config.json> --out <dir> [--seam near-white|silhouette]
                       [--project core|visible]
      Merge the full-body and head-crop See-through runs into rig-space parts:
      <out>/rig/parts/<name>.png (each cropped to its alpha box), <out>/rig/parts.json,
      <out>/render/recomposite_rig.png and <out>/render/${ERROR_MAP_FILE} (the error
      map: uncovered error px red, covered error px blue, the rest the painting in
      light grey). Reads config.seethrough.head_box and
      .resolution and config.assemble.rig_scale, .plan, .extend_below_crop and
      .patches — extra parts cut from the painting itself over a rig-pixel box
      (alpha "silhouette": the painting's figure inside it; "box": all of it),
      drawn "back", "front" or {"before": <plan part>}, recorded in parts.json
      as from "painting:<name>" and counted 100 % source — and no rig section:
      bones, meshes, regions and motion need not exist yet, because propose
      drafts them from these parts (AUTHORING §4, the table).
      Prints one line per part, the seam override counts, the \`pixels:\` totals
      (opaque = visible + occluded; taken from the painting; visible but not
      projected), and \`recomposite vs source\` (mean |d| and % within 8 over the
      mean channel; error px: max channel > 40; uncovered: of those, where no
      part has alpha above 128), then the uncovered holes (8-connected) and the
      largest ${HOLES_LISTED}, each \`uncovered hole N: <px> px at x,y wxh (between
      "<part>" <px> px, …)\` — the list parts.json holds under recomposite.
      Writes nothing unless every check passed.
      --seam defaults to ${DEFAULT_SEAM_RULE}. --project says where a layer takes
      the painting's pixel: core (the reference's) erodes every layer's top-most
      opaque area by 5x5 first, so a part a few pixels wide takes none; visible
      erodes only along a rim where a later layer is in front. It defaults to
      ${DEFAULT_PROJECT_RULE}.

  spine-parts assemble --propose-plan --source <painting.png> --full <dir|psd>
                       --head <dir|psd> --config <config.json>
      Print {plan, extend_below_crop, notes} for config.assemble, from the two
      runs. A layer \`layers\` WARNs about (PLAN_LAYER_TRANSLUCENT,
      PLAN_LAYER_BACKGROUND, PLAN_LAYER_OVERSIZED) is not proposed, and a note
      names it, its figures and the rule. Reads only config.seethrough.head_box,
      config.seethrough.resolution and config.assemble.rig_scale — the rest of
      the config need not exist yet.

  spine-parts inputs --source <painting.png> --config <config.json> --out <dir>
      Cut the two images See-through is fed: <out>/st_input_full.png (the
      painting centred on a white square as tall as it is) and, when the config
      sets seethrough.head_box, <out>/st_input_head.png (that box, cropped at
      its exact size). Refuses a landscape or translucent painting and a head
      box outside the painting, by name.

  spine-parts comfy seethrough --image <png> --out <dir> [--host <url>]
                    [--resolution 1024] [--steps 30] [--seed 42] [--offload] [--lama] [--nf4]
                    [--prefix spine_parts] [--wait 1800] [--timeout 3600] [--poll 3]
      Optional. Run See-through on a ComfyUI box with the jtydhr88/ComfyUI-See-through
      wrapper installed, and write the wrapper form \`layers\` reads into <out>
      (absent or empty): layers.json, parts/<tag>.png, meta.json, previews/.
      The host is --host or COMFY_HOST and has no default. Checks every node and
      input against the box's /object_info before uploading, waits for an empty
      queue (at most --wait s), polls /history (at most --timeout s), and
      writes <out> only after the layer reader accepts what came back.
      --lama turns the wrapper's LaMa inpainting on and --nf4 its nf4
      quantisation; both are off unless given, as --offload is.

  spine-parts comfy paint --config <config.json> --out <dir> [--host <url>]
                    [--seeds 1] [--seed0 <generation.seed>] [--wait 1800] [--timeout 3600] [--poll 3]
      Optional. Generate the painting from the config's inline generation block:
      <out>/painting_<seed>.png and painting_<seed>_meta.json (the prompts
      verbatim, checkpoint, LoRAs, sampler, control, elapsed) for --seeds
      seeds from --seed0, and control_<skeleton>.png when generation.control
      is set. The pose words are generation.pose, or the control skeleton's own.
      The config needs only key and generation here; the rest comes later.

  spine-parts build --config <config.json> --source <painting.png> --full <dir|psd>
                    --head <dir|psd> --out <dir> [--seam near-white|silhouette]
                    [--project core|visible] [--page-edges pot|free]
                    [--pack-shape rect|polygon] [--loop]
      assemble, then rig, then check, in one process, each stage's own lines
      printed under [assemble], [rig] and [check]; the first stage that refuses
      stops the build with its own FAIL lines. The config must already carry
      bones, meshes, regions and motion — propose is not a step of build: run it,
      correct the proposal against its overlay, and write the result into the
      config. Into --out: parts/ + parts.json + recomposite_rig.png +
      ${ERROR_MAP_FILE} (assemble),
      rig/ (rig), check/ (check, with the packed build in check/build/), and with
      --loop idle.png (lossless APNG), idle-indexed.png (indexed APNG) and
      idle.gif from check/idle_frames/, then one loop: line with the three sizes
      and the two palette errors. The paths it writes are cleared first. A
      green build ends with the pack line beside the spineboy yardstick and the
      three artifact paths — skeleton .json, .atlas and the packed page: the
      packed atlas is the result, the loose parts are the intermediate it was
      made from. --seam defaults to ${DEFAULT_SEAM_RULE}, --project to
      ${DEFAULT_PROJECT_RULE} (both as for assemble), --page-edges to ${DEFAULT_PAGE_EDGES} and
      --pack-shape to ${DEFAULT_PACK_SHAPE} (as for check; both packed builds, rig's gate
      and check's artifact, take them).

  spine-parts --version
  spine-parts --help

${LATER.length === 0 ? '' : `not implemented in this version (each exits 2):\n${LATER.map(([name, what]) => `  ${name.padEnd(9)} ${what}`).join('\n')}\n\n`}exit codes: 0 done, 1 input refused (FAIL lines name every reason), 2 usage or not implemented
`;

function printRefusal(err: unknown): number {
  if (err instanceof PartsError) {
    for (const p of err.problems) console.log(`  FAIL  ${problemLine(p)}`);
    console.log(`refused: ${err.problems.length} problem(s)`);
    return EXIT_REFUSED;
  }
  throw err;
}

function usage(message: string): number {
  console.log(`  FAIL  USAGE: ${message}`);
  console.log('spine-parts --help lists the commands');
  return EXIT_USAGE;
}

function fixed(v: number | null): string {
  return v === null ? '-' : v.toFixed(4);
}

function printLayerTable(set: LayerSet): void {
  console.log(`spine-parts layers: ${set.form === 'wrapper' ? 'ComfyUI wrapper form' : 'PSD'}, ${set.source}`);
  console.log(`  canvas ${set.canvas.w}x${set.canvas.h}, ${set.layers.length} layer(s), back to front`);
  const figures = layerFigures(set);
  const rows = set.layers.map((l, i) => [
    String(l.drawOrder),
    l.name,
    l.tag.group,
    `${l.left},${l.top}`,
    `${l.right},${l.bottom}`,
    `${l.pixels.width}x${l.pixels.height}`,
    String(l.opaquePx),
    fixed(l.depth),
    pct(figures[i].translucent),
    pct(figures[i].background),
    times(figures[i].areaRatio),
  ]);
  const head = ['order', 'name', 'group', 'left,top', 'right,bottom', 'size', 'opaque_px', 'depth', 'translucent', 'background', 'area'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`.trimEnd();
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  const painted = set.layers.filter((l) => l.opaquePx > 0).length;
  console.log(`  ${set.layers.length} layer(s): ${painted} with opaque pixels, ${set.layers.length - painted} with none`);
  // A reader refuses nothing on plausibility: it says what --propose-plan will leave out, and why.
  let warned = 0;
  for (const f of figures) {
    for (const rule of implausibleRules(f)) {
      console.log(`  WARN  ${rule}: layer "${f.name}" — ${figuresPhrase(f)}; ${ruleSummary(rule)} is required, so --propose-plan leaves it out`);
      warned++;
    }
  }
  console.log(`  ${warned} WARN line(s)`);
}

function cmdLayers(args: string[]): number {
  if (args.length !== 1) return usage(`layers takes one path; got ${args.length}`);
  try {
    printLayerTable(readLayers(args[0]));
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdSheet(args: string[]): number {
  const layers: string[] = [];
  let source: string | null = null;
  let out: string | null = null;
  let cell = 220;
  let cols = 8;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--source', '--layers', '--out', '--cell', '--cols'].includes(flag)) return usage(`sheet does not take "${flag}"`);
    if (value === undefined) return usage(`${flag} needs a value`);
    i++;
    if (flag === '--source') source = value;
    else if (flag === '--layers') layers.push(value);
    else if (flag === '--out') out = value;
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < (flag === '--cell' ? 40 : 1)) {
        return usage(`${flag} ${value} is not an integer of at least ${flag === '--cell' ? 40 : 1}`);
      }
      if (flag === '--cell') cell = n;
      else cols = n;
    }
  }
  if (source === null) return usage('sheet needs --source <painting.png>');
  if (layers.length === 0) return usage('sheet needs at least one --layers <path>');
  if (out === null) return usage('sheet needs --out <sheet.png>');
  if (extname(out).toLowerCase() !== '.png') return usage(`--out ${out} is not a .png; the sheet is written as PNG only`);
  try {
    if (!existsSync(source)) {
      throw new PartsError([{ code: 'SHEET_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is the first tile' }]);
    }
    const src = readPng(source);
    const tiles: Tile[] = [{ name: 'source', image: src, caption: basename(source) }];
    for (const path of layers) tiles.push(...tilesFrom(path));
    const sheet = buildSheet(tiles, cols, cell);
    // The README's loop writes sheets/layers.png into a folder nothing made yet;
    // every other command creates its --out, so this one does too.
    mkdirSync(dirname(out), { recursive: true });
    writePng(out, sheet);
    console.log(`spine-parts sheet: ${out}`);
    console.log(`  ${tiles.length} tile(s) in ${cols} column(s) of ${cell} px, sheet ${sheet.width}x${sheet.height}`);
    tiles.forEach((t, i) => console.log(`  tile ${String(i).padStart(3)}  ${t.name}  ${t.caption ?? defaultCaption(t.image)}`));
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

/** `--page-edges`, or its default; a value spine-rigc does not take is a usage error naming the two it does. */
function pageEdgesOf(value: string | undefined): PageEdges | string {
  const edges = value ?? DEFAULT_PAGE_EDGES;
  return (PAGE_EDGES as readonly string[]).includes(edges) ? (edges as PageEdges) : `--page-edges ${edges}; one of ${PAGE_EDGES.join(', ')} is required`;
}

function isPageEdges(v: PageEdges | string): v is PageEdges {
  return (PAGE_EDGES as readonly string[]).includes(v);
}

/** `--pack-shape`, or its default; a value spine-rigc does not take is a usage error naming the two it does. */
function packShapeOf(value: string | undefined): PackShape | string {
  const shape = value ?? DEFAULT_PACK_SHAPE;
  return (PACK_SHAPES as readonly string[]).includes(shape) ? (shape as PackShape) : `--pack-shape ${shape}; one of ${PACK_SHAPES.join(', ')} is required`;
}

function isPackShape(v: PackShape | string): v is PackShape {
  return (PACK_SHAPES as readonly string[]).includes(v);
}

function cmdRig(args: string[]): number {
  let config: string | null = null;
  let partsDir: string | null = null;
  let out: string | null = null;
  let idleKeys: string | null = null;
  let pageEdges: string | null = null;
  let packShape: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--config', '--parts', '--out', '--idle-keys', '--page-edges', '--pack-shape'].includes(flag)) return usage(`rig does not take "${flag}"`);
    if (value === undefined) return usage(`${flag} needs a value`);
    i++;
    if (flag === '--config') config = value;
    else if (flag === '--parts') partsDir = value;
    else if (flag === '--idle-keys') {
      if (idleKeys !== null) return usage('--idle-keys is given twice');
      idleKeys = value;
    } else if (flag === '--page-edges') {
      if (pageEdges !== null) return usage('--page-edges is given twice');
      pageEdges = value;
    } else if (flag === '--pack-shape') {
      if (packShape !== null) return usage('--pack-shape is given twice');
      packShape = value;
    } else out = value;
  }
  if (config === null) return usage('rig needs --config <config.json>');
  if (partsDir === null) return usage('rig needs --parts <dir> (the directory holding parts.json and parts/)');
  if (out === null) return usage('rig needs --out <dir>');
  const keys = idleKeys ?? DEFAULT_IDLE_KEYS;
  if (!(IDLE_KEYS as readonly string[]).includes(keys)) return usage(`--idle-keys ${keys}; one of ${IDLE_KEYS.join(', ')} is required`);
  const edges = pageEdgesOf(pageEdges ?? undefined);
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(packShape ?? undefined);
  if (!isPackShape(shape)) return usage(shape);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'spine-parts-rig-'));
  try {
    rigStage({ config, parts: partsDir, out, idleKeys: keys as IdleKeys, pageEdges: edges, packShape: shape }, rigcRunner(bin), scratch, console.log);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The rigc process, for every stage that runs rigc — `rig`'s gate, `check`, and
 * both inside `build`: the `rigc` binary {@link findRigc} located, spawned as
 * it is, so spine-rigc's own launcher (`bin/rigc.cjs`) chooses the entry —
 * `cli.ts` and the spine-core round trip where the runtime resolves beside it,
 * `cli_core.ts` and rigc's own validator where it does not. No stage runs a
 * rigc source file by path: under spine-rigc 2.0, `cli.ts` by path is the
 * spine-core entry whether or not spine-core is there. `src/` is pure and takes
 * the spawn from here.
 */
function rigcRunner(bin: string): RigcRunner {
  return (args) => {
    const r = spawnSync(bin, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error !== undefined) return { status: 127, out: `could not start ${bin}: ${r.error.message}` };
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
}

function flags(args: string[], known: readonly string[], command: string, optional: readonly string[] = []): Map<string, string> | string {
  const got = new Map<string, string>();
  const all = [...known, ...optional];
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!all.includes(flag)) return `${command} does not take "${flag}"; it takes ${all.join(', ')}`;
    if (args[i + 1] === undefined) return `${flag} needs a value`;
    if (got.has(flag)) return `${flag} is given twice`;
    got.set(flag, args[i + 1]);
  }
  for (const k of known) if (!got.has(k)) return `${command} needs ${k} <value>`;
  return got;
}

function cmdCheck(args: string[]): number {
  const f = flags(args, ['--rig', '--out'], 'check', ['--parts', '--page-edges', '--pack-shape']);
  if (typeof f === 'string') return usage(f);
  const rig = f.get('--rig') as string;
  const out = f.get('--out') as string;
  const edges = pageEdgesOf(f.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(f.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  try {
    const bin = findRigc(import.meta.dir, process.env.PATH ?? '');
    const r = checkStage({ rig, parts: f.get('--parts') ?? rig, out, pageEdges: edges, packShape: shape }, rigcRunner(bin), bin, console.log);
    return r.figures.PASS ? EXIT_OK : EXIT_REFUSED;
  } catch (err) {
    return printRefusal(err);
  }
}

function parseCanvas(v: string): { w: number; h: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(v);
  return m === null ? null : { w: Number(m[1]), h: Number(m[2]) };
}

function printLint(P: PartSet, spec: { bones: CharacterConfig['bones']; meshes: CharacterConfig['meshes'] }): number {
  const res = lint(P, spec);
  for (const f of res.findings) console.log(lintLine(f));
  for (const m of res.unknownMeshes) console.log(`note: mesh ${JSON.stringify(m)} names no part in parts.json, so it was not linted`);
  for (const b of res.missingTorsoBones) console.log(`note: no single bone named ${JSON.stringify(b)}, so the hip was not linted against the chest${b === 'hip' ? ' or the figure height' : ''}`);
  console.log(`${res.findings.length} LINT line(s) over ${Object.keys(spec.meshes).length - res.unknownMeshes.length} mesh(es) and the hip`);
  return res.findings.length;
}

function cmdPropose(args: string[]): number {
  const flags = new Map<string, string>();
  let headBox = false;
  const valued = ['--parts', '--source', '--out', '--from-config', '--compare', '--full', '--canvas'];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--head-box') {
      headBox = true;
      continue;
    }
    if (!valued.includes(flag)) return usage(`propose does not take "${flag}"; it takes --head-box and ${valued.join(', ')}`);
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  try {
    if (headBox) {
      const stray = [...flags.keys()].filter((f) => f !== '--full' && f !== '--canvas');
      if (stray.length > 0) return usage(`--head-box takes --full and --canvas only; got ${stray.join(', ')}`);
      const full = flags.get('--full');
      const canvasArg = flags.get('--canvas');
      if (full === undefined) return usage('--head-box needs --full <dir | layers.json | file.psd>, the full run\'s layers');
      if (canvasArg === undefined) return usage('--head-box needs --canvas <W>x<H>, the painting\'s size in px');
      const canvas = parseCanvas(canvasArg);
      if (canvas === null) return usage(`--canvas ${canvasArg} is not <W>x<H> in integer px`);
      const r = proposeHeadBox(readLayers(full), canvas);
      console.log(`spine-parts propose --head-box: ${full}`);
      console.log(`  painting ${canvas.w}x${canvas.h}; head layers ${r.layers.map(([n, c]) => `${n} ${c} px`).join(', ')}`);
      if (r.shift[0] !== 0 || r.shift[1] !== 0) {
        console.log(`  clamped: the proposed box [${r.unclamped.join(', ')}] leaves the ${canvas.w}x${canvas.h} painting; shifted by ${r.shift[0]},${r.shift[1]} px at the same size`);
      } else console.log('  inside the painting, no shift');
      console.log(`  head_box [${r.head_box.join(', ')}], ${r.head_box[2] - r.head_box[0]}x${r.head_box[3] - r.head_box[1]}`);
      console.log(JSON.stringify({ head_box: r.head_box }));
      return EXIT_OK;
    }
    for (const f of ['--full', '--canvas']) if (flags.has(f)) return usage(`${f} belongs to --head-box`);
    const partsArg = flags.get('--parts');
    const source = flags.get('--source');
    const out = flags.get('--out');
    if (partsArg === undefined) return usage('propose needs --parts <dir>, the directory holding parts.json and parts/');
    if (source === undefined) return usage('propose needs --source <painting.png>, drawn under the overlay');
    if (out === undefined) return usage('propose needs --out <dir>');
    if (flags.has('--from-config') && flags.has('--compare')) return usage('--from-config and --compare are two modes; give one');
    const partsDir = existsSync(partsArg) && statSync(partsArg).isFile() ? dirname(partsArg) : partsArg;
    if (!existsSync(source)) {
      throw new PartsError([{ code: 'PROPOSE_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is drawn under the overlay' }]);
    }
    const P = readPartSet(partsDir);
    const painting = readPng(source);
    const render = join(out, 'render');
    const fromConfig = flags.get('--from-config');
    if (fromConfig !== undefined) {
      const cfg = loadConfig(fromConfig);
      const img = drawLandmarks(P, painting, cfg.bones, 'config bones');
      mkdirSync(render, { recursive: true });
      writePng(join(render, 'landmarks_config.png'), img.full);
      if (img.head !== null) writePng(join(render, 'landmarks_config_head.png'), img.head);
      console.log(`wrote ${join(render, 'landmarks_config.png')}${img.head !== null ? ' (+_head)' : ' (no bone named "head", so no head crop)'}`);
      return printLint(P, cfg) > 0 ? EXIT_REFUSED : EXIT_OK;
    }
    const cmpPath = flags.get('--compare');
    const cfg = cmpPath === undefined ? null : loadConfig(cmpPath);
    const prop = propose(P);
    // Emit only after green: a proposal the config loader would refuse is not written.
    checkProposal(P, prop);
    const img = drawLandmarks(P, painting, prop.bones, 'PROPOSAL - CORRECT ME');
    mkdirSync(render, { recursive: true });
    writeFileSync(join(out, 'proposal.json'), serializeProposal(prop));
    writePng(join(render, 'landmarks.png'), img.full);
    if (img.head !== null) writePng(join(render, 'landmarks_head.png'), img.head);
    console.log(`wrote proposal.json (${prop.bones.length} bone entries, ${Object.keys(prop.meshes).length} meshes) and render/landmarks.png (+_head) under ${out}`);
    for (const n of prop.notes) console.log(`note: ${n}`);
    printLint(P, prop);
    if (cfg !== null) for (const l of compareLines(compare(prop.bones, cfg.bones))) console.log(l);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdLoop(args: string[]): number {
  const palettes = args.filter((a) => a === '--palette').length;
  if (palettes > 1) return usage('--palette is given twice');
  const f = flags(
    args.filter((a) => a !== '--palette'),
    ['--frames', '--out'],
    'loop',
  );
  if (typeof f === 'string') return usage(f);
  const out = f.get('--out') as string;
  const ext = extname(out).toLowerCase();
  if (ext === '.webp') return usage(`--out ${out}: animated WebP needs a VP8/VP8L encoder, which is out of scope; write .png (APNG) or .gif`);
  if (ext !== '.png' && ext !== '.gif') return usage(`--out ${out} is neither .png (APNG) nor .gif`);
  if (palettes === 1 && ext !== '.png') return usage(`--palette selects the indexed APNG, so --out must be a .png; ${out} is a GIF, which is always one palette`);
  try {
    loopStage(f.get('--frames') as string, out, ext === '.gif' ? 'gif' : palettes === 1 ? 'indexed' : 'apng', console.log);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdAssemble(args: string[]): number {
  const flags = new Map<string, string>();
  let propose = false;
  const valued = ['--source', '--full', '--head', '--config', '--out', '--seam', '--project'];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--propose-plan') {
      propose = true;
      continue;
    }
    if (!valued.includes(flag)) return usage(`assemble does not take "${flag}"`);
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  for (const f of ['--source', '--full', '--head', '--config']) if (!flags.has(f)) return usage(`assemble needs ${f}`);
  if (propose && (flags.has('--out') || flags.has('--seam') || flags.has('--project'))) return usage('--propose-plan prints to the console; it takes none of --out, --seam, --project');
  if (!propose && !flags.has('--out')) return usage('assemble needs --out <dir>');
  const seam = flags.get('--seam') ?? DEFAULT_SEAM_RULE;
  if (!(SEAM_RULES as readonly string[]).includes(seam)) return usage(`--seam ${seam}; one of ${SEAM_RULES.join(', ')} is required`);
  const project = flags.get('--project') ?? DEFAULT_PROJECT_RULE;
  if (!(PROJECT_RULES as readonly string[]).includes(project)) return usage(`--project ${project}; one of ${PROJECT_RULES.join(', ')} is required`);
  const [source, full, head, config] = ['--source', '--full', '--head', '--config'].map((f) => flags.get(f) as string);
  try {
    if (propose) {
      const src = readSource(source);
      const runs = readRuns(full, head);
      const g = proposeFields(loadEarlyConfig(config, 'layers'));
      const proposal = proposePlan(runs.full, runs.head, { sourceW: src.width, sourceH: src.height, ...g });
      console.log(JSON.stringify(proposal, null, 2));
      return EXIT_OK;
    }
    const out = flags.get('--out') as string;
    assembleStage(
      { source, full, head, config, seam: seam as SeamRule, project: project as ProjectRule },
      { partsJson: join(out, 'rig', 'parts.json'), partsDir: join(out, 'rig', 'parts'), recomposite: join(out, 'render', 'recomposite_rig.png'), errorMap: join(out, 'render', ERROR_MAP_FILE) },
      console.log,
    );
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

/** Parse `--flag value` pairs and bare `--switch`es; a string is a usage error. */
function comfyFlags(args: string[], valued: readonly string[], switches: readonly string[], command: string): { v: Map<string, string>; on: Set<string> } | string {
  const v = new Map<string, string>();
  const on = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (switches.includes(flag)) {
      if (on.has(flag)) return `${flag} is given twice`;
      on.add(flag);
      continue;
    }
    if (!valued.includes(flag)) return `${command} does not take "${flag}"; it takes ${[...valued, ...switches].join(', ')}`;
    const value = args[i + 1];
    if (value === undefined) return `${flag} needs a value`;
    if (v.has(flag)) return `${flag} is given twice`;
    v.set(flag, value);
    i++;
  }
  return { v, on };
}

/** An integer flag at or above `min`, or its stated default; a string is a usage error. */
function intFlag(v: Map<string, string>, flag: string, fallback: number, min: number): number | string {
  const raw = v.get(flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : `${flag} ${raw} is not an integer of at least ${min}`;
}

/** A seconds flag above 0, or its stated default. */
function secondsFlag(v: Map<string, string>, flag: string, fallback: number): number | string {
  const raw = v.get(flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : `${flag} ${raw} is not a number of seconds above 0`;
}

const COMFY_TIMING = ['--host', '--wait', '--timeout', '--poll'] as const;

async function cmdComfy(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== 'seethrough' && sub !== 'paint') return usage(`comfy takes seethrough or paint; got ${sub === undefined ? 'nothing' : `"${sub}"`}`);
  const valued = sub === 'seethrough' ? ['--image', '--out', '--resolution', '--steps', '--seed', '--prefix', ...COMFY_TIMING] : ['--config', '--out', '--seeds', '--seed0', ...COMFY_TIMING];
  const switches = sub === 'seethrough' ? ['--offload', '--lama', '--nf4'] : [];
  const f = comfyFlags(rest, valued, switches, `comfy ${sub}`);
  if (typeof f === 'string') return usage(f);
  const { v, on } = f;
  const wait = secondsFlag(v, '--wait', 1800);
  const timeout = secondsFlag(v, '--timeout', 3600);
  const poll = secondsFlag(v, '--poll', 3);
  for (const x of [wait, timeout, poll]) if (typeof x === 'string') return usage(x);
  const out = v.get('--out');
  if (out === undefined) return usage(`comfy ${sub} needs --out <dir>`);
  const configPath = v.get('--config');
  if (sub === 'paint' && configPath === undefined) return usage('comfy paint needs --config <config.json>');
  try {
    // The config is a local file, so it is answered before any host is: a
    // config comfy paint cannot paint from is refused with no box named.
    const cfg = sub === 'paint' ? loadEarlyConfig(configPath as string, 'paint') : null;
    const host = resolveHost(v.get('--host'), process.env.COMFY_HOST);
    const client = new ComfyClient(host, { poll: poll as number, request: 30 });
    if (sub === 'seethrough') {
      const image = v.get('--image');
      if (image === undefined) return usage('comfy seethrough needs --image <png>');
      const resolution = intFlag(v, '--resolution', 1024, 64);
      const steps = intFlag(v, '--steps', 30, 1);
      const seed = intFlag(v, '--seed', 42, 0);
      for (const x of [resolution, steps, seed]) if (typeof x === 'string') return usage(x);
      const prefix = v.get('--prefix') ?? 'spine_parts';
      if (!/^[A-Za-z0-9_-]+$/.test(prefix)) return usage(`--prefix ${prefix} is not letters, digits, "_" and "-"`);
      const run = {
        image,
        out,
        prefix,
        resolution: resolution as number,
        steps: steps as number,
        seed: seed as number,
        offload: on.has('--offload'),
        lama: on.has('--lama'),
        quant: on.has('--nf4') ? ('nf4' as const) : ('none' as const),
        wait: wait as number,
        timeout: timeout as number,
      };
      console.log(`spine-parts comfy seethrough: ${image} -> ${out}`);
      console.log(`  resolution ${run.resolution}, steps ${run.steps}, seed ${run.seed}, offload ${run.offload}, lama ${run.lama}, quant ${run.quant}; wait <= ${run.wait} s, timeout ${run.timeout} s`);
      const r = await runSeeThrough(client, run, (l) => console.log(l));
      console.log(`  ${r.layers.length} layer(s) on a ${r.canvas[0]}x${r.canvas[1]} canvas, read back green by the layer reader: ${r.layers.join(', ')}`);
      console.log(`  wrote ${join(out, 'layers.json')}, meta.json, parts/ (${r.layers.length} PNG) and previews/ (${r.previews.length} PNG); GPU job ended`);
      return EXIT_OK;
    }
    if (cfg === null) return usage('comfy paint needs --config <config.json>');
    const seeds = intFlag(v, '--seeds', 1, 1);
    if (typeof seeds === 'string') return usage(seeds);
    const seed0 = intFlag(v, '--seed0', cfg.generation.seed, 0);
    if (typeof seed0 === 'string') return usage(seed0);
    console.log(`spine-parts comfy paint: ${cfg.key} -> ${out}`);
    console.log(`  ${seeds} seed(s) from ${seed0}${v.has('--seed0') ? '' : ' (generation.seed)'}; wait <= ${wait} s per seed, timeout ${timeout} s`);
    const done = await runPainting(client, { config: cfg, out, seeds, seed0, wait: wait as number, timeout: timeout as number }, (l) => console.log(l));
    console.log(`  wrote ${done.length} painting(s): ${done.map((d) => `${d.file} ${d.size[0]}x${d.size[1]} in ${d.elapsed.toFixed(1)} s`).join(', ')}; GPU job(s) ended`);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdInputs(args: string[]): number {
  const f = flags(args, ['--source', '--config', '--out'], 'inputs');
  if (typeof f === 'string') return usage(f);
  const source = f.get('--source') as string;
  const out = f.get('--out') as string;
  try {
    if (!existsSync(source)) throw new PartsError([{ code: 'INPUTS_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is required' }]);
    const cfg = loadEarlyConfig(f.get('--config') as string, 'layers');
    const painting = readPng(source);
    const r = makeInputs(painting, cfg, source);
    mkdirSync(out, { recursive: true });
    writePng(join(out, 'st_input_full.png'), r.full);
    console.log(`spine-parts inputs: ${source} (${painting.width}x${painting.height}) -> ${out}`);
    console.log(`  st_input_full.png ${r.full.width}x${r.full.height}: the painting at x ${r.padLeft}, white either side (${r.padLeft} + ${r.full.width - painting.width - r.padLeft} px)`);
    if (r.head !== null && r.headBox !== null) {
      writePng(join(out, 'st_input_head.png'), r.head);
      console.log(`  st_input_head.png ${r.head.width}x${r.head.height}: seethrough.head_box [${r.headBox.join(', ')}]`);
    } else {
      console.log('  no seethrough.head_box in the config, so no st_input_head.png: run the full See-through pass, then `propose --head-box`, then this again');
    }
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdBuild(args: string[]): number {
  const flags = new Map<string, string>();
  let loop = false;
  const valued = ['--config', '--source', '--full', '--head', '--out', '--seam', '--project', '--page-edges', '--pack-shape'];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--loop') {
      if (loop) return usage('--loop is given twice');
      loop = true;
      continue;
    }
    if (!valued.includes(flag)) return usage(`build does not take "${flag}"; it takes --loop and ${valued.join(', ')}`);
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  for (const f of ['--config', '--source', '--full', '--head', '--out']) if (!flags.has(f)) return usage(`build needs ${f}`);
  const seam = flags.get('--seam') ?? DEFAULT_SEAM_RULE;
  if (!(SEAM_RULES as readonly string[]).includes(seam)) return usage(`--seam ${seam}; one of ${SEAM_RULES.join(', ')} is required`);
  const project = flags.get('--project') ?? DEFAULT_PROJECT_RULE;
  if (!(PROJECT_RULES as readonly string[]).includes(project)) return usage(`--project ${project}; one of ${PROJECT_RULES.join(', ')} is required`);
  const edges = pageEdgesOf(flags.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(flags.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  const [config, source, full, head, out] = ['--config', '--source', '--full', '--head', '--out'].map((f) => flags.get(f) as string);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'spine-parts-build-'));
  try {
    const r = build(
      { config, source, full, head, out, seam: seam as SeamRule, project: project as ProjectRule, loop, pageEdges: edges, packShape: shape },
      { rig: rigcRunner(bin), check: rigcRunner(bin), checkBin: bin, scratch: join(scratch, 'rig-gate') },
      console.log,
    );
    return r.stoppedAt === null ? EXIT_OK : EXIT_REFUSED;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main(argv: string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return command === undefined ? EXIT_USAGE : EXIT_OK;
  }
  if (command === '--version' || command === '-v') {
    console.log(version());
    return EXIT_OK;
  }
  if (command === 'layers') return cmdLayers(rest);
  if (command === 'sheet') return cmdSheet(rest);
  if (command === 'rig') return cmdRig(rest);
  if (command === 'propose') return cmdPropose(rest);
  if (command === 'check') return cmdCheck(rest);
  if (command === 'loop') return cmdLoop(rest);
  if (command === 'assemble') return cmdAssemble(rest);
  if (command === 'inputs') return cmdInputs(rest);
  if (command === 'comfy') return cmdComfy(rest);
  if (command === 'build') return cmdBuild(rest);
  const later = LATER.find(([name]) => name === command);
  if (later !== undefined) {
    console.log(`  FAIL  NOT_IMPLEMENTED: \`spine-parts ${command}\` (${later[1]}) is not implemented in this version, ${version()}`);
    return EXIT_USAGE;
  }
  return usage(`unknown command "${command}"`);
}

process.exit(await main(process.argv.slice(2)));
