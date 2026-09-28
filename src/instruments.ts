/**
 * The instruments behind `check`'s six judgement lines (issue #11, and #31
 * for texture stretch): what an eye used to be asked about a rendered idle,
 * turned into figures read off rigc's frames, its `geometry.json`,
 * `parts.json` and `motion.json`.
 *
 * Everything here is pure: frames, part records and specs in, figures out.
 * `src/check.ts` owns the rigc renders that produce the frames and the bars
 * the figures are held to.
 *
 * ⭐ **A region is chosen by the See-through tag a part came from, never by a
 * part's name** (`parts.json`'s `from`, read through `src/tags.ts`). The
 * torso is `topwear`, the feet `footwear`, the eyes `eyewhite`, the swinging
 * cloth `handwear` and `bottomwear`, the face `face` less the parts drawn on
 * it (`eyewhite`, `irides`, `eyelash`, `eyebrow`, `mouth`). A part is drawn by
 * the slot of its own name — the rig stage's contract, which `check` holds
 * with `CHECK_PART_SLOT_PRESENT` — so a region's slots follow from its parts.
 *
 * A chain is read off the rig's bone TREE and the idle's rotate tracks, not
 * off link names: a keyed bone's chain parent is its nearest ancestor that is
 * itself keyed, which is also how the control bones `<bone>_ctl` fall into
 * place without being recognised by their suffix.
 */
import type { StageBox, Viewport } from './check.ts';
import { cropToSpineY } from './coords.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { type PartRecord, type PartsFile, tagOf } from './parts.ts';
import type { Raster } from './raster/types.ts';
import { type BaseTag, readTag } from './tags.ts';

// ---------------------------------------------------------------------------
// regions, by tag
// ---------------------------------------------------------------------------

/**
 * The v3 base tag a part came from, or null for a `painting:` patch — which no
 * tag classifies, so no region picks it — or a `from` that is neither
 * (readParts already refused that).
 */
export function baseTagOf(p: PartRecord): BaseTag | null {
  const t = tagOf(p.from);
  return t === null ? null : (readTag(t)?.base ?? null);
}

export function partsTagged(parts: PartsFile, tags: readonly BaseTag[]): PartRecord[] {
  return parts.parts.filter((p) => {
    const t = baseTagOf(p);
    return t !== null && tags.includes(t);
  });
}

export const TORSO_TAGS: readonly BaseTag[] = ['topwear'];
export const FEET_TAGS: readonly BaseTag[] = ['footwear'];
export const EYE_TAGS: readonly BaseTag[] = ['eyewhite'];
export const SWING_TAGS: readonly BaseTag[] = ['handwear', 'bottomwear'];
export const FACE_TAGS: readonly BaseTag[] = ['face'];
/** Drawn on the face and moved by the blink or the mouth: left out of the face-outline region. */
export const FACE_FEATURE_TAGS: readonly BaseTag[] = ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth'];

/** A box in frame pixels, half-open: x0 <= x < x1, y0 <= y < y1, clipped to the frame. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Frame pixel x of rig (crop) pixel column u: crop -> world through the stage box, world -> frame through the viewport. */
function frameX(u: number, stage: StageBox, vp: Viewport): number {
  return (stage.x + u - vp.x) * vp.scale;
}

/** Frame pixel y of rig (crop) pixel row v; world y goes through `cropToSpineY`, the one door. */
function frameY(v: number, H: number, stage: StageBox, vp: Viewport): number {
  return (vp.y + vp.height - (stage.y + cropToSpineY(v, H))) * vp.scale;
}

/**
 * The frame-pixel box covering the union of parts' rig boxes: every frame
 * pixel any of them touches (floor of the near edge, ceil of the far one),
 * clipped to the frame. Null for no part or a box entirely off the frame.
 */
export function frameBox(ps: readonly PartRecord[], rigH: number, stage: StageBox, vp: Viewport): PixelBox | null {
  if (ps.length === 0) return null;
  const x0 = Math.max(0, Math.floor(Math.min(...ps.map((p) => frameX(p.x, stage, vp)))));
  const x1 = Math.min(vp.pixelWidth, Math.ceil(Math.max(...ps.map((p) => frameX(p.x + p.w, stage, vp)))));
  const y0 = Math.max(0, Math.floor(Math.min(...ps.map((p) => frameY(p.y, rigH, stage, vp)))));
  const y1 = Math.min(vp.pixelHeight, Math.ceil(Math.max(...ps.map((p) => frameY(p.y + p.h, rigH, stage, vp)))));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function boxLabel(b: PixelBox): string {
  return `${b.x0},${b.y0} ${b.x1 - b.x0}x${b.y1 - b.y0}`;
}

/**
 * Which part is on top at every rig pixel of the flat stack: the index (in
 * parts.json order) of the last part whose alpha there is above
 * `OPAQUE_ALPHA_ABOVE`, or -1. `alphaOf(i)` is part i's PNG.
 */
export function topmostIndex(parts: PartsFile, alphaOf: (i: number) => Raster): Int32Array {
  const [W, H] = parts.rig_size;
  const top = new Int32Array(W * H).fill(-1);
  parts.parts.forEach((p, i) => {
    const im = alphaOf(i);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) if (im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) top[(p.y + y) * W + p.x + x] = i;
    }
  });
  return top;
}

/**
 * Frame pixels whose centre falls on a rig pixel where one of `indices` is on
 * top, inside `box` and outside every box of `exclude`. The frame -> rig map
 * is the inverse of {@link frameBox}'s, sampled at the pixel centre.
 */
export function visibleMask(
  top: Int32Array,
  parts: PartsFile,
  indices: ReadonlySet<number>,
  box: PixelBox,
  exclude: readonly PixelBox[],
  stage: StageBox,
  vp: Viewport,
): Uint8Array {
  const [W, H] = parts.rig_size;
  const m = new Uint8Array(vp.pixelWidth * vp.pixelHeight);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (exclude.some((e) => x >= e.x0 && x < e.x1 && y >= e.y0 && y < e.y1)) continue;
      const u = Math.floor((x + 0.5) / vp.scale + vp.x - stage.x);
      const v = Math.floor(cropToSpineY(vp.y + vp.height - (y + 0.5) / vp.scale - stage.y, H));
      if (u < 0 || u >= W || v < 0 || v >= H) continue;
      if (indices.has(top[v * W + u])) m[y * vp.pixelWidth + x] = 1;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// heat
// ---------------------------------------------------------------------------

/** Each pixel's largest per-channel RGB change from frame 0 across the frames — the red channel `motion_heat.png` blends in. */
export function heatField(frames: readonly Raster[]): Uint8Array {
  const f0 = frames[0];
  const n = f0.width * f0.height;
  const d = new Uint8Array(n);
  for (const f of frames) {
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const v = Math.abs(f.data[p * 4 + c] - f0.data[p * 4 + c]);
        if (v > d[p]) d[p] = v;
      }
    }
  }
  return d;
}

export interface RegionHeat {
  /** Pixels measured. */
  px: number;
  mean: number;
  max: number;
}

/** Heat over a box, or over the pixels of `mask` inside it. */
export function regionHeat(heat: Uint8Array, width: number, box: PixelBox, mask?: Uint8Array): RegionHeat {
  let px = 0;
  let sum = 0;
  let max = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = y * width + x;
      if (mask !== undefined && mask[i] === 0) continue;
      px++;
      sum += heat[i];
      if (heat[i] > max) max = heat[i];
    }
  }
  return { px, mean: px === 0 ? 0 : sum / px, max };
}

// ---------------------------------------------------------------------------
// swing: how far a band of a part's art travels
// ---------------------------------------------------------------------------

/**
 * How far the art inside `box` travels across the frames, in frame pixels: the
 * largest distance of its centroid from frame 0's. The art is every pixel
 * that is not the render's background, so the frames must be a `--slot`
 * render of the part alone. Null when frame 0 has no art in the box.
 *
 * ⚠️ This is a proxy for displacement, not a displacement: art entering or
 * leaving the band moves its centroid too. It was chosen over the band's heat
 * because heat is texture times motion — on the demo's sleeves the tip half's
 * mean heat is 1.1 times the root half's while its centroid travels 3.7 times
 * as far — and the question is how far the cloth moves, not how busy it is.
 */
export function bandExcursion(frames: readonly Raster[], bg: readonly number[], box: PixelBox): number | null {
  const w = frames[0].width;
  const centroid = (f: Raster): [number, number] | null => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const i = (y * w + x) * 4;
        if (f.data[i] !== bg[0] || f.data[i + 1] !== bg[1] || f.data[i + 2] !== bg[2]) {
          n++;
          sx += x;
          sy += y;
        }
      }
    }
    return n === 0 ? null : [sx / n, sy / n];
  };
  const c0 = centroid(frames[0]);
  if (c0 === null) return null;
  let max = 0;
  for (const f of frames) {
    const c = centroid(f);
    if (c === null) continue;
    max = Math.max(max, Math.hypot(c[0] - c0[0], c[1] - c0[1]));
  }
  return max;
}

/** The two halves of a box across its rows: the upper one holds the root of a hanging part, the lower one its tip. */
export function rowHalves(b: PixelBox): { root: PixelBox; tip: PixelBox } {
  const mid = Math.floor((b.y0 + b.y1) / 2);
  return { root: { ...b, y1: mid }, tip: { ...b, y0: mid } };
}

// ---------------------------------------------------------------------------
// sines and chains, off motion.json
// ---------------------------------------------------------------------------

export interface SineReading {
  period: number;
  /** |amplitude|: a sine's sign is a half-cycle of phase, and the keys cannot tell the two apart. */
  amp: number;
  /** Cycles, in [0, 1): `v = base + amp sin(2 pi (t / period - phase))`. */
  phase: number;
}

interface Key {
  t: number;
  v: number[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keysOf(track: Record<string, unknown>): Key[] | null {
  const ks = track.keys;
  if (!Array.isArray(ks)) return null;
  const out: Key[] = [];
  for (const k of ks) {
    if (!isRecord(k) || typeof k.t !== 'number' || !Array.isArray(k.v) || typeof k.v[0] !== 'number') return null;
    out.push({ t: k.t, v: k.v as number[] });
  }
  return out;
}

/**
 * Read a track as the sampled sine `src/motion.ts` writes: keys at equal steps
 * from 0 to the idle's duration, last equal to first. The fundamental is the
 * strongest bin of the discrete Fourier transform of the first n keys; its
 * magnitude is the amplitude and its argument the phase. Null for a track that
 * is not sampled that way (a hand-authored curve) — it is listed as unread,
 * never guessed at.
 */
export function readSine(keys: readonly Key[], duration: number): SineReading | null {
  const n = keys.length - 1;
  if (n < 3 || keys[0].t !== 0 || Math.abs(keys[n].t - duration) > 1e-6) return null;
  for (let k = 0; k <= n; k++) if (Math.abs(keys[k].t - (duration * k) / n) > 1e-6) return null;
  const v = keys.slice(0, n).map((k) => k.v[0]);
  let best = { j: 0, a: 0, b: 0, mag: 0 };
  for (let j = 1; j < n / 2; j++) {
    let a = 0;
    let b = 0;
    for (let k = 0; k < n; k++) {
      a += v[k] * Math.sin((2 * Math.PI * j * k) / n);
      b += v[k] * Math.cos((2 * Math.PI * j * k) / n);
    }
    a *= 2 / n;
    b *= 2 / n;
    const mag = Math.hypot(a, b);
    if (mag > best.mag) best = { j, a, b, mag };
  }
  if (best.j === 0) return null;
  // v = A sin(x - psi) = A cos(psi) sin x - A sin(psi) cos x, so a = A cos psi and b = -A sin psi.
  const psi = Math.atan2(-best.b, best.a);
  const phase = (((psi / (2 * Math.PI)) % 1) + 1) % 1;
  return { period: duration / best.j, amp: best.mag, phase };
}

/** A phase difference in cycles, folded into (-1/4, 1/4]: the sign of a sine is half a cycle, so a lag is only readable modulo half a cycle. */
export function lagStep(from: number, to: number): number {
  let d = (((to - from) % 0.5) + 0.5) % 0.5;
  if (d > 0.25) d -= 0.5;
  return d;
}

export interface ChainLink {
  bone: string;
  reading: SineReading;
}

export interface ChainEdge {
  parent: string;
  child: string;
  step: number;
}

export interface ChainFigures {
  /** Unbranched runs of rotate-keyed bones, each link the keyed child of the one before at the same period. */
  chains: ChainLink[][];
  /** Every keyed bone under a keyed ancestor of the same period: the lag from that ancestor. */
  edges: ChainEdge[];
  /** Keyed bones under a keyed ancestor of another period: their phases are not comparable. */
  otherPeriod: Array<{ parent: string; child: string }>;
  /** Rotate-keyed bones whose track is not a sampled sine, or that carry more than one rotate track. */
  unread: string[];
}

/**
 * The rotate channels of the idle, read as sines and arranged by the rig's
 * bone tree. Only bone tracks and group tracks with property `rotate` are
 * read; a group track keys each of its members.
 */
export function chainFigures(rig: Record<string, unknown>, motion: Record<string, unknown>): ChainFigures {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string') as Array<Record<string, unknown> & { name: string }>;
  const order = new Map(bones.map((b, i) => [b.name, i]));
  const parent = new Map(bones.map((b) => [b.name, typeof b.parent === 'string' ? b.parent : null]));
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const duration = typeof idle.duration === 'number' ? idle.duration : 0;
  const groups = isRecord(motion.groups) ? motion.groups : {};
  const tracksOn = new Map<string, Key[][]>();
  const unreadable = new Set<string>();
  for (const t of Array.isArray(idle.tracks) ? idle.tracks.filter(isRecord) : []) {
    if (t.property !== 'rotate') continue;
    const targets = typeof t.bone === 'string' ? [t.bone] : typeof t.group === 'string' && Array.isArray(groups[t.group]) ? (groups[t.group] as unknown[]).filter((m): m is string => typeof m === 'string') : [];
    const keys = keysOf(t);
    for (const b of targets) {
      if (keys === null) unreadable.add(b);
      else tracksOn.set(b, [...(tracksOn.get(b) ?? []), keys]);
    }
  }
  const reading = new Map<string, SineReading>();
  for (const [b, ts] of tracksOn) {
    const r = ts.length === 1 ? readSine(ts[0], duration) : null;
    if (r === null) unreadable.add(b);
    else reading.set(b, r);
  }
  const byOrder = (a: string, b: string): number => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0);
  const keyed = [...reading.keys()].sort(byOrder);
  const keyedParent = new Map<string, string | null>();
  for (const b of keyed) {
    let p = parent.get(b) ?? null;
    const seen = new Set<string>();
    while (p !== null && !reading.has(p) && !seen.has(p)) {
      seen.add(p);
      p = parent.get(p) ?? null;
    }
    keyedParent.set(b, p !== null && reading.has(p) ? p : null);
  }
  const kids = new Map<string, string[]>();
  for (const b of keyed) {
    const p = keyedParent.get(b) ?? null;
    if (p !== null) kids.set(p, [...(kids.get(p) ?? []), b]);
  }
  const samePeriod = (a: string, b: string): boolean => Math.abs((reading.get(a) as SineReading).period - (reading.get(b) as SineReading).period) < 1e-9;
  const edges: ChainEdge[] = [];
  const otherPeriod: Array<{ parent: string; child: string }> = [];
  for (const b of keyed) {
    const p = keyedParent.get(b) ?? null;
    if (p === null) continue;
    if (samePeriod(p, b)) edges.push({ parent: p, child: b, step: lagStep((reading.get(p) as SineReading).phase, (reading.get(b) as SineReading).phase) });
    else otherPeriod.push({ parent: p, child: b });
  }
  const continues = (b: string): string | null => {
    const k = kids.get(b) ?? [];
    return k.length === 1 && samePeriod(b, k[0]) ? k[0] : null;
  };
  const chains: ChainLink[][] = [];
  for (const b of keyed) {
    const p = keyedParent.get(b) ?? null;
    if (p !== null && continues(p) === b) continue;
    const links: ChainLink[] = [];
    let cur: string | null = b;
    while (cur !== null) {
      links.push({ bone: cur, reading: reading.get(cur) as SineReading });
      cur = continues(cur);
    }
    chains.push(links);
  }
  return { chains, edges, otherPeriod, unread: [...unreadable].sort(byOrder) };
}

// ---------------------------------------------------------------------------
// the blink
// ---------------------------------------------------------------------------

export interface BlinkTrack {
  /** How the track names what it keys, as motion.json spells it. */
  target: { bone: string } | { group: string };
  /** The smallest `scaley` it keys — the closed eye. */
  closed: number;
  /** The first and last key time at that value. */
  window: [number, number];
}

/**
 * The bones an eye part's slot is moved by through `scaley` without changing
 * shape: the slot's bone, and each ancestor it sits at the origin of (local
 * x = y = 0) — which is how a control bone is attached, so a blink moved to a
 * control is found without reading its name.
 */
export function eyeBones(rig: Record<string, unknown>, slotBones: readonly string[]): Set<string> {
  const bones = new Map((Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).map((b) => [String(b.name), b]));
  const out = new Set<string>();
  for (const s of slotBones) {
    let cur: string | null = s;
    while (cur !== null && !out.has(cur)) {
      out.add(cur);
      const b = bones.get(cur);
      if (b === undefined || (b.x ?? 0) !== 0 || (b.y ?? 0) !== 0) break;
      cur = typeof b.parent === 'string' ? b.parent : null;
    }
  }
  return out;
}

/** The idle's `scaley` tracks on the eye bones (directly or through a group) that go below their first key: the blink. */
export function blinkTracks(motion: Record<string, unknown>, eyes: ReadonlySet<string>): BlinkTrack[] {
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const groups = isRecord(motion.groups) ? motion.groups : {};
  const out: BlinkTrack[] = [];
  for (const t of Array.isArray(idle.tracks) ? idle.tracks.filter(isRecord) : []) {
    if (t.property !== 'scaley') continue;
    let target: BlinkTrack['target'] | null = null;
    if (typeof t.bone === 'string' && eyes.has(t.bone)) target = { bone: t.bone };
    else if (typeof t.group === 'string' && Array.isArray(groups[t.group]) && (groups[t.group] as unknown[]).some((m) => typeof m === 'string' && eyes.has(m))) target = { group: t.group };
    const keys = keysOf(t);
    if (target === null || keys === null || keys.length === 0) continue;
    const closed = Math.min(...keys.map((k) => k.v[0]));
    if (!(closed < keys[0].v[0])) continue;
    const at = keys.filter((k) => k.v[0] === closed).map((k) => k.t);
    out.push({ target, closed, window: [at[0], at[at.length - 1]] });
  }
  return out;
}

export interface BlinkFigures {
  /** Pixels in the box that show the background with the eyes closed and showed art with them open. */
  holePx: number;
  /** Of the box's pixels with the eyes closed, the largest max-channel distance to the nearest colour the open-eye box holds. */
  patchMax: number;
  /** How many exceed `patchLevel`. */
  patchOver: number;
  px: number;
}

/**
 * The closed-eye frame against the open-eye frame on the same grid, inside
 * the eye box. A hole is background where there was art — the rasteriser
 * paints the background exactly where nothing is drawn. A colour patch is a
 * pixel far from every colour the open eye's box held; that half is a
 * reported figure, not a bar (see AUTHORING §7).
 */
export function blinkFigures(open: Raster, closed: Raster, bg: readonly number[], box: PixelBox, patchLevel: number): BlinkFigures {
  const w = open.width;
  const isBg = (r: Raster, i: number): boolean => r.data[i] === bg[0] && r.data[i + 1] === bg[1] && r.data[i + 2] === bg[2];
  const colours = new Map<number, [number, number, number]>();
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * w + x) * 4;
      colours.set((open.data[i] << 16) | (open.data[i + 1] << 8) | open.data[i + 2], [open.data[i], open.data[i + 1], open.data[i + 2]]);
    }
  }
  const palette = [...colours.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  let holePx = 0;
  let patchMax = 0;
  let patchOver = 0;
  let px = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * w + x) * 4;
      px++;
      if (isBg(closed, i) && !isBg(open, i)) holePx++;
      let near = 255;
      for (const c of palette) {
        const d = Math.max(Math.abs(closed.data[i] - c[0]), Math.abs(closed.data[i + 1] - c[1]), Math.abs(closed.data[i + 2] - c[2]));
        if (d < near) near = d;
        if (near === 0) break;
      }
      if (near > patchMax) patchMax = near;
      if (near > patchLevel) patchOver++;
    }
  }
  return { holePx, patchMax, patchOver, px };
}

// ---------------------------------------------------------------------------
// texture stretch (issue #31)
// ---------------------------------------------------------------------------

/** One mesh attachment's rest shape and topology, as rigc's `geometry.json` `rest` table carries it: world units, the setup pose's bones with no deform. */
export interface MeshRest {
  slot: string;
  attachment: string;
  /** x, y per vertex. */
  vertices: readonly number[];
  /** Vertex index triplets. */
  triangles: readonly number[];
}

/** One frame's skinned attachments, as `geometry.json`'s `frames[i].attachments` carries them. */
export interface GeometryPose {
  index: number;
  attachments: ReadonlyArray<{ slot: string; attachment: string; vertices: readonly number[] }>;
}

/** Where one edge ratio was found: the triangle, its three vertex indices, the edge's two, the frame, and deformed length over rest length. */
export interface StretchAt {
  triangle: number;
  vertices: [number, number, number];
  edge: [number, number];
  frame: number;
  ratio: number;
}

export interface MeshStretch {
  slot: string;
  attachment: string;
  triangles: number;
  /** Frames that show this attachment; 0 leaves `max` and `min` null. */
  frames: number;
  /** The largest edge ratio over every triangle and every frame. */
  max: StretchAt | null;
  /** The smallest. */
  min: StretchAt | null;
  /** Rest edges of length 0, which no ratio can be read off: `triangle`, the edge's two vertices. */
  degenerate: Array<{ triangle: number; edge: [number, number] }>;
}

/**
 * How far a ratio is from 1 in either direction: `max(r, 1/r)`. Compression
 * distorts a texture as much as stretch does — an edge at half its rest length
 * squeezes the texels on it by the factor an edge at twice its rest length
 * spreads them — so the one figure held to a bar reads both, as |ln r| does.
 */
export function stretchSeverity(ratio: number): number {
  return ratio >= 1 ? ratio : 1 / ratio;
}

/**
 * For every mesh in `rest`, every triangle's three edges in every frame that
 * shows the attachment: deformed length over rest length, the largest and the
 * smallest, each with the triangle, its vertices, the edge and the frame.
 * Frames are walked in the order given and triangles in index order, and a
 * later value replaces the kept one only when strictly more extreme, so a tie
 * names the earliest frame and then the lowest triangle.
 */
export function stretchFigures(rest: readonly MeshRest[], frames: readonly GeometryPose[]): MeshStretch[] {
  return rest.map((m) => {
    const t = m.triangles;
    const v0 = m.vertices;
    const len = (v: readonly number[], a: number, b: number): number => Math.hypot(v[2 * a] - v[2 * b], v[2 * a + 1] - v[2 * b + 1]);
    const out: MeshStretch = { slot: m.slot, attachment: m.attachment, triangles: t.length / 3, frames: 0, max: null, min: null, degenerate: [] };
    const restLen: number[] = [];
    for (let i = 0; i < t.length; i += 3) {
      for (const [a, b] of [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]] as const) {
        const l = len(v0, a, b);
        restLen.push(l);
        if (l === 0) out.degenerate.push({ triangle: i / 3, edge: [a, b] });
      }
    }
    for (const f of frames) {
      const pose = f.attachments.find((a) => a.slot === m.slot && a.attachment === m.attachment);
      if (pose === undefined) continue;
      out.frames++;
      for (let i = 0; i < t.length; i += 3) {
        const edges = [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]] as const;
        for (let e = 0; e < 3; e++) {
          const l0 = restLen[i + e];
          if (l0 === 0) continue;
          const [a, b] = edges[e];
          const ratio = len(pose.vertices, a, b) / l0;
          const at = (): StretchAt => ({ triangle: i / 3, vertices: [t[i], t[i + 1], t[i + 2]], edge: [a, b], frame: f.index, ratio });
          if (out.max === null || ratio > out.max.ratio) out.max = at();
          if (out.min === null || ratio < out.min.ratio) out.min = at();
        }
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// the face in the head's own frame (issue #33)
// ---------------------------------------------------------------------------

/** A bone's world transform as rigc's `geometry.json` records it: world = [a b; c d] local + (worldX, worldY), Spine's y-up world units. */
export interface BoneWorld {
  a: number;
  b: number;
  c: number;
  d: number;
  worldX: number;
  worldY: number;
}

/** One bone's world transform at the setup pose and on every frame of a render, in frame order, with each frame's time in seconds. */
export interface BoneTrack {
  bone: string;
  setup: BoneWorld;
  frames: BoneWorld[];
  times: number[];
}

/**
 * The world -> world map that carries the bone from its setup pose to a
 * frame: `frame * setup^-1`, as a {@link BoneWorld} (matrix and translation).
 * Null when the setup transform is singular.
 */
export function setupToFrame(setup: BoneWorld, frame: BoneWorld): BoneWorld | null {
  const det = setup.a * setup.d - setup.b * setup.c;
  if (!(Math.abs(det) > 1e-12)) return null;
  const ia = setup.d / det;
  const ib = -setup.b / det;
  const ic = -setup.c / det;
  const id = setup.a / det;
  const a = frame.a * ia + frame.b * ic;
  const b = frame.a * ib + frame.b * id;
  const c = frame.c * ia + frame.d * ic;
  const d = frame.c * ib + frame.d * id;
  return { a, b, c, d, worldX: frame.worldX - (a * setup.worldX + b * setup.worldY), worldY: frame.worldY - (c * setup.worldX + d * setup.worldY) };
}

/** Spine's local transform fields for a root bone whose world transform is `m` (shearX held at 0): the inverse of spine-core's `a = cos(rotation + shearX) scaleX`, `b = cos(rotation + 90 + shearY) scaleY`, `c = sin(...) scaleX`, `d = sin(...) scaleY`. Degrees. */
export function rootLocalOf(m: BoneWorld): { x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearY: number } {
  const deg = 180 / Math.PI;
  const rotation = Math.atan2(m.c, m.a) * deg;
  let shearY = Math.atan2(m.d, m.b) * deg - rotation - 90;
  shearY = ((((shearY + 180) % 360) + 360) % 360) - 180;
  return { x: m.worldX, y: m.worldY, rotation, scaleX: Math.hypot(m.a, m.c), scaleY: Math.hypot(m.b, m.d), shearY };
}

/** A 2x3 affine map of frame pixels, `(x, y) -> (m[0] x + m[1] y + m[2], m[3] x + m[4] y + m[5])`. */
export type PixelAffine = readonly [number, number, number, number, number, number];

/**
 * The frame-pixel map that carries a point on the bone at the setup pose to
 * where the same point is on a frame: frame pixel -> world (the viewport's
 * inverse), world -> bone-local (the setup transform's inverse), bone-local ->
 * world (the frame's transform), world -> frame pixel (the viewport). Every
 * step is affine, so the map is one 2x3 matrix. Null when the setup transform
 * is singular (a bone scaled to nothing has no frame to carry back into).
 */
export function restToFrame(setup: BoneWorld, frame: BoneWorld, vp: Viewport): PixelAffine | null {
  const w = setupToFrame(setup, frame);
  if (w === null) return null;
  const s = vp.scale;
  const { a: ra, b: rb, c: rc, d: rd, worldX: tx, worldY: ty } = w;
  // world (wx, wy) of pixel (px, py): wx = px / s + vp.x, wy = Y - py / s with Y = vp.y + vp.height
  const Y = vp.y + vp.height;
  // world' = R (wx, wy) + t; px' = (wx' - vp.x) s, py' = (Y - wy') s
  const m0 = ra;
  const m1 = -rb;
  const m2 = (ra * vp.x + rb * Y + tx - vp.x) * s;
  const m3 = -rc;
  const m4 = rd;
  const m5 = (Y - (rc * vp.x + rd * Y + ty)) * s;
  return [m0, m1, m2, m3, m4, m5];
}

/**
 * Bilinear sample of a frame's RGB at a continuous frame-pixel position, with
 * pixel centres at integer + 0.5 and every tap outside the frame reading the
 * render's background — which is what rigc paints wherever nothing is drawn.
 * Plain float64 bilinear interpolation, not a port of any library call: the
 * figure it feeds is a difference of two samples through the same filter, so
 * no library's rounding is being reproduced.
 */
export function sampleRgb(f: Raster, x: number, y: number, bg: readonly number[], out: Float64Array): void {
  const gx = x - 0.5;
  const gy = y - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    const wy = j === 0 ? 1 - fy : fy;
    if (wy === 0) continue;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      const w = wy * (i === 0 ? 1 - fx : fx);
      if (w === 0) continue;
      const inside = xx >= 0 && xx < f.width && yy >= 0 && yy < f.height;
      const at = (yy * f.width + xx) * 4;
      for (let c = 0; c < 3; c++) out[c] += w * (inside ? f.data[at + c] : bg[c]);
    }
  }
}

/**
 * Heat over a region measured in a bone's own frame: every pixel of `mask`
 * inside `box` is a point on the bone at the setup pose; on each frame that
 * point is carried to where the bone has moved it ({@link restToFrame}) and
 * the frame is sampled there ({@link sampleRgb}); a pixel's heat is its largest
 * per-channel change from frame 0's sample across the frames, as
 * {@link heatField}'s is in screen space. Art rigid on the bone therefore
 * measures only the resampler's own error, and anything that moves on the
 * region relative to the bone measures its motion. Null when a transform
 * is singular.
 */
export function boneFrameHeat(frames: readonly Raster[], track: BoneTrack, vp: Viewport, bg: readonly number[], box: PixelBox, mask: Uint8Array): RegionHeat | null {
  const maps: PixelAffine[] = [];
  for (const f of track.frames) {
    const m = restToFrame(track.setup, f, vp);
    if (m === null) return null;
    maps.push(m);
  }
  const width = vp.pixelWidth;
  const s0 = new Float64Array(3);
  const sk = new Float64Array(3);
  let px = 0;
  let sum = 0;
  let max = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (mask[y * width + x] === 0) continue;
      const cx = x + 0.5;
      const cy = y + 0.5;
      const m0 = maps[0];
      sampleRgb(frames[0], m0[0] * cx + m0[1] * cy + m0[2], m0[3] * cx + m0[4] * cy + m0[5], bg, s0);
      let d = 0;
      for (let k = 1; k < frames.length; k++) {
        const m = maps[k];
        sampleRgb(frames[k], m[0] * cx + m[1] * cy + m[2], m[3] * cx + m[4] * cy + m[5], bg, sk);
        for (let c = 0; c < 3; c++) {
          const v = Math.abs(sk[c] - s0[c]);
          if (v > d) d = v;
        }
      }
      px++;
      sum += d;
      if (d > max) max = d;
    }
  }
  return { px, mean: px === 0 ? 0 : sum / px, max };
}

/** A box in Spine world units at the setup pose (y up): x0 <= x <= x1, y0 <= y <= y1. */
export interface WorldBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where a part's art can be, in the head's frame, over the frames: the part's
 * setup-pose box carried by the bone its slot rides to each frame and back
 * through the head's transform, as the bounding box of every corner on every
 * frame (the setup box included). For a feature the head carries rigidly it is
 * the setup box; for one its own bone moves on the face — a brow the blink
 * drops — it is the whole of where it goes. Null when a transform is singular.
 */
export function sweptBox(box: WorldBox, part: BoneTrack, head: BoneTrack): WorldBox | null {
  const corners: Array<[number, number]> = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ];
  let out: WorldBox = { ...box };
  for (let k = 0; k < part.frames.length; k++) {
    const f = setupToFrame(part.setup, part.frames[k]);
    const g = setupToFrame(head.setup, head.frames[k]);
    if (f === null || g === null) return null;
    const det = g.a * g.d - g.b * g.c;
    if (!(Math.abs(det) > 1e-12)) return null;
    for (const [x, y] of corners) {
      // world at frame k, then back through the head's setup -> frame map
      const wx = f.a * x + f.b * y + f.worldX - g.worldX;
      const wy = f.c * x + f.d * y + f.worldY - g.worldY;
      const hx = (g.d * wx - g.b * wy) / det;
      const hy = (-g.c * wx + g.a * wy) / det;
      out = { x0: Math.min(out.x0, hx), y0: Math.min(out.y0, hy), x1: Math.max(out.x1, hx), y1: Math.max(out.y1, hy) };
    }
  }
  return out;
}

/** A part's rig box (crop pixels, y down) as a world box at the setup pose, through the stage box and `cropToSpineY`. */
export function partWorldBox(p: PartRecord, rigH: number, stage: StageBox): WorldBox {
  return { x0: stage.x + p.x, x1: stage.x + p.x + p.w, y0: stage.y + cropToSpineY(p.y + p.h, rigH), y1: stage.y + cropToSpineY(p.y, rigH) };
}

/**
 * How far, in rig pixels, what a region pixel reads in the head's frame can
 * reach from its centre: the rasteriser samples each texture bilinearly (one
 * texel each way), and {@link boneFrameHeat} samples each frame bilinearly
 * (one frame pixel each way, 1/scale rig pixels). A pixel is the face's to
 * answer for only when everything within that reach is the face.
 */
export function footprintReach(vp: Viewport): number {
  return 1 + 1 / vp.scale;
}

/**
 * The region the face half measures in the head's frame: frame pixels whose
 * whole footprint ({@link footprintReach}) at the setup pose lies on rig
 * pixels where one of `indices` is on top, and whose centre is at least that
 * reach from every box of `exclude` (world boxes: where the features go).
 * A pixel at the region's rim, or next to a feature, reads a neighbour's art
 * as well, and that neighbour moving — a torso breathing under the chin —
 * would light it without anything on the face having moved.
 */
export function footprintMask(
  top: Int32Array,
  parts: PartsFile,
  indices: ReadonlySet<number>,
  box: PixelBox,
  exclude: readonly WorldBox[],
  stage: StageBox,
  vp: Viewport,
): Uint8Array {
  const [W, H] = parts.rig_size;
  const r = footprintReach(vp);
  const m = new Uint8Array(vp.pixelWidth * vp.pixelHeight);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const wx = (x + 0.5) / vp.scale + vp.x;
      const wy = vp.y + vp.height - (y + 0.5) / vp.scale;
      if (exclude.some((e) => wx > e.x0 - r && wx < e.x1 + r && wy > e.y0 - r && wy < e.y1 + r)) continue;
      const u = wx - stage.x;
      const v = cropToSpineY(wy - stage.y, H);
      const u0 = Math.floor(u - r);
      const u1 = Math.floor(u + r);
      const v0 = Math.floor(v - r);
      const v1 = Math.floor(v + r);
      if (u0 < 0 || u1 >= W || v0 < 0 || v1 >= H) continue;
      let all = true;
      for (let vv = v0; vv <= v1 && all; vv++) for (let uu = u0; uu <= u1 && all; uu++) if (!indices.has(top[vv * W + uu])) all = false;
      if (all) m[y * vp.pixelWidth + x] = 1;
    }
  }
  return m;
}
