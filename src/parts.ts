/**
 * The output contract of the assemble stage: `parts.json`, one record per
 * part, beside `parts/<name>.png`.
 *
 * It is a MEASUREMENT record as much as a manifest. Each part says where it
 * came from (`from` = `<run>:<tag>`, the See-through run and tag — the only
 * thing downstream stages classify a part by — or `painting:<name>` for an
 * `assemble.patches` entry, cut from the painting itself and named for the
 * part it made, which no tag classifies; a part from a layer the author made
 * is `<run>:author:<label>`, issue #256, which no tag classifies either),
 * where it sits in rig pixels
 * (`x`/`y`/`w`/`h`, y down, origin top-left: the PNG's own box), and what the
 * assembler did to its pixels, counted:
 *
 * - `opaque_px` — pixels with alpha above 8 in the written PNG;
 * - `visible_px` — of those, the ones no later layer of their See-through run
 *   is opaque (alpha >= 250) in front of: what the painting shows of this
 *   layer, and so what projection can reach;
 * - `occluded_px` — the rest of `opaque_px`: art the painting does not show,
 *   so See-through's synthesis by necessity. `visible_px + occluded_px =
 *   opaque_px`;
 * - `projected_core_px` — pixels where this layer was the top-most opaque layer
 *   of its own run, eroded: the candidates for taking the source painting's
 *   pixel instead of See-through's repaint;
 * - `source_px_taken` — of those, the ones that did take it;
 * - `visible_not_projected_px` — visible pixels that did not take it (too thin
 *   for the core, a fringe below alpha 250, refused for drift): synthesis where
 *   the painting was there to be taken. At most `visible_px`;
 * - `refused_drift_px` — of those, the ones refused because See-through's
 *   pixel and the painting's disagreed by more than the drift limit;
 * - `merged_px` — pixels brought in from the other run below the head crop;
 * - `seam_override_px` — pixels whose colour the seam pass replaced;
 * - `fringe_pushed_back` — written only when not empty: the pixels of this
 *   part's fringe (alpha below 250) made transparent because the painting
 *   shows another part there, as `{part, px}` — the part beneath that holds
 *   them at alpha >= 250 and how many (`src/assemble.ts` `pushBackFringe`,
 *   issue #119). They are not in `opaque_px`: the counts above are taken
 *   after it.
 *
 * One field names a part rather than counting pixels: `cut_from`, written only
 * on a piece an `assemble.cuts` entry made (issue #230) — the plan part it was
 * cut from, which shares its `from`. The record is in draw order, and a piece
 * drawn `"back"` comes before its base, so order cannot say which of two parts
 * sharing a layer is the piece; this field does. A `parts.json` written before
 * 1.6.0 has none, and still reads. `limb`, written only on a part a
 * `config.limbs` segment made (issue #349), names the limb, the segment's
 * index (0 the upper), the part it was cut from (`of`), the one bone it rides
 * and, below a joint, the joint and its cap ({@link LimbRecord}).
 *
 * ⭐ **A patch is 100 % source.** Every pixel of a `painting:` part is the
 * painting's own, so it is all visible (the painting shows it; nothing of it
 * is synthesis), all candidates and all taken: `visible_px =
 * projected_core_px = source_px_taken = opaque_px`, and `occluded_px`,
 * `visible_not_projected_px`, `refused_drift_px` and `merged_px` are 0. The
 * reader holds a `painting:` record to exactly that.
 *
 * The three visibility counts are this port's, not the reference's: a
 * `parts.json` the reference wrote has none of them and reads as it always
 * did, and a record holds all three or none.
 *
 * `rig_size` is the rig canvas in pixels, `scale_rig_per_source` the rig pixels
 * per source-painting pixel, and `ghost_px` the sub-threshold specks removed
 * from each `<run>:<tag>` layer before anything else.
 *
 * `recomposite` is the flat stack of every part against the painting (this
 * port's, issue #25; a `parts.json` the reference wrote has none and reads as
 * it did): the four figures the assemble summary prints, the limits they were
 * measured at, and the largest uncovered holes — 8-connected components of the
 * error pixels no part covers, each with its box and the parts bordering it.
 * A hole is a class of defect no gate downstream can see: `check`'s seam
 * compares the setup pose with the flat stack of parts, so a pixel missing
 * from every part is missing from both sides. `check` reports it
 * (`RECOMPOSITE_HOLES`) from this block.
 *
 * This file is types, a writer and a reader; the assembly that fills it in is
 * a later stage. The writer's key order is fixed, so two runs over the same
 * inputs write the same bytes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Problem, refuseIfAny } from './errors.ts';
import { readLayerTag } from './tags.ts';

export interface PartRecord {
  name: string;
  from: string;
  /**
   * Written only on a piece an `assemble.cuts` entry made (issue #230): the
   * name of the plan part it was cut from, which has the same `from`. Absent
   * on every other part, and in a `parts.json` written before 1.6.0.
   */
  cut_from?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opaque_px: number;
  /** Absent in a `parts.json` the reference wrote; `assemble` always writes it. */
  visible_px?: number;
  /** Absent in a `parts.json` the reference wrote; `assemble` always writes it. */
  occluded_px?: number;
  projected_core_px: number;
  source_px_taken: number;
  /** Absent in a `parts.json` the reference wrote; `assemble` always writes it. */
  visible_not_projected_px?: number;
  refused_drift_px: number;
  merged_px: number;
  seam_override_px: number;
  /** Absent when the part had no fringe pushed back (and in a `parts.json` the reference wrote). */
  fringe_pushed_back?: Array<{ part: string; px: number }>;
  /** Written only on a part a `config.limbs` segment made (issue #349). */
  limb?: LimbRecord;
}

/**
 * A limb segment's provenance (issue #349): the limb, the segment's index
 * (0 the upper), the part its pixels were cut from (`of`), the bone it rides
 * with weight 1, and, on a segment below a joint, the joint's name and its cap.
 */
export interface LimbRecord {
  name: string;
  segment: number;
  of: string;
  bone: string;
  joint?: string;
  cap?: CapRecord;
}

/**
 * The cap a lower segment carries past its joint (issue #349): the disc's
 * centre (the joint, rig px), its radius (half the limb's width across the
 * joint line, `width`), the box its image covers `[x, y, w, h]`, and its
 * pixels on the upper side of the joint line counted by where each came from
 * — the layer (`layer_px`), the config's cap image (`image_px`, only with one)
 * — or none (`missing_px`: no pixel in the layer and none in an image).
 */
export interface CapRecord {
  at: [number, number];
  width: number;
  radius: number;
  box: [number, number, number, number];
  layer_px: number;
  image_px?: number;
  /** Issue #359: with `image_px`, the hidden-art layer the cap's image came from (`<run>:<layer>:hidden`), when it came from one rather than the config's cap file. */
  image_layer?: string;
  missing_px: number;
}

const LIMB_KEYS = ['name', 'segment', 'of', 'bone', 'joint', 'cap'] as const;
const CAP_KEYS = ['at', 'width', 'radius', 'box', 'layer_px', 'image_px', 'image_layer', 'missing_px'] as const;

/** The limb record with its keys in the fixed order, so two runs write the same bytes. */
function orderedLimb(l: LimbRecord): Record<string, unknown> {
  const cap = l.cap === undefined ? undefined : Object.fromEntries(CAP_KEYS.filter((k) => (l.cap as CapRecord)[k] !== undefined).map((k) => [k, (l.cap as CapRecord)[k]]));
  return Object.fromEntries(LIMB_KEYS.filter((k) => (k === 'cap' ? cap : l[k]) !== undefined).map((k) => [k, k === 'cap' ? cap : l[k]]));
}

/** One listed hole: its area, its box in rig pixels, and the parts beside it (`src/assemble.ts` `uncoveredHoles`). */
export interface HoleRecord {
  px: number;
  x: number;
  y: number;
  w: number;
  h: number;
  borders: Array<{ part: string; px: number }>;
}

export interface RecompositeRecord {
  mean_abs: number;
  within_limit: number;
  within_share: number;
  error_limit: number;
  error_px: number;
  covered_alpha: number;
  uncovered_error_px: number;
  hole_count: number;
  holes_listed: number;
  holes: HoleRecord[];
}

export interface PartsFile {
  rig_size: [number, number];
  scale_rig_per_source: number;
  parts: PartRecord[];
  ghost_px: Record<string, number>;
  /** Absent in a `parts.json` the reference wrote; `assemble` always writes it. */
  recomposite?: RecompositeRecord;
  /** Written only under `config.scene` (issue #242): the recomposite was read inside this figure; absent otherwise. */
  scene?: SceneRecord;
}

/**
 * `parts.json`'s `scene` block (issue #242): the painting is a scene, so the
 * `recomposite` block beside it was measured inside the figure — the rig pixels
 * where a full-run layer's alpha is above `figure_alpha_above` — and `check`
 * reads `RECOMPOSITE_HOLES` and the seam that way. `figure_px` is the figure's
 * size; `figure_mask` the image `assemble` wrote of it, beside the recomposite.
 */
export interface SceneRecord {
  figure_alpha_above: number;
  figure_px: number;
  figure_mask: string;
}

const TOP_KEYS = ['rig_size', 'scale_rig_per_source', 'parts', 'ghost_px', 'recomposite', 'scene'] as const;
const REQUIRED_TOP_KEYS = TOP_KEYS.filter((k) => k !== 'recomposite' && k !== 'scene');
export const SCENE_KEYS = ['figure_alpha_above', 'figure_px', 'figure_mask'] as const;
export const RECOMPOSITE_KEYS = ['mean_abs', 'within_limit', 'within_share', 'error_limit', 'error_px', 'covered_alpha', 'uncovered_error_px', 'hole_count', 'holes_listed', 'holes'] as const;
const RECOMPOSITE_COUNTS = ['within_limit', 'error_limit', 'error_px', 'covered_alpha', 'uncovered_error_px', 'hole_count', 'holes_listed'] as const;
export const HOLE_KEYS = ['px', 'x', 'y', 'w', 'h', 'borders'] as const;
const BORDER_KEYS = ['part', 'px'] as const;
export const PART_KEYS = [
  'name',
  'from',
  'cut_from',
  'x',
  'y',
  'w',
  'h',
  'opaque_px',
  'visible_px',
  'occluded_px',
  'projected_core_px',
  'source_px_taken',
  'visible_not_projected_px',
  'refused_drift_px',
  'merged_px',
  'seam_override_px',
  'fringe_pushed_back',
  'limb',
] as const;
/** The one part field that is not a count: a list of `{part, px}`, written only when it is not empty. */
const FRINGE_KEY = 'fringe_pushed_back';
/** The one part field that names another part: a cut's piece names its base, written only on a piece. */
const CUT_FROM_KEY = 'cut_from';
/** The one part field that is a record of its own: a limb segment's provenance (issue #349), written only on one. */
const LIMB_KEY = 'limb';
const COUNT_KEYS = PART_KEYS.slice(2).filter((k) => k !== FRINGE_KEY && k !== CUT_FROM_KEY && k !== LIMB_KEY) as ReadonlyArray<(typeof PART_KEYS)[number]>;
/** The port's own counts: all three or none (none = a record the reference wrote). */
export const VISIBILITY_KEYS = ['visible_px', 'occluded_px', 'visible_not_projected_px'] as const;
const REQUIRED_KEYS = PART_KEYS.filter((k) => !(VISIBILITY_KEYS as readonly string[]).includes(k) && k !== FRINGE_KEY && k !== CUT_FROM_KEY && k !== LIMB_KEY);

/** Where a part came from: a See-through run and a v3 tag or an author-made layer's `author:<label>` (issue #256), or the painting itself for a patch. */
export type From = { run: 'full' | 'head'; tag: string } | { run: 'painting'; patch: string };

/** The `from` a patch's record carries. */
export const PAINTING_RUN = 'painting';

/** `<run>:<tag>` with run `full` or `head` and a v3 tag or an `author:<label>` (`full:author:hand`), `painting:<patch name>`, or null. */
export function readFrom(from: string): From | null {
  const p = /^painting:(.+)$/.exec(from);
  if (p !== null) return { run: 'painting', patch: p[1] };
  const m = /^(full|head):(.+)$/.exec(from);
  if (m === null || readLayerTag(m[2]) === null) return null;
  return { run: m[1] as 'full' | 'head', tag: m[2] };
}

/** The tag a part came from — a See-through tag, or an author-made layer's `author:<label>`, which no role reader matches — or null for a `painting:` patch (or a `from` that is neither). */
export function tagOf(from: string): string | null {
  const f = readFrom(from);
  return f === null || f.run === 'painting' ? null : f.tag;
}

export function serializeParts(file: PartsFile): string {
  const ordered = {
    rig_size: file.rig_size,
    scale_rig_per_source: file.scale_rig_per_source,
    parts: file.parts.map((p) =>
      Object.fromEntries(PART_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, k === FRINGE_KEY ? (p.fringe_pushed_back ?? []).map((q) => ({ part: q.part, px: q.px })) : k === LIMB_KEY ? orderedLimb(p.limb as LimbRecord) : p[k]])),
    ),
    ghost_px: Object.fromEntries(Object.keys(file.ghost_px).sort().map((k) => [k, file.ghost_px[k]])),
    ...(file.recomposite === undefined
      ? {}
      : {
          recomposite: {
            ...Object.fromEntries(RECOMPOSITE_KEYS.filter((k) => k !== 'holes').map((k) => [k, (file.recomposite as RecompositeRecord)[k]])),
            holes: file.recomposite.holes.map((h) => ({ ...Object.fromEntries(HOLE_KEYS.filter((k) => k !== 'borders').map((k) => [k, h[k]])), borders: h.borders.map((b) => ({ part: b.part, px: b.px })) })),
          },
        }),
    ...(file.scene === undefined ? {} : { scene: Object.fromEntries(SCENE_KEYS.map((k) => [k, (file.scene as SceneRecord)[k]])) }),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Write `parts.json`. The record is checked first, so nothing unreadable is ever written. */
export function writeParts(path: string, file: PartsFile): void {
  const text = serializeParts(file);
  checkParts(JSON.parse(text), path);
  writeFileSync(path, text);
}

export function readParts(path: string): PartsFile {
  if (!existsSync(path)) refuseIfAny([{ code: 'PARTS_FILE_PRESENT', object: path, detail: 'no such file' }]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    refuseIfAny([{ code: 'PARTS_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` }]);
  }
  return checkParts(raw, path);
}

function show(v: unknown): string {
  return v === undefined ? 'absent' : JSON.stringify(v);
}

function checkParts(raw: unknown, path: string): PartsFile {
  const problems: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('PARTS_FIELD_TYPE', path, `holds ${show(raw)}; an object is required`);
    refuseIfAny(problems);
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(TOP_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${path} key "${k}"`, `is not a parts.json field; known: ${TOP_KEYS.join(', ')}`);
  for (const k of REQUIRED_TOP_KEYS) if (!(k in o)) fail('PARTS_FIELD_PRESENT', `${path} field "${k}"`, 'is absent and required');
  const size = o.rig_size;
  const sizeOk = Array.isArray(size) && size.length === 2 && size.every((n) => Number.isInteger(n) && (n as number) > 0);
  if ('rig_size' in o && !sizeOk) fail('PARTS_FIELD_TYPE', `${path} field "rig_size"`, `is ${show(size)}; [width, height] in positive integers is required`);
  const scale = o.scale_rig_per_source;
  if ('scale_rig_per_source' in o && !(typeof scale === 'number' && Number.isFinite(scale) && scale > 0)) {
    fail('PARTS_FIELD_TYPE', `${path} field "scale_rig_per_source"`, `is ${show(scale)}; a number above 0 is required`);
  }
  if ('ghost_px' in o) {
    const g = o.ghost_px;
    if (typeof g !== 'object' || g === null || Array.isArray(g)) fail('PARTS_FIELD_TYPE', `${path} field "ghost_px"`, `is ${show(g)}; an object of "<run>:<tag>" -> pixels is required`);
    else {
      for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
        if (tagOf(k) === null) fail('PARTS_FROM_KNOWN', `${path} ghost_px key "${k}"`, 'is not "<full|head>:<v3 tag>" or "<full|head>:author:<label>" (a patch has no See-through layer, so no ghost count)');
        if (!(Number.isInteger(v) && (v as number) >= 0)) fail('PARTS_FIELD_TYPE', `${path} ghost_px "${k}"`, `is ${show(v)}; a pixel count is required`);
      }
    }
  }
  if ('parts' in o && !(Array.isArray(o.parts) && o.parts.length > 0)) fail('PARTS_FIELD_TYPE', `${path} field "parts"`, `is ${show(o.parts)}; a non-empty array is required`);
  if (Array.isArray(o.parts)) {
    const seen = new Map<string, number>();
    o.parts.forEach((p, i) => {
      const at = `${path} parts[${i}]`;
      if (typeof p !== 'object' || p === null || Array.isArray(p)) {
        fail('PARTS_FIELD_TYPE', at, `is ${show(p)}; an object is required`);
        return;
      }
      const r = p as Record<string, unknown>;
      const label = typeof r.name === 'string' ? `part "${r.name}"` : at;
      for (const k of Object.keys(r)) if (!(PART_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${label} key "${k}"`, `is not a part field; known: ${PART_KEYS.join(', ')}`);
      for (const k of REQUIRED_KEYS) if (!(k in r)) fail('PARTS_FIELD_PRESENT', `${label} field "${k}"`, 'is absent and required');
      const held = VISIBILITY_KEYS.filter((k) => k in r);
      if (held.length > 0 && held.length < VISIBILITY_KEYS.length) {
        fail('PARTS_FIELD_PRESENT', `${label} fields ${VISIBILITY_KEYS.map((k) => `"${k}"`).join(', ')}`, `only ${held.join(', ')} present; all three (assemble writes them) or none (the reference's record) is required`);
      }
      if (typeof r.name !== 'string' || r.name === '' || /[\\/]/.test(r.name) || r.name.startsWith('.')) {
        fail('PARTS_FIELD_TYPE', `${label} field "name"`, `is ${show(r.name)}; a file-name-safe part name is required`);
      } else if (seen.has(r.name)) fail('PARTS_NAME_UNIQUE', label, `appears at parts[${seen.get(r.name)}] and parts[${i}]`);
      else seen.set(r.name, i);
      const from = typeof r.from === 'string' ? readFrom(r.from) : null;
      if (from === null) fail('PARTS_FROM_KNOWN', `${label} field "from"`, `is ${show(r.from)}; "<full|head>:<v3 tag>", "<full|head>:author:<label>" for a layer the author made, or "painting:<the part's own name>" for a patch, is required`);
      else if (from.run === 'painting' && from.patch !== r.name) {
        fail('PARTS_FROM_KNOWN', `${label} field "from"`, `is ${show(r.from)}; a patch's provenance names the patch itself, so "painting:${String(r.name)}" is required`);
      }
      for (const k of COUNT_KEYS) {
        if (k in r && !(Number.isInteger(r[k]) && (r[k] as number) >= 0)) fail('PARTS_FIELD_TYPE', `${label} field "${k}"`, `is ${show(r[k])}; a non-negative integer is required`);
      }
      const count = (k: string): number | null => (Number.isInteger(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : null);
      const [op, vis, occ, vnp] = ['opaque_px', 'visible_px', 'occluded_px', 'visible_not_projected_px'].map(count);
      if (held.length === VISIBILITY_KEYS.length && op !== null && vis !== null && occ !== null && vnp !== null) {
        if (vis + occ !== op) fail('PARTS_COUNTS_ADD_UP', `${label}`, `visible_px ${vis} + occluded_px ${occ} = ${vis + occ}; opaque_px ${op} is required`);
        if (vnp > vis) fail('PARTS_COUNTS_ADD_UP', `${label}`, `visible_not_projected_px ${vnp} is above visible_px ${vis}; at most visible_px is required`);
      }
      if (from !== null && from.run === 'painting' && op !== null) {
        // A patch is 100 % source: every count is opaque_px or 0 (module doc).
        const whole = ['visible_px', 'projected_core_px', 'source_px_taken'].filter((k) => k in r && count(k) !== op);
        const none = ['occluded_px', 'visible_not_projected_px', 'refused_drift_px', 'merged_px'].filter((k) => k in r && count(k) !== 0);
        if (whole.length > 0 || none.length > 0) {
          const said = [...whole.map((k) => `${k} ${show(r[k])} (opaque_px ${op} required)`), ...none.map((k) => `${k} ${show(r[k])} (0 required)`)].join(', ');
          fail('PARTS_COUNTS_ADD_UP', `${label}`, `is a painting patch (${String(r.from)}), which is 100 % source; ${said}`);
        }
      }
      if (FRINGE_KEY in r) {
        const list = r[FRINGE_KEY];
        const ok =
          Array.isArray(list) &&
          list.length > 0 &&
          list.every((q) => typeof q === 'object' && q !== null && !Array.isArray(q) && Object.keys(q).join(',') === 'part,px' && typeof q.part === 'string' && q.part !== r.name && Number.isInteger(q.px) && q.px > 0);
        if (!ok) fail('PARTS_FIELD_TYPE', `${label} field "${FRINGE_KEY}"`, `is ${show(list)}; a non-empty list of {"part": <another part's name>, "px": <a count above 0>} is required (the field is absent when no fringe was pushed back)`);
      }
      if (sizeOk && [r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n))) {
        const [W, H] = size as [number, number];
        const [x, y, w, h] = [r.x, r.y, r.w, r.h] as number[];
        if (w < 1 || h < 1 || x + w > W || y + h > H) {
          fail('PARTS_BOX_INSIDE_RIG', label, `box ${x},${y} ${w}x${h}; a non-empty box inside the ${W}x${H} rig is required`);
        }
      }
    });
  }
  if (Array.isArray(o.parts)) {
    const named = new Set(o.parts.map((p) => (typeof p === 'object' && p !== null ? (p as Record<string, unknown>).name : undefined)));
    o.parts.forEach((p) => {
      if (typeof p !== 'object' || p === null || !Array.isArray((p as Record<string, unknown>)[FRINGE_KEY])) return;
      const r = p as Record<string, unknown>;
      for (const q of r[FRINGE_KEY] as unknown[]) {
        const held = typeof q === 'object' && q !== null ? (q as Record<string, unknown>).part : undefined;
        if (typeof held === 'string' && !named.has(held)) fail('PARTS_FROM_KNOWN', `part "${String(r.name)}" field "${FRINGE_KEY}"`, `names "${held}", which is no part of this file; the part that holds a pushed-back pixel is one of its parts`);
      }
    });
  }
  if (Array.isArray(o.parts)) {
    // A cut's piece (issue #230) names its base: a part of this file, with the
    // same "<run>:<tag>", that is not itself a piece (a cut of a cut has no
    // single plan part behind it; the config loader refuses one).
    const recs = o.parts.filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && !Array.isArray(p));
    const byName = new Map<unknown, Record<string, unknown>>(recs.map((r) => [r.name, r]));
    for (const r of recs) {
      if (!(CUT_FROM_KEY in r)) continue;
      const object = `part "${String(r.name)}" field "${CUT_FROM_KEY}"`;
      const base = r[CUT_FROM_KEY];
      if (typeof base !== 'string' || base === '') {
        fail('PARTS_FIELD_TYPE', object, `is ${show(base)}; the name of the part the cut took it from is required (the field is absent on a part no cut made)`);
        continue;
      }
      const b = byName.get(base);
      if (b === undefined) fail('PARTS_CUT_FROM_KNOWN', object, `names "${base}", which is no part of this file; the plan part the cut took this piece from is required`);
      else if (base === r.name) fail('PARTS_CUT_FROM_KNOWN', object, `names the piece itself; the plan part the cut took it from is required`);
      else if (CUT_FROM_KEY in b) fail('PARTS_CUT_FROM_KNOWN', object, `names "${base}", which is itself a piece (cut from ${show(b[CUT_FROM_KEY])}); a plan part is required, as a cut of a cut has no single layer behind it`);
      else if (b.from !== r.from) fail('PARTS_CUT_FROM_KNOWN', object, `names "${base}", whose from is ${show(b.from)}; this piece's is ${show(r.from)}, and a piece shares its base's layer`);
    }
  }
  if (Array.isArray(o.parts)) {
    // A limb segment (issue #349) names its limb, its index, the part it was cut from, its bone, and below a joint the joint and its cap.
    for (const p of o.parts) {
      if (typeof p !== 'object' || p === null || Array.isArray(p) || !(LIMB_KEY in p)) continue;
      const r = p as Record<string, unknown>;
      const object = `part "${String(r.name)}" field "${LIMB_KEY}"`;
      const l = r[LIMB_KEY];
      if (typeof l !== 'object' || l === null || Array.isArray(l)) {
        fail('PARTS_FIELD_TYPE', object, `is ${show(l)}; an object {name, segment, of, bone, joint?, cap?} is required`);
        continue;
      }
      const q = l as Record<string, unknown>;
      for (const k of Object.keys(q)) if (!(LIMB_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${object} key "${k}"`, `is not a limb field; known: ${LIMB_KEYS.join(', ')}`);
      for (const k of ['name', 'of', 'bone'] as const) if (!(typeof q[k] === 'string' && q[k] !== '')) fail('PARTS_FIELD_TYPE', `${object} "${k}"`, `is ${show(q[k])}; a non-empty string is required`);
      if (!isCount(q.segment)) fail('PARTS_FIELD_TYPE', `${object} "segment"`, `is ${show(q.segment)}; the segment's index, a non-negative integer, is required`);
      const below = isCount(q.segment) && q.segment > 0;
      if (below !== ('joint' in q) || below !== ('cap' in q)) fail('PARTS_FIELD_PRESENT', object, `segment ${show(q.segment)} with${'joint' in q ? '' : 'out'} a joint and with${'cap' in q ? '' : 'out'} a cap; a segment below a joint (index above 0) has both, the upper segment neither`);
      if ('joint' in q && !(typeof q.joint === 'string' && q.joint !== '')) fail('PARTS_FIELD_TYPE', `${object} "joint"`, `is ${show(q.joint)}; the joint's name is required`);
      if ('cap' in q) {
        const c = q.cap;
        const co = typeof c === 'object' && c !== null && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
        const pt = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
        const ok =
          co !== null &&
          Object.keys(co).every((k) => (CAP_KEYS as readonly string[]).includes(k)) &&
          pt(co.at, 2) &&
          typeof co.width === 'number' &&
          typeof co.radius === 'number' &&
          pt(co.box, 4) &&
          isCount(co.layer_px) &&
          isCount(co.missing_px) &&
          (!('image_px' in co) || isCount(co.image_px)) &&
          (!('image_layer' in co) || ('image_px' in co && typeof co.image_layer === 'string' && co.image_layer !== ''));
        if (!ok) fail('PARTS_FIELD_TYPE', `${object} "cap"`, `is ${show(c)}; {at: [x, y], width, radius, box: [x, y, w, h], layer_px, image_px?, image_layer? (with image_px), missing_px} is required`);
      }
    }
  }
  if ('scene' in o) {
    const sc = o.scene;
    if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) fail('PARTS_FIELD_TYPE', `${path} field "scene"`, `is ${show(sc)}; an object is required`);
    else {
      const r = sc as Record<string, unknown>;
      for (const k of Object.keys(r)) if (!(SCENE_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${path} scene key "${k}"`, `is not a scene field; known: ${SCENE_KEYS.join(', ')}`);
      for (const k of SCENE_KEYS) if (!(k in r)) fail('PARTS_FIELD_PRESENT', `${path} scene field "${k}"`, 'is absent and required');
      for (const k of ['figure_alpha_above', 'figure_px'] as const) if (k in r && !(Number.isInteger(r[k]) && (r[k] as number) >= 0)) fail('PARTS_FIELD_TYPE', `${path} scene field "${k}"`, `is ${show(r[k])}; a non-negative integer is required`);
      if ('figure_mask' in r && !(typeof r.figure_mask === 'string' && r.figure_mask !== '')) fail('PARTS_FIELD_TYPE', `${path} scene field "figure_mask"`, `is ${show(r.figure_mask)}; the mask's file name is required`);
      if (!('recomposite' in o)) fail('PARTS_FIELD_PRESENT', `${path} field "recomposite"`, 'is absent; a scene block says how the recomposite block beside it was measured, so it is required with one');
    }
  }
  if ('recomposite' in o && sizeOk) {
    const names = Array.isArray(o.parts) ? new Set(o.parts.map((p) => (typeof p === 'object' && p !== null ? (p as Record<string, unknown>).name : undefined)).filter((n): n is string => typeof n === 'string')) : new Set<string>();
    checkRecomposite(o.recomposite, path, size as [number, number], names, fail);
  }
  refuseIfAny(problems);
  return raw as PartsFile;
}

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * The `recomposite` block: every key known and present, every figure its
 * type, and the counts consistent with one another — the listed holes are the
 * largest `holes_listed` of `hole_count` (so there are `min` of the two),
 * largest first, their areas sum to at most `uncovered_error_px` (to exactly
 * it when every hole is listed), each area fits its box, each box is inside
 * the rig, and each bordering part is a part of this file.
 */
function checkRecomposite(r: unknown, path: string, [W, H]: [number, number], names: ReadonlySet<string>, fail: (code: string, object: string, detail: string) => void): void {
  const at = `${path} field "recomposite"`;
  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    fail('PARTS_FIELD_TYPE', at, `is ${show(r)}; an object is required`);
    return;
  }
  const b = r as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!(RECOMPOSITE_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${at} key "${k}"`, `is not a recomposite field; known: ${RECOMPOSITE_KEYS.join(', ')}`);
  for (const k of RECOMPOSITE_KEYS) if (!(k in b)) fail('PARTS_FIELD_PRESENT', `${at} field "${k}"`, 'is absent and required');
  for (const k of RECOMPOSITE_COUNTS) if (k in b && !isCount(b[k])) fail('PARTS_FIELD_TYPE', `${at} field "${k}"`, `is ${show(b[k])}; a non-negative integer is required`);
  if ('mean_abs' in b && !(typeof b.mean_abs === 'number' && b.mean_abs >= 0 && b.mean_abs <= 255)) fail('PARTS_FIELD_TYPE', `${at} field "mean_abs"`, `is ${show(b.mean_abs)}; a number from 0 to 255 is required`);
  if ('within_share' in b && !(typeof b.within_share === 'number' && b.within_share >= 0 && b.within_share <= 1)) fail('PARTS_FIELD_TYPE', `${at} field "within_share"`, `is ${show(b.within_share)}; a number from 0 to 1 is required`);
  const [err, unc, count, listed] = [b.error_px, b.uncovered_error_px, b.hole_count, b.holes_listed].map((v) => (isCount(v) ? v : null));
  if (err !== null && err > W * H) fail('PARTS_COUNTS_ADD_UP', at, `error_px ${err} is above the ${W}x${H} rig's ${W * H} pixels`);
  if (err !== null && unc !== null && unc > err) fail('PARTS_COUNTS_ADD_UP', at, `uncovered_error_px ${unc} is above error_px ${err}; at most error_px is required`);
  if (unc !== null && count !== null && (count > unc || (count === 0) !== (unc === 0))) {
    fail('PARTS_COUNTS_ADD_UP', at, `hole_count ${count} with uncovered_error_px ${unc}; at least one pixel per hole, and no hole exactly when no uncovered pixel, is required`);
  }
  if (!('holes' in b)) return;
  if (!Array.isArray(b.holes)) {
    fail('PARTS_FIELD_TYPE', `${at} field "holes"`, `is ${show(b.holes)}; an array is required`);
    return;
  }
  if (count !== null && listed !== null && b.holes.length !== Math.min(count, listed)) {
    fail('PARTS_COUNTS_ADD_UP', `${at} field "holes"`, `lists ${b.holes.length} hole(s); the largest min(hole_count ${count}, holes_listed ${listed}) = ${Math.min(count, listed)} is required`);
  }
  let sum = 0;
  let prev: number | null = null;
  b.holes.forEach((h, i) => {
    const hat = `${at} holes[${i}]`;
    if (typeof h !== 'object' || h === null || Array.isArray(h)) {
      fail('PARTS_FIELD_TYPE', hat, `is ${show(h)}; an object is required`);
      return;
    }
    const o = h as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!(HOLE_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${hat} key "${k}"`, `is not a hole field; known: ${HOLE_KEYS.join(', ')}`);
    for (const k of HOLE_KEYS) if (!(k in o)) fail('PARTS_FIELD_PRESENT', `${hat} field "${k}"`, 'is absent and required');
    for (const k of ['px', 'x', 'y', 'w', 'h'] as const) if (k in o && !isCount(o[k])) fail('PARTS_FIELD_TYPE', `${hat} field "${k}"`, `is ${show(o[k])}; a non-negative integer is required`);
    const [px, x, y, w, hh] = [o.px, o.x, o.y, o.w, o.h].map((v) => (isCount(v) ? v : null));
    if (px !== null) {
      sum += px;
      if (px < 1) fail('PARTS_COUNTS_ADD_UP', hat, 'px 0; a hole has at least one pixel');
      if (prev !== null && px > prev) fail('PARTS_HOLES_LARGEST_FIRST', hat, `px ${px} is above holes[${i - 1}]'s ${prev}; the holes are listed largest first`);
      prev = px;
    }
    if (x !== null && y !== null && w !== null && hh !== null) {
      if (w < 1 || hh < 1 || x + w > W || y + hh > H) fail('PARTS_BOX_INSIDE_RIG', hat, `box ${x},${y} ${w}x${hh}; a non-empty box inside the ${W}x${H} rig is required`);
      else if (px !== null && px > w * hh) fail('PARTS_COUNTS_ADD_UP', hat, `px ${px} is above its ${w}x${hh} box's ${w * hh} pixels`);
    }
    if (!('borders' in o)) return;
    if (!Array.isArray(o.borders)) {
      fail('PARTS_FIELD_TYPE', `${hat} field "borders"`, `is ${show(o.borders)}; an array of {part, px} is required`);
      return;
    }
    o.borders.forEach((bd, j) => {
      const bat = `${hat} borders[${j}]`;
      if (typeof bd !== 'object' || bd === null || Array.isArray(bd)) {
        fail('PARTS_FIELD_TYPE', bat, `is ${show(bd)}; an object {part, px} is required`);
        return;
      }
      const q = bd as Record<string, unknown>;
      for (const k of Object.keys(q)) if (!(BORDER_KEYS as readonly string[]).includes(k)) fail('PARTS_KEY_KNOWN', `${bat} key "${k}"`, `is not a border field; known: ${BORDER_KEYS.join(', ')}`);
      for (const k of BORDER_KEYS) if (!(k in q)) fail('PARTS_FIELD_PRESENT', `${bat} field "${k}"`, 'is absent and required');
      if ('px' in q && !(isCount(q.px) && q.px >= 1)) fail('PARTS_FIELD_TYPE', `${bat} field "px"`, `is ${show(q.px)}; a pixel count of at least 1 is required`);
      if ('part' in q && !(typeof q.part === 'string' && names.has(q.part))) fail('PARTS_HOLE_PART_KNOWN', `${bat} field "part"`, `is ${show(q.part)}; a part this file lists is required`);
    });
  });
  if (unc !== null && sum > unc) fail('PARTS_COUNTS_ADD_UP', `${at} field "holes"`, `the listed holes hold ${sum} px, above uncovered_error_px ${unc}`);
  if (unc !== null && count !== null && b.holes.length === count && sum !== unc && sum <= unc) {
    fail('PARTS_COUNTS_ADD_UP', `${at} field "holes"`, `every one of the ${count} hole(s) is listed and they hold ${sum} px; uncovered_error_px ${unc} is required`);
  }
}
