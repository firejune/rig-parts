/**
 * The character config: everything character-specific the CPU stages read,
 * plus the optional blocks for the two GPU stages.
 *
 * One file per character. Only what the CPU stages need is required —
 * `key`, `assemble`, `bones`, `meshes`, `regions`, `motion`. `generation` is
 * read only by the optional image-generation adapter and `seethrough` only by
 * the optional See-through driver; a character whose painting and layers came
 * from anywhere else leaves both out.
 *
 * 🔒 **Every key is known or refused.** An unknown key is refused by name and
 * so is a missing one — a config that half-loads is a rig nobody can reason
 * about. The one open door is annotation: `note`, and any key ending in
 * `_note`, may hold a string anywhere an object is expected, and nothing reads
 * it. Annotations are how a hand correction records its reason beside the value
 * it corrected, and refusing them would push that reason out of the file.
 *
 * ⛔ **The generation block is inline.** Configs written for the private
 * reference pointed at a character file and an art-job id elsewhere
 * (`generation.character_file`, `generation.art_job`) and overrode parts of it
 * (`identity_override`, `lora_strength`). None of that resolves outside the
 * tree it was written in, so each of those keys is refused with a message that
 * names what replaces it, rather than as a bare unknown.
 *
 * Coordinates in `bones`, `meshes` and `motion` are RIG pixels, y down, origin
 * top-left — the parts' own space. The y flip to Spine happens once, in
 * `spine-rigc/src/transform.ts` (see `src/coords.ts`), when the rig is built.
 */
import { existsSync, readFileSync } from 'node:fs';
import { type Problem, refuseIfAny } from './errors.ts';
import { acceptedTagNames, readTag } from './tags.ts';

export type Point = [number, number];

export interface Lora {
  name: string;
  strength: number;
  strength_clip?: number;
}

export interface Sampler {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export interface Control {
  skeleton: 'stand_sides' | 'stand_clasp';
  strength: number;
  end_percent: number;
  model?: string;
}

export interface Generation {
  checkpoint: string;
  loras: Lora[];
  trigger: string;
  identity: string;
  sampler: Sampler;
  costume: string;
  negative_extra: string;
  pose?: string;
  style: string;
  negative_pose: string;
  latent: [number, number];
  seed: number;
  control?: Control;
}

export interface SeeThrough {
  /** Square crop `[x0, y0, x1, y1]` in source pixels for the second, head-only run. */
  head_box?: [number, number, number, number];
  resolution: number;
  steps: number;
  seed: number;
  offload: boolean;
}

export type Run = 'full' | 'head';

/** One part: its name, which run it comes from, and the See-through tag it is. Order = draw order, back to front. */
export type PlanEntry = [string, Run, string];

export interface Extend {
  part: string;
  run: Run;
  tag: string;
}

export interface Assemble {
  /** Rig pixels per source pixel. */
  rig_scale: number;
  plan: PlanEntry[];
  extend_below_crop?: Extend[];
}

export interface SingleBone {
  name: string;
  parent: string;
  at: Point;
  tip?: Point;
}

export interface ChainBones {
  /** The links are named `<chain>0`, `<chain>1`, … in `points` order. */
  chain: string;
  parent: string;
  points: Point[];
  tip: Point;
}

export type BoneEntry = SingleBone | ChainBones;

/** A chain name, a bone name, or an explicit segment `[bone, from, to]`. */
export type Segment = string | [string, Point, Point];

export interface MeshSpec {
  grid: number;
  r: number;
  segments: Segment[];
}

export interface SingleTrack {
  bone: string;
  prop: SingleProp;
  amp: number;
  period: number;
  phase: number;
  base?: number;
}

export interface ChainTrack {
  chain: string;
  amps: number[];
  period: number;
  phase: number;
  lag: number;
}

export type Track = SingleTrack | ChainTrack;

export interface Blink {
  t: number;
  eyes: string[];
  brows: string[];
  squash: number;
  brow_drop: number;
}

export interface Motion {
  duration: number;
  tracks: Track[];
  blink?: Blink;
}

export interface CharacterConfig {
  key: string;
  note?: string;
  generation?: Generation;
  seethrough?: SeeThrough;
  assemble: Assemble;
  bones: BoneEntry[];
  meshes: Record<string, MeshSpec>;
  regions: Record<string, string>;
  motion: Motion;
}

/** The single-value bone properties a sine track may drive — rigc's one-channel bone timelines. */
export const SINGLE_PROPS = ['rotate', 'translatex', 'translatey', 'scalex', 'scaley', 'shearx', 'sheary'] as const;
export type SingleProp = (typeof SINGLE_PROPS)[number];

/** The bone every rig has and no config declares. */
export const ROOT_BONE = 'root';

/** Keys from the private reference era, each with what replaces it. */
const RETIRED: Record<string, Record<string, string>> = {
  generation: {
    character_file:
      'pointed at a character file outside this tree; write its values inline instead — generation.checkpoint, generation.loras, generation.trigger, generation.identity and generation.sampler',
    art_job: 'named a job record outside this tree; put the costume words themselves in generation.costume and where they came from in generation.costume_note',
    identity_override: 'overrode the character file\'s identity; with the values inline, write the identity you want in generation.identity',
    lora_strength: 'overrode every LoRA\'s strength; with the values inline, set generation.loras[i].strength on each',
    seed0: 'recorded where a seed search started; the chosen seed is generation.seed, and the search belongs in generation.seed_note',
    seeds_tried: 'recorded the seeds a search tried; the chosen seed is generation.seed, and the search belongs in generation.seed_note',
  },
};

// ---------------------------------------------------------------------------
// the checker
// ---------------------------------------------------------------------------

type Json = unknown;

class Check {
  readonly problems: Problem[] = [];

  fail(code: string, object: string, detail: string): void {
    this.problems.push({ code, object, detail });
  }

  /** An object with exactly these keys (plus annotations); returns it, or null after refusing. */
  object(path: string, v: Json, required: readonly string[], optional: readonly string[]): Record<string, Json> | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; an object is required`);
      return null;
    }
    const o = v as Record<string, Json>;
    const section = path.replace(/^config\.?/, '');
    for (const key of Object.keys(o)) {
      if (required.includes(key) || optional.includes(key)) continue;
      if (key === 'note' || key.endsWith('_note')) {
        if (typeof o[key] !== 'string') this.fail('CONFIG_FIELD_TYPE', `${path}.${key}`, `is ${show(o[key])}; an annotation is a string`);
        continue;
      }
      const retired = RETIRED[section]?.[key];
      if (retired !== undefined) this.fail('CONFIG_KEY_RETIRED', `${path}.${key}`, retired);
      else this.fail('CONFIG_KEY_KNOWN', `${path}.${key}`, `is not a field here; known: ${[...required, ...optional].join(', ')}`);
    }
    for (const key of required) if (!(key in o)) this.fail('CONFIG_FIELD_PRESENT', `${path}.${key}`, 'is absent and required');
    return o;
  }

  string(path: string, v: Json, nonEmpty = true): v is string {
    if (typeof v === 'string' && (!nonEmpty || v !== '')) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; ${nonEmpty ? 'a non-empty string' : 'a string'} is required`);
    return false;
  }

  number(path: string, v: Json, rule: 'any' | 'positive' | 'non-negative' | 'unit' = 'any'): v is number {
    const ok =
      typeof v === 'number' &&
      Number.isFinite(v) &&
      (rule === 'any' || (rule === 'positive' ? v > 0 : rule === 'non-negative' ? v >= 0 : v >= 0 && v <= 1));
    if (!ok) {
      const need = { any: 'a finite number', positive: 'a number above 0', 'non-negative': 'a number at or above 0', unit: 'a number in [0, 1]' }[rule];
      this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; ${need} is required`);
    }
    return ok;
  }

  int(path: string, v: Json, min: number): v is number {
    if (typeof v === 'number' && Number.isInteger(v) && v >= min) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; an integer at or above ${min} is required`);
    return false;
  }

  point(path: string, v: Json): v is Point {
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; a point [x, y] in rig pixels is required`);
    return false;
  }

  array(path: string, v: Json, nonEmpty: boolean): v is Json[] {
    if (Array.isArray(v) && (!nonEmpty || v.length > 0)) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; ${nonEmpty ? 'a non-empty array' : 'an array'} is required`);
    return false;
  }
}

function show(v: Json): string {
  if (v === undefined) return 'absent';
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/** A part name becomes a file name (`parts/<name>.png`) and a Spine slot name, so it may not be a path. */
function partNameOk(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !/[\\/]/.test(name);
}

// ---------------------------------------------------------------------------
// the loader
// ---------------------------------------------------------------------------

/** The file as parsed JSON, or a refusal naming why not. Both loaders read through it. */
function readConfigFile(path: string): Json {
  if (!existsSync(path)) refuseIfAny([{ code: 'CONFIG_FILE_PRESENT', object: path, detail: 'no such file' }]);
  let raw: Json;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    refuseIfAny([{ code: 'CONFIG_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` }]);
  }
  return raw;
}

export function loadConfig(path: string): CharacterConfig {
  return parseConfig(readConfigFile(path));
}

// ---------------------------------------------------------------------------
// the early loader — before the rig exists
// ---------------------------------------------------------------------------

/**
 * Which step is reading the config before the rig exists, and so which fields
 * that step requires. The requirement is the caller's to name because it is a
 * fact about the step, not about the file: the same config legitimately lacks
 * `seethrough` when the painting is generated and must carry it when the
 * See-through images are cut.
 *
 * - `paint` — `comfy paint`, the first step of all: `key` and `generation`.
 *   Nothing else exists yet, and nothing else is read.
 * - `layers` — `inputs` and `assemble --propose-plan`: `key`, `seethrough`
 *   (`head_box` absent until `propose --head-box` has run) and
 *   `assemble.rig_scale`; `generation` is checked when present, because that
 *   block is complete before any image exists.
 */
export type EarlyDoor = 'paint' | 'layers';

/** What `comfy paint` reads: the key its files are named for and the generation block it paints from. */
export interface PaintConfig {
  key: string;
  generation: Generation;
}

/**
 * What a character's config holds before its layers exist: a key, the
 * See-through block and the rig scale. `inputs` and `assemble --propose-plan`
 * run at that point, and the full loader would refuse the config for the plan,
 * bones, meshes, regions and motion that are written only after them.
 */
export interface EarlyConfig {
  key: string;
  seethrough: SeeThrough;
  assemble: { rig_scale: number };
}

/** The top-level keys each door requires; every other known section may be present. */
const EARLY_REQUIRED: Record<EarlyDoor, readonly string[]> = {
  paint: ['key', 'generation'],
  layers: ['key', 'seethrough', 'assemble'],
};
const TOP_KEYS = ['key', 'generation', 'seethrough', 'assemble', 'bones', 'meshes', 'regions', 'motion'] as const;

/**
 * The one partial entry point. It validates exactly what its door requires —
 * with the full loader's own rules for each — plus `generation` whenever it is
 * present. The sections a later step writes may be present and are NOT read or
 * vouched for (for `paint` that is everything but `key` and `generation`; for
 * `layers`, `assemble.plan`, `extend_below_crop`, `bones`, `meshes`, `regions`
 * and `motion`); a caller that needs them uses {@link parseConfig}. Every other
 * key is still refused by name, and a retired one (`generation.character_file`
 * and its kin) still with what replaces it: a config is not allowed to be
 * half-known at any stage.
 */
export function parseEarlyConfig(raw: Json, door: 'paint'): PaintConfig;
export function parseEarlyConfig(raw: Json, door: 'layers'): EarlyConfig;
export function parseEarlyConfig(raw: Json, door: EarlyDoor): PaintConfig | EarlyConfig {
  const c = new Check();
  // `generation` is taken out of the generic presence check so its absence can
  // say what the block has to hold, rather than only that it is missing.
  const required = EARLY_REQUIRED[door].filter((k) => k !== 'generation');
  const top = c.object('config', raw, required, TOP_KEYS.filter((k) => !required.includes(k)));
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('key' in t) c.string('config.key', t.key);
  if ('generation' in t) checkGeneration(c, t.generation);
  else if (EARLY_REQUIRED[door].includes('generation')) {
    c.fail(
      'CONFIG_FIELD_PRESENT',
      'config.generation',
      `is absent and required; comfy paint generates from it and nothing else — ${GENERATION_REQUIRED.join(', ')}, and pose or control`,
    );
  }
  if (door === 'layers') {
    if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
    if ('assemble' in t) {
      const a = c.object('config.assemble', t.assemble, ['rig_scale'], ['plan', 'extend_below_crop']);
      if (a !== null && 'rig_scale' in a) c.number('config.assemble.rig_scale', a.rig_scale, 'positive');
    }
  }
  refuseIfAny(c.problems);
  return door === 'paint' ? (raw as PaintConfig) : (raw as EarlyConfig);
}

export function loadEarlyConfig(path: string, door: 'paint'): PaintConfig;
export function loadEarlyConfig(path: string, door: 'layers'): EarlyConfig;
export function loadEarlyConfig(path: string, door: EarlyDoor): PaintConfig | EarlyConfig {
  const raw = readConfigFile(path);
  return door === 'paint' ? parseEarlyConfig(raw, 'paint') : parseEarlyConfig(raw, 'layers');
}

/** Validate a parsed config. Every problem found is thrown at once, as one `PartsError`. */
export function parseConfig(raw: Json): CharacterConfig {
  const c = new Check();
  const top = c.object('config', raw, ['key', 'assemble', 'bones', 'meshes', 'regions', 'motion'], ['generation', 'seethrough']);
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('key' in t) c.string('config.key', t.key);
  if ('generation' in t) checkGeneration(c, t.generation);
  if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
  const parts = 'assemble' in t ? checkAssemble(c, t.assemble) : [];
  const names = 'bones' in t ? checkBones(c, t.bones) : { bones: new Set<string>([ROOT_BONE]), chains: new Map<string, number>() };
  if ('meshes' in t) checkMeshes(c, t.meshes, names.bones, names.chains);
  if ('regions' in t) checkRegions(c, t.regions, names.bones);
  if ('meshes' in t && 'regions' in t && 'assemble' in t) checkCoverage(c, parts, t.meshes, t.regions);
  if ('motion' in t) checkMotion(c, t.motion, names.bones, names.chains);
  refuseIfAny(c.problems);
  return raw as CharacterConfig;
}

/** The fields every generation block carries; `pose` or `control` is required besides, checked below. */
const GENERATION_REQUIRED = ['checkpoint', 'loras', 'trigger', 'identity', 'sampler', 'costume', 'negative_extra', 'style', 'negative_pose', 'latent', 'seed'] as const;

function checkGeneration(c: Check, v: Json): void {
  const g = c.object('config.generation', v, GENERATION_REQUIRED, ['pose', 'control']);
  if (g === null) return;
  const p = 'config.generation';
  for (const key of ['checkpoint', 'identity', 'costume', 'style', 'negative_pose'] as const) if (key in g) c.string(`${p}.${key}`, g[key]);
  for (const key of ['trigger', 'negative_extra'] as const) if (key in g) c.string(`${p}.${key}`, g[key], false);
  if ('pose' in g) c.string(`${p}.pose`, g.pose);
  if ('seed' in g) c.int(`${p}.seed`, g.seed, 0);
  if ('latent' in g) {
    const l = g.latent;
    if (!(Array.isArray(l) && l.length === 2 && l.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0))) {
      c.fail('CONFIG_FIELD_TYPE', `${p}.latent`, `is ${show(l)}; [width, height] in positive integers is required`);
    }
  }
  if ('loras' in g && c.array(`${p}.loras`, g.loras, false)) {
    (g.loras as Json[]).forEach((lo, i) => {
      const o = c.object(`${p}.loras[${i}]`, lo, ['name', 'strength'], ['strength_clip']);
      if (o === null) return;
      if ('name' in o) c.string(`${p}.loras[${i}].name`, o.name);
      if ('strength' in o) c.number(`${p}.loras[${i}].strength`, o.strength);
      if ('strength_clip' in o) c.number(`${p}.loras[${i}].strength_clip`, o.strength_clip);
    });
  }
  if ('sampler' in g) {
    const s = c.object(`${p}.sampler`, g.sampler, ['steps', 'cfg', 'sampler', 'scheduler'], []);
    if (s !== null) {
      if ('steps' in s) c.int(`${p}.sampler.steps`, s.steps, 1);
      if ('cfg' in s) c.number(`${p}.sampler.cfg`, s.cfg, 'positive');
      if ('sampler' in s) c.string(`${p}.sampler.sampler`, s.sampler);
      if ('scheduler' in s) c.string(`${p}.sampler.scheduler`, s.scheduler);
    }
  }
  if ('control' in g) {
    const k = c.object(`${p}.control`, g.control, ['skeleton', 'strength', 'end_percent'], ['model']);
    if (k !== null) {
      if ('skeleton' in k && k.skeleton !== 'stand_sides' && k.skeleton !== 'stand_clasp') {
        c.fail('CONFIG_FIELD_TYPE', `${p}.control.skeleton`, `is ${show(k.skeleton)}; "stand_sides" or "stand_clasp" is required`);
      }
      if ('strength' in k) c.number(`${p}.control.strength`, k.strength, 'non-negative');
      if ('end_percent' in k) c.number(`${p}.control.end_percent`, k.end_percent, 'unit');
      if ('model' in k) c.string(`${p}.control.model`, k.model);
    }
  }
  if (!('pose' in g) && !('control' in g)) {
    c.fail('CONFIG_FIELD_PRESENT', `${p}.pose`, 'is absent and so is generation.control; the pose words come from one of them, and neither is guessed');
  }
}

function checkSeeThrough(c: Check, v: Json): void {
  const s = c.object('config.seethrough', v, ['resolution', 'steps', 'seed', 'offload'], ['head_box']);
  if (s === null) return;
  const p = 'config.seethrough';
  if ('resolution' in s) c.int(`${p}.resolution`, s.resolution, 1);
  if ('steps' in s) c.int(`${p}.steps`, s.steps, 1);
  if ('seed' in s) c.int(`${p}.seed`, s.seed, 0);
  if ('offload' in s && typeof s.offload !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${p}.offload`, `is ${show(s.offload)}; true or false is required`);
  if ('head_box' in s) {
    const b = s.head_box;
    const ints = Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isInteger(n));
    if (!ints) c.fail('CONFIG_FIELD_TYPE', `${p}.head_box`, `is ${show(b)}; [x0, y0, x1, y1] in integer source pixels is required`);
    else {
      const [x0, y0, x1, y1] = b as number[];
      if (!(x1 > x0 && y1 > y0 && x1 - x0 === y1 - y0)) {
        c.fail('CONFIG_HEAD_BOX_SQUARE', `${p}.head_box`, `is ${x1 - x0}x${y1 - y0}; a non-empty square is required (the head run is fed a square crop)`);
      }
    }
  }
}

function checkRunTag(c: Check, path: string, run: Json, tag: Json): void {
  if (run !== 'full' && run !== 'head') c.fail('CONFIG_FIELD_TYPE', `${path} run`, `is ${show(run)}; "full" or "head" is required`);
  if (typeof tag !== 'string' || readTag(tag) === null) {
    c.fail('CONFIG_TAG_KNOWN', `${path} tag`, `is ${show(tag)}; a See-through v3 tag is required — one of ${acceptedTagNames().join(', ')}`);
  }
}

/** Returns the plan's part names, in plan order. */
function checkAssemble(c: Check, v: Json): string[] {
  const a = c.object('config.assemble', v, ['rig_scale', 'plan'], ['extend_below_crop']);
  if (a === null) return [];
  const p = 'config.assemble';
  if ('rig_scale' in a) c.number(`${p}.rig_scale`, a.rig_scale, 'positive');
  const parts: string[] = [];
  if ('plan' in a && c.array(`${p}.plan`, a.plan, true)) {
    const seenPart = new Map<string, number>();
    const seenSource = new Map<string, number>();
    (a.plan as Json[]).forEach((entry, i) => {
      const at = `${p}.plan[${i}]`;
      if (!(Array.isArray(entry) && entry.length === 3 && typeof entry[0] === 'string')) {
        c.fail('CONFIG_FIELD_TYPE', at, `is ${show(entry)}; [part name, "full" | "head", tag] is required`);
        return;
      }
      const [name, run, tag] = entry as [string, Json, Json];
      if (!partNameOk(name)) c.fail('CONFIG_PART_NAME', at, `names the part ${show(name)}; a part name is a file name, so it may not be empty, start with "." or hold a slash`);
      checkRunTag(c, at, run, tag);
      if (seenPart.has(name)) c.fail('CONFIG_PART_UNIQUE', at, `names the part "${name}" again (first at plan[${seenPart.get(name)}]); each part is one layer`);
      else seenPart.set(name, i);
      const source = `${String(run)}:${String(tag)}`;
      if (seenSource.has(source)) c.fail('CONFIG_PART_UNIQUE', at, `takes ${source} again (first at plan[${seenSource.get(source)}]); one layer makes one part`);
      else seenSource.set(source, i);
      parts.push(name);
    });
  }
  if ('extend_below_crop' in a && c.array(`${p}.extend_below_crop`, a.extend_below_crop, false)) {
    (a.extend_below_crop as Json[]).forEach((entry, i) => {
      const at = `${p}.extend_below_crop[${i}]`;
      const e = c.object(at, entry, ['part', 'run', 'tag'], []);
      if (e === null) return;
      checkRunTag(c, at, e.run, e.tag);
      if (typeof e.part !== 'string' || !parts.includes(e.part)) {
        c.fail('CONFIG_NAME_RESOLVES', `${at}.part`, `is ${show(e.part)}; a part named in assemble.plan is required`);
      }
    });
  }
  return parts;
}

/** Returns every bone name (root and chain links included) and each chain's link count. */
function checkBones(c: Check, v: Json): { bones: Set<string>; chains: Map<string, number> } {
  const bones = new Set<string>([ROOT_BONE]);
  const chains = new Map<string, number>();
  if (!c.array('config.bones', v, true)) return { bones, chains };
  // Not `declare`: Bun strips `declare(...)` as a TypeScript ambient declaration
  // while tsc accepts it as a call, so the call vanished at run time with both
  // gates green. Measured, not assumed — the selftest has a control for it.
  const addBone = (name: string, at: string): void => {
    if (name === ROOT_BONE) c.fail('CONFIG_BONE_UNIQUE', at, `declares "${ROOT_BONE}", which every rig already has`);
    else if (bones.has(name)) c.fail('CONFIG_BONE_UNIQUE', at, `declares the bone "${name}" a second time`);
    bones.add(name);
  };
  (v as Json[]).forEach((entry, i) => {
    const at = `config.bones[${i}]`;
    const isChain = typeof entry === 'object' && entry !== null && 'chain' in entry;
    if (isChain) {
      const b = c.object(at, entry, ['chain', 'parent', 'points', 'tip'], []);
      if (b === null) return;
      if ('parent' in b && c.string(`${at}.parent`, b.parent) && !bones.has(b.parent)) {
        c.fail('CONFIG_NAME_RESOLVES', `${at}.parent`, `names "${b.parent}", which is not "${ROOT_BONE}" or a bone declared above it; parents come first`);
      }
      if ('tip' in b) c.point(`${at}.tip`, b.tip);
      if (!c.string(`${at}.chain`, b.chain)) return;
      const name = b.chain;
      if (chains.has(name)) c.fail('CONFIG_BONE_UNIQUE', `${at}.chain`, `declares the chain "${name}" a second time`);
      if ('points' in b && c.array(`${at}.points`, b.points, true)) {
        const points = b.points as Json[];
        points.forEach((pt, k) => c.point(`${at}.points[${k}]`, pt));
        points.forEach((_, k) => addBone(`${name}${k}`, `${at} link ${k}`));
        chains.set(name, points.length);
      }
      return;
    }
    const b = c.object(at, entry, ['name', 'parent', 'at'], ['tip']);
    if (b === null) return;
    if ('parent' in b && c.string(`${at}.parent`, b.parent) && !bones.has(b.parent)) {
      c.fail('CONFIG_NAME_RESOLVES', `${at}.parent`, `names "${b.parent}", which is not "${ROOT_BONE}" or a bone declared above it; parents come first`);
    }
    if ('at' in b) c.point(`${at}.at`, b.at);
    if ('tip' in b) c.point(`${at}.tip`, b.tip);
    if ('name' in b && c.string(`${at}.name`, b.name)) addBone(b.name, `${at}.name`);
  });
  return { bones, chains };
}

function checkMeshes(c: Check, v: Json, bones: Set<string>, chains: Map<string, number>): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', 'config.meshes', `is ${show(v)}; an object of part name -> mesh is required`);
    return;
  }
  for (const [part, spec] of Object.entries(v as Record<string, Json>)) {
    const at = `config.meshes.${part}`;
    const m = c.object(at, spec, ['grid', 'r', 'segments'], []);
    if (m === null) continue;
    if ('grid' in m) c.int(`${at}.grid`, m.grid, 1);
    if ('r' in m) c.number(`${at}.r`, m.r, 'non-negative');
    if ('segments' in m && c.array(`${at}.segments`, m.segments, true)) {
      (m.segments as Json[]).forEach((s, i) => {
        const sp = `${at}.segments[${i}]`;
        if (typeof s === 'string') {
          if (!chains.has(s) && !bones.has(s)) c.fail('CONFIG_NAME_RESOLVES', sp, `names "${s}", which is neither a chain nor a bone`);
          return;
        }
        if (!(Array.isArray(s) && s.length === 3 && typeof s[0] === 'string')) {
          c.fail('CONFIG_FIELD_TYPE', sp, `is ${show(s)}; a chain name, a bone name, or [bone, [x, y], [x, y]] is required`);
          return;
        }
        if (!bones.has(s[0] as string)) c.fail('CONFIG_NAME_RESOLVES', `${sp}[0]`, `names "${String(s[0])}", which is not a bone`);
        c.point(`${sp}[1]`, s[1]);
        c.point(`${sp}[2]`, s[2]);
      });
    }
  }
}

function checkRegions(c: Check, v: Json, bones: Set<string>): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', 'config.regions', `is ${show(v)}; an object of part name -> bone name is required`);
    return;
  }
  for (const [part, bone] of Object.entries(v as Record<string, Json>)) {
    if (typeof bone !== 'string' || !bones.has(bone)) {
      c.fail('CONFIG_NAME_RESOLVES', `config.regions.${part}`, `is ${show(bone)}; a bone name is required`);
    }
  }
}

/** Every plan part is exactly one of a mesh or a region, and every mesh or region is a plan part. */
function checkCoverage(c: Check, parts: string[], meshes: Json, regions: Json): void {
  const m = typeof meshes === 'object' && meshes !== null ? Object.keys(meshes) : [];
  const r = typeof regions === 'object' && regions !== null ? Object.keys(regions) : [];
  for (const part of parts) {
    const inM = m.includes(part);
    const inR = r.includes(part);
    if (!inM && !inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'has neither a meshes entry nor a regions entry; exactly one is required');
    if (inM && inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'has both a meshes entry and a regions entry; exactly one is required');
  }
  for (const name of [...m, ...r]) {
    if (!parts.includes(name)) {
      c.fail('CONFIG_NAME_RESOLVES', `config.${m.includes(name) ? 'meshes' : 'regions'}.${name}`, 'names a part that assemble.plan does not make');
    }
  }
}

function checkMotion(c: Check, v: Json, bones: Set<string>, chains: Map<string, number>): void {
  const m = c.object('config.motion', v, ['duration', 'tracks'], ['blink']);
  if (m === null) return;
  const p = 'config.motion';
  const duration = 'duration' in m && c.number(`${p}.duration`, m.duration, 'positive') ? (m.duration as number) : null;
  const periodFits = (at: string, period: Json): void => {
    if (!c.number(at, period, 'positive') || duration === null) return;
    const cycles = duration / period;
    if (Math.abs(cycles - Math.round(cycles)) > 1e-9) {
      c.fail(
        'CONFIG_PERIOD_DIVIDES_DURATION',
        at,
        `is ${period} s against a ${duration} s idle, ${cycles.toFixed(4)} cycles; a whole number of cycles is required or the loop's last frame is not its first`,
      );
    }
  };
  if ('tracks' in m && c.array(`${p}.tracks`, m.tracks, false)) {
    (m.tracks as Json[]).forEach((tr, i) => {
      const at = `${p}.tracks[${i}]`;
      if (typeof tr === 'object' && tr !== null && 'chain' in tr) {
        const t = c.object(at, tr, ['chain', 'amps', 'period', 'phase', 'lag'], []);
        if (t === null) return;
        if ('period' in t) periodFits(`${at}.period`, t.period);
        if ('phase' in t) c.number(`${at}.phase`, t.phase);
        if ('lag' in t) c.number(`${at}.lag`, t.lag);
        const links = typeof t.chain === 'string' ? chains.get(t.chain) : undefined;
        if (links === undefined) c.fail('CONFIG_NAME_RESOLVES', `${at}.chain`, `is ${show(t.chain)}; a chain declared in config.bones is required`);
        if ('amps' in t && c.array(`${at}.amps`, t.amps, true)) {
          const amps = t.amps as Json[];
          amps.forEach((a, k) => c.number(`${at}.amps[${k}]`, a));
          if (links !== undefined && amps.length !== links) {
            c.fail('CONFIG_AMPS_MATCH_CHAIN', `${at}.amps`, `holds ${amps.length} amplitude(s) for the ${links}-link chain "${String(t.chain)}"; one per link is required`);
          }
        }
        return;
      }
      const t = c.object(at, tr, ['bone', 'prop', 'amp', 'period', 'phase'], ['base']);
      if (t === null) return;
      if (typeof t.bone !== 'string' || !bones.has(t.bone)) c.fail('CONFIG_NAME_RESOLVES', `${at}.bone`, `is ${show(t.bone)}; a declared bone is required`);
      if ('prop' in t && !(SINGLE_PROPS as readonly string[]).includes(t.prop as string)) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.prop`, `is ${show(t.prop)}; one of ${SINGLE_PROPS.join(', ')} is required`);
      }
      if ('amp' in t) c.number(`${at}.amp`, t.amp);
      if ('period' in t) periodFits(`${at}.period`, t.period);
      if ('phase' in t) c.number(`${at}.phase`, t.phase);
      if ('base' in t) c.number(`${at}.base`, t.base);
    });
  }
  if ('blink' in m) {
    const b = c.object(`${p}.blink`, m.blink, ['t', 'eyes', 'brows', 'squash', 'brow_drop'], []);
    if (b === null) return;
    if ('t' in b) c.number(`${p}.blink.t`, b.t, 'non-negative');
    if ('squash' in b) c.number(`${p}.blink.squash`, b.squash, 'positive');
    if ('brow_drop' in b) c.number(`${p}.blink.brow_drop`, b.brow_drop);
    for (const key of ['eyes', 'brows'] as const) {
      if (key in b && c.array(`${p}.blink.${key}`, b[key], false)) {
        (b[key] as Json[]).forEach((name, k) => {
          if (typeof name !== 'string' || !bones.has(name)) c.fail('CONFIG_NAME_RESOLVES', `${p}.blink.${key}[${k}]`, `is ${show(name)}; a declared bone is required`);
        });
      }
    }
  }
}
