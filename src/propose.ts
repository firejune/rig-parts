/**
 * The propose stage: bone origins, mesh candidate lists, regions and a default
 * idle, read off the assembled parts — and the overlay a person or an agent
 * corrects them against.
 *
 * ⭐ **Roles come from each part's See-through tag** (`parts.json` `from`),
 * never from the part's name. A plan may call the skirt layer anything; what
 * makes it the skirt is that it came from `bottomwear`. The rules, by tag:
 *
 * - `face` (head run first) -> `hip`/`chest`/`neck`/`head` — with no face
 *   part, a box derived from the head run's `front hair`/`back hair` and
 *   `neck`, said in a note (issue #76); `eyewhite-r/-l`
 *   -> `eye_r`/`eye_l`, the blink's `eyes` group — no eyewhite, no blink, and
 *   no eyebrow, no `brows` in it, each said in a note (issue #35); `irides-*`
 *   and `eyelash-*` ride their side's eye bone, or `head` with a note when
 *   that side has no eyewhite (issue #45); `mouth` -> `mouth` at the centroid of its biggest blob
 *   (stray pixels inflate a box); `eyebrow-*` -> `brow_r`/`brow_l` by POSITION
 *   left or right of the eye axis, never by tag, because the head run has been
 *   observed to swap the two brow tags.
 * - `bottomwear` -> `hip` at its top edge + three skirt chains — unless that
 *   hip would sit above `HIP_MIN_FRACTION` of the figure's height (a long
 *   robe tagged `bottomwear` starts at the collar): then `hip` is the waist,
 *   the narrowest torso row between the shoulder line and the figure's
 *   middle, and 0.32 of the figure height when no row narrows enough.
 * - `topwear` -> two outer-robe chains, only when it hangs below the hip line;
 *   a side whose link falls off the art is dropped.
 * - `handwear-*` -> two blobs: one sleeve chain per blob, its mesh taking that
 *   chain and a chest stub at the shoulder; one blob: both chains and the chest
 *   midline, split at the eye axis — unless the blob is clasped hands (at the
 *   axis and at most half the shoulders' width), which ride `hip` as a region.
 * - `front hair` -> three fringe chains + one lock chain per strand that hangs
 *   0.3 face heights below the chin.
 * - `back hair` -> one `bun` bone if it ends above the shoulders, else two
 *   hanging chains.
 * - `headwear` / `earwear` -> the biggest layer of the tag gets a rigid bone
 *   and a pendant chain where the part narrows (dropped if any chain point is
 *   off the art); any other layer of the tag rides the head as a region. A
 *   layer with hanging strands ({@link Strand}) gets one pendulum chain per
 *   strand instead of the single pendant chain, and one note naming every
 *   strand and what became of it — a strand left without a chain is never
 *   silent (issue #24).
 * - anything no rule claims rides its nearest trunk bone as a region —
 *   including every `painting:` patch (`assemble.patches`), which has no tag,
 *   so no rule above ever reads it: it is never a mesh or a chain, it moves
 *   no bone the rules place, and the note says the bone is the config's to
 *   name in `regions.<name>`.
 *
 * What it cannot know is written into `notes` when it guessed, and otherwise
 * left to the person correcting: things hidden inside a layer (a sash tail
 * painted into the skirt), hair that is none of the shapes above, whether an
 * accessory swings.
 *
 * Port of the reference `landmarks.py` (`propose`, `expand`, `lint`,
 * `compare`, `draw`). Every rule, constant and evaluation order is the
 * reference's, including three Python behaviours `src/pyfmt.ts` reproduces
 * (`round` to even, `or` treating 0.0 as missing, negative slice starts).
 * Seven departures, each stated where it happens: a missing face is refused
 * rather than crashing — unless the head run's hair and neck are there, when
 * the face box is derived from them by measured ratios and a note says so
 * (issue #76, {@link faceBoxOf}); the eye regions are keyed by the eyewhite
 * part's own name rather than by the literal `eyewhite_r`; the long-robe hip,
 * the clasped-hands region (issues #22, #23), an eyeless side's irides and
 * lashes on `head` (issue #45) and the face-less fallback, which fire on
 * neither published example — both proposals are byte-identical with and
 * without them; and `lint`'s two torso lines, which the reference did not
 * have.
 *
 * Coordinates are rig pixels, y down, origin top-left — the parts' own space.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drawText, GLYPH_H } from 'spine-rigc/tools/font5x7.ts';
import { type BoneEntry, type MeshSpec, parseConfig, type Point, type Segment } from './config.ts';
import { PartsError, type Problem, refuseIfAny } from './errors.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { PAINTING_RUN, type PartRecord, type PartsFile, readParts } from './parts.ts';
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

/** `brows` and `brow_drop` are absent together when no eyebrow part exists: rigc refuses a group with no members. */
export interface ProposedBlink {
  t: number;
  eyes: string[];
  brows?: string[];
  squash: number;
  brow_drop?: number;
  still?: Record<string, { row: number; bone: string }>;
}

/** The tags whose parts make the eye bones, the blink's `eyes` group. Nothing else does: irides and lashes ride those bones as regions, or `head` on a side with none. */
export const EYE_GROUP_TAGS: readonly string[] = ['eyewhite-r', 'eyewhite-l'];
/** The tags whose parts make the brow bones, the blink's `brows` group. */
export const BROW_GROUP_TAGS: readonly string[] = ['eyebrow-r', 'eyebrow-l'];

export interface Proposal {
  bones: BoneEntry[];
  meshes: Record<string, MeshSpec>;
  regions: Record<string, string>;
  motion: {
    duration: number;
    tracks: Array<ProposedSingleTrack | ProposedChainTrack>;
    /** Absent when no part feeds the `eyes` group ({@link EYE_GROUP_TAGS}): a blink with nothing to blink is not written. */
    blink?: ProposedBlink;
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
  // A patch is not a plan entry; it goes back as the patches entry it came
  // from, so the loader holds it to its own rule (a region, never a mesh).
  // Its box, alpha and draw are the record's own box and placeholders the
  // loader only type-checks: nothing here is written anywhere.
  const run = P.recs.filter((r) => splitFrom(r.from)[0] !== PAINTING_RUN);
  const painted = P.recs.filter((r) => splitFrom(r.from)[0] === PAINTING_RUN);
  parseConfig({
    key: 'proposal',
    assemble: {
      rig_scale: 1,
      plan: run.map((r) => [r.name, ...splitFrom(r.from)]),
      patches: painted.map((r) => ({ name: r.name, box: [r.x, r.y, r.x + r.w, r.y + r.h], alpha: 'box', draw: 'front' })),
    },
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

  /** Parts whose `from` tag is exactly `tag`, optionally from one run, in parts.json order. A `painting:` patch has no tag and is never one. */
  byTag(tag: string, run?: 'full' | 'head'): PartRecord[] {
    return this.recs.filter((p) => {
      const [r, t] = splitFrom(p.from);
      return r !== PAINTING_RUN && t === tag && (run === undefined || r === run);
    });
  }

  /** The See-through parts: every part but the `painting:` patches. */
  layered(): PartRecord[] {
    return this.recs.filter((p) => splitFrom(p.from)[0] !== PAINTING_RUN);
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

// ---------------------------------------------------------------------------
// the torso, read off the figure
// ---------------------------------------------------------------------------

/**
 * The hip may not sit above this fraction of the figure's height, measured
 * from its top. Below it the proposer takes `bottomwear`'s top edge as the
 * waist; above it that edge is the collar of a long robe and the waist is read
 * off the silhouette. `lint` holds any config to the same line. The published
 * examples' hips sit at 0.436 (`demo`) and 0.342 (`sample`) of their figures;
 * a figure four heads tall has its whole head in the top quarter.
 */
export const HIP_MIN_FRACTION = 0.25;

/** A row is a waist when the torso there is at most this fraction of the shoulders' width (the examples' torsos narrow to 0.648 of their shoulders in `demo` and 0.710 in `sample`). */
export const WAIST_MAX_OF_SHOULDERS = 0.8;

/**
 * One handwear blob is clasped hands, not two sleeves, when it is at most this
 * fraction of the shoulders' width: two sleeves that hang from the shoulders
 * are at least as wide as them (the examples' one-blob sleeves are 1.506 and
 * 1.580 shoulder widths).
 */
export const CLASPED_MAX_OF_SHOULDERS = 0.5;

/** ... and when its centre is within this fraction of the shoulders' width of the eye axis. */
export const CLASPED_AXIS_OF_SHOULDERS = 0.25;

/**
 * The tags whose layers make the torso's silhouette: the body without hair,
 * hands, head parts, tail, wings or held objects — the layers whose width at
 * a row is the body's width there.
 */
export const TORSO_TAGS = ['neck', 'neckwear', 'topwear', 'bottomwear', 'legwear', 'footwear'] as const;

/** The first and last rows holding any part's pixel. */
function figureExtent(P: PartSet): { top: number; bot: number } {
  // The layers' figure: a patch adds none of its own, so adding one moves no bone.
  let fig = newMask(P.W, P.H);
  for (const p of P.layered()) fig = union(fig, P.alpha(p));
  const ys = rowsAny(fig);
  return { top: ys[0], bot: ys[ys.length - 1] };
}

/** Per row, the leftmost and rightmost torso pixel (-1 on an empty row). */
function torsoRows(P: PartSet): { lo: Int32Array; hi: Int32Array } {
  const lo = new Int32Array(P.H).fill(-1);
  const hi = new Int32Array(P.H).fill(-1);
  for (const p of P.layered()) {
    if (!(TORSO_TAGS as readonly string[]).includes(splitFrom(p.from)[1])) continue;
    const m = P.alpha(p);
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (!m.data[y * P.W + x]) continue;
        if (lo[y] < 0 || x < lo[y]) lo[y] = x;
        if (x > hi[y]) hi[y] = x;
      }
    }
  }
  return { lo, hi };
}

interface TorsoRow {
  y: number;
  width: number;
  cx: number;
}

function rowAt(t: { lo: Int32Array; hi: Int32Array }, y: number): TorsoRow | null {
  return t.lo[y] < 0 ? null : { y, width: t.hi[y] - t.lo[y] + 1, cx: (t.lo[y] + t.hi[y]) / 2 };
}

/** The widest torso row within one face height below the neck (the first, on a tie): the shoulder line. */
function shoulderOf(t: { lo: Int32Array; hi: Int32Array }, neckY: number, fh: number): TorsoRow | null {
  let best: TorsoRow | null = null;
  for (let y = Math.max(0, Math.ceil(neckY)); y <= Math.min(t.lo.length - 1, Math.floor(neckY + fh)); y++) {
    const r = rowAt(t, y);
    if (r !== null && (best === null || r.width > best.width)) best = r;
  }
  return best;
}

/**
 * The narrowest torso row from the shoulder line down to `bandEnd` (the
 * figure's middle: below it legs are narrower than any waist — the sample's
 * legs are 89 px wide at y 1046, its waist 125 px at y 435), when it is a waist at all.
 */
function waistOf(t: { lo: Int32Array; hi: Int32Array }, shoulders: TorsoRow, bandEnd: number): TorsoRow | null {
  let best: TorsoRow | null = null;
  for (let y = shoulders.y; y <= Math.min(t.lo.length - 1, Math.floor(bandEnd)); y++) {
    const r = rowAt(t, y);
    if (r !== null && (best === null || r.width < best.width)) best = r;
  }
  return best !== null && best.width <= WAIST_MAX_OF_SHOULDERS * shoulders.width ? best : null;
}

/**
 * The note saying the handwear is clasped hands, or `null` when it is not:
 * every handwear part together is ONE connected component over 500 px (the
 * floor the sleeve rule applies to a part), at most
 * `CLASPED_MAX_OF_SHOULDERS` of the shoulder width wide, centred within
 * `CLASPED_AXIS_OF_SHOULDERS` of it of the eye axis. No shoulder line
 * measured -> `null`, and the sleeve rule runs as before.
 */
function claspedOf(P: PartSet, hw: readonly PartRecord[], shoulders: TorsoRow | null, axis: number): string | null {
  if (shoulders === null) return null;
  let mask = newMask(P.W, P.H);
  for (const p of hw) mask = union(mask, P.alpha(p));
  const cc = connectedComponents(mask, 8);
  const blobs = cc.stats.slice(1).filter((st) => st.area > 500);
  if (blobs.length !== 1) return null;
  const b = blobs[0];
  const cx = b.left + b.width / 2;
  if (b.width > CLASPED_MAX_OF_SHOULDERS * shoulders.width || Math.abs(cx - axis) > CLASPED_AXIS_OF_SHOULDERS * shoulders.width) return null;
  return (
    `handwear is one blob (${hw.map((p) => p.name).join(', ')}) ${b.width}x${b.height} px centred at x=${pyFixed(cx, 0)}: ` +
    `at most ${CLASPED_MAX_OF_SHOULDERS} of the shoulder width (${shoulders.width} px at y=${shoulders.y}) and within ${CLASPED_AXIS_OF_SHOULDERS} of it of the eye axis x=${pyFixed(axis, 0)}, ` +
    'so clasped hands: a region on hip, no sleeve chains (sleeves painted inside another layer move with it)'
  );
}

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

/**
 * A hanging strand: a connected sub-shape (8-connected) of an accessory's mask,
 * searched below the part's body — in its pendant rows, the run of rows at the
 * bottom narrower than {@link PENDANT_NARROW} of the widest row — or over the
 * whole part when the part is all pendant. It is a strand when it is at least
 * {@link STRAND_ASPECT} times as tall as it is wide, at least
 * {@link STRAND_SHARE} of the part's height, and at least
 * {@link PENDANT_MIN_ROWS} rows tall.
 *
 * Measured on the public examples' two accessories (the sub-shapes this
 * definition reads, height/width): `demo` `hairpin` (head:headwear, 133 rows)
 * has two in its pendant rows, 22/41 = 0.54 and 41/46 = 0.89 (the bows' tips,
 * the second carrying the star dangle); `demo` `earring` (full:earwear, all
 * pendant, 29 rows) has two, 26/25 = 1.04 and 28/26 = 1.08. None reaches 3,
 * so neither proposal changes; `sample` has no headwear or earwear.
 */
export interface Strand {
  /** Column centroid, rig px. */
  x: number;
  /** First and last row, rig px, inclusive. */
  top: number;
  bottom: number;
  /** Bounding-box width, px. */
  width: number;
  /** The strand alone, full canvas. */
  mask: Mask;
}

/** Pendant rows are the rows at the bottom narrower than this share of the widest row — the reference's 35 %. */
export const PENDANT_NARROW = 0.35;
/** A pendant (or strand) shorter than this many rows gets no chain — the reference's tassel floor. */
export const PENDANT_MIN_ROWS = 10;
/** A strand is at least this many times as tall as it is wide. */
export const STRAND_ASPECT = 3;
/** A strand is at least this share of its part's height. */
export const STRAND_SHARE = 0.2;
/** A pendant chain's second link sits this far down it — the reference's tassel. */
export const STRAND_LINK_AT = 0.45;
/** A pendant chain's two link amplitudes, degrees — the reference's tassel, which every strand chain takes. */
export const STRAND_AMPS: readonly [number, number] = [4.0, 7.0];

/** An accessory's opaque pixels per row, and where its pendant rows start (`j`, part rows) and how many there are. */
function pendantRows(P: PartSet, p: PartRecord): { rows: number[]; j: number; pendH: number } {
  const im = P.images.get(p.name) as Raster;
  const rows: number[] = [];
  for (let y = 0; y < p.h; y++) {
    let n = 0;
    for (let x = 0; x < p.w; x++) n += im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    rows.push(n);
  }
  const wmax = Math.max(...rows);
  // The pendant: the longest run of rows at the bottom whose width is under 35 % of the widest row.
  const narrow = rows.map((n) => n < PENDANT_NARROW * wmax);
  let j = rows.length - 1;
  while (j > 0 && narrow[j - 1] && rows[j - 1] > 0) j--;
  return { rows, j, pendH: rows.length - j };
}

/** The strands of `p` in its rows from `fromRow` down, left to right. See {@link Strand}. */
export function hangingStrands(P: PartSet, p: PartRecord, fromRow: number): Strand[] {
  const im = P.images.get(p.name) as Raster;
  const local = newMask(p.w, p.h);
  for (let y = fromRow; y < p.h; y++) for (let x = 0; x < p.w; x++) local.data[y * p.w + x] = im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
  const cc = connectedComponents(local, 8);
  const out: Strand[] = [];
  for (let i = 1; i < cc.count; i++) {
    const st = cc.stats[i];
    if (st.height < STRAND_ASPECT * st.width || st.height < STRAND_SHARE * p.h || st.height < PENDANT_MIN_ROWS) continue;
    const mask = newMask(P.W, P.H);
    for (let y = st.top; y < st.top + st.height; y++) {
      for (let x = st.left; x < st.left + st.width; x++) if (cc.labels[y * p.w + x] === i) mask.data[(p.y + y) * P.W + p.x + x] = 1;
    }
    out.push({ x: p.x + st.cx, top: p.y + st.top, bottom: p.y + st.top + st.height - 1, width: st.width, mask });
  }
  // Stable: two strands at one x keep their scan order.
  return out.sort((a, b) => a.x - b.x);
}

/** The one note a part with strands gets: every strand's figures, and which chain each got or why none. */
function strandNote(p: PartRecord, strands: readonly Strand[], chained: readonly string[], dropped: readonly Strand[], why: string): string {
  const n = strands.length;
  const at = `x=${strands.map((s) => pyFixed(s.x, 0)).join(',')}, y ${strands.map((s) => `${s.top}-${s.bottom}`).join(',')}, width ${strands.map((s) => s.width).join(',')}`;
  const head = `${p.name} (${p.from}): ${n} hanging strand${n === 1 ? '' : 's'} at ${at}`;
  if (chained.length === 0) return `${head} -- no chain proposed (${why})`;
  const made = `pendulum chain${chained.length === 1 ? '' : 's'} ${chained.join(', ')}`;
  if (dropped.length === 0) return `${head} -> ${made}`;
  return `${head} -> ${made}; no chain proposed at x=${dropped.map((s) => pyFixed(s.x, 0)).join(',')} (${why})`;
}

// ---------------------------------------------------------------------------
// the face box, or one derived from the head run when no face part exists (issue #76)
// ---------------------------------------------------------------------------

/**
 * The ratios the face-less fallback derives a face box with. `L`, the span,
 * runs from the top of the head run's hair ({@link FACELESS_HAIR_TAGS}, the
 * highest of them) to the top of its `neck`. Measured on the two public
 * examples' assembled parts (`examples/<key>/expected/parts.json`; demo: hair
 * top y 67, neck top y 191, face 361,80 109x133; sample: hair top y 80, neck
 * top y 194, face 368,98 94x121) — a sample of two; the mean of the two, to
 * three places, is used:
 *
 * - `heightOfSpan` — face height / L: demo 133/124 = 1.073, sample
 *   121/114 = 1.061.
 * - `topOfSpan` — (face top − hair top) / L: demo 13/124 = 0.105, sample
 *   18/114 = 0.158.
 * - `widthOfHeight` — face width / face height: demo 109/133 = 0.820,
 *   sample 94/121 = 0.777.
 *
 * The box is centred on the neck part's centre x (demo 417 against the face's
 * 415.5, sample 411 against 415). Rejected for the top: the union of every
 * head-run part, which the demo's headwear lifts to y 20 — its face height /
 * span is 0.778 there against the sample's 1.061.
 */
export interface FacelessRatios {
  heightOfSpan: number;
  topOfSpan: number;
  widthOfHeight: number;
}

/** The measured means; see {@link FacelessRatios}. */
export const FACELESS_RATIOS: Readonly<FacelessRatios> = { heightOfSpan: 1.067, topOfSpan: 0.131, widthOfHeight: 0.798 };

/** The head-run tags the face-less fallback reads the top of the head from. */
export const FACELESS_HAIR_TAGS: readonly string[] = ['front hair', 'back hair'];

/** The rules a face's features feed, by the tags each reads: the fallback note names each whose tags are all absent. */
const FACE_FEATURE_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [EYE_GROUP_TAGS, 'the eye bones, the eye axis, the blink and its still pieces'],
  [BROW_GROUP_TAGS, 'the brow bones'],
  [['mouth'], 'the mouth bone'],
];

/** A face box `[x0, y0, w, h]` in rig px, and the note saying how it was derived (`null` when it is the face part's own box). */
export interface FaceBox {
  box: [number, number, number, number];
  note: string | null;
}

/**
 * The face box every rule scales by: the head run's `face` part (the full
 * run's when the head run has none), as the reference read it; or, with no
 * face part at all, one derived from the head run's hair and neck by
 * `ratios` ({@link FACELESS_RATIOS}), with a note naming what it read, what
 * it derived and which face-reading rules have nothing to read. Refuses
 * `PROPOSE_FACE_PRESENT` when there is neither a face part nor what the
 * fallback reads — never a box from nothing.
 */
export function faceBoxOf(P: PartSet, ratios: Readonly<FacelessRatios> = FACELESS_RATIOS): FaceBox {
  const faces = P.headFirst('face');
  if (faces.length > 0) return { box: [faces[0].x, faces[0].y, faces[0].w, faces[0].h], note: null };
  const hair = P.layered().filter((p) => splitFrom(p.from)[0] === 'head' && FACELESS_HAIR_TAGS.includes(splitFrom(p.from)[1]));
  const neck = P.byTag('neck', 'head');
  const refuse = (why: string): never => {
    const tags = [...new Set(P.recs.map((p) => p.from))].join(', ');
    throw new PartsError([
      {
        code: 'PROPOSE_FACE_PRESENT',
        object: 'parts.json',
        detail:
          `holds no part from a "face" layer (found: ${tags}); head, neck, the eye axis and the face height every other rule scales by all come from it, ` +
          `and the face-less fallback, which derives a face box from the head run's hair (${FACELESS_HAIR_TAGS.map((t) => `"${t}"`).join(' or ')}) and its "neck", cannot: ${why}`,
      },
    ]);
  };
  if (hair.length === 0 && neck.length === 0) refuse('the head run has neither');
  if (hair.length === 0) refuse(`the head run has a neck (${neck[0].name}) but no hair part`);
  if (neck.length === 0) refuse(`the head run has hair (${hair.map((p) => p.name).join(', ')}) but no "neck" part`);
  const n = neck[0];
  const top = Math.min(...hair.map((p) => p.y));
  const span = n.y - top;
  if (span <= 0) refuse(`the hair's top, y=${top}, is not above the top of ${n.name}, y=${n.y}, so there is no span to scale`);
  const fh = ratios.heightOfSpan * span;
  const fw = ratios.widthOfHeight * fh;
  const cx = n.x + n.w / 2;
  const box: [number, number, number, number] = [cx - fw / 2, top + ratios.topOfSpan * span, fw, fh];
  const nothing = FACE_FEATURE_RULES.filter(([ts]) => ts.every((t) => P.byTag(t).length === 0)).map(([ts, rule]) => `${rule} (no ${ts.join(' or ')} part)`);
  const note =
    `no face part: face box derived from the head run's hair (${hair.map((p) => p.name).join(', ')}; top y=${top}) and neck (${n.name}; top y=${n.y}, centre x=${pyFixed(cx, 1)}), a span of ${span} px — ` +
    `height ${ratios.heightOfSpan} of the span, top ${ratios.topOfSpan} of it below the hair's top, width ${ratios.widthOfHeight} of the height, centred on the neck: ` +
    `x ${pyFixed(box[0], 1)}, y ${pyFixed(box[1], 1)}, ${pyFixed(fw, 1)}x${pyFixed(fh, 1)} (ratios measured on the two public examples); ` +
    'head, neck, the eye line when there is no eyewhite and every face-height scale are read off this guess, so correct those bones against the overlay' +
    (nothing.length === 0 ? '' : `; nothing to read for ${nothing.join(', ')}`) +
    // Measured: the sample with only its face removed opens 587 px behind its shut eyes, the demo 0 (its hair is under them).
    (EYE_GROUP_TAGS.some((t) => P.byTag(t).length > 0) ? "; the blink shuts the eyes over no face part, so check's BLINK_NO_HOLE says whether anything shows through" : '');
  return { box, note };
}

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

  // The face part's box, or with none one derived from the head run's hair
  // and neck (issue #76), said in the first note.
  const faceBox = faceBoxOf(P);
  const [fx0, fy0, fw, fh] = faceBox.box;
  if (faceBox.note !== null) notes.push(faceBox.note);
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
  const { top: ftop, bot: fbot } = figureExtent(P);
  const torso = torsoRows(P);
  const shoulders = shoulderOf(torso, neckY, fh);
  let hip: [number, number];
  if (bw.length > 0 && bw[0].y + 0.14 * fh >= ftop + HIP_MIN_FRACTION * (fbot - ftop)) hip = [bw[0].x + bw[0].w / 2, bw[0].y + 0.14 * fh];
  else if (bw.length === 0) {
    hip = [axis, ftop + 0.32 * (fbot - ftop)];
    notes.push('no bottomwear: hip from 0.32 of figure height');
  } else {
    // A long under-robe tagged bottomwear starts at the collar: its top edge
    // is not the waist, and a hip read off it sits at the shoulders with the
    // chest above it by half a neck. The waist is read off the figure instead.
    const limit = ftop + HIP_MIN_FRACTION * (fbot - ftop);
    notes.push(
      `hip: ${bw[0].name} (${bw[0].from}) starts at y=${bw[0].y}, so its top + 0.14 face heights (y=${pyFixed(bw[0].y + 0.14 * fh, 0)}) is above ${HIP_MIN_FRACTION} of the figure height (y=${pyFixed(limit, 0)}, figure y ${ftop}..${fbot}): its top edge is not the waist`,
    );
    const waist = shoulders === null ? null : waistOf(torso, shoulders, ftop + 0.5 * (fbot - ftop));
    if (shoulders !== null && waist !== null) {
      hip = [waist.cx, waist.y + 0.14 * fh];
      notes.push(`hip from the waist: silhouette narrowest at y=${waist.y} (width ${waist.width} px, shoulders ${shoulders.width} px at y=${shoulders.y}), hip 0.14 face heights below it`);
    } else {
      hip = [axis, ftop + 0.32 * (fbot - ftop)];
      const why =
        shoulders === null
          ? `no torso layer (${TORSO_TAGS.join(', ')}) in the shoulder band y ${pyFixed(neckY, 0)}..${pyFixed(neckY + fh, 0)}`
          : `the silhouette never narrows to ${WAIST_MAX_OF_SHOULDERS} of the shoulders (${shoulders.width} px at y=${shoulders.y}) above the figure's middle, y=${pyFixed(ftop + 0.5 * (fbot - ftop), 0)}`;
      notes.push(`hip from 0.32 of figure height (no waist found: ${why})`);
    }
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
  // An eye bone comes only from an eyewhite (EYE_GROUP_TAGS). An iris or a
  // lash on a side with none has no eye bone to ride, and writing its region
  // as `eye_<s>` anyway named a bone that does not exist — refused by the
  // loader as the symptom (`config.regions.<part> — is "eye_r"`), never the
  // cause (issue #45). Such a part rides `head` — the bone the eye bone would
  // hang from and the one the face beside it already rides — so no value is
  // invented, the proposal stays one a person can correct, and the note names
  // the cause.
  const eyeless: string[] = [];
  const eyelessSides = new Set<'r' | 'l'>();
  for (const p of P.layered()) {
    const t = splitFrom(p.from)[1];
    let role: string | undefined = TAG_REGION[t];
    if (browOf.has(p.name)) role = browOf.get(p.name);
    const side = role === 'eye_r' ? 'r' : role === 'eye_l' ? 'l' : null;
    if (side !== null && !eyes.has(side)) {
      role = 'head';
      eyeless.push(`${p.name} (${p.from})`);
      eyelessSides.add(side);
    }
    if (role !== undefined) regions[p.name] = role;
  }
  if (eyeless.length > 0) {
    const sides = (['r', 'l'] as const).filter((s) => eyelessSides.has(s));
    notes.push(
      `no eyewhite part for ${sides.map((s) => `eye_${s}`).join(', ')} (looked for: ${sides.map((s) => `eyewhite-${s}`).join(', ')}): ${eyeless.join(', ')} ${eyeless.length === 1 ? 'is' : 'are'} placed on head as ${eyeless.length === 1 ? 'a region' : 'regions'}, rigid with the head and not blinking — an eye bone comes only from an eyewhite`,
    );
  }
  // A blink group rigc is handed must name a member (rigc refuses `group
  // "eyes" declares no members`), so a group with none is not written, and a
  // blink with no eyes is not written at all: a value with nothing to act on
  // would be invented. Each omission is a note naming the tags looked for.
  const eyeBonesProposed = (['r', 'l'] as const).filter((s) => eyes.has(s)).map((s) => `eye_${s}`);
  const browBonesProposed = (['r', 'l'] as const).filter((s) => bySide.has(s)).map((s) => `brow_${s}`);
  let blink: ProposedBlink | undefined;
  if (eyeBonesProposed.length === 0) {
    const brows = browBonesProposed.length === 0 ? '' : `; ${browBonesProposed.join(', ')} ${browBonesProposed.length === 1 ? 'is' : 'are'} placed and nothing drops ${browBonesProposed.length === 1 ? 'it' : 'them'}`;
    notes.push(`no blink: no eyewhite part (looked for: ${EYE_GROUP_TAGS.join(', ')}), so the blink's eyes group would name no bone${brows}`);
  } else {
    blink = browBonesProposed.length === 0 ? { t: 2.3, eyes: eyeBonesProposed, squash: 0.12 } : { t: 2.3, eyes: eyeBonesProposed, brows: browBonesProposed, squash: 0.12, brow_drop: 1.2 };
    const still = lashStills(P, ew, notes);
    if (Object.keys(still).length > 0) blink.still = still;
    if (browBonesProposed.length === 0) notes.push(`blink without brows: no eyebrow part (looked for: ${BROW_GROUP_TAGS.join(', ')}), so the blink has no brows group and no brow_drop`);
  }
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

  // ---- accessories: rigid body + pendant chain where the part narrows, or one pendulum chain per hanging strand
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
      // A region cannot swing, so strands found on it are only said.
      const pr = pendantRows(P, q);
      const strands = hangingStrands(P, q, tag === 'earwear' || pr.pendH > 0.8 * q.h ? 0 : pr.j);
      if (strands.length > 0) notes.push(strandNote(q, strands, [], strands, 'it rides the head as a region'));
    }
    for (const p of cands.slice(0, 1)) {
      const [g, r] = gridR(p);
      const fullMask = dilate(P.alpha(p), 7);
      const onArt = (pts: ReadonlyArray<readonly [number, number]>): boolean => pts.every((q) => isOn(fullMask, q[0], q[1]));
      const im = P.images.get(p.name) as Raster;
      const own = (x: number, y: number): number => (im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0);
      const { rows, j, pendH } = pendantRows(P, p);
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
      const allPendant = tag === 'earwear' || pendH > 0.8 * rows.length;
      // Strands: searched below the body, or over the whole part when it is all pendant.
      const strands = hangingStrands(P, p, allPendant ? 0 : j);
      // One pendulum chain per strand, in place of the part's single pendant
      // chain: a chain at the mean x of several strands hangs between them.
      const strandChains = (parent: string): { segs: Segment[]; chained: string[]; dropped: Strand[] } => {
        const segs: Segment[] = [];
        const chained: string[] = [];
        const dropped: Strand[] = [];
        strands.forEach((st, k) => {
          const h = st.bottom - st.top + 1;
          const pts: Array<[number, number]> = [st.top, st.top + h * STRAND_LINK_AT].map((y) => [or(bandX(st.mask, y), st.x), y]);
          const tip: [number, number] = [or(bandX(st.mask, st.bottom), pts[pts.length - 1][0]), st.bottom];
          if (!onArt([...pts, tip])) {
            dropped.push(st);
            return;
          }
          const name = `${bname}_strand${k}_`;
          C(name, parent, pts, tip);
          // The head stub at the strand's top is what an all-pendant part hangs from, as the single pendant chain's mesh does.
          if (parent === par) segs.push(['head', rnd([pts[0][0], st.top - 7]), rnd([pts[0][0], st.top + 1])]);
          segs.push(name);
          chained.push(name);
          tracks.push({ chain: name, amps: [...STRAND_AMPS], period: 2.0, phase: 0.2, lag: 0.12 });
        });
        return { segs, chained, dropped };
      };
      if (allPendant && strands.length > 0) {
        const sc = strandChains(par);
        notes.push(strandNote(p, strands, sc.chained, sc.dropped, 'a chain down it would run off the art'));
        if (sc.chained.length > 0) {
          delete regions[p.name];
          meshes[p.name] = { grid: g, r, segments: sc.segs };
          continue;
        }
      }
      if (allPendant) {
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
      // The body's two fixed segments come first and stay: they are what holds the body still while a strand swings.
      const segs: Segment[] = [
        [bname, rnd(start), rnd([far, cy])],
        [bname, rnd([near, cy - 12]), rnd([start[0], cy + 18])],
      ];
      if (strands.length > 0) {
        // The body's full width at its mean row: without it the body's near side
        // is held only by the reference's two segments, and a strand's pull
        // reaches it (measured on the synthetic crown: 1.07 px off its bone
        // without this segment, 0.55 px with it).
        segs.push([bname, rnd([xl, cy]), rnd([xr, cy])]);
        const sc = strandChains(bname);
        segs.push(...sc.segs);
        notes.push(strandNote(p, strands, sc.chained, sc.dropped, 'a chain down it would run off the art'));
        meshes[p.name] = { grid: g, r, segments: segs };
        continue;
      }
      const tpts: Array<[number, number]> = [
        [px, p.y + j],
        [px, p.y + j + pendH * 0.45],
        [px, p.y + p.h - 1],
      ];
      if (pendH >= PENDANT_MIN_ROWS && !onArt(tpts)) {
        notes.push(`${p.name}: pendant chain would run off the art -> no tassel chain (add one by hand if it swings)`);
      } else if (pendH >= PENDANT_MIN_ROWS) {
        const y0 = p.y + j;
        C(`${bname}_tassel`, bname, [[px, y0], [px, y0 + pendH * 0.45]], [px, p.y + p.h - 1]);
        segs.push(`${bname}_tassel`);
        tracks.push({ chain: `${bname}_tassel`, amps: [...STRAND_AMPS], period: 2.0, phase: 0.2, lag: 0.12 });
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
  const clasped = hw.length > 0 && !(hw.length === 2 && sides.size === 2) ? claspedOf(P, hw, shoulders, axis) : null;
  if (clasped !== null) {
    // One blob at the midline, narrower than the shoulders: the hands, clasped
    // in front. The sleeves are inside another layer and move with it; two
    // sleeve chains on this blob would stand on one vertical line.
    for (const p of hw) regions[p.name] = 'hip';
    notes.push(clasped);
  } else if (hw.length === 2 && sides.size === 2) {
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
      if (splitFrom(p.from)[0] === PAINTING_RUN) {
        notes.push(`${p.name} (${p.from}): a painting patch has no tag, so no rule -> region on ${regions[p.name]}, the nearest trunk bone; config.regions.${p.name} is the bone it rides`);
      } else notes.push(`${p.name} (${p.from}): no rule -> region on ${regions[p.name]}`);
    }
  }
  return { bones, meshes, regions, motion: blink === undefined ? { duration: 4.0, tracks } : { duration: 4.0, tracks, blink }, notes };
}

// ---------------------------------------------------------------------------
// the lash that carries the crease (issue #26)
// ---------------------------------------------------------------------------

/**
 * A lash reaching more than this share of its own height above its eyewhite's
 * top is noted. Measured on the two public examples: their four lashes reach
 * 4-6 px above the eyewhite, 17-26 % of their height (demo 26 % / 17 %,
 * sample 18 % / 23 %), which is the lash line itself. The bar sits above that
 * with a 9-point margin; the character issue #26 reported is not in this tree,
 * so no figure of its crease is quoted here.
 */
export const LASH_ABOVE_SHARE_BAR = 0.35;

/**
 * A lash more than this many times the height of its pair is noted. The two
 * public examples' pairs are 24 / 23 px (1.04) and 22 / 22 px (1.00); the
 * pair issue #26 reported, 36x24 against 30x17, is 24 / 17 px (1.41).
 */
export const LASH_PAIR_RATIO_BAR = 1.2;

function pct(v: number): string {
  return `${Math.round(v * 100)} %`;
}

/**
 * The blink squashes each eye's parts about the eye bone, so anything painted
 * into the eyelash layer above the lid — a double-eyelid crease — is squashed
 * with it. A lash that reaches far above its eyewhite, or is much taller than
 * its pair, is noted; when some row between its top and the eyewhite's top
 * carries no art across the lash's whole width, the rows above the lowest such
 * row are proposed as a still piece (`motion.blink.still`) on the eye bone's
 * parent, `head`. The cut must be a clear row because the rig stage refuses
 * any other (`RIG_STILL_ROW_CLEAR`).
 */
function lashStills(P: PartSet, ew: Record<'r' | 'l', PartRecord | null>, notes: string[]): Record<string, { row: number; bone: string }> {
  const out: Record<string, { row: number; bone: string }> = {};
  const lash: Record<'r' | 'l', PartRecord | null> = { r: P.byTag('eyelash-r')[0] ?? null, l: P.byTag('eyelash-l')[0] ?? null };
  for (const s of ['r', 'l'] as const) {
    const la = lash[s];
    const eye = ew[s];
    if (la === null || eye === null) continue;
    const pair = lash[s === 'r' ? 'l' : 'r'];
    const above = eye.y - la.y;
    const share = above / la.h;
    const ratio = pair === null ? null : la.h / pair.h;
    const tall = share > LASH_ABOVE_SHARE_BAR;
    const odd = ratio !== null && ratio > LASH_PAIR_RATIO_BAR;
    if (!tall && !odd) continue;
    const im = P.images.get(la.name) as Raster;
    let row: number | null = null;
    for (let y = eye.y - 1; y > la.y && row === null; y--) {
      const r = y - la.y;
      if (r >= la.h) continue;
      let clear = true;
      for (let x = 0; x < la.w && clear; x++) if (im.data[(r * la.w + x) * 4 + 3] > 0) clear = false;
      if (clear) row = y;
    }
    const why = [
      `reaches ${above} px above ${eye.name}'s top, ${pct(share)} of its ${la.h} px height (noted above ${pct(LASH_ABOVE_SHARE_BAR)})`,
      ...(pair === null || ratio === null ? [] : [`is ${pyFixed(ratio, 2)}x the height of ${pair.name}, ${pair.h} px (noted above ${pyFixed(LASH_PAIR_RATIO_BAR, 2)}x)`]),
    ].join(' and ');
    if (row !== null) {
      out[la.name] = { row, bone: 'head' };
      notes.push(`${la.name} (${la.from}) ${why}: the blink would squash whatever is painted there, a crease included — rows above ${row} (a row with no art) split off as ${la.name}_still on head (motion.blink.still), which the blink does not move`);
    } else {
      notes.push(
        `${la.name} (${la.from}) ${why}: the blink squashes whatever is painted there, a crease included — no row between its top and the lid is clear across its width, so it is not split; if a crease is painted in, clear a row between it and the lash line and set motion.blink.still by hand`,
      );
    }
  }
  return out;
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

/** A chain link off the art of a mesh it is a candidate for. */
export interface OffArtFinding {
  kind: 'off-art';
  bone: string;
  mesh: string;
  at: [number, number];
}

/** The hip at or above the chest: breathing and every skirt chain hang from the wrong end of the torso. */
export interface HipAboveChestFinding {
  kind: 'hip-not-below-chest';
  hip: [number, number];
  chest: [number, number];
}

/** The hip above `HIP_MIN_FRACTION` of the figure's height: a hip at the shoulders. */
export interface HipTooHighFinding {
  kind: 'hip-too-high';
  hip: [number, number];
  /** The lowest y the hip may take, `figure.top + HIP_MIN_FRACTION * (figure.bot - figure.top)`. */
  limit: number;
  figure: { top: number; bot: number };
}

export type LintFinding = OffArtFinding | HipAboveChestFinding | HipTooHighFinding;

/** What a check could not look at, said rather than skipped. */
export interface LintResult {
  findings: LintFinding[];
  /** Meshes naming no part in parts.json: nothing to lint them against. */
  unknownMeshes: string[];
  /** Single bones the torso checks read (`hip`, `chest`) that the bones do not hold: those checks did not run. */
  missingTorsoBones: string[];
}

/**
 * Chain links that sit off the art of a mesh they are a candidate for
 * (the part's mask dilated 15 px each way). A chain point in the background
 * still weights by distance, but it is almost always a mis-pick.
 *
 * As in the reference, only CHAIN segments are linted: a string segment names
 * the links `<segment><digits>`, so a single bone named as a segment has none,
 * and an explicit `[bone, from, to]` segment is a line, not an origin.
 *
 * Then the torso, which the reference did not lint: a single bone `hip` that
 * is not below a single bone `chest` (larger y), and a `hip` above
 * `HIP_MIN_FRACTION` of the figure's height (every part's union, top row to
 * bottom row). Either one is a rig whose breath and skirt hang from the
 * shoulders, and a mesh check cannot see it.
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
      if (!isOn(mask, x, y)) findings.push({ kind: 'off-art', bone: n, mesh: mname, at: [x, y] });
    }
  }
  const single = (n: string): [number, number] | null => {
    const e = spec.bones.find((b) => 'name' in b && b.name === n);
    return e !== undefined && 'name' in e ? [e.at[0], e.at[1]] : null;
  };
  const hip = single('hip');
  const chest = single('chest');
  const missingTorsoBones = [hip === null ? 'hip' : null, chest === null ? 'chest' : null].filter((n): n is string => n !== null);
  if (hip !== null && chest !== null && hip[1] <= chest[1]) findings.push({ kind: 'hip-not-below-chest', hip, chest });
  if (hip !== null) {
    const figure = figureExtent(P);
    const limit = figure.top + HIP_MIN_FRACTION * (figure.bot - figure.top);
    if (hip[1] < limit) findings.push({ kind: 'hip-too-high', hip, limit, figure });
  }
  return { findings, unknownMeshes, missingTorsoBones };
}

/**
 * The LINT line. The off-art line is the reference's, verbatim:
 * `LINT sleeve_r0 at [335, 330] is off the art of mesh 'sleeves'`; the two
 * torso lines keep its shape, `LINT <bone> at [x, y] …`.
 */
export function lintLine(f: LintFinding): string {
  switch (f.kind) {
    case 'off-art':
      return `LINT ${f.bone} at ${pyIntList(f.at)} is off the art of mesh ${pyRepr(f.mesh)}`;
    case 'hip-not-below-chest':
      return `LINT hip at ${pyIntList(f.hip)} is not below chest at ${pyIntList(f.chest)}: the hip must have the larger y, or breathing and the skirt hang from the shoulders`;
    case 'hip-too-high':
      return `LINT hip at ${pyIntList(f.hip)} is above ${HIP_MIN_FRACTION} of the figure height (figure y ${f.figure.top}..${f.figure.bot}, so hip y must be at least ${pyFixed(f.limit, 1)}): a hip at the shoulders`;
  }
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
