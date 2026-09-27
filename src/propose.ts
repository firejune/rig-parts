/**
 * The propose stage: bone origins, mesh candidate lists, regions and a default
 * idle, read off the assembled parts — and the overlay a person or an agent
 * corrects them against.
 *
 * ⭐ **Roles come from each part's See-through tag** (`parts.json` `from`),
 * never from the part's name. A plan may call the skirt layer anything; what
 * makes it the skirt is that it came from `bottomwear`. The rules, by tag:
 *
 * - `face` (head run first) -> `hip`/`chest`/`neck`/`head`; `eyewhite-r/-l`
 *   -> `eye_r`/`eye_l`; `mouth` -> `mouth` at the centroid of its biggest blob
 *   (stray pixels inflate a box); `eyebrow-*` -> `brow_r`/`brow_l` by POSITION
 *   left or right of the eye axis, never by tag, because the head run has been
 *   observed to swap the two brow tags.
 * - `bottomwear` -> `hip` at its top edge + three skirt chains.
 * - `topwear` -> two outer-robe chains, only when it hangs below the hip line;
 *   a side whose link falls off the art is dropped.
 * - `handwear-*` -> two blobs: one sleeve chain per blob, its mesh taking that
 *   chain and a chest stub at the shoulder; one blob: both chains and the chest
 *   midline, split at the eye axis.
 * - `front hair` -> three fringe chains + one lock chain per strand that hangs
 *   0.3 face heights below the chin.
 * - `back hair` -> one `bun` bone if it ends above the shoulders, else two
 *   hanging chains.
 * - `headwear` / `earwear` -> the biggest layer of the tag gets a rigid bone
 *   and a pendant chain where the part narrows (dropped if any chain point is
 *   off the art); any other layer of the tag rides the head as a region.
 * - anything no rule claims rides its nearest trunk bone as a region.
 *
 * What it cannot know is written into `notes` when it guessed, and otherwise
 * left to the person correcting: things hidden inside a layer (a sash tail
 * painted into the skirt), hair that is none of the shapes above, whether an
 * accessory swings.
 *
 * Port of the reference `landmarks.py` (`propose`, `expand`, `lint`,
 * `compare`, `draw`). Every rule, constant and evaluation order is the
 * reference's, including three Python behaviours `src/pyfmt.ts` reproduces
 * (`round` to even, `or` treating 0.0 as missing, negative slice starts). Two
 * departures, both stated where they happen: a missing face is refused rather
 * than crashing, and the eye regions are keyed by the eyewhite part's own name
 * rather than by the literal `eyewhite_r`.
 *
 * Coordinates are rig pixels, y down, origin top-left — the parts' own space.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drawText, GLYPH_H } from 'spine-rigc/tools/font5x7.ts';
import { type BoneEntry, type MeshSpec, parseConfig, type Point, type Segment } from './config.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { type PartRecord, type PartsFile, readParts } from './parts.ts';
import { connectedComponents } from './raster/components.ts';
import { dilate, morphGradient } from './raster/morph.ts';
import { readPng } from './raster/png.ts';
import { resize } from './raster/resize.ts';
import { type Mask, newMask, newRaster, type Raster } from './raster/types.ts';
import { npMean, npMedian, npPercentile, pyFixed, pyInt, pyIntList, pyRepr, pyRound, pyStrList } from './pyfmt.ts';

// ---------------------------------------------------------------------------
// the output shape — config-shaped, key order as the reference writes it
// ---------------------------------------------------------------------------

export interface ProposedSingleTrack {
  bone: string;
  prop: 'rotate' | 'translatey' | 'scalex';
  amp: number;
  period: number;
  phase: number;
  base?: number;
}

export interface ProposedChainTrack {
  chain: string;
  amps: number[];
  period: number;
  phase: number;
  lag: number;
}

export interface Proposal {
  bones: BoneEntry[];
  meshes: Record<string, MeshSpec>;
  regions: Record<string, string>;
  motion: {
    duration: number;
    tracks: Array<ProposedSingleTrack | ProposedChainTrack>;
    blink: { t: number; eyes: string[]; brows: string[]; squash: number; brow_drop: number };
  };
  notes: string[];
}

/**
 * Hold the proposal to the config contract before it is written: it is copied
 * into a config field by field, so a proposal the loader would refuse is a
 * wrong file waiting to be pasted. The plan the loader needs is the parts
 * themselves — `[name, run, tag]` from each part's `from` — so every part must
 * come out as exactly one mesh or one region, every name must resolve, and
 * every chain track must carry one amplitude per link. Throws the loader's own
 * refusals.
 */
export function checkProposal(P: PartSet, p: Proposal): void {
  parseConfig({
    key: 'proposal',
    assemble: { rig_scale: 1, plan: P.recs.map((r) => [r.name, ...splitFrom(r.from)]) },
    bones: p.bones,
    meshes: p.meshes,
    regions: p.regions,
    motion: p.motion,
  });
}

/** Fixed key order, two-space indent, trailing newline: the same inputs write the same bytes. */
export function serializeProposal(p: Proposal): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// the parts, as masks
// ---------------------------------------------------------------------------

/** The assembled parts: `parts.json` plus `parts/<name>.png` beside it, every part as a full-canvas mask. */
export class PartSet {
  readonly W: number;
  readonly H: number;
  readonly recs: readonly PartRecord[];
  readonly images: ReadonlyMap<string, Raster>;
  private readonly masks = new Map<string, Mask>();

  constructor(file: PartsFile, images: ReadonlyMap<string, Raster>) {
    [this.W, this.H] = file.rig_size;
    this.recs = file.parts;
    this.images = images;
  }

  /** Parts whose `from` tag is exactly `tag`, optionally from one run, in parts.json order. */
  byTag(tag: string, run?: 'full' | 'head'): PartRecord[] {
    return this.recs.filter((p) => {
      const [r, t] = splitFrom(p.from);
      return t === tag && (run === undefined || r === run);
    });
  }

  /** `byTag(tag, 'head') or byTag(tag)`: the head run's layer when it has one. */
  headFirst(tag: string): PartRecord[] {
    const head = this.byTag(tag, 'head');
    return head.length > 0 ? head : this.byTag(tag);
  }

  /** Full-canvas mask of a part: its PNG's alpha above 8, placed at its box. */
  alpha(p: PartRecord): Mask {
    const cached = this.masks.get(p.name);
    if (cached !== undefined) return cached;
    const im = this.images.get(p.name) as Raster;
    const m = newMask(this.W, this.H);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) m.data[(p.y + y) * this.W + p.x + x] = im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    }
    this.masks.set(p.name, m);
    return m;
  }
}

function splitFrom(from: string): [string, string] {
  const i = from.indexOf(':');
  return [from.slice(0, i), from.slice(i + 1)];
}

/**
 * Read `parts.json` and every PNG it names. A PNG that is absent, or whose size
 * is not its record's box, is refused by name — the reference would have
 * crashed on the second and read garbage on neither.
 */
export function readPartSet(dir: string): PartSet {
  const file = readParts(join(dir, 'parts.json'));
  const problems: Problem[] = [];
  const images = new Map<string, Raster>();
  for (const p of file.parts) {
    const png = join(dir, 'parts', `${p.name}.png`);
    if (!existsSync(png)) {
      problems.push({ code: 'PROPOSE_PNG_PRESENT', object: `part "${p.name}"`, detail: `${png} does not exist; parts.json names it` });
      continue;
    }
    const im = readPng(png);
    if (im.width !== p.w || im.height !== p.h) {
      problems.push({ code: 'PROPOSE_PNG_MATCHES_BOX', object: `part "${p.name}"`, detail: `parts/${p.name}.png is ${im.width}x${im.height}; its parts.json box is ${p.w}x${p.h}` });
      continue;
    }
    images.set(p.name, im);
  }
  refuseIfAny(problems);
  return new PartSet(file, images);
}

// ---------------------------------------------------------------------------
// mask measurements, in numpy's slicing semantics
// ---------------------------------------------------------------------------

/** Python's `a[start:stop]` bounds over a length, negative indices included. */
function pySlice(start: number, stop: number, len: number): [number, number] {
  const norm = (i: number): number => (i < 0 ? Math.max(0, len + i) : Math.min(i, len));
  const s = norm(start);
  const e = norm(stop);
  return [s, Math.max(s, e)];
}

/** Columns (sorted) holding a set pixel in rows `mask[r0:r1]`. */
function colsAny(m: Mask, r0: number, r1: number): number[] {
  const [a, b] = pySlice(r0, r1, m.height);
  const hit = new Uint8Array(m.width);
  for (let y = a; y < b; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) hit[x] = 1;
  const out: number[] = [];
  for (let x = 0; x < m.width; x++) if (hit[x]) out.push(x);
  return out;
}

/** Rows (sorted) holding a set pixel. */
function rowsAny(m: Mask): number[] {
  const out: number[] = [];
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) {
        out.push(y);
        break;
      }
    }
  }
  return out;
}

function sideOf(xs: number[], side: 'r' | 'l', axis: number): number[] {
  return side === 'r' ? xs.filter((x) => x < axis) : xs.filter((x) => x >= axis);
}

/**
 * The x of the mask in a horizontal band at y (`half` rows each way): the
 * column-count centroid, or `frac` of the way between the band's edges. `null`
 * when the band is empty — the reference's `None`.
 */
function bandX(m: Mask, y: number, opts: { half?: number; frac?: number; side?: 'r' | 'l'; axis?: number } = {}): number | null {
  const half = opts.half ?? 12;
  const y0 = Math.max(0, pyInt(y - half));
  const y1 = pyInt(y + half);
  const [a, b] = pySlice(y0, y1, m.height);
  const counts = new Float64Array(m.width);
  for (let yy = a; yy < b; yy++) for (let x = 0; x < m.width; x++) counts[x] += m.data[yy * m.width + x];
  let xs: number[] = [];
  for (let x = 0; x < m.width; x++) if (counts[x] > 0) xs.push(x);
  if (opts.side !== undefined) xs = sideOf(xs, opts.side, opts.axis as number);
  if (xs.length === 0) return null;
  if (opts.frac === undefined) {
    let num = 0;
    let den = 0;
    for (const x of xs) {
      num += x * counts[x];
      den += counts[x];
    }
    return num / den;
  }
  return xs[0] + opts.frac * (xs[xs.length - 1] - xs[0]);
}

/** Python's `v or fallback` on a float that may be `None`: 0.0 is falsy there, and so it is here. */
function or(v: number | null, fallback: number): number {
  return v === null || v === 0 ? fallback : v;
}

function center(p: PartRecord): [number, number] {
  return [p.x + p.w / 2, p.y + p.h / 2];
}

function rnd(p: readonly [number, number]): Point {
  return [pyRound(p[0]), pyRound(p[1])];
}

function isOn(m: Mask, x: number, y: number): boolean {
  const xi = pyInt(x);
  const yi = pyInt(y);
  return yi >= 0 && yi < m.height && xi >= 0 && xi < m.width && m.data[yi * m.width + xi] === 1;
}

function union(a: Mask, b: Mask): Mask {
  const out = newMask(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] | b.data[i];
  return out;
}

// ---------------------------------------------------------------------------
// the proposer
// ---------------------------------------------------------------------------

/** The region role of each tag that has one. Brows are overridden by position below. */
const TAG_REGION: Readonly<Record<string, string>> = {
  face: 'head',
  'ears-r': 'head',
  'ears-l': 'head',
  mouth: 'mouth',
  nose: 'head',
  'irides-r': 'eye_r',
  'irides-l': 'eye_l',
  'eyelash-r': 'eye_r',
  'eyelash-l': 'eye_l',
  'eyewhite-r': 'eye_r',
  'eyewhite-l': 'eye_l',
  'eyebrow-r': 'brow_r',
  'eyebrow-l': 'brow_l',
  footwear: 'root',
};

const SIDES = [
  ['r', 1],
  ['l', -1],
] as const;

export function propose(P: PartSet): Proposal {
  const bones: BoneEntry[] = [];
  // No prototype: a part may be named anything file-safe, "__proto__" included.
  const meshes = Object.create(null) as Record<string, MeshSpec>;
  const regions = Object.create(null) as Record<string, string>;
  const tracks: Array<ProposedSingleTrack | ProposedChainTrack> = [];
  const notes: string[] = [];

  const faces = P.headFirst('face');
  if (faces.length === 0) {
    const tags = [...new Set(P.recs.map((p) => p.from))].join(', ');
    refuseIfAny([
      {
        code: 'PROPOSE_FACE_PRESENT',
        object: 'parts.json',
        detail: `holds no part from a "face" layer (found: ${tags}); head, neck, the eye axis and the face height every other rule scales by all come from it`,
      },
    ]);
  }
  const face = faces[0];
  const [fx0, fy0, fw, fh] = [face.x, face.y, face.w, face.h];
  const ew: Record<'r' | 'l', PartRecord | null> = { r: P.byTag('eyewhite-r')[0] ?? null, l: P.byTag('eyewhite-l')[0] ?? null };
  const eyes = new Map<'r' | 'l', [number, number]>();
  for (const s of ['r', 'l'] as const) {
    const p = ew[s];
    if (p !== null) eyes.set(s, center(p));
  }
  const axis = eyes.size === 2 ? ((eyes.get('r') as [number, number])[0] + (eyes.get('l') as [number, number])[0]) / 2 : fx0 + fw / 2;
  const eyeY = eyes.size > 0 ? npMean([...eyes.values()].map((e) => e[1])) : fy0 + 0.5 * fh;
  const chin = fy0 + fh;
  const head: [number, number] = [axis, fy0 + 0.88 * fh];
  const neckp = P.headFirst('neck');
  const neckY = neckp.length > 0 ? (chin + neckp[0].y + neckp[0].h) / 2 : chin + 0.12 * fh;
  const bw = P.byTag('bottomwear');
  const tw = P.byTag('topwear');
  let hip: [number, number];
  if (bw.length > 0) hip = [bw[0].x + bw[0].w / 2, bw[0].y + 0.14 * fh];
  else {
    // Only this branch reads the figure's extent, so only it builds the union.
    let fig = newMask(P.W, P.H);
    for (const p of P.recs) fig = union(fig, P.alpha(p));
    const ys = rowsAny(fig);
    const ftop = ys[0];
    const fbot = ys[ys.length - 1];
    hip = [axis, ftop + 0.32 * (fbot - ftop)];
    notes.push('no bottomwear: hip from 0.32 of figure height');
  }
  const chest: [number, number] = [hip[0], neckY + 0.5 * (hip[1] - neckY)];
  const B = (name: string, parent: string, at: readonly [number, number], tip?: readonly [number, number]): void => {
    bones.push(tip === undefined ? { name, parent, at: rnd(at) } : { name, parent, at: rnd(at), tip: rnd(tip) });
  };
  const C = (chain: string, parent: string, pts: ReadonlyArray<readonly [number, number]>, tip: readonly [number, number]): void => {
    bones.push({ chain, parent, points: pts.map(rnd), tip: rnd(tip) });
  };
  B('hip', 'root', hip);
  B('chest', 'hip', chest);
  B('neck', 'chest', [axis, neckY]);
  B('head', 'neck', head);
  for (const s of ['r', 'l'] as const) {
    const e = eyes.get(s);
    if (e !== undefined) {
      B(`eye_${s}`, 'head', e);
      // The reference keyed this by the literal "eyewhite_<s>"; keyed by the
      // part's own name it is the same entry whenever that is the name, and
      // not a region for a part that does not exist when it is not.
      regions[(ew[s] as PartRecord).name] = `eye_${s}`;
    }
  }
  // Brows by POSITION, not by tag: the head run has swapped the two brow tags
  // and lost one side, and a tag-bound brow bone then sits on the other eye.
  const browOf = new Map<string, string>();
  const bySide = new Map<'r' | 'l', PartRecord[]>();
  for (const b of [...P.byTag('eyebrow-r'), ...P.byTag('eyebrow-l')]) {
    const side = center(b)[0] < axis ? 'r' : 'l';
    if (!bySide.has(side)) bySide.set(side, []);
    (bySide.get(side) as PartRecord[]).push(b);
    browOf.set(b.name, `brow_${side}`);
    if (splitFrom(b.from)[1] !== `eyebrow-${side}`) notes.push(`${b.name} (${b.from}) sits on the ${side} side of the eye axis: bound to brow_${side}`);
  }
  for (const s of ['r', 'l'] as const) {
    const group = bySide.get(s);
    if (group !== undefined) {
      const cs = group.map(center);
      B(`brow_${s}`, 'head', [npMean(cs.map((c) => c[0])), npMean(cs.map((c) => c[1]))]);
    }
  }
  const mouth = P.headFirst('mouth');
  if (mouth.length > 0) {
    // The centroid of the biggest blob: stray pixels inflate the box.
    const cc = connectedComponents(P.alpha(mouth[0]), 8);
    if (cc.count > 1) {
      let best = 1;
      for (let i = 2; i < cc.count; i++) if (cc.stats[i].area > cc.stats[best].area) best = i;
      B('mouth', 'head', [cc.stats[best].cx, cc.stats[best].cy]);
    } else B('mouth', 'head', center(mouth[0]));
  }
  for (const p of P.recs) {
    const t = splitFrom(p.from)[1];
    let role: string | undefined = TAG_REGION[t];
    if (browOf.has(p.name)) role = browOf.get(p.name);
    if (role !== undefined) regions[p.name] = role;
  }
  const blink = {
    t: 2.3,
    eyes: (['r', 'l'] as const).filter((s) => eyes.has(s)).map((s) => `eye_${s}`),
    brows: (['r', 'l'] as const).filter((s) => bySide.has(s)).map((s) => `brow_${s}`),
    squash: 0.12,
    brow_drop: 1.2,
  };
  tracks.push(
    { bone: 'chest', prop: 'translatey', amp: 1.3, period: 4.0, phase: 0.0, base: 1.3 },
    { bone: 'chest', prop: 'scalex', amp: 0.004, period: 4.0, phase: 0.0, base: 1.004 },
    { bone: 'head', prop: 'rotate', amp: 0.9, period: 4.0, phase: 0.12 },
    { bone: 'neck', prop: 'rotate', amp: 0.35, period: 4.0, phase: 0.08 },
  );

  const gridR = (p: PartRecord): [number, number] => {
    const g = pyInt(Math.min(36, Math.max(5, pyRound(Math.min(p.w, p.h) / 10))));
    return [g, Math.max(3, pyInt(pyRound(g * 0.42)))];
  };

  // ---- back hair
  for (const p of P.headFirst('back hair')) {
    const [g, r] = gridR(p);
    const top = p.y;
    const bot = p.y + p.h;
    if (bot < neckY + 0.5 * fh) {
      B('bun', 'head', [axis, top + 0.36 * p.h], [axis, bot - 0.1 * p.h]);
      meshes[p.name] = { grid: g, r, segments: [['head', rnd(head), rnd([axis, top + 13])], 'bun'] };
      tracks.push({ bone: 'bun', prop: 'rotate', amp: 0.8, period: 4.0, phase: 0.2 });
    } else {
      const mask = P.alpha(p);
      const segs: Segment[] = [['head', rnd(head), rnd([axis, top + 13])]];
      for (const [s, sgn] of SIDES) {
        const y0 = eyeY;
        const pts: Array<[number, number]> = [0, 1, 2].map((k) => [or(bandX(mask, y0 + (k * (bot - y0)) / 4, { side: s, axis }), axis), y0 + (k * (bot - y0)) / 4]);
        C(`hairback_${s}`, 'head', pts, [pts[pts.length - 1][0], bot - 4]);
        segs.push(`hairback_${s}`);
        tracks.push({ chain: `hairback_${s}`, amps: [sgn * 0.6, sgn * 1.4, sgn * 2.4], period: 4.0, phase: 0.2, lag: 0.08 });
      }
      meshes[p.name] = { grid: g, r, segments: segs };
    }
  }

  // ---- front hair: fringe + locks
  for (const p of P.headFirst('front hair')) {
    const [g, r] = gridR(p);
    const mask = P.alpha(p);
    const top = p.y;
    const segs: Segment[] = [['head', rnd(head), rnd([axis, top])]];
    const browY = eyeY - 0.18 * fh;
    for (const [tag, f, dx] of [
      ['bang_r', 0.25, -10],
      ['bang_c', 0.5, 0],
      ['bang_l', 0.75, 10],
    ] as const) {
      const x0 = fx0 + f * fw;
      C(tag, 'head', [[x0, top + 13], [x0 + dx, (top + 13 + browY) / 2 + 6]], [x0 + dx * 1.8, browY + 19]);
      segs.push(tag);
      const a = tag === 'bang_c' ? 0.8 : 1.0;
      tracks.push({ chain: tag, amps: [a, Number((a * 2.2).toFixed(4))], period: 4.0, phase: 0.18, lag: 0.1 });
    }
    const below = newMask(P.W, P.H);
    below.data.set(mask.data);
    const [c0, c1] = pySlice(0, pyInt(chin) + 4, P.H);
    below.data.fill(0, c0 * P.W, c1 * P.W);
    const cc = connectedComponents(below, 8);
    let k = 0;
    for (let i = 1; i < cc.count; i++) {
      const st = cc.stats[i];
      if (st.height < 0.3 * fh) continue;
      const comp = newMask(P.W, P.H);
      for (let j = 0; j < comp.data.length; j++) comp.data[j] = cc.labels[j] === i ? 1 : 0;
      const bot = st.top + st.height;
      const y0 = eyeY - 0.22 * fh;
      const span = bot + 5 - y0;
      const cm = newMask(P.W, P.H);
      for (let y = 0; y < P.H; y++) {
        for (let x = 0; x < P.W; x++) {
          const j = y * P.W + x;
          cm.data[j] = comp.data[j] | (mask.data[j] & (Math.abs(x - st.cx) < 25 ? 1 : 0));
        }
      }
      const pts: Array<[number, number]> = [0, 1, 2, 3].map((j) => [or(bandX(cm, y0 + (j * span) / 4), st.cx), y0 + (j * span) / 4]);
      const name = k === 0 ? 'lock' : `lock${k}_`;
      C(name, 'head', pts, [or(bandX(comp, bot - 6), pts[pts.length - 1][0]), bot + 5]);
      segs.push(name);
      tracks.push({ chain: name, amps: [0.8, 1.6, 2.6, 3.6], period: 4.0, phase: 0.16, lag: 0.07 });
      k++;
    }
    meshes[p.name] = { grid: g, r, segments: segs };
  }

  // ---- accessories: rigid body + pendant chain where the part narrows
  for (const [tag, bname, par] of [
    ['headwear', 'hairpin', 'head'],
    ['earwear', 'earring', 'head'],
  ] as const) {
    // Every part with the tag (a plan may take both runs' layers): the biggest
    // gets the bone and chain, the rest ride the head rigidly. A stable sort,
    // as Python's `sorted` is.
    const cands = [...P.byTag(tag)].sort((a, b) => b.opaque_px - a.opaque_px);
    for (const q of cands.slice(1)) {
      regions[q.name] = 'head';
      notes.push(`${q.name} (${q.from}): second ${tag} layer, rigid on head`);
    }
    for (const p of cands.slice(0, 1)) {
      const [g, r] = gridR(p);
      const fullMask = dilate(P.alpha(p), 7);
      const onArt = (pts: ReadonlyArray<readonly [number, number]>): boolean => pts.every((q) => isOn(fullMask, q[0], q[1]));
      const im = P.images.get(p.name) as Raster;
      const own = (x: number, y: number): number => (im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0);
      const rows: number[] = [];
      for (let y = 0; y < p.h; y++) {
        let n = 0;
        for (let x = 0; x < p.w; x++) n += own(x, y);
        rows.push(n);
      }
      const wmax = Math.max(...rows);
      // The pendant: the longest run of rows at the bottom whose width is under 35 % of the widest row.
      const narrow = rows.map((n) => n < 0.35 * wmax);
      let j = rows.length - 1;
      while (j > 0 && narrow[j - 1] && rows[j - 1] > 0) j--;
      const pendH = rows.length - j;
      const bodyRows = j > 0 ? j : rows.length;
      const colsIn = (r0: number, r1: number): number[] => {
        const out: number[] = [];
        for (let x = 0; x < p.w; x++) {
          for (let y = r0; y < r1; y++) {
            if (own(x, y)) {
              out.push(x);
              break;
            }
          }
        }
        return out;
      };
      const byx = colsIn(0, bodyRows);
      if (tag === 'earwear' || pendH > 0.8 * rows.length) {
        // All pendant: a chain from the part's own top.
        const cols = colsIn(0, Math.min(p.h, Math.max(4, Math.floor(rows.length / 5))));
        const x = p.x + (cols.length > 0 ? npMean(cols) : p.w / 2);
        if (!onArt([[x, p.y + 3]])) {
          B(bname, par, [x, p.y + 3]);
          delete regions[p.name];
          meshes[p.name] = { grid: g, r, segments: [[bname, rnd([x, p.y]), rnd([x, p.y + p.h])]] };
          notes.push(`${p.name}: pendant top is off the art -> rigid bone, no chain`);
          continue;
        }
        C(bname, par, [[x, p.y + 3]], [x, p.y + p.h - 1]);
        meshes[p.name] = { grid: g, r, segments: [['head', rnd([x, p.y - 7]), rnd([x, p.y + 1])], bname] };
        tracks.push({ chain: bname, amps: [5.0], period: 2.0, phase: 0.25, lag: 0.0 });
        continue;
      }
      if (byx.length === 0) {
        // The reference's `byx.min()` raises here; a refusal names what it could not measure.
        refuseIfAny([
          {
            code: 'PROPOSE_ACCESSORY_BODY',
            object: `part "${p.name}" (${p.from})`,
            detail: `has no opaque pixel above its pendant rows (${pendH} of ${rows.length} rows from the bottom); a body to hang the ${bname} bone on is required`,
          },
        ]);
      }
      const by: number[] = [];
      for (let y = 0; y < bodyRows; y++) if (rows[y] > 0) by.push(y);
      const cy = p.y + npMean(by);
      const xl = p.x + byx[0];
      const xr = p.x + byx[byx.length - 1];
      // The pendant's lower half: clear of the body's fringe.
      const lowFrom = pendH > 0 ? j + Math.floor(pendH / 2) : 0;
      const lowCols: number[] = [];
      for (let y = lowFrom; y < p.h; y++) for (let x = 0; x < p.w; x++) if (own(x, y)) lowCols.push(x);
      const px = p.x + (lowCols.length > 0 ? npMean(lowCols) : p.w / 2);
      const near = Math.abs(px - xl) < Math.abs(px - xr) ? xl : xr;
      const far = near === xl ? xr : xl;
      const start: [number, number] = [near + (px - near) * 0.6 + (near === xl ? 47 : -47), cy];
      B(bname, par, start, [far, cy]);
      const segs: Segment[] = [
        [bname, rnd(start), rnd([far, cy])],
        [bname, rnd([near, cy - 12]), rnd([start[0], cy + 18])],
      ];
      const tpts: Array<[number, number]> = [
        [px, p.y + j],
        [px, p.y + j + pendH * 0.45],
        [px, p.y + p.h - 1],
      ];
      if (pendH >= 10 && !onArt(tpts)) {
        notes.push(`${p.name}: pendant chain would run off the art -> no tassel chain (add one by hand if it swings)`);
      } else if (pendH >= 10) {
        const y0 = p.y + j;
        C(`${bname}_tassel`, bname, [[px, y0], [px, y0 + pendH * 0.45]], [px, p.y + p.h - 1]);
        segs.push(`${bname}_tassel`);
        tracks.push({ chain: `${bname}_tassel`, amps: [4.0, 7.0], period: 2.0, phase: 0.2, lag: 0.12 });
      }
      meshes[p.name] = { grid: g, r, segments: segs };
    }
  }

  // ---- neck mesh
  for (const p of P.headFirst('neck')) {
    const [g, r] = gridR(p);
    meshes[p.name] = {
      grid: g,
      r,
      segments: [
        ['chest', rnd([axis, neckY + 18]), rnd([axis, chest[1]])],
        ['head', rnd(head), rnd([axis, head[1] - 50])],
      ],
    };
  }

  // ---- sleeves
  const hw = [...P.byTag('handwear-r'), ...P.byTag('handwear-l')].filter((p) => p.opaque_px > 500);
  const sides = new Map<'r' | 'l', PartRecord[]>();
  for (const p of hw) {
    const s = center(p)[0] < axis ? 'r' : 'l';
    if (!sides.has(s)) sides.set(s, []);
    (sides.get(s) as PartRecord[]).push(p);
  }
  if (hw.length === 2 && sides.size === 2) {
    // Arms apart: two blobs. Each mesh gets ONLY its own sleeve chain and a
    // short chest segment at its shoulder; the one-blob recipe made hanging
    // hands breathe with the sternum.
    for (const [s, sgn] of SIDES) {
      const p = (sides.get(s) as PartRecord[])[0];
      const mask = P.alpha(p);
      const ys = rowsAny(mask);
      const top = ys[0];
      const bot = ys[ys.length - 1];
      const y0 = top + 15;
      const span = bot - 6 - y0;
      const pts: Array<[number, number]> = [0, 1, 2].map((k) => [or(bandX(mask, y0 + (k * span) / 3), center(p)[0]), y0 + (k * span) / 3]);
      C(`sleeve_${s}`, 'chest', pts, [or(bandX(mask, bot - 6), pts[pts.length - 1][0]), bot - 3]);
      tracks.push({ chain: `sleeve_${s}`, amps: [sgn * 0.2, sgn * 0.6, sgn * 1.2], period: 4.0, phase: 0.22 + (s === 'l' ? 0.05 : 0), lag: 0.08 });
      const [g, r] = gridR(p);
      const sx = pts[0][0];
      meshes[p.name] = { grid: g, r, segments: [['chest', rnd([sx, y0 - 14]), rnd([sx, y0 + 2])], `sleeve_${s}`] };
    }
    notes.push('handwear is two blobs: one sleeve chain per mesh, chest only at the shoulder');
  } else if (hw.length > 0) {
    const segs: Segment[] = [['chest', rnd([chest[0], chest[1] - 40]), rnd([chest[0], hip[1]])]];
    let mask = newMask(P.W, P.H);
    for (const p of hw) mask = union(mask, P.alpha(p));
    const ys = rowsAny(mask);
    const bot = ys[ys.length - 1];
    for (const [s, sgn] of SIDES) {
      const span = bot - chest[1];
      // The outer half of the sleeve on that side, away from the axis.
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < 3; k++) {
        const y = chest[1] + (k * span) / 3;
        const xs = sideOf(colsAny(mask, pyInt(y) - 12, pyInt(y) + 12), s, axis);
        if (xs.length === 0) {
          pts.push([axis, y]);
          continue;
        }
        const outer = s === 'r' ? xs[0] : xs[xs.length - 1];
        const inner = s === 'r' ? xs[xs.length - 1] : xs[0];
        // k = 0 is the shoulder, not the clasped hands.
        pts.push([outer + (k === 0 ? 0.22 : 0.5 * (1 - 0.35 * k)) * (inner - outer), y]);
      }
      const xs = sideOf(colsAny(mask, bot - 12, bot), s, axis);
      const tipx = xs.length > 0 ? (xs[0] + xs[xs.length - 1]) / 2 : pts[pts.length - 1][0];
      C(`sleeve_${s}`, 'chest', pts, [tipx, bot - 3]);
      segs.push(`sleeve_${s}`);
      tracks.push({ chain: `sleeve_${s}`, amps: [sgn * 0.25, sgn * 0.9, sgn * 1.8], period: 4.0, phase: 0.22 + (s === 'l' ? 0.05 : 0), lag: 0.08 });
    }
    for (const p of hw) {
      const [g, r] = gridR(p);
      meshes[p.name] = { grid: g, r, segments: segs };
    }
    if (hw.length === 1) notes.push(`handwear is one blob (${hw[0].name}): both sleeves in one mesh, split at the eye axis x=${pyFixed(axis, 0)}`);
  }

  // ---- outer robe (topwear)
  for (const p of tw) {
    const [g, r] = gridR(p);
    const mask = P.alpha(p);
    const top = chest[1] - 0.3 * fh;
    const bot = p.y + p.h;
    const segs: Segment[] = [
      ['chest', rnd([chest[0], p.y]), rnd([chest[0], hip[1] - 20])],
      ['hip', rnd([chest[0], hip[1] - 20]), rnd([chest[0], hip[1] + 100])],
    ];
    if (bw.length > 0 && bot < hip[1] + 0.25 * fh) {
      // A bodice that stops at the waist: robe chains down to the hem would fall off the art.
      meshes[p.name] = { grid: g, r, segments: segs };
      notes.push(`${p.name} ends at y=${bot} (hip ${pyFixed(hip[1], 0)}): no robe chains -- add a sash chain by hand if one hangs`);
      continue;
    }
    // The LINT tolerance; the reference dilated it once per side, to the same mask.
    const near = dilate(mask, 31);
    for (const [s, sgn] of SIDES) {
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < 4; k++) {
        const y = top + (k * (bot - 0.1 * (bot - top) - top)) / 3.3;
        const xs = sideOf(colsAny(mask, pyInt(y) - 12, pyInt(y) + 12), s, axis);
        const outer = xs.length > 0 ? (s === 'r' ? xs[0] : xs[xs.length - 1]) : axis;
        pts.push([outer + 0.2 * (axis - outer), y]);
      }
      // The flare just above the hem.
      const xs2 = sideOf(colsAny(mask, bot - 60, bot - 20), s, axis);
      const o2 = xs2.length > 0 ? (s === 'r' ? xs2[0] : xs2[xs2.length - 1]) : pts[pts.length - 1][0];
      const tip: [number, number] = [o2 + 0.15 * (axis - o2), bot - 5];
      if (!pts.every((q) => isOn(near, q[0], q[1]))) {
        notes.push(`robe_${s}: a link falls off ${p.name} (the layer narrows above its hem) -> dropped`);
        continue;
      }
      C(`robe_${s}`, 'chest', pts, tip);
      segs.push(`robe_${s}`);
      tracks.push({ chain: `robe_${s}`, amps: [sgn * 0.12, sgn * 0.3, sgn * 0.6, sgn * 1.1], period: 4.0, phase: 0.25 + (s === 'l' ? 0.04 : 0), lag: 0.07 });
    }
    meshes[p.name] = { grid: g, r, segments: segs };
  }

  // ---- skirt (bottomwear)
  for (const p of bw) {
    const [g, r] = gridR(p);
    const mask = P.alpha(p);
    const bot = p.y + p.h;
    const y0 = hip[1] + 20;
    const segs: Segment[] = [
      ['chest', rnd([chest[0], chest[1] - 30]), rnd([chest[0], hip[1] - 20])],
      ['hip', rnd([p.x + 0.09 * p.w, hip[1] + 5]), rnd([p.x + 0.91 * p.w, hip[1] + 5])],
    ];
    for (const [tag, f, ph] of [
      ['skirt_r', 0.3, 0.3],
      ['skirt_c', 0.5, 0.34],
      ['skirt_l', 0.7, 0.38],
    ] as const) {
      const pts: Array<[number, number]> = [0, 1, 2].map((k) => [or(bandX(mask, y0 + (k * (bot - 4 - y0)) / 3, { frac: f }), p.x + f * p.w), y0 + (k * (bot - 4 - y0)) / 3]);
      C(tag, 'hip', pts, [or(bandX(mask, bot - 10, { frac: f }), pts[pts.length - 1][0]), bot - 4]);
      segs.push(tag);
      tracks.push({ chain: tag, amps: [0.15, 0.35, 0.7], period: 4.0, phase: ph, lag: 0.07 });
    }
    meshes[p.name] = { grid: g, r, segments: segs };
  }

  // Anything no rule claimed rides its nearest trunk bone rigidly, so the rig stage never meets an unassigned part.
  for (const p of P.recs) {
    if (!(p.name in meshes) && !(p.name in regions)) {
      const cy = center(p)[1];
      regions[p.name] = cy < neckY ? 'head' : cy < hip[1] ? 'chest' : 'hip';
      notes.push(`${p.name} (${p.from}): no rule -> region on ${regions[p.name]}`);
    }
  }
  return { bones, meshes, regions, motion: { duration: 4.0, tracks, blink }, notes };
}

// ---------------------------------------------------------------------------
// expand, lint, compare
// ---------------------------------------------------------------------------

export interface ExpandedBone {
  parent: string;
  x: number;
  y: number;
}

/** Config bones -> every bone by name (chain links as `<chain><i>`), plus the polylines to draw. */
export function expand(bones: readonly BoneEntry[]): { byName: Map<string, ExpandedBone>; chains: Array<[string, Point[]]> } {
  const byName = new Map<string, ExpandedBone>();
  const chains: Array<[string, Point[]]> = [];
  for (const e of bones) {
    if ('chain' in e) {
      let previous = e.parent;
      e.points.forEach((q, i) => {
        const n = `${e.chain}${i}`;
        byName.set(n, { parent: i === 0 ? e.parent : previous, x: q[0], y: q[1] });
        previous = n;
      });
      chains.push([e.chain, [...e.points, e.tip]]);
    } else {
      byName.set(e.name, { parent: e.parent, x: e.at[0], y: e.at[1] });
      if (e.tip !== undefined) chains.push([e.name, [e.at, e.tip]]);
    }
  }
  return { byName, chains };
}

export interface LintFinding {
  bone: string;
  mesh: string;
  at: [number, number];
}

/** What a mesh check could not look at, said rather than skipped. */
export interface LintResult {
  findings: LintFinding[];
  /** Meshes naming no part in parts.json: nothing to lint them against. */
  unknownMeshes: string[];
}

/**
 * Chain links that sit off the art of a mesh they are a candidate for
 * (the part's mask dilated 15 px each way). A chain point in the background
 * still weights by distance, but it is almost always a mis-pick.
 *
 * As in the reference, only CHAIN segments are linted: a string segment names
 * the links `<segment><digits>`, so a single bone named as a segment has none,
 * and an explicit `[bone, from, to]` segment is a line, not an origin.
 */
export function lint(P: PartSet, spec: { bones: readonly BoneEntry[]; meshes: Readonly<Record<string, MeshSpec>> }): LintResult {
  const { byName } = expand(spec.bones);
  const parts = new Map(P.recs.map((p) => [p.name, p]));
  const findings: LintFinding[] = [];
  const unknownMeshes: string[] = [];
  for (const [mname, m] of Object.entries(spec.meshes)) {
    const part = parts.get(mname);
    if (part === undefined) {
      unknownMeshes.push(mname);
      continue;
    }
    const mask = dilate(P.alpha(part), 31);
    const names: string[] = [];
    for (const sp of m.segments) {
      if (typeof sp !== 'string') continue;
      for (const n of byName.keys()) if (n.startsWith(sp) && /^[0-9]+$/.test(n.slice(sp.length))) names.push(n);
    }
    for (const n of names) {
      const b = byName.get(n) as ExpandedBone;
      const x = pyInt(b.x);
      const y = pyInt(b.y);
      if (!isOn(mask, x, y)) findings.push({ bone: n, mesh: mname, at: [x, y] });
    }
  }
  return { findings, unknownMeshes };
}

/** The reference's LINT line, verbatim: `LINT sleeve_r0 at [335, 330] is off the art of mesh 'sleeves'`. */
export function lintLine(f: LintFinding): string {
  return `LINT ${f.bone} at ${pyIntList(f.at)} is off the art of mesh ${pyRepr(f.mesh)}`;
}

export interface Comparison {
  rows: Array<[string, number]>;
  onlyConfig: string[];
  onlyProposal: string[];
}

/** Per bone the two share, in the config's order: the distance between the proposal's origin and the config's, in rig px. */
export function compare(proposal: readonly BoneEntry[], config: readonly BoneEntry[]): Comparison {
  const a = expand(proposal).byName;
  const b = expand(config).byName;
  const rows: Array<[string, number]> = [];
  for (const [n, cb] of b) {
    const pb = a.get(n);
    if (pb !== undefined) rows.push([n, Math.hypot(pb.x - cb.x, pb.y - cb.y)]);
  }
  return { rows, onlyConfig: [...b.keys()].filter((n) => !a.has(n)), onlyProposal: [...a.keys()].filter((n) => !b.has(n)) };
}

/** The reference's compare printout, line for line. */
export function compareLines(c: Comparison): string[] {
  const out = c.rows.map(([n, v]) => `  ${n.padEnd(12)} ${pyFixed(v, 1).padStart(6)} px`);
  const d = c.rows.map((r) => r[1]);
  if (d.length > 0) {
    out.push(
      `matched ${d.length} bones: median ${pyFixed(npMedian(d), 1)} px, mean ${pyFixed(npMean(d), 1)}, p90 ${pyFixed(npPercentile(d, 90), 1)}, max ${pyFixed(Math.max(...d), 1)}; ` +
        `<=10 px ${d.filter((v) => v <= 10).length}, <=25 px ${d.filter((v) => v <= 25).length}`,
    );
  } else out.push('matched 0 bones: the proposal and the config share no bone name, so there is no distance to state');
  out.push(`in config only (hand-added): ${pyStrList(c.onlyConfig)}`);
  out.push(`in proposal only: ${pyStrList(c.onlyProposal)}`);
  return out;
}

// ---------------------------------------------------------------------------
// the overlay
// ---------------------------------------------------------------------------

const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [230, 25, 75],
  [60, 180, 75],
  [0, 130, 200],
  [245, 130, 48],
  [145, 30, 180],
  [70, 190, 190],
  [240, 50, 230],
  [128, 128, 0],
];

function setPx(r: Raster, x: number, y: number, c: readonly [number, number, number]): void {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
  const i = (y * r.width + x) * 4;
  r.data[i] = c[0];
  r.data[i + 1] = c[1];
  r.data[i + 2] = c[2];
  r.data[i + 3] = 255;
}

function text(r: Raster, s: string, x0: number, y0: number, c: readonly [number, number, number]): void {
  const plot = (x: number, y: number): void => setPx(r, x, y, c);
  let x = Math.round(x0);
  const y = Math.round(y0);
  for (const ch of s) {
    if (ch === '_') for (let i = 0; i < 5; i++) plot(x + i, y + GLYPH_H - 1);
    else if (ch !== ' ') drawText(ch, x, y, 1, plot);
    x += 6;
  }
}

/** A line `width` px thick: a square brush stepped along the segment one pixel at a time. */
function line(r: Raster, a: readonly [number, number], b: readonly [number, number], width: number, c: readonly [number, number, number]): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  const lo = -Math.floor((width - 1) / 2);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * i) / steps);
    const y = Math.round(a[1] + ((b[1] - a[1]) * i) / steps);
    for (let dy = lo; dy < lo + width; dy++) for (let dx = lo; dx < lo + width; dx++) setPx(r, x + dx, y + dy, c);
  }
}

function dot(r: Raster, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= 3.5) setPx(r, Math.round(cx) + dx, Math.round(cy) + dy, [255, 0, 0]);
      else if (d <= 4.5) setPx(r, Math.round(cx) + dx, Math.round(cy) + dy, [0, 0, 0]);
    }
  }
}

/** A window of `src`, black where it reaches outside — what PIL's `crop` gives for a box past the edge. */
function cropPadded(src: Raster, x0: number, y0: number, x1: number, y1: number): Raster {
  const out = newRaster(x1 - x0, y1 - y0);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sx = x + x0;
      const sy = y + y0;
      const o = (y * out.width + x) * 4;
      out.data[o + 3] = 255;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const i = (sy * src.width + sx) * 4;
      out.data[o] = src.data[i];
      out.data[o + 1] = src.data[i + 1];
      out.data[o + 2] = src.data[i + 2];
    }
  }
  return out;
}

/**
 * The overlay: the painting resized to the rig and blended 55 % over white,
 * every part's outline in a rotating palette, a 50 px grid labelled every
 * 100 px, chains as blue polylines, every bone origin as a red dot with its
 * name, and the title bottom right. `head` is a 2x crop around the `head`
 * bone (300x320 rig px to 600x640), or null when no bone is named `head`.
 *
 * Layout, palette, blend, grid and crop are the reference's; two deviations,
 * both stated: labels are drawn in spine-rigc's 5x7 bitmap font (upper case)
 * rather than PIL's default font, and thick lines and dots are this module's
 * own raster rather than PIL's `ImageDraw` — the overlay is for reading, and
 * no claim is made that it matches the reference pixel for pixel.
 */
export function drawLandmarks(P: PartSet, source: Raster, bones: readonly BoneEntry[], title: string): { full: Raster; head: Raster | null } {
  const opaque = newRaster(source.width, source.height);
  for (let i = 0; i < source.width * source.height; i++) {
    opaque.data.set(source.data.subarray(i * 4, i * 4 + 3), i * 4);
    opaque.data[i * 4 + 3] = 255;
  }
  const src = resize(opaque, P.W, P.H, 'lanczos3');
  const im = newRaster(P.W, P.H);
  // PIL's Image.blend(white, src, 0.55): in1 + alpha * (in2 - in1) in float32, truncated.
  const alpha = Math.fround(0.55);
  for (let i = 0; i < P.W * P.H; i++) {
    for (let c = 0; c < 3; c++) im.data[i * 4 + c] = Math.trunc(Math.fround(255 + Math.fround(alpha * (src.data[i * 4 + c] - 255))));
    im.data[i * 4 + 3] = 255;
  }
  P.recs.forEach((p, i) => {
    const edge = morphGradient(P.alpha(p), 3);
    const c = PALETTE[i % PALETTE.length];
    for (let j = 0; j < edge.data.length; j++) if (edge.data[j]) setPx(im, j % P.W, Math.floor(j / P.W), c);
  });
  for (let x = 0; x < P.W; x += 50) {
    line(im, [x, 0], [x, P.H], 1, x % 100 ? [200, 200, 200] : [150, 150, 150]);
    if (x % 100 === 0) text(im, String(x), x + 2, 2, [80, 80, 80]);
  }
  for (let y = 0; y < P.H; y += 50) {
    line(im, [0, y], [P.W, y], 1, y % 100 ? [200, 200, 200] : [150, 150, 150]);
    if (y % 100 === 0) text(im, String(y), 2, y + 2, [80, 80, 80]);
  }
  const { byName, chains } = expand(bones);
  for (const [, pts] of chains) for (let k = 1; k < pts.length; k++) line(im, pts[k - 1], pts[k], 2, [0, 90, 255]);
  for (const [n, b] of byName) {
    dot(im, b.x, b.y);
    text(im, n, b.x + 6, b.y - 6, [0, 0, 0]);
  }
  text(im, title, P.W - 260, P.H - 16, [0, 0, 0]);
  const hb = bones.find((b) => 'name' in b && b.name === 'head');
  let headCrop: Raster | null = null;
  if (hb !== undefined && 'name' in hb) {
    const [hx, hy] = hb.at;
    const box = cropPadded(im, pyInt(hx - 150), Math.max(0, pyInt(hy - 190)), pyInt(hx + 150), pyInt(hy + 130));
    headCrop = box.width > 0 && box.height > 0 ? resize(box, 600, 640, 'lanczos3') : null;
  }
  return { full: im, head: headCrop };
}
