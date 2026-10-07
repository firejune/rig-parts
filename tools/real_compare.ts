#!/usr/bin/env bun
/**
 * The lattice against the contour mode on a REAL public example part, with a
 * declared test region — issue #107: #84's settled §3 and §4 on a part the
 * generated fixture of `tools/local_compare.ts` could not stand in for, and
 * what that fixture could not show: the seam with the parts drawn beside the
 * one that deforms.
 *
 *     bun tools/real_compare.ts --work <dir> [--examples <key>,...] [--builds] [--sweep] [--only <example>/<part>]
 *
 * Reads every tracked example (`examples/<key>/config.json`, in key order)
 * whose inputs are fetched (`examples/<key>/inputs`, `bun run fetch-examples`),
 * or with `--examples` only the keys it lists — a key that is not a fetched
 * example is refused by name. The rules below rank candidates across every
 * example read, so the set read decides the picks: the tables issues #107 and
 * #110 published are `--examples demo,sample`'s. Builds
 * each example's tracked config once into `<dir>/base-<key>` (the lattice, as
 * shipped) unless that build is already there; then applies the rules below,
 * prints both tables of §4 and the verdict for each picked part, and with
 * `--builds` runs the real `build` on out-of-tree config copies (under
 * `<dir>`) that add the test region's control bone and an idle moving it
 * through each declared pose, and measures the seam off spine-rigc's posed
 * geometry. Not shipped (`tools/` is not in `files`); the definitions are
 * exported and the selftest holds them (suite `contour-wiring`, `CV01`–`CV13`).
 * The contour mode measured is the one this tree's `src/contour.ts` builds,
 * so re-running this one command after a change to it regenerates every table.
 *
 * ## A test region is a place to measure
 *
 * The region below is a test region: a place to measure. It makes no claim
 * about what the painting's author intended, and names nothing the config
 * does not already name. Every rule is stated here, before any mesh is
 * measured, and picks by geometry and counts, never by an error.
 *
 * ## The rules
 *
 * - **Candidates**: every mesh part of every example whose contour mesh builds
 *   today at tolerance 1, margin 1, background spacing = its lattice grid (the
 *   #100/#104 survey's parameters).
 * - **The part**: a candidate whose See-through tag is hair (`… hair`) or
 *   clothing (`topwear`, `bottomwear`, `legwear`, `footwear`, `neckwear`,
 *   `handwear…`) is preferred over any other (a `neck`); among those, the one
 *   with the most neighbouring parts ({@link neighbours}); a tie goes to the
 *   example listed first, then the part listed first in its `parts.json`. The
 *   second part is the first, by the same rule, of the other kind (hair against
 *   clothing). A part the region rule refuses is passed over, and said so.
 * - **The region** ({@link testRegion}): a circle centred on the art pixel
 *   nearest the midpoint of the LAST link (last point → tip) of the FIRST chain
 *   the mesh's `segments` name ({@link nearestArt}: the pixel holding the
 *   midpoint when that pixel is art); radius `floor(min(w, h) / 10)` whole px
 *   of the part's box, band equal to the radius. The mesh must name a chain and
 *   have an explicit `[bone, a, b]` first segment, or the rule refuses the
 *   part. (As first written the rule required the midpoint's own pixel to be
 *   art; that refused the demo's `hair_front`, whose midpoint falls between
 *   strands, and the nearest-art clause was added before any `hair_front` mesh
 *   was measured. It moves no other part's region: the others' midpoints are
 *   on art.)
 * - **The control bone** `test_region`: at the centre, parented to the bone of
 *   the mesh's first segment (the bone its slot rides), so a translate or scale
 *   key on it is never under a turned chain link (`RIG_KEY_FRAME_UNTURNED`).
 * - **The poses** of the control ({@link regionPoses}): #104's three with the
 *   translation scaled by the radius over #104's radius 8 — rotation 20° about
 *   the centre, translation (r/2, −3r/8) image px, uniform scale 1.25 about the
 *   centre.
 * - **The meshes**: the lattice at the config's own grid; the contour mesh at
 *   tolerance 1, margin 1, background spacing twice the grid (#104's rule: the
 *   surround is not denser than the lattice's), and the region refined at the
 *   finest of #104's ten spacings scaled by grid / 8 (so the coarsest is the
 *   background spacing, as in #104) whose mesh has no more vertices than the
 *   lattice ({@link regionSpacings}; count only, never error).
 *
 * ## The measurements
 *
 * Table 1, table 2, the cost and the verdict are `tools/local_compare.ts`'s
 * definitions, unchanged (`errors`, `cost`, `weighMesh`): the field
 * `p + g(p)(M p − p)` against the mesh's barycentric mix of its skinned
 * vertices, over the part's art pixel centres. The lattice is given the
 * region's weight function at its vertices — in this tool only; a lattice
 * config cannot declare a region.
 *
 * **The seam** ({@link seamPairs}, {@link seamOpening}): the pairs (a, b) of
 * 4-adjacent rig pixels with a an art pixel of the part and b an art pixel of a
 * neighbour that is not an art pixel of the part. In a frame, each pixel
 * centre's displacement from rest is read off spine-rigc's `render --geometry`
 * — the triangle of the attachment's rest geometry holding the centre, and the
 * same barycentric mix of that triangle's posed vertices ({@link displacement})
 * — and a pair's opening is |d_part(a) − d_neighbour(b)|: how far the two
 * sides of the seam moved apart or across, in rig px. It is an upper bound on
 * any gap at the seam: what shows there depends on what is drawn under it.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type CharacterConfig, type ContourRegionSpec, loadConfig, type Point } from '../src/config.ts';
import { contourMesh } from '../src/contour.ts';
import { regionWeight } from '../src/localweights.ts';
import { ART_ALPHA, latticeMesh } from '../src/mesh.ts';
import { readParts, type PartsFile } from '../src/parts.ts';
import { alphaAbove, pad, type Raster, readPng } from '../src/raster/index.ts';
import { PAD } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { type Segment, segmentDistance } from '../src/weights.ts';
import { type Affine } from '../fixtures/localfield.ts';
import { type ComparedMesh, cost, type Errors, errors, fieldAt, locator, pixelErrors, pixelsOver, weighMesh, type WorstPixel } from './local_compare.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The region's control bone, added to the config copy. */
export const CONTROL = 'test_region';
/** #104's ten region spacings, for its grid 8. */
export const BASE_SPACINGS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
export const BASE_GRID = 8;
export const BASE_RADIUS = 8;
export const TOLERANCE = 1;
export const MARGIN = 1;

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------

export type Kind = 'hair' | 'clothing' | 'other';

/** The kind of a part by its See-through tag (`parts.json`'s `from`, after the run). */
export function kindOf(from: string): Kind {
  const tag = from.includes(':') ? from.slice(from.indexOf(':') + 1) : from;
  if (/\bhair$/.test(tag)) return 'hair';
  if (['topwear', 'bottomwear', 'legwear', 'footwear', 'neckwear'].includes(tag) || tag.startsWith('handwear')) return 'clothing';
  return 'other';
}

/** An art mask placed on the rig: its box's top-left in rig px and its pixels (alpha above {@link ART_ALPHA}). */
export interface PlacedMask {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export function placedMask(x: number, y: number, img: Raster): PlacedMask {
  const m = alphaAbove(img, ART_ALPHA);
  return { x, y, width: m.width, height: m.height, data: m.data };
}

function at(m: PlacedMask, rx: number, ry: number): boolean {
  const x = rx - m.x;
  const y = ry - m.y;
  return x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x] === 1;
}

/**
 * The seam pairs of `p` against `n`: [ax, ay, bx, by] in rig px, a an art
 * pixel of `p`, b a 4-neighbour of a that is an art pixel of `n` and not of
 * `p`. Order: a row-major over p's box, then right, down, left, up.
 */
export function seamPairs(p: PlacedMask, n: PlacedMask): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const steps: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.data[y * p.width + x] !== 1) continue;
      const ax = p.x + x;
      const ay = p.y + y;
      for (const [dx, dy] of steps) {
        const bx = ax + dx;
        const by = ay + dy;
        if (at(n, bx, by) && !at(p, bx, by)) out.push([ax, ay, bx, by]);
      }
    }
  }
  return out;
}

/** Is `n` drawn against `p`: does an art pixel of `n` coincide with, or 4-touch, an art pixel of `p`? */
export function touches(p: PlacedMask, n: PlacedMask): boolean {
  for (let y = 0; y < n.height; y++) {
    for (let x = 0; x < n.width; x++) {
      if (n.data[y * n.width + x] !== 1) continue;
      const rx = n.x + x;
      const ry = n.y + y;
      if (at(p, rx, ry) || at(p, rx + 1, ry) || at(p, rx - 1, ry) || at(p, rx, ry + 1) || at(p, rx, ry - 1)) return true;
    }
  }
  return false;
}

/** The parts drawn against `name`, in `masks` order. */
export function neighbours(masks: ReadonlyArray<readonly [string, PlacedMask]>, name: string): string[] {
  const p = masks.find(([k]) => k === name)?.[1];
  if (p === undefined) throw new Error(`real_compare: no part "${name}"`);
  return masks.filter(([k, n]) => k !== name && touches(p, n)).map(([k]) => k);
}

export interface Candidate {
  example: string;
  part: string;
  kind: Kind;
  neighbours: number;
}

/**
 * The rule's order: hair or clothing before any other kind; then more
 * neighbours first; then the order given (examples, then parts.json order).
 */
export function ranked(cands: readonly Candidate[]): Candidate[] {
  return cands
    .map((c, i) => ({ c, i }))
    .sort((u, v) => Number(u.c.kind === 'other') - Number(v.c.kind === 'other') || v.c.neighbours - u.c.neighbours || u.i - v.i)
    .map(({ c }) => c);
}

export interface TestRegion {
  /** Rig px, on the 1/256 grid (a pixel centre). */
  cx: number;
  cy: number;
  r: number;
  band: number;
  /** The chain whose last link placed it, and that link's midpoint. */
  chain: string;
  mid: Point;
  /** The control bone's parent: the bone of the mesh's first segment. */
  parent: string;
}

/**
 * The region rule (module header), or why it refuses the part. `art` is the
 * part's mask on the rig; `box` its `w, h`.
 */
export function testRegion(cfg: Pick<CharacterConfig, 'bones' | 'meshes'>, part: string, art: PlacedMask, box: { w: number; h: number }): TestRegion | string {
  const mesh = cfg.meshes[part];
  if (mesh === undefined) return `"${part}" is not a mesh`;
  const first = mesh.segments[0];
  if (first === undefined || typeof first === 'string') return `"${part}"'s first segment is ${JSON.stringify(first)}, not an explicit [bone, a, b]: the control's parent would not be named by the rule`;
  const chains = new Map<string, { points: Point[]; tip: Point }>();
  for (const b of cfg.bones) if ('chain' in b) chains.set(b.chain, { points: b.points, tip: b.tip });
  const chain = mesh.segments.find((s): s is string => typeof s === 'string' && chains.has(s));
  if (chain === undefined) return `"${part}"'s segments name no chain`;
  const c = chains.get(chain) as { points: Point[]; tip: Point };
  const last = c.points[c.points.length - 1];
  const mid: Point = [(last[0] + c.tip[0]) / 2, (last[1] + c.tip[1]) / 2];
  const near = nearestArt(art, mid);
  if (near === null) return `"${part}" has no art pixel`;
  const r = Math.floor(Math.min(box.w, box.h) / 10);
  if (r < 1) return `"${part}"'s box ${box.w}x${box.h} gives a radius of 0`;
  return { cx: near[0] + 0.5, cy: near[1] + 0.5, r, band: r, chain, mid, parent: first[0] };
}

/**
 * The pixel holding `q` (rig px) when it is art; otherwise the art pixel whose
 * centre is nearest `q`, first in row-major order among equals. Squared
 * distances of `q` on the half-pixel grid the chain midpoints sit on are
 * exact in doubles.
 */
export function nearestArt(art: PlacedMask, q: Point): [number, number] | null {
  if (at(art, Math.floor(q[0]), Math.floor(q[1]))) return [Math.floor(q[0]), Math.floor(q[1])];
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      if (art.data[y * art.width + x] !== 1) continue;
      const dx = art.x + x + 0.5 - q[0];
      const dy = art.y + y + 0.5 - q[1];
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = [art.x + x, art.y + y];
      }
    }
  }
  return best;
}

/** #104's spacings scaled by `grid / 8`, finest first; the coarsest is the background spacing `2 × grid`. */
export function regionSpacings(grid: number): number[] {
  return BASE_SPACINGS.map((s) => (s * grid) / BASE_GRID);
}

export interface RegionPose {
  name: string;
  /** The pose as an affine map of image px (y down), about the centre `c`. */
  map: Affine;
  /** The single tracks that reach it at their peak (Spine: degrees counter-clockwise, y up). */
  tracks: Array<{ prop: 'rotate' | 'translatex' | 'translatey' | 'scalex' | 'scaley'; amp: number; base?: number }>;
}

function about(c: Point, a: number, b: number, cc: number, d: number): Affine {
  return [a, b, cc, d, c[0] - a * c[0] - b * c[1], c[1] - cc * c[0] - d * c[1]];
}

/** The three declared poses about the centre `c` for a region of radius `r` (module header). */
export function regionPoses(c: Point, r: number): RegionPose[] {
  const th = (20 * Math.PI) / 180;
  const tx = r / 2;
  const ty = (3 * r) / 8;
  return [
    { name: 'rotate 20°', map: about(c, Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th)), tracks: [{ prop: 'rotate', amp: 20 }] },
    { name: `translate (${tx}, -${ty}) px`, map: [1, 0, 0, 1, tx, -ty], tracks: [{ prop: 'translatex', amp: tx }, { prop: 'translatey', amp: ty }] },
    { name: 'scale 1.25', map: about(c, 1.25, 0, 0, 1.25), tracks: [{ prop: 'scalex', amp: 0.25, base: 1 }, { prop: 'scaley', amp: 0.25, base: 1 }] },
  ];
}

/**
 * The phase every pose track runs at: a quarter cycle, so the peak (the
 * declared pose) is at half the idle and the opposite pose at its start. It
 * sits after the head's rotate track (phase 0.12 in both examples), so a
 * rotate key on a control under the head lags it as `CHAIN_LAG` requires; it is
 * not a mesh parameter.
 */
export const POSE_PHASE = 0.25;

/** The value `src/motion.ts`'s sine track takes at `t`: `base + amp·sin(2π(t/period − phase))`. */
export function sineAt(t: number, amp: number, period: number, phase: number, base: number): number {
  return base + amp * Math.sin(2 * Math.PI * (t / period - phase));
}

// ---------------------------------------------------------------------------
// the seam, off rigc's posed geometry
// ---------------------------------------------------------------------------

/** One attachment of a `rigc-geometry/1` file: rest and posed vertices (world, y up) and its triangles. */
export interface PosedAttachment {
  rest: number[];
  posed: number[];
  triangles: number[];
}

/** Rig px (y down, from the canvas's top-left) to Spine world (y up, root at the canvas's bottom centre). */
export function toWorldPx(p: Point, size: readonly [number, number]): Point {
  return [p[0] - size[0] / 2, size[1] - p[1]];
}

/** A displacement reader for one attachment: the world point's displacement from rest, or null off its rest geometry. */
export function displacement(a: PosedAttachment): (w: Point) => Point | null {
  const verts: Array<[number, number]> = [];
  for (let i = 0; i < a.rest.length; i += 2) verts.push([a.rest[i], a.rest[i + 1]]);
  const find = locator(verts, a.triangles, 8);
  return (w) => {
    // The locator buckets by floor(coordinate / cell); world coordinates are negative left of the root, which it handles.
    const hit = find(w);
    if (hit === null) return null;
    const ix = [a.triangles[3 * hit.t], a.triangles[3 * hit.t + 1], a.triangles[3 * hit.t + 2]];
    let x = 0;
    let y = 0;
    for (let k = 0; k < 3; k++) {
      x += hit.l[k] * a.posed[2 * ix[k]];
      y += hit.l[k] * a.posed[2 * ix[k] + 1];
    }
    return [x - w[0], y - w[1]];
  };
}

export interface SeamFigure {
  /** Largest |d_part(a) − d_neighbour(b)| over the pairs, rig px, and its pair. */
  max: number;
  at: [number, number, number, number] | null;
  /** Pairs measured, and pairs one side's rest geometry does not hold (not measured). */
  pairs: number;
  unread: number;
}

/** The seam opening over `pairs` in one frame (module header). */
export function seamOpening(pairs: ReadonlyArray<readonly [number, number, number, number]>, dPart: (w: Point) => Point | null, dNeighbour: (w: Point) => Point | null, size: readonly [number, number]): SeamFigure {
  let max = 0;
  let where: SeamFigure['at'] = null;
  let unread = 0;
  for (const [ax, ay, bx, by] of pairs) {
    const da = dPart(toWorldPx([ax + 0.5, ay + 0.5], size));
    const db = dNeighbour(toWorldPx([bx + 0.5, by + 0.5], size));
    if (da === null || db === null) {
      unread++;
      continue;
    }
    const o = Math.hypot(da[0] - db[0], da[1] - db[1]);
    if (where === null || o > max) {
      max = o;
      where = [ax, ay, bx, by];
    }
  }
  return { max, at: where, pairs: pairs.length - unread, unread };
}

export interface GeometryFile {
  frames: Array<{ time: number; attachments: Array<{ slot: string; vertices: number[] }> }>;
  rest: Array<{ slot: string; vertices: number[]; triangles: number[] }>;
}

function readGeometryFile(path: string): GeometryFile {
  return JSON.parse(readFileSync(path, 'utf8')) as GeometryFile;
}

function attachmentIn(g: GeometryFile, frame: number, slot: string): PosedAttachment | null {
  const rest = g.rest.find((r) => r.slot === slot);
  const posed = g.frames[frame].attachments.find((a) => a.slot === slot);
  if (rest === undefined || posed === undefined) return null;
  return { rest: rest.vertices, posed: posed.vertices, triangles: rest.triangles };
}

/** Every seam pair's opening in one frame, neighbours in `pairsBy` order; NaN where a side's rest geometry does not hold the pixel or the slot is absent. */
export function frameOpenings(g: GeometryFile, frame: number, part: string, pairsBy: ReadonlyArray<readonly [string, ReadonlyArray<readonly [number, number, number, number]>]>, size: readonly [number, number]): Float64Array {
  const total = pairsBy.reduce((n, [, ps]) => n + ps.length, 0);
  const out = new Float64Array(total).fill(Number.NaN);
  const pa = attachmentIn(g, frame, part);
  if (pa === null) return out;
  const dP = displacement(pa);
  let k = 0;
  for (const [n, ps] of pairsBy) {
    const na = attachmentIn(g, frame, n);
    const dN = na === null ? null : displacement(na);
    for (const [ax, ay, bx, by] of ps) {
      const da = dP(toWorldPx([ax + 0.5, ay + 0.5], size));
      const db = dN === null ? null : dN(toWorldPx([bx + 0.5, by + 0.5], size));
      if (da !== null && db !== null) out[k] = Math.hypot(da[0] - db[0], da[1] - db[1]);
      k++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// the meshes
// ---------------------------------------------------------------------------

/** The config's segments as the rig stage resolves them (chain → links, a tipped bone → its segment). */
export function resolveSegments(cfg: Pick<CharacterConfig, 'bones'>, segs: ReadonlyArray<string | [string, Point, Point]>): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (typeof s !== 'string') {
      out.push({ bone: s[0], a: s[1], b: s[2] });
      continue;
    }
    const e = cfg.bones.find((b) => ('chain' in b ? b.chain === s : b.name === s));
    if (e === undefined) throw new Error(`real_compare: segment "${s}" names no bone`);
    if ('chain' in e) {
      const poly = [...e.points, e.tip];
      e.points.forEach((p, k) => out.push({ bone: `${e.chain}${k}`, a: p, b: poly[k + 1] }));
    } else if (e.tip !== undefined) out.push({ bone: e.name, a: e.at, b: e.tip });
    else throw new Error(`real_compare: bone "${s}" has no tip`);
  }
  return out;
}

interface PartInput {
  example: string;
  cfg: CharacterConfig;
  parts: PartsFile;
  part: string;
  box: { x: number; y: number; w: number; h: number };
  img: Raster;
  mask: { width: number; height: number; alpha: Uint8Array };
  /** The padded image's origin in rig px. */
  ox: number;
  oy: number;
  grid: number;
  r: number;
  segs: Segment[];
}

function partInput(example: string, cfg: CharacterConfig, build: string, part: string): PartInput {
  const parts = readParts(join(build, 'parts.json'));
  const p = parts.parts.find((q) => q.name === part);
  if (p === undefined) throw new Error(`real_compare: no part ${part} in ${build}`);
  const img = pad(readPng(join(build, 'parts', `${part}.png`)), PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
  const alpha = new Uint8Array(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  const m = cfg.meshes[part];
  if (m === undefined || !('grid' in m)) throw new Error(`real_compare: ${part} is not a lattice mesh in the tracked config`);
  return { example, cfg, parts, part, box: { x: p.x, y: p.y, w: p.w, h: p.h }, img, mask: { width: img.width, height: img.height, alpha }, ox: p.x - PAD, oy: p.y - PAD, grid: m.grid, r: m.r, segs: resolveSegments(cfg, m.segments) };
}

/** Weights at rig px for vertices given in the padded part frame. */
function weighAt(pi: PartInput, vertices: ReadonlyArray<readonly [number, number]>, region: ContourRegionSpec | null): ComparedMesh['weights'] {
  return weighMesh(vertices.map(([x, y]) => [x + pi.ox, y + pi.oy] as [number, number]), pi.segs, pi.r, region === null ? [] : [region]);
}

function latticeOf(pi: PartInput, grid: number, region: ContourRegionSpec): ComparedMesh {
  const lm = latticeMesh(pi.part, alphaAbove(pi.img, ART_ALPHA), grid);
  if ('code' in lm) throw new Error(`${lm.code}: ${lm.detail}`);
  const vertices = lm.vertices.map(([x, y]) => [x, y] as [number, number]);
  return { label: `lattice grid ${grid}`, vertices, triangles: lm.triangles, hull: lm.hull, weights: weighAt(pi, vertices, region) };
}

interface ContourOf extends ComparedMesh {
  enclosedTransparentArea: number;
  overshoot: number;
}

function contourOf(pi: PartInput, region: ContourRegionSpec | null, spacing: number, tolerance = TOLERANCE): ContourOf | string {
  const regions = region === null || region.shape !== 'circle' ? [] : [{ name: region.name, shape: 'circle' as const, cx: region.cx - pi.ox, cy: region.cy - pi.oy, r: region.r, spacing: region.spacing, band: region.band }];
  const cm = contourMesh(pi.part, pi.mask, { threshold: ART_ALPHA, tolerance, margin: MARGIN, spacing, regions });
  if (Array.isArray(cm)) return cm.map((p) => `${p.code}: ${p.detail}`).join('; ');
  return {
    label: region === null ? 'contour, no region' : `contour, region spacing ${region.spacing}`,
    vertices: cm.vertices,
    triangles: cm.triangles,
    hull: cm.hull,
    weights: weighAt(pi, cm.vertices, region),
    enclosedTransparentArea: cm.report.enclosedTransparentArea,
    overshoot: cm.report.overshoot,
  };
}

/**
 * The count-only rule (module header): the finest region spacing whose contour
 * mesh has no more vertices than `budget`, and what each spacing tried gave.
 * A refused spacing is passed over.
 */
export function pickAtBudget<M extends { vertices: unknown[] }>(spacings: readonly number[], budget: number, make: (s: number) => M | string): { mesh: M | null; spacing: number | null; tried: string[] } {
  const tried: string[] = [];
  for (const s of spacings) {
    const m = make(s);
    tried.push(typeof m === 'string' ? `${s}: ${m.slice(0, 120)}` : `${s}: ${m.vertices.length} V`);
    if (typeof m !== 'string' && m.vertices.length <= budget) return { mesh: m, spacing: s, tried };
  }
  return { mesh: null, spacing: null, tried };
}

/** The outline tolerances `--sweep` runs the count-only rule at (issue #110); margin stays {@link MARGIN}, and a tolerance the settled refusals refuse at every spacing is printed as such. */
export const SWEEP_TOLERANCES: readonly number[] = [0, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/**
 * A worst pixel's triangle, for a reader who cannot see the mesh: each corner
 * as outline (an index below `hull`) or interior, its rig px and the region's
 * weight g there; the triangle's smallest angle and longest edge; and the
 * pixel's distance to the outline (contour meshes only: a lattice's hull is
 * not the art's outline) and to the region's edge (negative inside).
 * `at` is the frame's origin in rig px.
 */
export function describeWorst(mesh: ComparedMesh, w: WorstPixel, region: ContourRegionSpec, at: Point, contour: boolean): string {
  if (region.shape !== 'circle') throw new Error('real_compare: circle regions only');
  const v = (i: number): Point => [mesh.vertices[i][0], mesh.vertices[i][1]];
  const corner = (i: number): string => `${i < mesh.hull ? 'outline' : 'interior'} v${i} (${v(i)[0] + at[0]}, ${v(i)[1] + at[1]}) g ${f(regionWeight(v(i), region))}`;
  const ps = w.corners.map(v);
  const longest = Math.max(...[0, 1, 2].map((k) => Math.hypot(ps[k][0] - ps[(k + 1) % 3][0], ps[k][1] - ps[(k + 1) % 3][1])));
  let toOutline = Infinity;
  if (contour) for (let i = 0; i < mesh.hull; i++) toOutline = Math.min(toOutline, segmentDistance(w.pixel, v(i), v((i + 1) % mesh.hull)));
  const toEdge = Math.hypot(w.pixel[0] - region.cx, w.pixel[1] - region.cy) - region.r;
  return `${f(w.error)} at (${w.pixel[0] + at[0]}, ${w.pixel[1] + at[1]}) rig px, g ${f(regionWeight(w.pixel, region))}, ${contour ? `${f(toOutline)} px from the outline, ` : ''}${f(toEdge)} px from the region's edge; triangle ${w.triangle} [${w.corners.map(corner).join('; ')}], smallest angle ${pyRound(w.minAngle, 2)}°, longest edge ${f(longest)} px`;
}

function regionSpec(t: TestRegion, spacing: number): ContourRegionSpec {
  return { name: CONTROL, shape: 'circle', cx: t.cx, cy: t.cy, r: t.r, spacing, band: t.band, bone: CONTROL };
}

/** The region in the padded part frame, for `errors` / `cost`, which read it at the mask's pixel centres. */
function inFrame(pi: PartInput, reg: ContourRegionSpec): ContourRegionSpec {
  if (reg.shape !== 'circle') throw new Error('real_compare: circle regions only');
  return { ...reg, cx: reg.cx - pi.ox, cy: reg.cy - pi.oy };
}

// ---------------------------------------------------------------------------
// the builds
// ---------------------------------------------------------------------------

function run(cmd: string[], log: string): number {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });
  writeFileSync(log, `${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r.status ?? 1;
}

function buildArgs(example: string, config: string, out: string): string[] {
  const inputs = join(ROOT, 'examples', example, 'inputs');
  return ['bun', join(ROOT, 'cli.ts'), 'build', '--config', config, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', out];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** The tracked config's JSON with the control bone, the pose's tracks on it, and (contour) the part's mesh switched. */
export function variantConfig(raw: { [k: string]: Json }, part: string, t: TestRegion, pose: RegionPose | null, contour: { spacing: number; regionSpacing: number } | null): { [k: string]: Json } {
  const c = JSON.parse(JSON.stringify(raw)) as { [k: string]: Json };
  (c.bones as Json[]).push({ name: CONTROL, parent: t.parent, at: [t.cx, t.cy] });
  const motion = c.motion as { [k: string]: Json };
  const period = motion.duration as number;
  if (pose !== null) for (const tr of pose.tracks) (motion.tracks as Json[]).push({ bone: CONTROL, prop: tr.prop, amp: tr.amp, period, phase: POSE_PHASE, ...(tr.base === undefined ? {} : { base: tr.base }) });
  if (contour !== null) {
    const m = (c.meshes as { [k: string]: { [k: string]: Json } })[part];
    const r = m.r;
    const segments = m.segments;
    (c.meshes as { [k: string]: Json })[part] = {
      contour: { tolerance: TOLERANCE, margin: MARGIN, spacing: contour.spacing, regions: [{ name: CONTROL, shape: 'circle', cx: t.cx, cy: t.cy, r: t.r, spacing: contour.regionSpacing, band: t.band, bone: CONTROL }] },
      r,
      segments,
    };
  }
  return c;
}

interface RigWeight {
  bone: string;
  x: number;
  y: number;
  weight: number;
}

/**
 * The lattice variant weighted with the region, as a rig: the contour build's
 * rig.json and motion.json with the part's attachment replaced by the lattice
 * build's, its weights recomputed by the tool. A segment bone's bind offset is
 * the lattice build's own for that vertex; the control's is the vertex's world
 * position less the control's world origin — the control is never turned
 * (module header) — and the contour build's own control entries are held to
 * that formula before it is used.
 */
function latticeWithRegion(pi: PartInput, t: TestRegion, lattice: ComparedMesh, contourRig: string, latticeRig: string, out: string): void {
  type Rig = { skins: { default: { [s: string]: { [a: string]: { uvs: number[]; weights: RigWeight[][]; triangles: number[]; hull: number; width: number; height: number } } } } };
  const crig = JSON.parse(readFileSync(join(contourRig, 'rig.json'), 'utf8')) as Rig & { [k: string]: Json };
  const lrig = JSON.parse(readFileSync(join(latticeRig, 'rig.json'), 'utf8')) as Rig;
  const [W, H] = pi.parts.rig_size;
  const wx = (x: number): number => x - W / 2;
  const wy = (y: number): number => H - y;
  const catt = crig.skins.default[pi.part][pi.part];
  for (let i = 0; i < catt.uvs.length / 2; i++) {
    const vx = catt.uvs[2 * i] * catt.width + pi.ox;
    const vy = catt.uvs[2 * i + 1] * catt.height + pi.oy;
    for (const e of catt.weights[i]) {
      if (e.bone !== CONTROL) continue;
      const want: Point = [wx(vx) - wx(t.cx), wy(vy) - wy(t.cy)];
      // uvs carry 6 decimals of the image size, so the vertex is known to about width·5e-7.
      if (Math.abs(e.x - want[0]) > 1e-3 || Math.abs(e.y - want[1]) > 1e-3) throw new Error(`real_compare: the contour rig's control entry at vertex ${i} is (${e.x}, ${e.y}); the formula gives (${want.join(', ')})`);
    }
  }
  const latt = lrig.skins.default[pi.part][pi.part];
  if (latt.uvs.length !== 2 * lattice.vertices.length) throw new Error('real_compare: the lattice build and the tool disagree on the vertex count');
  const weights: RigWeight[][] = lattice.vertices.map(([x, y], i) => {
    const u = pyRound(x / latt.width, 6);
    if (u !== latt.uvs[2 * i]) throw new Error(`real_compare: lattice vertex ${i} is not the build's`);
    return lattice.weights[i].map((w) => {
      if (w.bone === CONTROL) return { bone: CONTROL, x: pyRound(wx(x + pi.ox) - wx(t.cx), 6), y: pyRound(wy(y + pi.oy) - wy(t.cy), 6), weight: w.weight };
      const old = latt.weights[i].find((e) => e.bone === w.bone);
      if (old === undefined) throw new Error(`real_compare: lattice vertex ${i} has no bind entry for "${w.bone}"`);
      return { bone: w.bone, x: old.x, y: old.y, weight: w.weight };
    });
  });
  crig.skins.default[pi.part][pi.part] = { ...latt, weights };
  mkdirSync(out, { recursive: true });
  cpSync(join(contourRig, 'images'), join(out, 'images'), { recursive: true });
  cpSync(join(contourRig, 'motion.json'), join(out, 'motion.json'));
  writeFileSync(join(out, 'rig.json'), `${JSON.stringify(crig, null, 1)}\n`);
}

interface CheckFigures {
  pass: boolean;
  gate: string;
  seam: string;
  stretch: string;
  lines: string;
}

function checkFigures(path: string): CheckFigures | string {
  if (!existsSync(path)) return `no ${path}`;
  const c = JSON.parse(readFileSync(path, 'utf8')) as { [k: string]: Json };
  const g = (k: string): { [k: string]: Json } => (c[k] ?? {}) as { [k: string]: Json };
  const st = g('TEXTURE_STRETCH');
  const worst = (st.worst ?? {}) as { [k: string]: Json };
  const statusOf = (k: string): string => String(g(k).status ?? '?');
  return {
    pass: c.PASS === true,
    gate: String(c.gate_spine_html_green ?? '?'),
    seam: `${c.seam_mean ?? '?'} / ${c.seam_px_over_40 ?? '?'}`,
    stretch: `${st.severity ?? '?'} (${worst.slot ?? '?'} tri ${worst.triangle ?? '?'} edge ${Array.isArray(worst.edge) ? worst.edge.join('-') : '?'} ratio ${worst.ratio ?? '?'} frame ${worst.frame ?? '?'})`,
    lines: ['BREATH_VISIBLE', 'BLINK_NO_HOLE', 'CHAIN_LAG', 'TIP_OVER_ROOT', 'STILL_REGIONS_DARK', 'TEXTURE_STRETCH'].map((k) => `${k} ${statusOf(k)}`).join(', '),
  };
}

/** The part's worst triangle stretch in one check.json, from its per-mesh rows. */
function partStretch(path: string, part: string): string {
  if (!existsSync(path)) return '?';
  const c = JSON.parse(readFileSync(path, 'utf8')) as { [k: string]: Json };
  const rows = (((c.TEXTURE_STRETCH ?? {}) as { [k: string]: Json }).per_mesh ?? []) as Array<{ [k: string]: Json }>;
  const r = rows.find((x) => x.slot === part);
  return r === undefined ? '?' : `${r.severity} (max ${r.max_ratio} at ${r.max_at}; min ${r.min_ratio} at ${r.min_at})`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const f = (v: number, d = 3): string => v.toFixed(d);

function compare(pi: PartInput, t: TestRegion, raw: { [k: string]: Json }, work: string, builds: boolean, sweep: boolean, masks: ReadonlyArray<readonly [string, PlacedMask]>): void {
  const centre: Point = [t.cx - pi.ox, t.cy - pi.oy];
  const poses = regionPoses(centre, t.r);
  const any = regionSpec(t, 1);
  const lattice = latticeOf(pi, pi.grid, any);
  const background = 2 * pi.grid;
  const pick = pickAtBudget(regionSpacings(pi.grid), lattice.vertices.length, (s) => contourOf(pi, regionSpec(t, s), background));
  const tried = pick.tried;
  const picked = pick.mesh === null || pick.spacing === null ? null : { mesh: pick.mesh, spacing: pick.spacing };
  console.log(`\n## ${pi.example}/${pi.part} — ${pi.box.w}x${pi.box.h} at (${pi.box.x}, ${pi.box.y}); lattice grid ${pi.grid}, r ${pi.r}; segments ${pi.segs.map((s) => s.bone).join(', ')}`);
  console.log(`test region (a test region: a place to measure): circle (${t.cx}, ${t.cy}) rig px, r ${t.r}, band ${t.band}; centre on the art pixel nearest (${t.mid.join(", ")}), the midpoint of chain "${t.chain}"'s last link; control "${CONTROL}" under "${t.parent}"`);
  console.log(`poses: ${poses.map((p) => p.name).join('; ')}`);
  console.log(`the lattice (grid ${pi.grid}): ${lattice.vertices.length} vertices`);
  console.log(`contour region spacings tried (background ${background}, tolerance ${TOLERANCE}, margin ${MARGIN}): ${tried.join('; ')}`);
  if (picked === null) {
    console.log('no contour mesh fits the lattice vertex count: table 1 has no contour row');
    return;
  }
  const region = inFrame(pi, regionSpec(t, picked.spacing));
  const contour = picked.mesh;
  const meshes = [lattice, contour];
  const costs = meshes.map((m) => cost(m, pi.mask, ART_ALPHA, region));
  const errs = meshes.map((m) => poses.map((p) => errors(m, pi.mask, ART_ALPHA, region, p.map)));
  console.log('\n### Table 1 — at the lattice\'s vertex count (px)\n');
  console.log('| mesh | pose | local max | local RMS | transition max | transition RMS | outside max |');
  console.log('|---|---|---|---|---|---|---|');
  meshes.forEach((m, i) => poses.forEach((p, k) => console.log(`| ${m.label} | ${p.name} | ${f(errs[i][k].localMax)} | ${f(errs[i][k].localRms)} | ${f(errs[i][k].transitionMax)} | ${f(errs[i][k].transitionRms)} | ${f(errs[i][k].outsideMax)} |`)));
  console.log('\n| mesh | vertices | triangles | bindings | surround vertices | surround density /1000 px | smallest angle° | uncovered px |');
  console.log('|---|---|---|---|---|---|---|---|');
  meshes.forEach((m, i) => console.log(`| ${m.label} | ${costs[i].vertices} | ${costs[i].triangles} | ${costs[i].bindings} | ${costs[i].surroundVertices} | ${f(costs[i].surroundDensity)} | ${costs[i].minAngle} | ${errs[i][0].uncovered} |`));
  const px = errs[0][0].pixels;
  console.log(`\npixels per class (each mesh, every pose): local ${px.local}, transition ${px.transition}, outside ${px.outside}`);
  const worst = (e: Errors[], k: 'localMax' | 'outsideMax' | 'transitionMax'): number => Math.max(...e.map((x) => x[k]));
  const [lLocal, cLocal] = [worst(errs[0], 'localMax'), worst(errs[1], 'localMax')];
  const [lOut, cOut] = [worst(errs[0], 'outsideMax'), worst(errs[1], 'outsideMax')];
  const rule = [
    [`contour vertices ${costs[1].vertices} <= lattice ${costs[0].vertices}`, costs[1].vertices <= costs[0].vertices],
    [`largest local shape error lower: contour ${f(cLocal)} < lattice ${f(lLocal)}`, cLocal < lLocal],
    [`deformation outside not higher: contour ${f(cOut)} <= lattice ${f(lOut)}`, cOut <= lOut],
    ['part, slot and texture counts unchanged: the build writes one slot and one image per part in both variants (read off rig.json below with --builds)', true],
    [`surround density not raised: contour ${f(costs[1].surroundDensity)} <= lattice ${f(costs[0].surroundDensity)} vertices per 1000 px`, costs[1].surroundDensity <= costs[0].surroundDensity],
  ] as const;
  console.log('\n### §4 rule\n');
  for (const [what, ok] of rule) console.log(`- ${ok ? 'met' : 'NOT met'}: ${what}`);
  console.log(`\nverdict: ${rule.every((r) => r[1]) ? 'ACCEPTED' : 'NOT ACCEPTED'} by §4's rule`);

  console.log(`\n### Table 2 — at matched error: the lattice refined until its largest local shape error reaches the contour's ${f(cLocal)} px\n`);
  console.log('| mesh | largest local max | largest transition max | largest outside max | vertices | triangles | bindings | surround density |');
  console.log('|---|---|---|---|---|---|---|---|');
  console.log(`| ${contour.label} | ${f(cLocal)} | ${f(worst(errs[1], 'transitionMax'))} | ${f(cOut)} | ${costs[1].vertices} | ${costs[1].triangles} | ${costs[1].bindings} | ${f(costs[1].surroundDensity)} |`);
  let matched: string | null = null;
  for (let g = pi.grid; g >= 1; g--) {
    const lm = latticeOf(pi, g, regionSpec(t, picked.spacing));
    const e = poses.map((p) => errors(lm, pi.mask, ART_ALPHA, region, p.map));
    const c = cost(lm, pi.mask, ART_ALPHA, region);
    const lmax = worst(e, 'localMax');
    console.log(`| ${lm.label} | ${f(lmax)} | ${f(worst(e, 'transitionMax'))} | ${f(worst(e, 'outsideMax'))} | ${c.vertices} | ${c.triangles} | ${c.bindings} | ${f(c.surroundDensity)} |`);
    if (lmax <= cLocal) {
      matched = lm.label;
      break;
    }
  }
  console.log(`\nmatched: ${matched ?? `no lattice grid from ${pi.grid} down to 1 reaches it`}`);
  console.log('\n### Where the worst pixels sit (no bar)\n');
  const at: Point = [pi.ox, pi.oy];
  meshes.forEach((m, i) => {
    console.log(`- ${m.label}: smallest angle ${costs[i].minAngle}°`);
    errs[i].forEach((e, k) => {
      console.log(`  - ${poses[k].name}: worst local ${e.worstLocal === null ? 'none' : describeWorst(m, e.worstLocal, region, at, i === 1)}`);
      console.log(`  - ${poses[k].name}: worst transition ${e.worstTransition === null ? 'none' : describeWorst(m, e.worstTransition, region, at, i === 1)}`);
    });
  });
  console.log('\n### The distribution behind the maximum: contour pixels above the lattice\'s largest error of the same class and pose\n');
  poses.forEach((p, k) => {
    const read = pixelErrors(contour, pi.mask, ART_ALPHA, region, p.map);
    for (const cls of ['local', 'transition'] as const) {
      const bar = cls === 'local' ? errs[0][k].localMax : errs[0][k].transitionMax;
      const o = pixelsOver(read, cls, bar);
      console.log(`- ${p.name}, ${cls}: ${o.pixels} of ${o.of} above ${f(bar)} px${o.triangles.length === 0 ? '' : `, in triangle(s) ${o.triangles.map((x) => `${x.triangle} (${x.pixels} px)`).join(', ')}`}`);
    }
  });
  if (sweep) {
    console.log(`\n### The tolerance sweep (issue #110): the count-only rule at each outline tolerance, margin ${MARGIN}, background ${background}; largest errors over the three poses; §4 read as above\n`);
    console.log('| tolerance | region spacing | vertices (hull) | local max | transition max | outside max | enclosed transparent px² | overshoot px | §4 | worst local pixel |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const tol of SWEEP_TOLERANCES) {
      const sp = pickAtBudget(regionSpacings(pi.grid), lattice.vertices.length, (s) => contourOf(pi, regionSpec(t, s), background, tol));
      if (sp.mesh === null || sp.spacing === null) {
        const codes = [...new Set(sp.tried.map((x) => x.slice(x.indexOf(': ') + 2).split(':')[0]))].join(', ');
        console.log(`| ${tol} | none fits (${codes}) | | | | | | | not accepted | |`);
        continue;
      }
      const reg = inFrame(pi, regionSpec(t, sp.spacing));
      const es = poses.map((p) => errors(sp.mesh as ContourOf, pi.mask, ART_ALPHA, reg, p.map));
      const c = cost(sp.mesh, pi.mask, ART_ALPHA, reg);
      const [lm, tm, om] = [worst(es, 'localMax'), worst(es, 'transitionMax'), worst(es, 'outsideMax')];
      const ok = lm < lLocal && om <= lOut && c.surroundDensity <= costs[0].surroundDensity;
      const wp = es.reduce((a, b) => (b.localMax > a.localMax ? b : a)).worstLocal;
      console.log(`| ${tol} | ${sp.spacing} | ${sp.mesh.vertices.length} (${sp.mesh.hull}) | ${f(lm)} | ${f(tm)} | ${f(om)} | ${sp.mesh.enclosedTransparentArea} | ${sp.mesh.overshoot} | ${ok ? 'accepted' : 'not accepted'} | ${wp === null ? 'none' : describeWorst(sp.mesh, wp, reg, at, true)} |`);
    }
  }
  if (!builds) return;

  // ---- the real builds ---------------------------------------------------
  const dir = join(work, `${pi.example}-${pi.part}`);
  mkdirSync(dir, { recursive: true });
  const nb = neighbours(masks, pi.part);
  const P = masks.find(([k]) => k === pi.part)?.[1] as PlacedMask;
  const pairsBy = nb.map((n) => [n, seamPairs(P, masks.find(([k]) => k === n)?.[1] as PlacedMask)] as const).filter(([, ps]) => ps.length > 0);
  console.log(`\n### The real builds — ${pi.example}/${pi.part}\n`);
  console.log(`neighbours drawn against it: ${nb.length} (${nb.join(', ')}); with seam pairs: ${pairsBy.map(([n, ps]) => `${n} ${ps.length}`).join(', ')}`);
  const size = pi.parts.rig_size;
  const peak = (motionDuration: number): number => motionDuration * (POSE_PHASE + 0.25);
  const duration = (raw.motion as { duration: number }).duration;
  const rows: string[] = [];
  const seamRows: string[] = [];
  const support = regionSpec(t, picked.spacing);
  const flat: Array<[string, readonly [number, number, number, number], boolean]> = pairsBy.flatMap(([n, ps]) => ps.map((q) => [n, q, regionWeight([q[0] + 0.5, q[1] + 0.5], support) > 0] as [string, readonly [number, number, number, number], boolean]));
  // What the declared field itself asks of the seam: the largest displacement the field gives a seam pixel of the part,
  // per pose (mesh-free; the neighbours are not weighted to the control, so this is what the region adds to an opening).
  for (const pose of poses) {
    let m = 0;
    for (const [, q] of flat) {
      const p: Point = [q[0] + 0.5 - pi.ox, q[1] + 0.5 - pi.oy];
      const v = fieldAt(p, region, pose.map);
      m = Math.max(m, Math.hypot(v[0] - p[0], v[1] - p[1]));
    }
    console.log(`the field's own largest displacement of a seam pixel, ${pose.name}: ${f(m)} px`);
  }
  for (const [k, pose] of [null, ...poses].entries()) {
    let base: Float64Array[] | null = null;
    const tag = pose === null ? 'still' : ['rotate', 'translate', 'scale'][k - 1];
    const variants: Array<[string, string]> = [];
    const lcfg = join(dir, `lattice-${tag}.json`);
    writeFileSync(lcfg, `${JSON.stringify(variantConfig(raw, pi.part, t, pose, null), null, 1)}\n`);
    const lout = join(dir, `lattice-${tag}`);
    const ls = existsSync(join(lout, 'check', 'check.json')) ? 0 : run(buildArgs(pi.example, lcfg, lout), `${lout}.log`);
    variants.push(['lattice (no region: a lattice config cannot declare one)', lout]);
    const ccfg = join(dir, `contour-${tag}.json`);
    writeFileSync(ccfg, `${JSON.stringify(variantConfig(raw, pi.part, t, pose, { spacing: background, regionSpacing: picked.spacing }), null, 1)}\n`);
    const cout = join(dir, `contour-${tag}`);
    const cs = existsSync(join(cout, 'check', 'check.json')) ? 0 : run(buildArgs(pi.example, ccfg, cout), `${cout}.log`);
    let rs = -1;
    const rout = join(dir, `lattice-region-${tag}`);
    // A build whose `check` fails a bar still wrote its rig and check.json; only a missing rig stops the patched variant.
    if (existsSync(join(lout, 'rig', 'rig.json')) && existsSync(join(cout, 'rig', 'rig.json'))) {
      // Plumbing: the contour build's mesh and weights are the tool's.
      const crig = JSON.parse(readFileSync(join(cout, 'rig', 'rig.json'), 'utf8')) as { skins: { default: { [s: string]: { [a: string]: { uvs: number[]; triangles: number[]; weights: RigWeight[][] } } } } };
      const ca = crig.skins.default[pi.part][pi.part];
      const sameMesh = ca.uvs.length === 2 * contour.vertices.length && ca.triangles.join() === contour.triangles.join() && contour.weights.every((ws, i) => ws.length === ca.weights[i].length && ws.every((w, j) => w.bone === ca.weights[i][j].bone && w.weight === ca.weights[i][j].weight));
      console.log(`${tag}: the contour build's ${pi.part} attachment is the tool's mesh, triangles and weights: ${sameMesh}`);
      if (!sameMesh) throw new Error('real_compare: the contour build is not the mesh table 1 measured');
      latticeWithRegion(pi, t, lattice, join(cout, 'rig'), join(lout, 'rig'), join(rout, 'rig'));
      rs = existsSync(join(rout, 'check', 'check.json')) ? 0 : run(['bun', join(ROOT, 'cli.ts'), 'check', '--rig', join(rout, 'rig'), '--parts', cout, '--out', join(rout, 'check')], `${rout}.log`);
      variants.push(['lattice + region weights (the tool\'s, rig patched, through `check`)', rout]);
    }
    variants.push(['contour + region', cout]);
    console.log(`${tag}: lattice build exit ${ls}; contour build exit ${cs}; lattice + region check exit ${rs} (0 also when already built: the PASS column below is check.json's)`);
    for (const [label, d] of variants) {
      const cf = checkFigures(join(d, 'check', 'check.json'));
      if (typeof cf === 'string') {
        rows.push(`| ${tag} | ${label} | ${cf} | | | | |`);
        continue;
      }
      rows.push(`| ${tag} | ${label} | ${cf.pass} | ${cf.gate} | ${cf.seam} | ${cf.stretch} | ${partStretch(join(d, 'check', 'check.json'), pi.part)} | ${cf.lines} |`);
      const geo = join(d, 'check', 'idle_frames', 'idle', 'geometry.json');
      if (!existsSync(geo)) continue;
      const g = readGeometryFile(geo);
      const frameAt = (time: number): number => g.frames.findIndex((fr) => Math.abs(fr.time - time) < 1e-9);
      const open = g.frames.map((_, fr) => frameOpenings(g, fr, pi.part, pairsBy, size));
      if (base === null) base = open;
      const cell = (frs: number[]): string => {
        let best = { o: -1, fr: -1, i: -1 };
        let add = { o: -Infinity, fr: -1, i: -1 };
        let unread = 0;
        for (const fr of frs) {
          const o = open[fr];
          const l = (base as Float64Array[])[fr];
          for (let i = 0; i < o.length; i++) {
            if (Number.isNaN(o[i])) {
              unread++;
              continue;
            }
            if (o[i] > best.o) best = { o: o[i], fr, i };
            if (!Number.isNaN(l[i]) && o[i] - l[i] > add.o) add = { o: o[i] - l[i], fr, i };
          }
        }
        const where = (i: number): string => `${flat[i][0]} ${flat[i][1].join(',')}${flat[i][2] ? ', in the support' : ''}`;
        const fr = frs.length > 1 ? `, frame ${best.fr}` : '';
        const fra = frs.length > 1 ? `, frame ${add.fr}` : '';
        return `${f(best.o)} (${where(best.i)}${fr}) | ${f(add.o)} (${where(add.i)}${fra})${unread > 0 ? `; unread ${unread}` : ''}`;
      };
      seamRows.push(`| ${tag} | ${label} | ${cell([frameAt(peak(duration))])} | ${cell([frameAt(0)])} | ${cell(g.frames.map((_, i) => i))} |`);
    }
  }
  console.log('\n| idle | variant | PASS | gate green | seam mean / px over 40 | TEXTURE_STRETCH (rig worst) | this part\'s stretch | judgement lines |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
  console.log(`\n### The seam off rigc's posed geometry (rig px): the largest opening over the part's seam pairs, and the largest opening ADDED over the lattice build of the same idle at the same frame (the region's own contribution; 0.000 = none). Seam pairs in the region's support (g > 0): ${flat.filter((x) => x[2]).length} of ${flat.length}\n`);
  console.log(`| idle | variant | at the pose (t = ${peak(duration)} s): largest | added | at the opposite pose (t = 0): largest | added | over the idle: largest | added |`);
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of seamRows) console.log(r);
}

function main(argv: string[]): void {
  const w = argv.indexOf('--work');
  if (w < 0 || argv[w + 1] === undefined) {
    console.log('usage: bun tools/real_compare.ts --work <dir> [--examples <key>,...] [--builds] [--sweep] [--only <example>/<part>]');
    process.exit(2);
  }
  const work = resolve(argv[w + 1]);
  const builds = argv.includes('--builds');
  const sweep = argv.includes('--sweep');
  mkdirSync(work, { recursive: true });
  const fetched = readdirSync(join(ROOT, 'examples'))
    .sort()
    .filter((k) => existsSync(join(ROOT, 'examples', k, 'config.json')) && existsSync(join(ROOT, 'examples', k, 'inputs', 'painting.png')));
  const e = argv.indexOf('--examples');
  const asked = e < 0 ? null : (argv[e + 1] ?? '').split(',').filter((k) => k !== '');
  if (asked !== null) {
    const unknown = asked.filter((k) => !fetched.includes(k));
    if (asked.length === 0 || unknown.length > 0) {
      console.log(`real_compare: --examples ${asked.length === 0 ? 'names no key' : `names ${unknown.map((k) => `"${k}"`).join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not a fetched example`}; the fetched examples are ${fetched.join(', ') || 'none'}`);
      process.exit(2);
    }
  }
  const examples = asked === null ? fetched : fetched.filter((k) => asked.includes(k));
  if (examples.length === 0) {
    console.log('real_compare: no fetched examples/<key>/inputs (bun run fetch-examples); nothing measured');
    process.exit(2);
  }
  const cands: Candidate[] = [];
  const ctx = new Map<string, { cfg: CharacterConfig; raw: { [k: string]: Json }; build: string; masks: Array<readonly [string, PlacedMask]> }>();
  for (const ex of examples) {
    const config = join(ROOT, 'examples', ex, 'config.json');
    const build = join(work, `base-${ex}`);
    if (!existsSync(join(build, 'check', 'check.json'))) {
      const s = run(buildArgs(ex, config, build), `${build}.log`);
      if (s !== 0) throw new Error(`real_compare: the tracked ${ex} build exited ${s}; see ${build}.log`);
    }
    const cfg = loadConfig(config);
    const parts = readParts(join(build, 'parts.json'));
    const masks = parts.parts.map((p) => [p.name, placedMask(p.x, p.y, readPng(join(build, 'parts', `${p.name}.png`)))] as const);
    ctx.set(ex, { cfg, raw: JSON.parse(readFileSync(config, 'utf8')) as { [k: string]: Json }, build, masks });
    console.log(`\n${ex}: mesh parts at tolerance ${TOLERANCE}, margin ${MARGIN}, spacing = grid:`);
    for (const p of parts.parts) {
      const m = cfg.meshes[p.name];
      if (m === undefined || !('grid' in m)) continue;
      const pi = partInput(ex, cfg, build, p.name);
      const cm = contourOf(pi, null, m.grid);
      const nb = neighbours(masks, p.name);
      const kind = kindOf(p.from);
      console.log(`  ${p.name} (${p.from}, ${kind}): ${typeof cm === 'string' ? `refused — ${cm.slice(0, 140)}` : `builds, ${cm.vertices.length} V`}; ${nb.length} neighbours (${nb.join(', ')})`);
      if (typeof cm !== 'string') cands.push({ example: ex, part: p.name, kind, neighbours: nb.length });
    }
  }
  const order = ranked(cands);
  console.log(`\nthe rule's order: ${order.map((c) => `${c.example}/${c.part} (${c.kind}, ${c.neighbours})`).join(', ')}`);
  const picks: Array<{ c: Candidate; t: TestRegion }> = [];
  for (const want of ['first', 'other'] as const) {
    for (const c of order) {
      if (c.kind === 'other') continue;
      if (want === 'other' && (picks.length === 0 || c.kind === picks[0].c.kind)) continue;
      if (picks.some((p) => p.c === c)) continue;
      const e = ctx.get(c.example) as { cfg: CharacterConfig; build: string; masks: Array<readonly [string, PlacedMask]> };
      const pr = readParts(join(e.build, 'parts.json')).parts.find((p) => p.name === c.part) as { w: number; h: number };
      const t = testRegion(e.cfg, c.part, e.masks.find(([k]) => k === c.part)?.[1] as PlacedMask, pr);
      if (typeof t === 'string') {
        console.log(`region rule passes over ${c.example}/${c.part}: ${t}`);
        continue;
      }
      picks.push({ c, t });
      console.log(`picked (${want === 'first' ? 'the rule\'s first' : 'the first of the other kind'}): ${c.example}/${c.part} (${c.kind}, ${c.neighbours} neighbours)`);
      break;
    }
  }
  const only = argv.indexOf('--only');
  for (const { c, t } of picks) {
    if (only >= 0 && argv[only + 1] !== `${c.example}/${c.part}`) continue;
    const e = ctx.get(c.example) as { cfg: CharacterConfig; raw: { [k: string]: Json }; build: string; masks: Array<readonly [string, PlacedMask]> };
    compare(partInput(c.example, e.cfg, e.build, c.part), t, e.raw, work, builds, sweep, e.masks);
  }
}

if (import.meta.main) main(process.argv.slice(2));
