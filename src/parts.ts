/**
 * The output contract of the assemble stage: `parts.json`, one record per
 * part, beside `parts/<name>.png`.
 *
 * It is a MEASUREMENT record as much as a manifest. Each part says where it
 * came from (`from` = `<run>:<tag>`, the See-through run and tag — the only
 * thing downstream stages classify a part by), where it sits in rig pixels
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
 * - `seam_override_px` — pixels whose colour the seam pass replaced.
 *
 * The three visibility counts are this port's, not the reference's: a
 * `parts.json` the reference wrote has none of them and reads as it always
 * did, and a record holds all three or none.
 *
 * `rig_size` is the rig canvas in pixels, `scale_rig_per_source` the rig pixels
 * per source-painting pixel, and `ghost_px` the sub-threshold specks removed
 * from each `<run>:<tag>` layer before anything else.
 *
 * This file is types, a writer and a reader; the assembly that fills it in is
 * a later stage. The writer's key order is fixed, so two runs over the same
 * inputs write the same bytes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Problem, refuseIfAny } from './errors.ts';
import { readTag } from './tags.ts';

export interface PartRecord {
  name: string;
  from: string;
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
}

export interface PartsFile {
  rig_size: [number, number];
  scale_rig_per_source: number;
  parts: PartRecord[];
  ghost_px: Record<string, number>;
}

const TOP_KEYS = ['rig_size', 'scale_rig_per_source', 'parts', 'ghost_px'] as const;
export const PART_KEYS = [
  'name',
  'from',
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
] as const;
const COUNT_KEYS = PART_KEYS.slice(2) as ReadonlyArray<(typeof PART_KEYS)[number]>;
/** The port's own counts: all three or none (none = a record the reference wrote). */
export const VISIBILITY_KEYS = ['visible_px', 'occluded_px', 'visible_not_projected_px'] as const;
const REQUIRED_KEYS = PART_KEYS.filter((k) => !(VISIBILITY_KEYS as readonly string[]).includes(k));

/** `<run>:<tag>` with run `full` or `head` and a v3 tag, or null. */
export function readFrom(from: string): { run: 'full' | 'head'; tag: string } | null {
  const m = /^(full|head):(.+)$/.exec(from);
  if (m === null || readTag(m[2]) === null) return null;
  return { run: m[1] as 'full' | 'head', tag: m[2] };
}

export function serializeParts(file: PartsFile): string {
  const ordered = {
    rig_size: file.rig_size,
    scale_rig_per_source: file.scale_rig_per_source,
    parts: file.parts.map((p) => Object.fromEntries(PART_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))),
    ghost_px: Object.fromEntries(Object.keys(file.ghost_px).sort().map((k) => [k, file.ghost_px[k]])),
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
  for (const k of TOP_KEYS) if (!(k in o)) fail('PARTS_FIELD_PRESENT', `${path} field "${k}"`, 'is absent and required');
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
        if (readFrom(k) === null) fail('PARTS_FROM_KNOWN', `${path} ghost_px key "${k}"`, 'is not "<full|head>:<v3 tag>"');
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
      if (typeof r.from !== 'string' || readFrom(r.from) === null) fail('PARTS_FROM_KNOWN', `${label} field "from"`, `is ${show(r.from)}; "<full|head>:<v3 tag>" is required`);
      for (const k of COUNT_KEYS) {
        if (k in r && !(Number.isInteger(r[k]) && (r[k] as number) >= 0)) fail('PARTS_FIELD_TYPE', `${label} field "${k}"`, `is ${show(r[k])}; a non-negative integer is required`);
      }
      const count = (k: string): number | null => (Number.isInteger(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : null);
      const [op, vis, occ, vnp] = ['opaque_px', 'visible_px', 'occluded_px', 'visible_not_projected_px'].map(count);
      if (held.length === VISIBILITY_KEYS.length && op !== null && vis !== null && occ !== null && vnp !== null) {
        if (vis + occ !== op) fail('PARTS_COUNTS_ADD_UP', `${label}`, `visible_px ${vis} + occluded_px ${occ} = ${vis + occ}; opaque_px ${op} is required`);
        if (vnp > vis) fail('PARTS_COUNTS_ADD_UP', `${label}`, `visible_not_projected_px ${vnp} is above visible_px ${vis}; at most visible_px is required`);
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
  refuseIfAny(problems);
  return raw as PartsFile;
}
