/**
 * The rig stage: a character config and its assembled parts in, a rig spec
 * and a motion spec in spine-rigc's format out.
 *
 *     config (bones, meshes, regions, motion) + parts.json + parts/*.png
 *       -> images/*.png, rig.json, motion.json, mesh_report.json
 *
 * Everything written is something spine-rigc takes verbatim; no rigc
 * generator is used. What is authored:
 *
 * - **Bones**, unrotated and unscaled, at the config's landmarks. A chain
 *   `{chain: "c", points: [p0 .. pn]}` becomes the bones `c0 .. cn`, each the
 *   parent of the next. `root` sits at the bottom centre of the rig canvas.
 *   Because no bone is rotated or scaled, a vertex's bind position under a
 *   bone is simply `vertex - bone origin` in Spine's axes.
 * - **Meshes** over the parts named in `meshes`: a square lattice (`src/mesh.ts`)
 *   weighted by distance to the mesh's candidate segments (`src/weights.ts`),
 *   written in rigc's by-name `weights` form. The slot's bone is the first
 *   segment's bone.
 * - **Regions** for the parts named in `regions`: the image centred where the
 *   part sits, offset from its bone. A part named in `motion.blink.still` is
 *   two regions cut at its row: the rows from `row` down on the part's own
 *   slot and bone (they blink), the rows above on `<part>_still` and the
 *   entry's `bone`, drawn right after it (they do not). The cut row must carry
 *   no art: cut through art, each piece is resampled against its own
 *   transparent edge and the render changes at rest — measured on the demo
 *   example, 36 px of the setup pose (max 7 levels) — while a clear-row cut
 *   changes no pixel outside the blink (issue #26, `RG16`). A `painting:`
 *   patch (`assemble.patches`) is always a region; its slot sits where
 *   parts.json puts it, which is where its `draw` put it.
 * - **The idle** and, under `idleKeys: 'ctl'` (the default), its control
 *   bones (`src/motion.ts`). Under `idleKeys: 'direct'` the keys stay on the
 *   bones the meshes are weighted to, no `<bone>_ctl` is added, and the rig
 *   spec declares `invariants.idleDrivesMeshes` with
 *   {@link IDLE_DRIVES_MESHES_WHY} — spine-rigc 1.3.0's statement that this
 *   idle deforms meshes on purpose, which `A15_IDLE_NO_MESH_BONE_KEYS` then
 *   reports as a SKIP with its cost instead of refusing each bone. The
 *   declaration is written only when the idle keys at least one mesh-driving
 *   bone: rigc refuses a declaration that switches nothing off.
 *
 * Every part image is padded by {@link PAD} transparent pixels on each side
 * before it is meshed or placed, and the padded image is what `images/`
 * holds: a lattice vertex on the part's own edge would otherwise sit on the
 * texture's edge, where filtering samples outside the art.
 *
 * Coordinates in the config and in parts.json are rig pixels, y down. The one
 * y flip goes through `src/coords.ts` (spine-rigc's `cropToSpineY`); x is
 * measured from the canvas centre, which is where `root` stands.
 *
 * Pure: the caller reads the files and writes the outputs; nothing here
 * touches the disk, and the same inputs give the same bytes (key order is the
 * order the objects are built in, and every number is rounded by `pyRound`).
 */
import { type BoneEntry, type CharacterConfig, type Point, ROOT_BONE } from './config.ts';
import { cropToSpineY } from './coords.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { artCoverage, ART_ALPHA, latticeMesh, ONE_LOOP_PASSES } from './mesh.ts';
import { BLINK, BLINK_SPAN, blinkHoldMisses, CONTROL_SUFFIX, controlledBones, IDLE_FPS, idleMotion, type MotionSpec, moveKeysToControls } from './motion.ts';
import { PAINTING_RUN, type PartsFile, readFrom } from './parts.ts';
import { alphaAbove, crop, pad, type Raster } from './raster/index.ts';
import { pyRound } from './round.ts';
import { influences, type Segment } from './weights.ts';

/** Transparent pixels added round every part image — the reference's `PAD`. */
export const PAD = 4;

interface Bone {
  name: string;
  parent: string | null;
  x: number;
  y: number;
}

export interface RigBone {
  name: string;
  parent?: string;
  x: number;
  y: number;
}

export interface WeightEntry {
  bone: string;
  x: number;
  y: number;
  weight: number;
}

export interface MeshAttachment {
  type: 'mesh';
  image: string;
  width: number;
  height: number;
  uvs: number[];
  triangles: number[];
  hull: number;
  weights: WeightEntry[][];
}

export interface RegionAttachment {
  image: string;
  x: number;
  y: number;
}

export interface RigSpec {
  spec: 'rigc-rig/1';
  name: string;
  images: 'images';
  skeleton: { x: number; y: number; width: number; height: number };
  bones: RigBone[];
  slots: Array<{ name: string; bone: string; attachment: string }>;
  skins: { default: Record<string, Record<string, MeshAttachment | RegionAttachment>> };
  /** Written only under `idleKeys: 'direct'`, and only when the idle keys a mesh-driving bone. */
  invariants?: { idleDrivesMeshes: { why: string } };
}

/**
 * Where the idle's keys on a mesh-driving bone go (`rig --idle-keys`).
 *
 * - `ctl`: onto a same-origin `<bone>_ctl` parent, which passes
 *   `A15_IDLE_NO_MESH_BONE_KEYS` under every spine-rigc this package has run
 *   on. It satisfies the rule's wording only — see `src/motion.ts`.
 * - `direct`: onto the bone itself, with `invariants.idleDrivesMeshes`
 *   declared, which needs spine-rigc 1.3.0 or later (an older rigc refuses
 *   the unknown invariant by name).
 *
 * Measured on the two public examples (spine-parts #13, `tools/idle_cost.ts`):
 * `direct` removes 31 of 72 bones (demo) and 24 of 56 (sample); every shown
 * mesh (8 and 6) has a driving bone whose world transform changes on every
 * idle frame under both, so the meshes a dirty-skip renderer could skip are 0
 * in both; and the per-frame pose time differs only in
 * `updateWorldTransform` (1.2 against 0.7 us on the demo), about 3 % of a
 * frame dominated by `computeWorldVertices`. The controls buy no renderer
 * work. `ctl` stays the default because the examples' expected `rig.json` and
 * `motion.json` are the reference implementation's output, and because the
 * declaration lives in the rig spec only: `rigc validate <build> --profile
 * spine-html`, which has no rig spec to read, refuses a `direct` build once
 * per keyed mesh bone.
 */
export const IDLE_KEYS = ['ctl', 'direct'] as const;
export type IdleKeys = (typeof IDLE_KEYS)[number];
export const DEFAULT_IDLE_KEYS: IdleKeys = 'ctl';

/** The `why` of the `invariants.idleDrivesMeshes` that `idleKeys: 'direct'` declares. */
export const IDLE_DRIVES_MESHES_WHY = 'painting rig: the idle is meant to deform the meshes it keys (spine-parts rig --idle-keys direct)';

export interface MeshReport {
  part: string;
  vertices: number;
  triangles: number;
  hull: number;
  bones: string[];
  max_influences: number;
  mean_influences: number;
  art_coverage: number;
  grid: number;
}

export interface RigOutput {
  rig: RigSpec;
  motion: MotionSpec;
  meshReport: MeshReport[];
  /** The padded images, by file name (`<part>.png`), in parts.json order. */
  images: Array<[string, Raster]>;
  /** The bones that got a `<bone>_ctl`, sorted; empty under `idleKeys: 'direct'`. */
  controls: string[];
  /** The idle-keyed bones some mesh is weighted to, sorted — the bones `ctl` moves the keys off, and `direct` keys in place. */
  meshKeyed: string[];
  idleKeys: IdleKeys;
  /** The one-loop passes each mesh took, for the printed report. */
  loopPasses: Record<string, number>;
}

/**
 * `RIG_BLINK_HOLD_SPANS_A_FRAME` (issue #32): the eyes' hold must put an
 * idle frame inside the closed window for every `blink.t`, or the idle
 * frames, the contact sheet and the loop show a blink that never closes. The
 * three numbers are the tree's own constants (`BLINK.shut`, `BLINK.hold`,
 * `IDLE_FPS`), which the rig stage passes on every build that has a blink;
 * they are parameters so the refusal can be planted without editing them.
 */
export function blinkHoldProblems(shut: number, hold: number, fps: number): Problem[] {
  const m = blinkHoldMisses(shut, hold, fps);
  if (m.misses === 0) return [];
  return [
    {
      code: 'RIG_BLINK_HOLD_SPANS_A_FRAME',
      object: 'BLINK.hold (src/motion.ts)',
      detail:
        `is ${hold} s; the idle is rendered at IDLE_FPS = ${fps}, a frame every ${pyRound(1 / fps, 6)} s, so the closed window [t + ${shut}, t + ${pyRound(shut + hold, 6)}] s holds no frame ` +
        `for ${m.misses} of the ${m.phases} phases a 6-decimal blink.t takes against the frame grid (the first at t = ${m.first} s), and the idle frames and the loop show no closed eye there; ` +
        `a hold of at least one frame, 1/${fps} s, is required`,
    },
  ];
}

/** The slot, attachment and image name suffix of a `motion.blink.still` part's upper piece. */
export const STILL_SUFFIX = '_still';

/** Pixels with alpha above 0 in rows [y0, y1) of `img`. */
function alphaCount(img: Raster, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > 0) n++;
  return n;
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pt(p: Point): string {
  return `[${p[0]}, ${p[1]}]`;
}

/**
 * Build the rig. `images` holds every parts.json part's PNG by part name.
 * Every problem found is thrown at once, as one `PartsError`.
 */
export function buildRig(
  cfg: CharacterConfig,
  parts: PartsFile,
  images: ReadonlyMap<string, Raster>,
  maxLoopPasses: number = ONE_LOOP_PASSES,
  idleKeys: IdleKeys = DEFAULT_IDLE_KEYS,
): RigOutput {
  const problems: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  const [W, H] = parts.rig_size;
  const CX = W / 2;
  const byPart = new Map(parts.parts.map((p) => [p.name, p]));

  // ---- bones -------------------------------------------------------------
  const B = new Map<string, Bone>();
  B.set(ROOT_BONE, { name: ROOT_BONE, parent: null, x: CX, y: H });
  const tips = new Map<string, Point>();
  const child = new Map<string, Point>();
  const chains = new Map<string, string[]>();
  cfg.bones.forEach((e: BoneEntry, i) => {
    if ('chain' in e) {
      const names: string[] = [];
      const polyline = [...e.points, e.tip];
      if (e.points.length < 1) {
        fail('RIG_CHAIN_POINTS', `config.bones[${i}] chain "${e.chain}"`, `has ${e.points.length} point(s) and a tip; at least one point and a tip — 2 points — are required to make a link`);
      }
      for (let k = 0; k + 1 < polyline.length; k++) {
        if (same(polyline[k], polyline[k + 1])) {
          fail(
            'RIG_CHAIN_POINTS',
            `config.bones[${i}] chain "${e.chain}" link ${k}`,
            `runs from ${pt(polyline[k])} to ${k + 1 < e.points.length ? `points[${k + 1}]` : 'the tip'} ${pt(polyline[k + 1])}, the same point — the chain has fewer than 2 distinct points along that link, so the link has no direction to weight along; each link must end at a point other than its origin`,
          );
        }
      }
      e.points.forEach(([x, y], k) => {
        const n = `${e.chain}${k}`;
        B.set(n, { name: n, parent: k === 0 ? e.parent : names[names.length - 1], x, y });
        if (names.length > 0) child.set(names[names.length - 1], [x, y]);
        names.push(n);
      });
      if (names.length > 0) tips.set(names[names.length - 1], [e.tip[0], e.tip[1]]);
      chains.set(e.chain, names);
    } else {
      B.set(e.name, { name: e.name, parent: e.parent, x: e.at[0], y: e.at[1] });
      if (e.tip !== undefined) tips.set(e.name, [e.tip[0], e.tip[1]]);
    }
  });

  // ---- segments ----------------------------------------------------------
  const seg = (bone: string, at: string): Segment | null => {
    const b = B.get(bone);
    if (b === undefined) {
      fail('RIG_NAME_RESOLVES', at, `names the bone "${bone}", which config.bones does not declare`);
      return null;
    }
    const end = child.get(bone) ?? tips.get(bone);
    if (end === undefined) {
      fail(
        'RIG_SEGMENT_DEFINED',
        at,
        `names the bone "${bone}", which has no tip and no next chain link, so it has an origin and no segment; give config.bones "${bone}" a "tip", or write the segment out as ["${bone}", [x0, y0], [x1, y1]]`,
      );
      return null;
    }
    return { bone, a: [b.x, b.y], b: end };
  };
  const meshSegments = new Map<string, Segment[]>();
  for (const [part, m] of Object.entries(cfg.meshes)) {
    const out: Segment[] = [];
    m.segments.forEach((sp, i) => {
      const at = `config.meshes.${part}.segments[${i}]`;
      if (typeof sp === 'string') {
        const links = chains.get(sp);
        if (links !== undefined) {
          for (const l of links) {
            const s = seg(l, `${at} (chain "${sp}" link "${l}")`);
            if (s !== null) out.push(s);
          }
        } else {
          const s = seg(sp, at);
          if (s !== null) out.push(s);
        }
      } else {
        if (!B.has(sp[0])) fail('RIG_NAME_RESOLVES', `${at}[0]`, `names the bone "${sp[0]}", which config.bones does not declare`);
        else out.push({ bone: sp[0], a: [sp[1][0], sp[1][1]], b: [sp[2][0], sp[2][1]] });
      }
    });
    meshSegments.set(part, out);
  }

  // ---- parts ↔ config ----------------------------------------------------
  const where = (part: string): string => `parts.json holds ${parts.parts.length} part(s): ${parts.parts.map((p) => p.name).join(', ')}`;
  for (const part of Object.keys(cfg.meshes)) if (!byPart.has(part)) fail('RIG_PART_PRESENT', `config.meshes.${part}`, `names the part "${part}", which is not in parts.json; ${where(part)}`);
  for (const [part, bone] of Object.entries(cfg.regions)) {
    if (!byPart.has(part)) fail('RIG_PART_PRESENT', `config.regions.${part}`, `names the part "${part}", which is not in parts.json; ${where(part)}`);
    if (!B.has(bone)) fail('RIG_NAME_RESOLVES', `config.regions.${part}`, `names the bone "${bone}", which config.bones does not declare`);
  }
  for (const p of parts.parts) {
    const inM = p.name in cfg.meshes;
    const inR = p.name in cfg.regions;
    if (!inM && !inR) fail('RIG_PART_ATTACHED', `part "${p.name}"`, 'is in parts.json and has neither a config.meshes nor a config.regions entry; exactly one is required');
    if (inM && inR) fail('RIG_PART_ATTACHED', `part "${p.name}"`, 'has both a config.meshes and a config.regions entry; exactly one is required');
    else if (inM && readFrom(p.from)?.run === PAINTING_RUN) {
      fail('RIG_PART_ATTACHED', `part "${p.name}"`, `is a painting patch (${p.from}) and has a config.meshes entry; a patch is a region — config.regions.${p.name} names its bone`);
    }
    const img = images.get(p.name);
    if (img === undefined) fail('RIG_PNG_PRESENT', `part "${p.name}"`, `has no parts/${p.name}.png`);
    else if (img.width !== p.w || img.height !== p.h) {
      fail('RIG_PNG_MATCHES_BOX', `part "${p.name}"`, `parts/${p.name}.png is ${img.width}x${img.height}; parts.json's box is ${p.w}x${p.h}`);
    }
  }

  // ---- motion ------------------------------------------------------------
  const bl = cfg.motion.blink;
  if (bl !== undefined && !(bl.t > 0 && bl.t + BLINK_SPAN < cfg.motion.duration)) {
    fail(
      'RIG_BLINK_INSIDE_IDLE',
      'config.motion.blink.t',
      `is ${bl.t} s; the blink's keys run from t to t + ${pyRound(BLINK_SPAN, 6)} s between the idle's first key at 0 and its last at ${cfg.motion.duration} s, so 0 < t < ${pyRound(cfg.motion.duration - BLINK_SPAN, 6)} is required`,
    );
  }
  if (bl !== undefined) problems.push(...blinkHoldProblems(BLINK.shut, BLINK.hold, IDLE_FPS));
  // ---- blink.still: a blinking region cut at a row ----------------------
  const stills = bl?.still ?? {};
  const partNames = new Set(parts.parts.map((p) => p.name));
  for (const [part, st] of Object.entries(stills)) {
    const at = `config.motion.blink.still.${part}`;
    const p = byPart.get(part);
    if (!(part in cfg.regions)) fail('RIG_NAME_RESOLVES', at, `names "${part}", which config.regions does not attach; a region part is required`);
    if (!B.has(st.bone)) fail('RIG_NAME_RESOLVES', `${at}.bone`, `names the bone "${st.bone}", which config.bones does not declare`);
    if (p === undefined) continue;
    const still = `${part}${STILL_SUFFIX}`;
    if (partNames.has(still)) fail('RIG_STILL_NAME_FREE', at, `the still piece is drawn by the slot "${still}", and parts.json already holds a part of that name; rename that part`);
    if (!(st.row > p.y && st.row < p.y + p.h)) {
      fail('RIG_STILL_ROW_INSIDE_PART', `${at}.row`, `is ${st.row}; "${part}" spans rows ${p.y}..${p.y + p.h - 1}, so a row with part rows on both sides, ${p.y + 1}..${p.y + p.h - 1}, is required`);
      continue;
    }
    const img = images.get(part);
    if (img === undefined || img.width !== p.w || img.height !== p.h) continue;
    const r = st.row - p.y;
    const crossing: number[] = [];
    for (let x = 0; x < img.width; x++) if (img.data[(r * img.width + x) * 4 + 3] > 0) crossing.push(x);
    if (crossing.length > 0) {
      fail(
        'RIG_STILL_ROW_CLEAR',
        `${at}.row`,
        `is ${st.row}, and "${part}" has ${crossing.length} pixel(s) with alpha above 0 on that row (the first at x = ${p.x + crossing[0]}); a row with no art across the part's whole width is required — two pieces cut through art are each resampled against their own transparent edge, so the render changes at rest, not only while the eye moves`,
      );
      continue;
    }
    const artAbove = alphaCount(img, 0, r);
    const artBelow = alphaCount(img, r, img.height);
    if (artAbove === 0 || artBelow === 0) {
      fail('RIG_STILL_PIECES_HAVE_ART', `${at}.row`, `is ${st.row}; "${part}" has ${artAbove} art pixel(s) above it and ${artBelow} below; both pieces need art, or the cut holds nothing still (or nothing blinks)`);
    }
  }
  refuseIfAny(problems);

  const motion = idleMotion(cfg, chains);
  const meshBones = new Set<string>();
  for (const segs of meshSegments.values()) for (const s of segs) meshBones.add(s.bone);
  const meshKeyed = controlledBones(motion, meshBones);
  const controls = idleKeys === 'ctl' ? meshKeyed : [];
  for (const k of controls) {
    const ctl = `${k}${CONTROL_SUFFIX}`;
    if (B.has(ctl)) {
      fail('RIG_CONTROL_NAME_FREE', `bone "${k}"`, `is keyed by the idle and weighted to by a mesh, so it needs the control bone "${ctl}", and config.bones already declares a bone of that name`);
    }
  }
  refuseIfAny(problems);
  for (const k of controls) {
    const b = B.get(k) as Bone;
    const ctl = `${k}${CONTROL_SUFFIX}`;
    B.set(ctl, { name: ctl, parent: b.parent, x: b.x, y: b.y });
    B.set(k, { ...b, parent: ctl });
  }
  moveKeysToControls(motion, controls);
  // Parents first: a depth-first walk over the table in insertion order, each
  // bone after its parent — which puts every control directly above its bone.
  const ordered: Bone[] = [];
  const done = new Set<string>();
  const visit = (n: string): void => {
    if (done.has(n)) return;
    const b = B.get(n) as Bone;
    if (b.parent !== null) visit(b.parent);
    done.add(n);
    ordered.push(b);
  };
  for (const n of B.keys()) visit(n);

  const spineX = (x: number): number => x - CX;
  const spineY = (y: number): number => cropToSpineY(y, H);
  const bones: RigBone[] = ordered.map((b) => {
    if (b.parent === null) return { name: b.name, x: 0, y: 0 };
    const p = B.get(b.parent) as Bone;
    return { name: b.name, parent: b.parent, x: pyRound(b.x - p.x, 3), y: pyRound(spineY(b.y) - spineY(p.y), 3) };
  });

  // ---- attachments -------------------------------------------------------
  const slots: RigSpec['slots'] = [];
  const skin: RigSpec['skins']['default'] = {};
  const meshReport: MeshReport[] = [];
  const outImages: Array<[string, Raster]> = [];
  const loopPasses: Record<string, number> = {};
  for (const p of parts.parts) {
    const img = pad(images.get(p.name) as Raster, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
    const file = `${p.name}.png`;
    outImages.push([file, img]);
    const mesh = cfg.meshes[p.name];
    if (mesh === undefined) {
      const bone = B.get(cfg.regions[p.name]) as Bone;
      const cx = p.x + p.w / 2;
      const st = stills[p.name];
      if (st !== undefined) {
        // The part cut at st.row: the lower piece keeps the part's slot and
        // blinks; the upper one is drawn right after it, by <part>_still on
        // st.bone. Each piece sits exactly where its rows sat in the part.
        const src = images.get(p.name) as Raster;
        const r = st.row - p.y;
        const still = `${p.name}${STILL_SUFFIX}`;
        const stillFile = `${still}.png`;
        const lower = pad(crop(src, 0, r, p.w, p.h - r), PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
        const upper = pad(crop(src, 0, 0, p.w, r), PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
        const sb = B.get(st.bone) as Bone;
        outImages[outImages.length - 1] = [file, lower];
        outImages.push([stillFile, upper]);
        const cyLow = st.row + (p.h - r) / 2;
        const cyUp = p.y + r / 2;
        skin[p.name] = { [p.name]: { image: file, x: pyRound(spineX(cx) - spineX(bone.x), 3), y: pyRound(spineY(cyLow) - spineY(bone.y), 3) } };
        skin[still] = { [still]: { image: stillFile, x: pyRound(spineX(cx) - spineX(sb.x), 3), y: pyRound(spineY(cyUp) - spineY(sb.y), 3) } };
        slots.push({ name: p.name, bone: bone.name, attachment: p.name }, { name: still, bone: sb.name, attachment: still });
        continue;
      }
      const cy = p.y + p.h / 2;
      skin[p.name] = { [p.name]: { image: file, x: pyRound(spineX(cx) - spineX(bone.x), 3), y: pyRound(spineY(cy) - spineY(bone.y), 3) } };
      slots.push({ name: p.name, bone: bone.name, attachment: p.name });
      continue;
    }
    const segs = meshSegments.get(p.name) as Segment[];
    const art = alphaAbove(img, ART_ALPHA);
    const lm = latticeMesh(p.name, art, mesh.grid, maxLoopPasses);
    if ('code' in lm) {
      problems.push(lm);
      continue;
    }
    loopPasses[p.name] = lm.passes;
    const ox = p.x - PAD;
    const oy = p.y - PAD;
    const w = img.width;
    const h = img.height;
    const weights: WeightEntry[][] = [];
    let infl = 0;
    let maxInfl = 0;
    for (const [vx0, vy0] of lm.vertices) {
      const wx = vx0 + ox;
      const wy = vy0 + oy;
      const ent: WeightEntry[] = influences([wx, wy], segs, mesh.r).map(({ bone, weight }) => {
        const b = B.get(bone) as Bone;
        return { bone, x: pyRound(spineX(wx) - spineX(b.x), 3), y: pyRound(spineY(wy) - spineY(b.y), 3), weight: pyRound(weight, 5) };
      });
      let others = 0;
      for (let k = 0; k < ent.length - 1; k++) others += ent[k].weight;
      ent[ent.length - 1].weight = pyRound(1 - others, 5);
      weights.push(ent);
      infl += ent.length;
      maxInfl = Math.max(maxInfl, ent.length);
    }
    const uvs: number[] = [];
    for (const [x, y] of lm.vertices) uvs.push(pyRound(x / w, 6), pyRound(y / h, 6));
    skin[p.name] = { [p.name]: { type: 'mesh', image: file, width: w, height: h, uvs, triangles: lm.triangles, hull: lm.hull, weights } };
    slots.push({ name: p.name, bone: segs[0].bone, attachment: p.name });
    meshReport.push({
      part: p.name,
      vertices: lm.vertices.length,
      triangles: lm.triangles.length / 3,
      hull: lm.hull,
      bones: [...new Set(segs.map((s) => s.bone))].sort(),
      max_influences: maxInfl,
      mean_influences: pyRound(infl / lm.vertices.length, 2),
      art_coverage: pyRound(artCoverage(lm, art), 5),
      grid: mesh.grid,
    });
  }
  refuseIfAny(problems);

  const name = `${cfg.key}_painting`;
  const rig: RigSpec = {
    spec: 'rigc-rig/1',
    name,
    images: 'images',
    skeleton: { x: -CX, y: 0, width: W, height: H },
    bones,
    slots,
    skins: { default: skin },
  };
  if (idleKeys === 'direct' && meshKeyed.length > 0) rig.invariants = { idleDrivesMeshes: { why: IDLE_DRIVES_MESHES_WHY } };
  return { rig, motion, meshReport, images: outImages, controls, meshKeyed, idleKeys, loopPasses };
}

/**
 * The JSON text of a rig output file. One space of indent, as the reference
 * wrote, and a closing newline; the key order is the order the objects were
 * built in, which `buildRig` fixes.
 */
export function rigJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 1)}\n`;
}
