/**
 * The turn control (issue #251): one bone nothing keys, and each part carried
 * sideways a fraction of that bone's offset, the fraction ordered by the part's
 * See-through depth — nearest furthest, the pivot depth staying put.
 *
 * 🧭 **The law is a turn's, not a chosen curve.** A figure turned by a small
 * angle θ about a vertical axis standing at depth `pivot`, seen without
 * perspective, moves each point sideways by `sin θ · (pivot − depth)` in depth
 * units: linear in depth, zero at the pivot, opposite signs on either side of
 * it. The depth unit's size in pixels is nothing See-through states, so the
 * dial is normalised by the nearest part instead:
 *
 *     fraction(part) = (pivot − depth(part)) / (pivot − depth(nearest))
 *
 * The nearest part (the smallest `depth_median`, larger being further back)
 * travels exactly the control's offset, the pivot depth 0, a part behind the
 * pivot the other way. The dial's unit is therefore the nearest part's travel
 * in rig px, and how far a consumer turns it is the consumer's.
 *
 * ⚖️ **The pivot `propose` drafts** ({@link turnPivot}) is the mean of the
 * carried parts' depths weighted by their `opaque_px`: the one depth at which
 * `Σ opaque_px · fraction = 0`, so the painted pixels' centroid does not slide
 * under the dial — the figure turns about its own middle rather than drifting
 * with it. It is a config field (`turn.pivot`), so a person corrects it there;
 * the rig stage recomputes every fraction from it.
 *
 * Depths are See-through's per-layer `depth_median` only. Issue #250 measured
 * that the depth maps do not carry relief inside a layer, so a part moves as
 * one piece. Pure: no file, no clock.
 */
import { computeWorldTransforms, toBoneLocalVector, toWorld, type BoneTransform } from './coords.ts';
import { pyRound } from './round.ts';

/**
 * The layers that ride on the face (issue #271): See-through makes no depth
 * of their own for them, so `propose` does not read theirs. The eye group —
 * eyewhite, irides, eyelash, eyebrow — is cut from one depth map predicted for
 * the combined eyes layer (`compose_list` in See-through's
 * `common/utils/inference_utils.py`, commit df019de), which is why
 * `eyewhite-r` and `eyewhite-l` read the same median in every run measured
 * for #251; nose and mouth are clamped by See-through to the face's median
 * minus {@link TURN_RIDER_OFFSET} when they read behind it (the same file,
 * lines 528-531). Their own medians disagreed across the two runs by up to
 * 0.474 (demo `eyebrow-r`, #251's table), and the disagreement swapped their
 * order against the face. Matched on the layer's base tag, either side.
 */
export const TURN_RIDER_TAGS: readonly string[] = ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'nose', 'mouth'];

/** The tag of the part the riders take their depth from. */
export const TURN_CARRIER_TAG = 'face';

/** See-through's own offset between a clamped face feature and the face (`face − 0.001`, the file named at {@link TURN_RIDER_TAGS}). */
export const TURN_RIDER_OFFSET = 0.001;

/**
 * A rider's depth: its carrier's, {@link TURN_RIDER_OFFSET} nearer when the
 * rider is drawn after the carrier (above it) and as much further when it is
 * drawn before (under it), so the draw order the depths imply is the one
 * parts.json holds.
 */
export function turnRiderDepth(carrier: number, above: boolean): number {
  return above ? carrier - TURN_RIDER_OFFSET : carrier + TURN_RIDER_OFFSET;
}

/** The control bone the rig stage adds under `root` when the config has `turn`: nothing keys it, and its local x is the dial. */
export const TURN_BONE = 'turn';

/** The places a pivot and a fraction are written to. */
export const TURN_PLACES = 6;

/**
 * The Set B ×2.5 face surface deformation table (issue #436): per-degree
 * fractions of the face plate's opaque width `W` and height `H` (and the
 * dimensionless coupling shares of the hair, ear and topknot parts that sample
 * the same head field), with the sheet's measurements on a `106×128` plate at
 * `+15°` beside each entry.
 */
export const FACE_DEFORM_FRACTIONS = {
  /** Mid-face vertical shift per degree of pitch (`H/deg`; `-9.02 px` at `+15°` on `H = 128`). */
  tilt_mid_y: -0.0047,
  /** Lower-face chin vertical squash per degree of pitch (`H/deg`; `+5.04 px` squash, chin tip `-3.98 px` at `+15°` on `H = 128`). */
  tilt_chin_squash_y: 0.002625,
  /** Forehead/crown extra drop per degree of pitch (`H/deg`; crown `-11.28 px` at `+15°` on `H = 128`). */
  tilt_crown_drop_y: -0.001175,
  /** Forehead/jaw perspective horizontal taper per degree of pitch (`W/deg`; `±4.77 px` at `+15°` on `W = 106`). */
  tilt_taper_x: 0.003,
  /** Mid-face and chin horizontal shift per degree of yaw (`W/deg`; `-9.54 px` at `+15°` on `W = 106`). */
  turn_mid_x: -0.006,
  /** Far (leading) cheek inward compression per degree of yaw (`W/deg`; far cheek `+3.75 px` inward at `+15°` on `W = 106`). */
  turn_lead_compress_x: 0.00835,
  /** Near (trailing) cheek shift beyond mid-face per degree of yaw (`W/deg`; near cheek `-10.50 px` at `+15°` on `W = 106`, total narrowing `-14.25 px` = `-13.4% W`). */
  turn_trail_shift_x: -0.0006,
  /** Cheek-arch vertical lift/drop per degree of yaw (`H/deg`; `±1.20 px` at `+15°` on `H = 128`). */
  turn_cheek_arch_y: 0.000625,
  /** Forehead bang base vertical travel per degree of pitch (`H/deg`; `-3.00 px` at `+15°` on `H = 128`). */
  tilt_bang_base_y: -0.0015625,
  /** Share of the pitch vertical surface field carried by `hair_front` (`0.95×` of `dySurf`). */
  tilt_hair_front_y: 0.95,
  /** Share of the pitch vertical surface field carried by lower `hair_back` (`0.85×` of `dySurf`). */
  tilt_hair_back_lower_y: 0.85,
  /** Share of the pitch vertical surface field carried by upper `hair_back` (`0.45×` of `dySurf`). */
  tilt_hair_back_bun_y: 0.45,
  /** Share of the pitch horizontal taper carried at the top of `hair_back` (`0.60×` of `dxSurf`). */
  tilt_hair_back_bun_x: 0.6,
  /** Share of the pitch vertical surface field carried by `ears` (`0.55×` of `dySurf`, `-4.31 px` at `+15°`). */
  tilt_ear_y: 0.55,
  /** Share of the crown pitch vertical field carried by `topknot` (`0.50×` of crown `dySurf`, `-5.64 px` at `+15°`). */
  tilt_topknot_y: 0.5,
  /** Forehead bang forward parallax per degree of yaw (`W/deg`; `-3.50 px` at `+15°` on `W = 106`). */
  turn_bang_parallax_x: -(3.5 / 15) / 106,
  /** Share of the cheek yaw horizontal field carried by lower `hair_back` (`0.90×` of `dxCheek`). */
  turn_hair_back_cheek_x: 0.9,
  /** Rear bun counter-parallax per degree of yaw (`W/deg`; `+8.00 px` at `+15°` on `W = 106`). */
  turn_bun_counter_x: 8.0 / 15 / 106,
  /** Rear hairpin counter-parallax per degree of yaw (`W/deg`; `+6.00 px` at `+15°` on `W = 106`). */
  turn_hairpin_counter_x: 6.0 / 15 / 106,
  /** Share of the cheek-edge yaw horizontal field carried by `ear_r` and `ear_l` (`0.85×` of `dxCheekEdge`, `-8.92 px` / `+3.14 px` at `+15°`). */
  turn_ear_x: 0.85,
} as const;

export type FaceDeformKey = keyof typeof FACE_DEFORM_FRACTIONS;
export type FaceDeformFractions = Record<FaceDeformKey, number>;

/**
 * Allowed `[min, max]` range for each key of {@link FACE_DEFORM_FRACTIONS}; an
 * override in `config.turn.deform` outside its stated interval is refused by
 * name (`CONFIG_TURN_DEFORM_RANGE`).
 */
export const FACE_DEFORM_RANGES: Readonly<Record<FaceDeformKey, readonly [number, number]>> = {
  tilt_mid_y: [-0.02, 0],
  tilt_chin_squash_y: [0, 0.015],
  tilt_crown_drop_y: [-0.01, 0],
  tilt_taper_x: [0, 0.015],
  turn_mid_x: [-0.02, 0],
  turn_lead_compress_x: [0, 0.025],
  turn_trail_shift_x: [-0.01, 0.01],
  turn_cheek_arch_y: [0, 0.01],
  tilt_bang_base_y: [-0.01, 0],
  tilt_hair_front_y: [0, 1.5],
  tilt_hair_back_lower_y: [0, 1.5],
  tilt_hair_back_bun_y: [0, 1.5],
  tilt_hair_back_bun_x: [0, 1.5],
  tilt_ear_y: [0, 1.5],
  tilt_topknot_y: [0, 1.5],
  turn_bang_parallax_x: [-0.015, 0],
  turn_hair_back_cheek_x: [0, 1.5],
  turn_bun_counter_x: [0, 0.02],
  turn_hairpin_counter_x: [0, 0.02],
  turn_ear_x: [0, 1.5],
};

/** Uneven 5×5 grid columns and rows for the `face` plate mesh (issue #436). */
export const FACE_DEFORM_GRID_US: readonly number[] = [0, 0.18, 0.5, 0.82, 1];
export const FACE_DEFORM_GRID_VS: readonly number[] = [0, 0.22, 0.5, 0.78, 1];

/** Resolve {@link FACE_DEFORM_FRACTIONS} with optional recipe overrides. */
export function resolveFaceDeformFractions(overrides?: Readonly<Partial<FaceDeformFractions>> | null): FaceDeformFractions {
  const out: FaceDeformFractions = { ...FACE_DEFORM_FRACTIONS };
  if (overrides !== undefined && overrides !== null) {
    for (const k of Object.keys(FACE_DEFORM_FRACTIONS) as FaceDeformKey[]) {
      const v = overrides[k];
      if (typeof v === 'number') out[k] = v;
    }
  }
  return out;
}

/** `config.turn`: the pivot depth, each carried part's See-through `depth_median`, and optional face surface deform overrides. */
export interface TurnSpec {
  pivot: number;
  depths: Record<string, number>;
  deform?: Partial<FaceDeformFractions>;
}

/** One carried part: its depth and the fraction of the control's offset it travels. */
export interface TurnFraction {
  part: string;
  depth: number;
  fraction: number;
}

/** The nearest part of a turn: the smallest depth, the first such part in `depths`' key order. */
export function turnNearest(depths: Readonly<Record<string, number>>): { part: string; depth: number } | null {
  let best: { part: string; depth: number } | null = null;
  for (const [part, depth] of Object.entries(depths)) if (best === null || depth < best.depth) best = { part, depth };
  return best;
}

/**
 * `(pivot − depth) / (pivot − nearest)`, to {@link TURN_PLACES} places, with a
 * negative zero written as 0. The caller holds `pivot > nearest` (the loader
 * refuses anything else, `CONFIG_TURN_PIVOT_BEHIND_NEAREST`).
 */
export function turnFraction(pivot: number, nearest: number, depth: number): number {
  const f = pyRound((pivot - depth) / (pivot - nearest), TURN_PLACES);
  return f === 0 ? 0 : f;
}

/** Every carried part's fraction, in `order` (parts.json's draw order); a name in `order` the spec does not list is not carried. */
export function turnFractions(spec: TurnSpec, order: readonly string[]): TurnFraction[] {
  const nearest = turnNearest(spec.depths);
  if (nearest === null) return [];
  return order.filter((p) => Object.hasOwn(spec.depths, p)).map((part) => ({ part, depth: spec.depths[part], fraction: turnFraction(spec.pivot, nearest.depth, spec.depths[part]) }));
}

/**
 * The pivot `propose` drafts: `Σ area · depth / Σ area` over the carried
 * parts, to {@link TURN_PLACES} places — the depth at which the painted
 * pixels' centroid does not move under the dial. Null with no area.
 */
export function turnPivot(rows: ReadonlyArray<{ depth: number; area: number }>): number | null {
  let a = 0;
  let ad = 0;
  for (const r of rows) {
    a += r.area;
    ad += r.area * r.depth;
  }
  return a > 0 ? pyRound(ad / a, TURN_PLACES) : null;
}

/** The leaf bone that carries `part`'s share of `bone` under the turn: an identity child of `bone`, so it follows everything `bone` does. */
export function turnTwin(part: string, bone: string): string {
  return `${TURN_BONE}_${part}_${bone}`;
}

/** The transform constraint that carries `part`. */
export function turnConstraintName(part: string): string {
  return `${TURN_BONE}_${part}`;
}

const FACE_DEFORM_MULT = 2.5;
const unmult = (v: number): number => pyRound(v / FACE_DEFORM_MULT, 8);

/**
 * Evaluate the pitch (`tilt`) surface deformation field `(dx, dy)` in `head`
 * space at `(hx, hy)` for `deg` degrees of pitch.
 */
export function evalPitchFaceSurface(
  hx: number,
  hy: number,
  deg: number,
  W: number,
  H: number,
  X0: number,
  Y0: number,
  f: Readonly<FaceDeformFractions> = FACE_DEFORM_FRACTIONS,
): [number, number] {
  if (deg === 0) return [0, 0];
  const ux = Math.max(-1.35, Math.min(1.35, (hx - X0) / (W / 2)));
  const uy = Math.max(-1.35, Math.min(1.35, (hy - Y0) / (H / 2)));
  const uChin = Math.min(1.2, Math.max(0, -uy));
  const uCrown = Math.min(1.2, Math.max(0, uy));
  const fracYPerDeg = unmult(f.tilt_mid_y) + unmult(f.tilt_chin_squash_y) * Math.pow(uChin, 1.25) + unmult(f.tilt_crown_drop_y) * Math.pow(uCrown, 1.25);
  const fracXPerDeg = unmult(f.tilt_taper_x) * ux * Math.max(-1.1, Math.min(1.1, uy));
  return [FACE_DEFORM_MULT * deg * W * fracXPerDeg, FACE_DEFORM_MULT * deg * H * fracYPerDeg];
}

/**
 * Evaluate the yaw (`turn`) surface deformation field `(dx, dy)` in `head`
 * space at `(hx, hy)` for `deg` degrees of yaw.
 */
export function evalYawFaceSurface(
  hx: number,
  hy: number,
  deg: number,
  W: number,
  H: number,
  X0: number,
  Y0: number,
  f: Readonly<FaceDeformFractions> = FACE_DEFORM_FRACTIONS,
): [number, number] {
  if (deg === 0) return [0, 0];
  const s = Math.sign(deg);
  const ux = Math.max(-1.35, Math.min(1.35, (hx - X0) / (W / 2)));
  const uy = Math.max(-1.35, Math.min(1.35, (hy - Y0) / (H / 2)));
  const uLead = Math.min(1.2, Math.max(0, -s * ux));
  const uTrail = Math.min(1.2, Math.max(0, s * ux));
  const fracXPerDeg = unmult(f.turn_mid_x) + unmult(f.turn_lead_compress_x) * Math.pow(uLead, 1.2) + unmult(f.turn_trail_shift_x) * Math.pow(uTrail, 1.2);
  const fracYPerDeg = unmult(f.turn_cheek_arch_y) * (-s * ux) * Math.max(0, 1 - Math.abs(uy));
  return [FACE_DEFORM_MULT * deg * W * fracXPerDeg, FACE_DEFORM_MULT * deg * H * fracYPerDeg];
}

export interface FaceSurfaceDeformOptions {
  /** Padded `face.png` width in rig px (defaults to the mesh width or 114). */
  imageWidth?: number;
  /** Padded `face.png` height in rig px (defaults to the mesh height or 136). */
  imageHeight?: number;
  /** Opaque face plate width `W` in rig px (defaults to `imageWidth - 8`). */
  opaqueWidth?: number;
  /** Opaque face plate height `H` in rig px (defaults to `imageHeight - 8`). */
  opaqueHeight?: number;
  /** Recipe overrides for {@link FACE_DEFORM_FRACTIONS}. */
  overrides?: Readonly<Partial<FaceDeformFractions>> | null;
}

interface DeformWeight {
  bone: string;
  x: number;
  y: number;
  weight: number;
}

interface DeformMeshAttachment {
  type: 'mesh';
  image: string;
  width: number;
  height: number;
  uvs: number[];
  triangles: number[];
  hull: number;
  weights: DeformWeight[][];
}

interface DeformRegionAttachment {
  image: string;
  x: number;
  y: number;
  rotation?: number;
}

interface DeriveSpec {
  kind: 'yaw' | 'pitch';
  degrees: number;
  about?: number;
  depth?: number | Readonly<Record<string, number>>;
  carried?: number | Readonly<Record<string, number>>;
}

interface SliderKey {
  t: number;
  v?: number[] | Record<string, number[]>;
  derive?: DeriveSpec;
}

interface SliderTrack {
  bone?: string;
  group?: string;
  property: string;
  keys: SliderKey[];
}

interface DeformTimelineEntry {
  slot: string;
  attachment: string;
  keys: Array<{ t: number; vertices?: number[] }>;
}

interface SliderAnimation {
  duration: number;
  tracks: SliderTrack[];
  deform?: DeformTimelineEntry[];
}

function buildFaceGrid(width: number, height: number): { points: Array<[number, number]>; uvs: number[]; triangles: number[]; hull: number } {
  const us = FACE_DEFORM_GRID_US;
  const vs = FACE_DEFORM_GRID_VS;
  const cols = us.length - 1;
  const rows = vs.length - 1;
  const ring: Array<[number, number]> = [];
  for (let c = 0; c <= cols; c++) ring.push([c, 0]);
  for (let r = 1; r <= rows; r++) ring.push([cols, r]);
  for (let c = cols - 1; c >= 0; c--) ring.push([c, rows]);
  for (let r = rows - 1; r >= 1; r--) ring.push([0, r]);
  const interior: Array<[number, number]> = [];
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) interior.push([c, r]);
  const all = [...ring, ...interior];
  const idx = new Map<string, number>();
  all.forEach(([c, r], i) => idx.set(`${c},${r}`, i));
  const points: Array<[number, number]> = [];
  const uvs: number[] = [];
  for (const [c, r] of all) {
    const u = us[c];
    const v = vs[r];
    points.push([u * width, v * height]);
    uvs.push(pyRound(u, 6), pyRound(v, 6));
  }
  const triangles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = idx.get(`${c},${r}`) as number;
      const tr = idx.get(`${c + 1},${r}`) as number;
      const bl = idx.get(`${c},${r + 1}`) as number;
      const br = idx.get(`${c + 1},${r + 1}`) as number;
      triangles.push(tl, bl, br, tl, br, tr);
    }
  }
  return { points, uvs, triangles, hull: ring.length };
}

/**
 * Promote the `face` region on `head` to a 5×5 grid mesh and populate the
 * `tilt` and `turn` slider animations with the Set B ×2.5 face and hair mesh
 * deform timelines, feature field-sampled tracks (#468) and ear/topknot tracks
 * (issue #436). When `motion` holds neither `tilt` nor `turn` with slider
 * `derive` keys, neither `rig` nor `motion` is touched.
 */
export function applyFaceSurfaceDeform(
  rig: {
    bones: Array<{ name: string; parent?: string; x: number; y: number; rotation?: number; length?: number; inherit?: string }>;
    skins: { default: Record<string, Record<string, DeformMeshAttachment | DeformRegionAttachment>> };
    invariants?: Record<string, unknown>;
  },
  motion: {
    groups?: Record<string, string[]>;
    animations: Record<string, unknown>;
  },
  options?: FaceSurfaceDeformOptions | Readonly<Partial<FaceDeformFractions>> | null,
): void {
  const rawTilt = motion.animations.tilt as SliderAnimation | undefined;
  const rawTurn = motion.animations.turn as SliderAnimation | undefined;
  if (rawTilt === undefined && rawTurn === undefined) return;
  const hasDerive =
    (rawTilt?.tracks?.some((tr) => tr.keys?.some((k) => k.derive !== undefined)) ?? false) ||
    (rawTurn?.tracks?.some((tr) => tr.keys?.some((k) => k.derive !== undefined)) ?? false);
  if (!hasDerive) return;
  const tiltAnim = rawTilt === undefined ? undefined : structuredClone(rawTilt);
  const turnAnim = rawTurn === undefined ? undefined : structuredClone(rawTurn);
  if (tiltAnim !== undefined) motion.animations.tilt = tiltAnim;
  if (turnAnim !== undefined) motion.animations.turn = turnAnim;

  const isOpts =
    options !== undefined &&
    options !== null &&
    ('imageWidth' in options || 'imageHeight' in options || 'opaqueWidth' in options || 'opaqueHeight' in options || 'overrides' in options);
  const opts: FaceSurfaceDeformOptions = isOpts ? (options as FaceSurfaceDeformOptions) : { overrides: options as Readonly<Partial<FaceDeformFractions>> | null | undefined };
  const f = resolveFaceDeformFractions(opts.overrides);

  const faceSlot = rig.skins.default.face;
  if (faceSlot === undefined || faceSlot.face === undefined) return;
  const faceAtt = faceSlot.face;

  let faceW = opts.imageWidth ?? 114;
  let faceH = opts.imageHeight ?? 136;
  let faceRegX = -1;
  let faceRegY = 49;

  if (!('type' in faceAtt)) {
    faceRegX = faceAtt.x;
    faceRegY = faceAtt.y;
    const grid = buildFaceGrid(faceW, faceH);
    const faceWeights: DeformWeight[][] = grid.points.map(([px, py]) => [
      {
        bone: 'head',
        x: pyRound(faceRegX - faceW / 2 + px, 6),
        y: pyRound(faceRegY + faceH / 2 - py, 6),
      weight: 1,
      },
    ]);
    faceSlot.face = {
      type: 'mesh',
      image: faceAtt.image,
      width: faceW,
      height: faceH,
      uvs: grid.uvs,
      triangles: grid.triangles,
      hull: grid.hull,
      weights: faceWeights,
    };
    if (rig.invariants !== undefined) {
      if (typeof rig.invariants.meshSlots === 'number') rig.invariants.meshSlots += 1;
      if (typeof rig.invariants.meshTriangles === 'number') rig.invariants.meshTriangles += grid.triangles.length / 3;
    }
  } else {
    faceW = faceAtt.width;
    faceH = faceAtt.height;
    let sumX = 0;
    let sumY = 0;
    for (const w of faceAtt.weights) {
      sumX += w[0]?.x ?? 0;
      sumY += w[0]?.y ?? 0;
    }
    if (faceAtt.weights.length > 0) {
      faceRegX = Math.round(sumX / faceAtt.weights.length);
      faceRegY = Math.round(sumY / faceAtt.weights.length);
    }
  }

  const W = opts.opaqueWidth ?? faceW - 8;
  const H = opts.opaqueHeight ?? faceH - 8;
  const X0 = faceRegX;
  const Y0 = faceRegY - 1;

  const boneOrder = new Map<string, number>(rig.bones.map((b, i) => [b.name, i]));
  for (const slotName of ['hair_front', 'hair_back']) {
    const slotObj = rig.skins.default[slotName];
    const att = slotObj?.[slotName];
    if (att !== undefined && 'type' in att) {
      for (const infls of att.weights) {
        infls.sort((a, b) => (boneOrder.get(a.bone) ?? 0) - (boneOrder.get(b.bone) ?? 0));
      }
    }
  }

  const tf = computeWorldTransforms(rig.bones);
  const headTf = tf.get('head') as BoneTransform | undefined;
  if (headTf === undefined) return;

  interface VertexSetup {
    hx: number;
    hy: number;
    boneWeights: Record<string, number>;
    infls: DeformWeight[];
  }

  const getMeshSetup = (att: DeformMeshAttachment): VertexSetup[] =>
    att.weights.map((infls) => {
      let wx = 0;
      let wy = 0;
      const boneWeights: Record<string, number> = {};
      for (const inf of infls) {
        const m = tf.get(inf.bone) as BoneTransform;
        const [x, y] = toWorld(m, inf.x, inf.y);
        wx += x * inf.weight;
        wy += y * inf.weight;
        boneWeights[inf.bone] = (boneWeights[inf.bone] ?? 0) + inf.weight;
      }
      return { hx: wx - headTf.worldX, hy: wy - headTf.worldY, boneWeights, infls };
    });

  const expandToDeform = (verts: readonly VertexSetup[], evalVertex: (v: VertexSetup) => [number, number]): number[] => {
    const out: number[] = [];
    for (const v of verts) {
      const [dx, dy] = evalVertex(v);
      for (const inf of v.infls) {
        const m = tf.get(inf.bone) as BoneTransform;
        const [bx, by] = toBoneLocalVector(m, dx, dy);
        out.push(pyRound(bx, 4), pyRound(by, 4));
      }
    }
    return out;
  };

  const boneMap = new Map(rig.bones.map((b) => [b.name, b]));
  const evalDeriveKey = (boneName: string, k: SliderKey): number => {
    if (Array.isArray(k.v)) return k.v[0] ?? 0;
    if (k.v !== undefined && typeof k.v === 'object') return k.v[boneName]?.[0] ?? 0;
    const d = k.derive;
    if (d === undefined) return 0;
    const b = boneMap.get(boneName);
    const coord = d.kind === 'yaw' ? (b?.x ?? 0) : (b?.y ?? 0);
    const rad = (d.degrees * Math.PI) / 180;
    const depth = typeof d.depth === 'number' ? d.depth : (d.depth?.[boneName] ?? 0);
    const carried = typeof d.carried === 'number' ? d.carried : (d.carried?.[boneName] ?? 0);
    const val = (coord - (d.about ?? 0)) * (Math.cos(rad) - 1) - (depth - carried) * Math.sin(rad);
    const r = Math.round(val * 1e6) / 1e6;
    return r === 0 ? 0 : r;
  };

  const mapParent: Readonly<Record<string, string>> = {
    bang_r0: 'bang_r0_ctl',
    bang_r1: 'bang_r0_ctl',
    bang_c0: 'bang_c0_ctl',
    bang_c1: 'bang_c0_ctl',
    bang_l0: 'bang_l0_ctl',
    bang_l1: 'bang_l0_ctl',
    bun: 'bun_ctl',
  };

  const getBoneDeltaAtTime = (tracks: readonly SliderTrack[], t: number, boneName: string): [number, number] => {
    const driver = mapParent[boneName] ?? boneName;
    let dx = 0;
    let dy = 0;
    for (const tr of tracks) {
      const inGroup = tr.group !== undefined && (motion.groups?.[tr.group]?.includes(driver) ?? false);
      if (tr.bone !== driver && !inGroup) continue;
      const key = tr.keys.find((k) => Math.abs(k.t - t) < 1e-6);
      if (key === undefined) continue;
      const val = evalDeriveKey(driver, key);
      if (tr.property === 'translatex') dx = val;
      if (tr.property === 'translatey') dy = val;
    }
    return [dx, dy];
  };

  const getVertexBoneDelta = (v: VertexSetup, tracks: readonly SliderTrack[], t: number): [number, number] => {
    let bx = 0;
    let by = 0;
    for (const [bname, w] of Object.entries(v.boneWeights)) {
      const [dx, dy] = getBoneDeltaAtTime(tracks, t, bname);
      bx += dx * w;
      by += dy * w;
    }
    return [bx, by];
  };

  const faceMesh = faceSlot.face as DeformMeshAttachment;
  const faceVerts = getMeshSetup(faceMesh);
  const hairFrontAtt = rig.skins.default.hair_front?.hair_front;
  const hairBackAtt = rig.skins.default.hair_back?.hair_back;
  const hairFrontVerts = hairFrontAtt !== undefined && 'type' in hairFrontAtt ? getMeshSetup(hairFrontAtt) : null;
  const hairBackVerts = hairBackAtt !== undefined && 'type' in hairBackAtt ? getMeshSetup(hairBackAtt) : null;

  const hyCrown = Y0 + (67 / 128) * H;
  const hyBunSpan = (85 / 128) * H;
  const hyBangBottom = Y0 - (68 / 128) * H;
  const hyBangSpan = (130 / 128) * H;
  const hyTurnBangBottom = Y0 - (28 / 128) * H;
  const hyTurnBangSpan = (80 / 128) * H;
  const hyEar = Y0 - (16 / 128) * H;
  const earRx = boneMap.get('ear_r')?.x ?? -51;
  const earLx = boneMap.get('ear_l')?.x ?? 47.5;
  const featRx = (24 / 106) * W;
  const featRy = (12 / 128) * H;
  const featMembers = motion.groups?.features ?? [];

  const minDepthOf = (depth: number | Readonly<Record<string, number>> | undefined, fallback: number): number => {
    if (typeof depth === 'number') return depth > 0 ? depth : fallback;
    if (depth === undefined) return fallback;
    const vals = Object.values(depth).filter((v): v is number => typeof v === 'number' && v > 0);
    return vals.length > 0 ? Math.min(...vals) : fallback;
  };

  const memberDepthOf = (depth: number | Readonly<Record<string, number>> | undefined, boneName: string, zRef: number): number => {
    if (typeof depth === 'number') return depth;
    return depth?.[boneName] ?? zRef;
  };

  if (tiltAnim !== undefined) {
    const origTiltTracks = tiltAnim.tracks.map((tr) => ({ ...tr, keys: [...tr.keys] }));
    const tiltKeys: Array<{ t: number; deg: number }> = [
      { t: 0, deg: -25 },
      { t: 0.75, deg: -10 },
      { t: 1.25, deg: 0 },
      { t: 2.0, deg: 15 },
      { t: 2.5, deg: 25 },
    ];
    const tiltDeform: DeformTimelineEntry[] = [
      {
        slot: 'face',
        attachment: 'face',
        keys: tiltKeys.map(({ t, deg }) =>
          deg === 0 ? { t } : { t, vertices: expandToDeform(faceVerts, (v) => evalPitchFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f)) },
        ),
      },
    ];
    if (hairFrontVerts !== null) {
      tiltDeform.push({
        slot: 'hair_front',
        attachment: 'hair_front',
        keys: tiltKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairFrontVerts, (v) => {
                  const [dxSurf, dySurf] = evalPitchFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f);
                  const [bx, by] = getVertexBoneDelta(v, origTiltTracks, t);
                  const baseBangDy = (deg / 15) * (f.tilt_bang_base_y * 15 * H) * Math.max(0, Math.min(1, (v.hy - hyBangBottom) / hyBangSpan));
                  return [dxSurf - bx, baseBangDy + dySurf * f.tilt_hair_front_y - by];
                }),
              },
        ),
      });
    }
    if (hairBackVerts !== null) {
      tiltDeform.push({
        slot: 'hair_back',
        attachment: 'hair_back',
        keys: tiltKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairBackVerts, (v) => {
                  const [bx, by] = getVertexBoneDelta(v, origTiltTracks, t);
                  const [dxSurf, dySurf] = evalPitchFaceSurface(v.hx, Math.min(hyCrown, v.hy), deg, W, H, X0, Y0, f);
                  const uBun = Math.max(0, Math.min(1, (v.hy - hyCrown) / hyBunSpan));
                  const targetDy = (1 - uBun) * (dySurf * f.tilt_hair_back_lower_y) + uBun * (dySurf * f.tilt_hair_back_bun_y);
                  return [dxSurf * (1 - pyRound(1 - f.tilt_hair_back_bun_x, 8) * uBun) - bx, targetDy - by];
                }),
              },
        ),
      });
    }
    for (const tr of tiltAnim.tracks) {
      if (tr.group === 'features' && (tr.property === 'translatey' || tr.property === 'scaley') && featMembers.length > 0) {
        const zRef = minDepthOf(tr.keys[0]?.derive?.depth, 34);
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: tr.property === 'scaley' ? [1] : [0] };
          const vMap: Record<string, number[]> = {};
          for (const bname of featMembers) {
            const b = boneMap.get(bname);
            const bx = b?.x ?? 0;
            const by = b?.y ?? Y0;
            const z = memberDepthOf(k.derive?.depth, bname, zRef);
            const dFrac = zRef > 0 ? z / zRef : 1;
            const uy = Math.max(-1, Math.min(1, (by - Y0) / (H / 2)));
            const effDeg = deg * (1 + (dFrac - 1) * Math.max(0, 1 - uy * uy));
            const [, dyD] = evalPitchFaceSurface(bx, by - featRy, effDeg, W, H, X0, Y0, f);
            const [, dyU] = evalPitchFaceSurface(bx, by + featRy, effDeg, W, H, X0, Y0, f);
            if (tr.property === 'translatey') {
              vMap[bname] = [pyRound(0.5 * (dyD + dyU), 4)];
            } else {
              vMap[bname] = [pyRound(Math.max(0.2, 1 + (dyU - dyD) / (2 * featRy)), 4)];
            }
          }
          return { t: k.t, v: vMap };
        });
      }
      if (tr.group === 'ears' && tr.property === 'translatey') {
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [, dyEar] = evalPitchFaceSurface(0, hyEar, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dyEar * f.tilt_ear_y, 4)] };
        });
      }
      if (tr.group === 'topknot' && tr.property === 'translatey') {
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [, dyCrown] = evalPitchFaceSurface(0, hyCrown, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dyCrown * f.tilt_topknot_y, 4)] };
        });
      }
    }
    const refTiltKeys = origTiltTracks[0]?.keys ?? [];
    for (const [earBone, earHx] of [
      ['ear_r', earRx],
      ['ear_l', earLx],
    ] as const) {
      if (!boneMap.has(earBone)) continue;
      tiltAnim.tracks.push({
        bone: earBone,
        property: 'translatex',
        keys: refTiltKeys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [dxEar] = evalPitchFaceSurface(earHx, hyEar, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dxEar, 4)] };
        }),
      });
    }
    tiltAnim.deform = tiltDeform;
  }

  if (turnAnim !== undefined) {
    const origTurnTracks = turnAnim.tracks.map((tr) => ({ ...tr, keys: [...tr.keys] }));
    const turnKeys: Array<{ t: number; deg: number }> = [
      { t: 0, deg: -30 },
      { t: 0.75, deg: -15 },
      { t: 1.5, deg: 0 },
      { t: 2.25, deg: 15 },
      { t: 3.0, deg: 30 },
    ];
    const turnDeform: DeformTimelineEntry[] = [
      {
        slot: 'face',
        attachment: 'face',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0 ? { t } : { t, vertices: expandToDeform(faceVerts, (v) => evalYawFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f)) },
        ),
      },
    ];
    if (hairFrontVerts !== null) {
      turnDeform.push({
        slot: 'hair_front',
        attachment: 'hair_front',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairFrontVerts, (v) => {
                  const [dxSurf, dySurf] = evalYawFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f);
                  const [bx, by] = getVertexBoneDelta(v, origTurnTracks, t);
                  const uBang = Math.max(0, Math.min(1, (v.hy - hyTurnBangBottom) / hyTurnBangSpan));
                  const bangParallaxX = (deg / 15) * pyRound(f.turn_bang_parallax_x * 15 * W, 8) * uBang;
                  return [bangParallaxX + dxSurf - bx, dySurf - by];
                }),
              },
        ),
      });
    }
    if (hairBackVerts !== null) {
      turnDeform.push({
        slot: 'hair_back',
        attachment: 'hair_back',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairBackVerts, (v) => {
                  const [bx, by] = getVertexBoneDelta(v, origTurnTracks, t);
                  const [dxCheek, dyCheek] = evalYawFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f);
                  const uBun = Math.max(0, Math.min(1, (v.hy - hyCrown) / hyBunSpan));
                  const bunCounterX = FACE_DEFORM_MULT * (deg / 15) * pyRound((f.turn_bun_counter_x * 15 * W) / FACE_DEFORM_MULT, 8);
                  const targetDx = (1 - uBun) * (dxCheek * f.turn_hair_back_cheek_x) + uBun * bunCounterX;
                  return [targetDx - bx, (1 - uBun) * dyCheek - by];
                }),
              },
        ),
      });
    }
    const refTurnKeys = origTurnTracks[0]?.keys ?? [];
    turnAnim.tracks = turnAnim.tracks.filter(
      (tr) => !(tr.group === 'ears' && tr.property === 'translatex') && !(tr.group === 'topknot' && tr.property === 'translatex'),
    );
    for (const tr of turnAnim.tracks) {
      if (tr.group === 'features' && (tr.property === 'translatex' || tr.property === 'scalex') && featMembers.length > 0) {
        const zRef = minDepthOf(tr.keys[0]?.derive?.depth, 36);
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: tr.property === 'scalex' ? [1] : [0] };
          const vMap: Record<string, number[]> = {};
          const s = Math.sign(deg);
          for (const bname of featMembers) {
            const b = boneMap.get(bname);
            const bx = b?.x ?? X0;
            const by = b?.y ?? Y0;
            const z = memberDepthOf(k.derive?.depth, bname, zRef);
            const dFrac = zRef > 0 ? z / zRef : 1;
            const ux = Math.max(-1, Math.min(1, (bx - X0) / (W / 2)));
            const effDeg = deg * (1 + (dFrac - 1) * Math.max(0, 1 - ux * ux));
            const [dxL] = evalYawFaceSurface(bx - featRx, by, effDeg, W, H, X0, Y0, f);
            const [dxR] = evalYawFaceSurface(bx + featRx, by, effDeg, W, H, X0, Y0, f);
            const rawDelta = (dxR - dxL) / (2 * featRx);
            const isTrailing = s * (bx - X0) > featRx * 0.5;
            const sx = isTrailing ? 1 + Math.abs(rawDelta) : Math.max(0.2, 1 + rawDelta);
            const dx = isTrailing
              ? (s > 0 ? dxR - featRx * (sx - 1) : dxL + featRx * (sx - 1))
              : 0.5 * (dxL + dxR);
            if (tr.property === 'translatex') {
              vMap[bname] = [pyRound(dx, 4)];
            } else {
              vMap[bname] = [pyRound(sx, 4)];
            }
          }
          return { t: k.t, v: vMap };
        });
      }
    }
    for (const [earBone, earHx] of [
      ['ear_r', earRx],
      ['ear_l', earLx],
    ] as const) {
      if (!boneMap.has(earBone)) continue;
      turnAnim.tracks.push({
        bone: earBone,
        property: 'translatex',
        keys: refTurnKeys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [dxCheekEdge] = evalYawFaceSurface(earHx, hyEar, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dxCheekEdge * f.turn_ear_x, 4)] };
        }),
      });
    }
    for (const [tkBone, tkFrac] of [
      ['bun_ctl', f.turn_bun_counter_x],
      ['hairpin', f.turn_hairpin_counter_x],
    ] as const) {
      if (!boneMap.has(tkBone)) continue;
      turnAnim.tracks.push({
        bone: tkBone,
        property: 'translatex',
        keys: refTurnKeys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const tkPx = pyRound((tkFrac * 15 * W) / FACE_DEFORM_MULT, 8);
          return { t: k.t, v: [pyRound(FACE_DEFORM_MULT * (deg / 15) * tkPx, 4)] };
        }),
      });
    }
    turnAnim.deform = turnDeform;
  }
}
