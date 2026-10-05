/**
 * The character config: everything character-specific the CPU stages read,
 * plus the optional blocks for the two GPU stages.
 *
 * One file per character, filled in as the loop runs. What a step requires is
 * what that step reads, and {@link CONFIG_REQUIRES} states it once per loader:
 * the full loader, in front of `rig` and `build`, requires `key`, `assemble`,
 * `bones`, `meshes`, `regions` and `motion`; the early doors, in front of the
 * steps that run before `propose` has drafted the rig, require less.
 * `generation` is read only by the optional image-generation adapter; a
 * character whose painting came from anywhere else leaves it out.
 *
 * 🔒 **Every key is known or refused.** An unknown key is refused by name and
 * so is a missing one — a config that half-loads is a rig nobody can reason
 * about. There are two open doors, and both lead nowhere — nothing reads what
 * stands behind them. Annotation: `note`, and any key ending in `_note`, may
 * hold a string anywhere an object is expected. Annotations are how a hand
 * correction records its reason beside the value it corrected, and refusing
 * them would push that reason out of the file. Record: any key beginning with
 * `x-` and at least one character after it may hold any JSON value in the same
 * places (issue #70) — a project's own provenance, such as the gate results of
 * a past build or the seeds a search rejected, kept beside the conditions that
 * made the rig. The record test comes first, so `x-seed_note` is a record. The
 * part-name maps (`meshes`, `regions`, `motion.blink.still`) are not objects
 * in this sense: their keys are part names, and an `x-` key there is a part
 * name like any other. No stage writes a vouched object whole into an output;
 * each writer names its fields (`resolvedSampler` and its kin in
 * `src/graphs.ts`), which is what keeps both doors read by nothing.
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

/** Which pixels of a patch's box it takes: the painting's figure silhouette inside the box, or the whole box. */
export type PatchAlpha = 'silhouette' | 'box';
export const PATCH_ALPHAS: readonly PatchAlpha[] = ['silhouette', 'box'];

/** Where a patch is drawn: behind every part, in front of every part, or immediately behind a named plan part. */
export type PatchDraw = 'back' | 'front' | { before: string };

/**
 * An extra part cut from the PAINTING rather than from a See-through layer —
 * for a piece of the figure no layer holds (a hem the runs dropped). Its
 * `box` is `[x0, y0, x1, y1]` in RIG pixels, the space `parts.json` and the
 * recomposite are in, `x1`/`y1` exclusive. Its bone is `regions.<name>`, as
 * for every region part: a patch is always a region, never a mesh.
 */
export interface Patch {
  name: string;
  box: [number, number, number, number];
  alpha: PatchAlpha;
  draw: PatchDraw;
}

export interface Assemble {
  /** Rig pixels per source pixel. */
  rig_scale: number;
  plan: PlanEntry[];
  extend_below_crop?: Extend[];
  patches?: Patch[];
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

/**
 * A region part the blink moves, cut at a rig row: the rows above `row` are
 * drawn by a second slot `<part>_still` on `bone`, which the blink does not
 * key, and the rows from `row` down stay on the part's own slot and blink.
 * For an eyelash layer that also carries the eyelid crease (issue #26).
 */
export interface BlinkStill {
  row: number;
  bone: string;
}

/**
 * The idle's one blink. `eyes` names at least one bone; `brows` and
 * `brow_drop` are stated together or not at all, and a stated `brows` names
 * at least one bone — rigc refuses a group with no members, and a
 * `brow_drop` with no brows is a value nothing reads. A figure with no eye
 * bone has no blink: leave `blink` out (`CONFIG_BLINK_GROUP_MEMBERS`).
 */
export interface Blink {
  t: number;
  eyes: string[];
  brows?: string[];
  squash: number;
  brow_drop?: number;
  still?: Record<string, BlinkStill>;
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
    seed0: 'recorded where a seed search started; the chosen seed is generation.seed, and the search belongs in generation.seed_note, or as a structured record in generation.x-seeds_tried',
    seeds_tried: 'recorded the seeds a search tried; the chosen seed is generation.seed, and the search belongs in generation.seed_note, or as a structured record in generation.x-seeds_tried',
  },
};

/**
 * A project's own record: a key beginning `x-` with at least one character
 * after it, holding any JSON value, read by nothing. `X-`, `x_` and a bare
 * `x-` are not record names, so a typo of one is still refused by name.
 */
function isRecordKey(key: string): boolean {
  return key.length > 2 && key.startsWith('x-');
}

/** What every refusal of a key the schema does not know adds after its own sentence: the two doors. */
const DOORS = 'a project\'s own record goes under a key beginning "x-" (any JSON, read by nothing), a remark under note or <name>_note (a string)';

// ---------------------------------------------------------------------------
// the checker
// ---------------------------------------------------------------------------

type Json = unknown;

class Check {
  readonly problems: Problem[] = [];

  fail(code: string, object: string, detail: string): void {
    this.problems.push({ code, object, detail });
  }

  /** An object with exactly these keys (plus records and annotations); returns it, or null after refusing. */
  object(path: string, v: Json, required: readonly string[], optional: readonly string[]): Record<string, Json> | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; an object is required`);
      return null;
    }
    const o = v as Record<string, Json>;
    const section = path.replace(/^config\.?/, '');
    for (const key of Object.keys(o)) {
      if (required.includes(key) || optional.includes(key)) continue;
      if (isRecordKey(key)) continue;
      if (key === 'note' || key.endsWith('_note')) {
        if (typeof o[key] !== 'string') {
          this.fail('CONFIG_FIELD_TYPE', `${path}.${key}`, `is ${show(o[key])}; an annotation is a string — a structured record goes under a key beginning "x-" (any JSON, read by nothing)`);
        }
        continue;
      }
      const retired = RETIRED[section]?.[key];
      if (retired !== undefined) this.fail('CONFIG_KEY_RETIRED', `${path}.${key}`, retired);
      else this.fail('CONFIG_KEY_KNOWN', `${path}.${key}`, `is not a field here; known: ${[...required, ...optional].join(', ')} — ${DOORS}`);
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
 *   `assemble.rig_scale`.
 * - `assemble` — plain `assemble`: the `layers` door plus `assemble.plan`,
 *   which `--propose-plan` printed, and `extend_below_crop` when present, both
 *   under the full loader's own rules. `bones`, `meshes`, `regions` and
 *   `motion` are drafted by `propose` from the parts this step writes, so
 *   requiring them here is what made a new character need placeholder rig
 *   fields (issue #20).
 *
 * `generation` is checked on every door when present, because that block is
 * complete before any image exists.
 */
export type EarlyDoor = 'paint' | 'layers' | 'assemble';

/** Every loader: the three early doors, and `full` — `parseConfig`, in front of `rig`, `build` and `propose --from-config`/`--compare`. */
export type ConfigDoor = EarlyDoor | 'full';

/**
 * 🔒 The one statement of what each loader requires, as dotted field paths.
 * The loaders read their required keys from here — the top-level keys are the
 * first segments, `config.assemble`'s the second — and docs/AUTHORING.md §4's
 * table is compared against it by the selftest, so neither the doc nor a
 * loader can state a requirement the other does not.
 */
export const CONFIG_REQUIRES: Readonly<Record<ConfigDoor, readonly string[]>> = {
  paint: ['key', 'generation'],
  layers: ['key', 'seethrough', 'assemble.rig_scale'],
  assemble: ['key', 'seethrough', 'assemble.rig_scale', 'assemble.plan'],
  full: ['key', 'assemble.rig_scale', 'assemble.plan', 'bones', 'meshes', 'regions', 'motion'],
};

/** The top-level keys a loader requires, in `CONFIG_REQUIRES` order. */
function topRequired(door: ConfigDoor): string[] {
  return [...new Set(CONFIG_REQUIRES[door].map((f) => f.split('.')[0]))];
}

/** The keys a loader requires inside one top-level section. */
function sectionRequired(door: ConfigDoor, section: string): string[] {
  return CONFIG_REQUIRES[door].filter((f) => f.startsWith(`${section}.`)).map((f) => f.slice(section.length + 1));
}

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

/** What plain `assemble` reads: the early config plus the plan `--propose-plan` printed. */
export interface AssembleConfig {
  key: string;
  seethrough: SeeThrough;
  assemble: Assemble;
}

const TOP_KEYS = ['key', 'generation', 'seethrough', 'assemble', 'bones', 'meshes', 'regions', 'motion'] as const;

/**
 * The one partial entry point. It validates exactly what its door requires —
 * with the full loader's own rules for each — plus `generation` whenever it is
 * present. The sections a later step writes may be present and are NOT read or
 * vouched for (for `paint` that is everything but `key` and `generation`; for
 * `layers`, `assemble.plan`, `extend_below_crop`, `patches`, `bones`, `meshes`,
 * `regions` and `motion`; for `assemble`, the last four); a caller that needs
 * them uses {@link parseConfig}. Every other key that is not a record or an
 * annotation is still refused by name, and a retired one
 * (`generation.character_file` and its kin) still with what replaces it: a
 * config is not allowed to be half-known at any stage.
 */
export function parseEarlyConfig(raw: Json, door: 'paint'): PaintConfig;
export function parseEarlyConfig(raw: Json, door: 'layers'): EarlyConfig;
export function parseEarlyConfig(raw: Json, door: 'assemble'): AssembleConfig;
export function parseEarlyConfig(raw: Json, door: EarlyDoor): PaintConfig | EarlyConfig | AssembleConfig {
  const c = new Check();
  // `generation` is taken out of the generic presence check so its absence can
  // say what the block has to hold, rather than only that it is missing.
  const needed = topRequired(door);
  const required = needed.filter((k) => k !== 'generation');
  const top = c.object('config', raw, required, TOP_KEYS.filter((k) => !required.includes(k)));
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('key' in t) c.string('config.key', t.key);
  if ('generation' in t) checkGeneration(c, t.generation);
  else if (needed.includes('generation')) {
    c.fail(
      'CONFIG_FIELD_PRESENT',
      'config.generation',
      `is absent and required; comfy paint generates from it and nothing else — ${GENERATION_REQUIRED.join(', ')}, and pose or control`,
    );
  }
  if (door === 'layers') {
    if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
    if ('assemble' in t) {
      const a = c.object('config.assemble', t.assemble, sectionRequired(door, 'assemble'), ['plan', 'extend_below_crop', 'patches']);
      if (a !== null && 'rig_scale' in a) c.number('config.assemble.rig_scale', a.rig_scale, 'positive');
    }
  }
  if (door === 'assemble') {
    if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
    if ('assemble' in t) checkAssemble(c, t.assemble, door);
  }
  refuseIfAny(c.problems);
  return raw as PaintConfig | EarlyConfig | AssembleConfig;
}

export function loadEarlyConfig(path: string, door: 'paint'): PaintConfig;
export function loadEarlyConfig(path: string, door: 'layers'): EarlyConfig;
export function loadEarlyConfig(path: string, door: 'assemble'): AssembleConfig;
export function loadEarlyConfig(path: string, door: EarlyDoor): PaintConfig | EarlyConfig | AssembleConfig {
  const raw = readConfigFile(path);
  if (door === 'paint') return parseEarlyConfig(raw, 'paint');
  if (door === 'layers') return parseEarlyConfig(raw, 'layers');
  return parseEarlyConfig(raw, 'assemble');
}

/** Validate a parsed config. Every problem found is thrown at once, as one `PartsError`. */
export function parseConfig(raw: Json): CharacterConfig {
  const c = new Check();
  const required = topRequired('full');
  const top = c.object('config', raw, required, TOP_KEYS.filter((k) => !required.includes(k)));
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('key' in t) c.string('config.key', t.key);
  if ('generation' in t) checkGeneration(c, t.generation);
  if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
  const { parts, patches } = 'assemble' in t ? checkAssemble(c, t.assemble, 'full') : { parts: [], patches: [] };
  const names = 'bones' in t ? checkBones(c, t.bones) : { bones: new Set<string>([ROOT_BONE]), chains: new Map<string, number>() };
  if ('meshes' in t) checkMeshes(c, t.meshes, names.bones, names.chains);
  if ('regions' in t) checkRegions(c, t.regions, names.bones);
  if ('meshes' in t && 'regions' in t && 'assemble' in t) checkCoverage(c, parts, patches, t.meshes, t.regions);
  if ('motion' in t) checkMotion(c, t.motion, names.bones, names.chains, 'regions' in t ? t.regions : undefined);
  refuseIfAny(c.problems);
  return raw as CharacterConfig;
}

/**
 * `motion.blink.still`: part name -> `{row, bone}`. The part must be a region
 * whose bone the blink's `eyes` names — a cut on anything else holds nothing
 * still that was moving — and `bone` must be declared and must not be one of
 * the blink's eyes, or the still piece would blink with the rest.
 */
function checkBlinkStill(c: Check, v: Json, eyes: Json, bones: Set<string>, regions: Json): void {
  const at = 'config.motion.blink.still';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', at, `is ${show(v)}; an object of part name -> {row, bone} is required`);
    return;
  }
  const eyeList = Array.isArray(eyes) ? eyes.filter((e): e is string => typeof e === 'string') : [];
  const regionOf = typeof regions === 'object' && regions !== null && !Array.isArray(regions) ? (regions as Record<string, Json>) : {};
  for (const [part, entry] of Object.entries(v as Record<string, Json>)) {
    const e = c.object(`${at}.${part}`, entry, ['row', 'bone'], []);
    if (e === null) continue;
    if ('row' in e) c.int(`${at}.${part}.row`, e.row, 0);
    if ('bone' in e) {
      if (typeof e.bone !== 'string' || !bones.has(e.bone)) c.fail('CONFIG_NAME_RESOLVES', `${at}.${part}.bone`, `is ${show(e.bone)}; a declared bone is required`);
      else if (eyeList.includes(e.bone)) {
        c.fail('CONFIG_STILL_OFF_THE_BLINK', `${at}.${part}.bone`, `is "${e.bone}", which config.motion.blink.eyes names, so the still piece would blink too; a bone the blink does not key is required (the eye bone's parent, as propose writes it)`);
      }
    }
    const rb = Object.prototype.hasOwnProperty.call(regionOf, part) ? regionOf[part] : undefined;
    if (typeof rb !== 'string') {
      c.fail('CONFIG_NAME_RESOLVES', `${at}.${part}`, `names "${part}", which config.regions does not attach; a region part is required — a mesh is not cut`);
    } else if (!eyeList.includes(rb)) {
      c.fail(
        'CONFIG_STILL_OFF_THE_BLINK',
        `${at}.${part}`,
        `names a region on "${rb}", which config.motion.blink.eyes (${eyeList.join(', ') || 'none'}) does not name, so the blink never moves it and there is nothing to hold still; a region on a blinking eye bone is required`,
      );
    }
  }
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

/**
 * Returns the plan's part names, in plan order, and the patches' names, in
 * patch order. `plan` is left out of the generic presence check so that its
 * absence says which command writes one — the step a config without a plan
 * has most likely skipped.
 */
function checkAssemble(c: Check, v: Json, door: 'assemble' | 'full'): { parts: string[]; patches: string[] } {
  const required = sectionRequired(door, 'assemble');
  const a = c.object('config.assemble', v, required.filter((k) => k !== 'plan'), ['plan', 'extend_below_crop', 'patches']);
  if (a === null) return { parts: [], patches: [] };
  if (required.includes('plan') && !('plan' in a)) {
    c.fail('CONFIG_FIELD_PRESENT', 'config.assemble.plan', 'is absent and required; `assemble --propose-plan` prints one from the two runs — paste its plan and extend_below_crop into config.assemble');
  }
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
  const patches = 'patches' in a ? checkPatches(c, a.patches, parts) : [];
  return { parts, patches };
}

/**
 * `assemble.patches`: each entry `{name, box, alpha, draw}`, refused field by
 * field. What the config alone cannot know — whether the box lies inside the
 * rig, whether the rule leaves any pixel — the assemble stage refuses
 * (`ASSEMBLE_PATCH_BOX_INSIDE`, `ASSEMBLE_PATCH_OPAQUE`). Returns the patch
 * names, in order.
 */
function checkPatches(c: Check, v: Json, plan: string[]): string[] {
  const p = 'config.assemble.patches';
  const names: string[] = [];
  if (!c.array(p, v, false)) return names;
  const seen = new Map<string, number>();
  (v as Json[]).forEach((entry, i) => {
    const at = `${p}[${i}]`;
    // `bone` is the field a reader expects here, and the answer is a place
    // that already exists: one place for a region's bone, not two.
    let fields = entry;
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && 'bone' in entry) {
      c.fail('CONFIG_KEY_KNOWN', `${at}.bone`, 'is not a field here; a patch is a region, and the bone a region rides is config.regions.<name> — write it there');
      const { bone: _bone, ...rest } = entry as Record<string, Json>;
      fields = rest;
    }
    const e = c.object(at, fields, ['name', 'box', 'alpha', 'draw'], []);
    if (e === null) return;
    if ('name' in e && c.string(`${at}.name`, e.name)) {
      const name = e.name;
      if (!partNameOk(name)) c.fail('CONFIG_PART_NAME', `${at}.name`, `names the part ${show(name)}; a part name is a file name, so it may not be empty, start with "." or hold a slash`);
      if (plan.includes(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.name`, `names the part "${name}", which assemble.plan[${plan.indexOf(name)}] already makes; a patch is a part of its own`);
      else if (seen.has(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.name`, `names the part "${name}" again (first at patches[${seen.get(name)}])`);
      else seen.set(name, i);
      names.push(name);
    }
    if ('box' in e) {
      const b = e.box;
      const ints = Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
      if (!ints) c.fail('CONFIG_FIELD_TYPE', `${at}.box`, `is ${show(b)}; [x0, y0, x1, y1] in non-negative integer rig pixels is required`);
      else {
        const [x0, y0, x1, y1] = b as number[];
        if (!(x1 > x0 && y1 > y0)) c.fail('CONFIG_PATCH_BOX', `${at}.box`, `is [${x0}, ${y0}, ${x1}, ${y1}], ${x1 - x0}x${y1 - y0}; a non-empty box is required (x1 > x0 and y1 > y0; x1 and y1 are exclusive)`);
      }
    }
    if ('alpha' in e && !(PATCH_ALPHAS as readonly Json[]).includes(e.alpha)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.alpha`, `is ${show(e.alpha)}; one of ${PATCH_ALPHAS.map((r) => `"${r}"`).join(', ')} is required — "silhouette" takes the painting's figure inside the box, "box" the whole box`);
    }
    if ('draw' in e) {
      const d = e.draw;
      if (d === 'back' || d === 'front') return;
      if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
        const o = c.object(`${at}.draw`, d, ['before'], []);
        if (o !== null && 'before' in o && (typeof o.before !== 'string' || !plan.includes(o.before))) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.draw.before`, `is ${show(o.before)}; a part named in assemble.plan is required`);
        }
        return;
      }
      c.fail('CONFIG_FIELD_TYPE', `${at}.draw`, `is ${show(d)}; "back", "front" or {"before": "<plan part>"} is required`);
    }
  });
  return names;
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

/**
 * Every plan part is exactly one of a mesh or a region, every patch is a
 * region, and every mesh or region is a plan part or a patch.
 */
function checkCoverage(c: Check, parts: string[], patches: string[], meshes: Json, regions: Json): void {
  const m = typeof meshes === 'object' && meshes !== null ? Object.keys(meshes) : [];
  const r = typeof regions === 'object' && regions !== null ? Object.keys(regions) : [];
  for (const patch of patches) {
    if (m.includes(patch)) c.fail('CONFIG_PART_ATTACHED', `part "${patch}"`, `is an assemble.patches entry and has a meshes entry; a patch is a region — drop config.meshes.${patch} and name its bone in config.regions.${patch}`);
    else if (!r.includes(patch)) c.fail('CONFIG_PART_ATTACHED', `part "${patch}"`, `is an assemble.patches entry with no regions entry; a patch is a region, so config.regions.${patch} naming its bone is required`);
  }
  for (const part of parts) {
    const inM = m.includes(part);
    const inR = r.includes(part);
    if (!inM && !inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'has neither a meshes entry nor a regions entry; exactly one is required');
    if (inM && inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'has both a meshes entry and a regions entry; exactly one is required');
  }
  for (const name of [...m, ...r]) {
    if (!parts.includes(name) && !patches.includes(name)) {
      c.fail('CONFIG_NAME_RESOLVES', `config.${m.includes(name) ? 'meshes' : 'regions'}.${name}`, 'names a part that neither assemble.plan nor assemble.patches makes');
    }
  }
}

/** What an empty blink group is told: the tags whose parts make its bones, and what to write instead. */
const BLINK_GROUP_EMPTY: Readonly<Record<'eyes' | 'brows', string>> = {
  eyes: 'is []; the eyes group must name at least one bone (rigc refuses a group with no members). The eye bones come from eyewhite-r / eyewhite-l parts; a figure with none has nothing to blink, so leave config.motion.blink out',
  brows: 'is []; the brows group must name at least one bone (rigc refuses a group with no members). The brow bones come from eyebrow-r / eyebrow-l parts; a figure with none has nothing to drop, so leave brows and brow_drop out',
};

function checkMotion(c: Check, v: Json, bones: Set<string>, chains: Map<string, number>, regions: Json): void {
  const m = c.object('config.motion', v, ['duration', 'tracks'], ['blink']);
  if (m === null) return;
  const p = 'config.motion';
  // Every bone property the idle will key, and the tracks that key it, in the
  // order idleMotion writes them: single and chain tracks, then the eyes
  // group, then the brows group.
  const claims = new Map<string, string[]>();
  const claim = (target: string, by: string): void => {
    claims.set(target, [...(claims.get(target) ?? []), by]);
  };
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
        // A chain track keys rotate on every link (idleMotion), one link per point.
        else for (let k = 0; k < links; k++) claim(`${String(t.chain)}${k}.rotate`, `${at} (chain "${String(t.chain)}", link ${k})`);
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
      } else if ('prop' in t && typeof t.bone === 'string' && bones.has(t.bone)) claim(`${t.bone}.${String(t.prop)}`, at);
      if ('amp' in t) c.number(`${at}.amp`, t.amp);
      if ('period' in t) periodFits(`${at}.period`, t.period);
      if ('phase' in t) c.number(`${at}.phase`, t.phase);
      if ('base' in t) c.number(`${at}.base`, t.base);
    });
  }
  if ('blink' in m) {
    const b = c.object(`${p}.blink`, m.blink, ['t', 'eyes', 'squash'], ['brows', 'brow_drop', 'still']);
    if (b === null) return refuseSharedTargets(c, claims);
    if ('t' in b) c.number(`${p}.blink.t`, b.t, 'non-negative');
    if ('squash' in b) c.number(`${p}.blink.squash`, b.squash, 'positive');
    if ('brow_drop' in b) c.number(`${p}.blink.brow_drop`, b.brow_drop);
    if ('brows' in b && !('brow_drop' in b)) {
      c.fail('CONFIG_BLINK_BROWS_PAIRED', `${p}.blink.brow_drop`, 'is absent while config.motion.blink.brows is stated; the brows group drops by brow_drop, so state both or neither');
    }
    if ('brow_drop' in b && !('brows' in b)) {
      c.fail('CONFIG_BLINK_BROWS_PAIRED', `${p}.blink.brows`, `is absent while config.motion.blink.brow_drop is ${show(b.brow_drop)}; nothing would drop, so state both or neither`);
    }
    for (const key of ['eyes', 'brows'] as const) {
      if (key in b && c.array(`${p}.blink.${key}`, b[key], false)) {
        const list = b[key] as Json[];
        // rigc refuses a group with no members (`group "eyes" declares no
        // members`) one stage later, at the gate; the stage whose input is
        // wrong is this one.
        if (list.length === 0) c.fail('CONFIG_BLINK_GROUP_MEMBERS', `${p}.blink.${key}`, BLINK_GROUP_EMPTY[key]);
        const at = new Map<string, number[]>();
        list.forEach((name, k) => {
          if (typeof name !== 'string' || !bones.has(name)) c.fail('CONFIG_NAME_RESOLVES', `${p}.blink.${key}[${k}]`, `is ${show(name)}; a declared bone is required`);
          if (typeof name === 'string') at.set(name, [...(at.get(name) ?? []), k]);
        });
        // The group track keys one property on every member: scaley for the
        // eyes, translatey for the brows — and the brows track is written only
        // when brow_drop is stated beside them (idleMotion). A member named
        // twice is CONFIG_BLINK_GROUP_UNIQUE's, so each bone claims once, at
        // its first index.
        const prop = key === 'eyes' ? 'scaley' : 'translatey';
        if (key === 'eyes' || 'brow_drop' in b) {
          for (const [name, ks] of at) if (bones.has(name)) claim(`${name}.${prop}`, `${p}.blink.${key}[${ks[0]}] (the blink's ${key} group, which keys ${prop} on every member)`);
        }
        // rigc refuses a member named twice (`group "eyes" names member "eye"
        // twice`) at the gate, one stage late — issue #45, the sibling of the
        // empty group above. One refusal per repeated name, in first-seen order.
        for (const [name, ks] of at) {
          if (ks.length > 1) {
            c.fail(
              'CONFIG_BLINK_GROUP_UNIQUE',
              `${p}.blink.${key}`,
              `names ${show(name)} ${ks.length === 2 ? 'twice' : `${ks.length} times`} (at ${ks.map((k) => `[${k}]`).join(', ')}); each bone is named once — the group keys every member it names, so a repeat keys one bone twice, and rigc refuses a group naming a member twice`,
            );
          }
        }
      }
    }
    if ('still' in b) checkBlinkStill(c, b.still, b.eyes, bones, regions);
  }
  refuseSharedTargets(c, claims);
}

/**
 * Two tracks keying one bone property — two single tracks, a single track
 * beside a chain link's rotate or a blink group's member — are one refusal
 * per property, naming every track that keys it (issue #49). rigc refuses the
 * pair at the rig gate (`animation "idle" has two tracks on eye.scaley`), one
 * stage after the input that was wrong; the loader knows every track it
 * writes. The control bones the rig stage adds (`<bone>_ctl`) cannot make two
 * distinct targets one: the rename is the same suffix on every key of a bone,
 * and a declared bone already holding the control's name is the rig stage's
 * refusal, `RIG_CONTROL_NAME_FREE`.
 */
function refuseSharedTargets(c: Check, claims: ReadonlyMap<string, string[]>): void {
  for (const [target, by] of claims) {
    if (by.length < 2) continue;
    c.fail(
      'CONFIG_BONE_PROPERTY_KEYED_ONCE',
      `bone property "${target}"`,
      `is keyed by ${by.length} tracks: ${by.join(' and ')}; one track per bone property is required — the idle would hold ${by.length} timelines on ${target}, and rigc refuses two tracks on one bone property. Merge them into one track, or key another property or bone`,
    );
  }
}
