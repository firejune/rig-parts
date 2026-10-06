/**
 * External pose keypoints: one explicit file that says where a painting's
 * joints are, read by `propose --keypoints` (issue #75).
 *
 * `propose` places the skeleton from face-height and figure-height ratios that
 * assume a standing figure. A posed, seated or reclining figure needs to be
 * told where its joints are, and this file is how it is told — nothing about
 * it is implied:
 *
 * ```json
 * {
 *   "spec": "spine-parts-keypoints/1",
 *   "space": { "units": "painting-px", "origin": "top-left", "y": "down" },
 *   "width": 1664, "height": 2432,
 *   "source": "what produced the file, recorded and never interpreted",
 *   "people": [
 *     { "id": "a", "joints": {
 *         "neck": { "state": "observed", "at": [830, 380] },
 *         "l_hip": { "state": "occluded", "at": [890, 1010], "score": 0.4 },
 *         "r_ear": { "state": "missing" } } }
 *   ]
 * }
 * ```
 *
 * - **The space is stated, and refused if it is another**: painting pixels,
 *   origin top-left, y down. A file in normalised or y-up coordinates is not
 *   read as if it were in this one.
 * - **`width` and `height` are the painting's**, held to the `--source`
 *   painting's size by {@link checkImageSize}.
 * - **`source` is recorded, never interpreted**: a non-empty string naming
 *   what produced the file, printed in the first keypoint note.
 * - **Joint names are the body-18 names** of `src/skeleton.ts`'s
 *   `KEYPOINT_NAMES`, read from there; `r` / `l` are the subject's sides, so
 *   `r_shoulder` is on the image's left of a figure that faces the viewer.
 * - **Each joint says what it is**: `observed` with a position; `occluded`,
 *   whose position is optional and, when given, is the producer's estimate
 *   and recorded as that; or `missing`, with no position. A joint the file
 *   does not list is missing. An optional `score` is the producer's, recorded
 *   beside the joint and never computed or compared with a bar here.
 * - **A position lies inside the image**: `0 <= x <= width`, `0 <= y <=
 *   height`, continuous painting coordinates (the right and bottom edges are
 *   the image's edges, so they are inside).
 *
 * Every problem is collected and thrown once, in the config loader's voice:
 * a code, the field spelled as the file spells it, the value found and the
 * value required.
 *
 * Painting pixels reach rig pixels by the one map the proposer's overlay
 * already uses to draw the painting under the bones: `drawLandmarks`
 * (`src/propose.ts`) resizes the whole painting onto the `W`x`H` rig canvas,
 * which takes a painting coordinate `(x, y)` to `(x * W / width, y * H /
 * height)` ({@link toRigJoints}). For the public examples that is `x * 0.5`,
 * `y * 0.5` (a 1664x2432 painting on an 832x1216 rig).
 */
import { existsSync, readFileSync } from 'node:fs';
import { type Problem, refuseIfAny } from './errors.ts';
import { KEYPOINT_NAMES, type KeypointName } from './skeleton.ts';

/** The spec tag a keypoint file carries. */
export const KEYPOINTS_SPEC = 'spine-parts-keypoints/1';

/** The one coordinate space a keypoint file may state. */
export const KEYPOINTS_SPACE: Readonly<Record<'units' | 'origin' | 'y', string>> = { units: 'painting-px', origin: 'top-left', y: 'down' };

export const JOINT_STATES = ['observed', 'occluded', 'missing'] as const;
export type JointState = (typeof JOINT_STATES)[number];

export interface Joint {
  state: JointState;
  /** Painting px; `null` for a missing joint and for an occluded one given no position. */
  at: [number, number] | null;
  /** The producer's score, recorded as given; `null` when the file carries none. */
  score: number | null;
  /** Whether the file lists the joint; an unlisted joint is missing. */
  listed: boolean;
}

export interface KeypointPerson {
  id: string;
  joints: Record<KeypointName, Joint>;
}

export interface KeypointFile {
  width: number;
  height: number;
  source: string;
  people: KeypointPerson[];
}

const TOP_KEYS = ['spec', 'space', 'width', 'height', 'source', 'people'] as const;

function show(v: unknown): string {
  if (v === undefined) return 'absent';
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFinite2(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Validate a parsed keypoint file. `label` names it in every refusal (its path
 * when read from disk). Every problem found is thrown at once.
 */
export function parseKeypoints(raw: unknown, label: string): KeypointFile {
  const problems: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  const known = (path: string, o: Record<string, unknown>, keys: readonly string[]): void => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) fail('KEYPOINTS_KEY_KNOWN', `${path}.${k}`, `is not a field here; known: ${keys.join(', ')}`);
  };
  if (!isObject(raw)) {
    refuseIfAny([{ code: 'KEYPOINTS_FIELD_TYPE', object: label, detail: `is ${show(raw)}; an object is required` }]);
  }
  const t = raw as Record<string, unknown>;
  known(label, t, TOP_KEYS);
  for (const k of TOP_KEYS) if (!(k in t)) fail('KEYPOINTS_FIELD_PRESENT', `${label}.${k}`, 'is absent and required');
  if ('spec' in t && t.spec !== KEYPOINTS_SPEC) fail('KEYPOINTS_SPEC_KNOWN', `${label}.spec`, `is ${show(t.spec)}; "${KEYPOINTS_SPEC}" is required`);
  if ('space' in t) {
    if (!isObject(t.space)) fail('KEYPOINTS_FIELD_TYPE', `${label}.space`, `is ${show(t.space)}; an object ${show(KEYPOINTS_SPACE)} is required`);
    else {
      const sp = t.space;
      const keys = Object.keys(KEYPOINTS_SPACE) as Array<keyof typeof KEYPOINTS_SPACE>;
      known(`${label}.space`, sp, keys);
      for (const k of keys) {
        if (sp[k] !== KEYPOINTS_SPACE[k]) {
          fail(
            'KEYPOINTS_SPACE_STATED',
            `${label}.space.${k}`,
            `is ${show(sp[k])}; "${KEYPOINTS_SPACE[k]}" is required — the one space read here is painting pixels, origin top-left, y down, and a file in another is not read as if it were in this one`,
          );
        }
      }
    }
  }
  const dim = (k: 'width' | 'height'): number | null => {
    if (!(k in t)) return null;
    const v = t[k];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
    fail('KEYPOINTS_FIELD_TYPE', `${label}.${k}`, `is ${show(v)}; the painting's ${k} in px, an integer above 0, is required`);
    return null;
  };
  const width = dim('width');
  const height = dim('height');
  if ('source' in t && !(typeof t.source === 'string' && t.source.trim() !== '')) {
    fail('KEYPOINTS_FIELD_TYPE', `${label}.source`, `is ${show(t.source)}; a non-empty string naming what produced the file is required`);
  }
  const people: KeypointPerson[] = [];
  if ('people' in t) {
    if (!Array.isArray(t.people) || t.people.length === 0) fail('KEYPOINTS_FIELD_TYPE', `${label}.people`, `is ${show(t.people)}; a non-empty array of {id, joints} is required`);
    else {
      const seen = new Map<string, number>();
      t.people.forEach((pv, i) => {
        const at = `${label}.people[${i}]`;
        if (!isObject(pv)) {
          fail('KEYPOINTS_FIELD_TYPE', at, `is ${show(pv)}; an object {id, joints} is required`);
          return;
        }
        known(at, pv, ['id', 'joints']);
        for (const k of ['id', 'joints']) if (!(k in pv)) fail('KEYPOINTS_FIELD_PRESENT', `${at}.${k}`, 'is absent and required');
        let id: string | null = null;
        if ('id' in pv) {
          if (typeof pv.id === 'string' && pv.id !== '') {
            id = pv.id;
            const first = seen.get(id);
            if (first !== undefined) fail('KEYPOINTS_PERSON_UNIQUE', `${at}.id`, `is "${id}", which ${label}.people[${first}] already is; one id per person is required, or --person cannot say which one is meant`);
            else seen.set(id, i);
          } else fail('KEYPOINTS_FIELD_TYPE', `${at}.id`, `is ${show(pv.id)}; a non-empty string is required`);
        }
        if (!('joints' in pv)) return;
        if (!isObject(pv.joints)) {
          fail('KEYPOINTS_FIELD_TYPE', `${at}.joints`, `is ${show(pv.joints)}; an object of joint name -> {state, at?, score?} is required`);
          return;
        }
        const joints = {} as Record<KeypointName, Joint>;
        for (const n of KEYPOINT_NAMES) joints[n] = { state: 'missing', at: null, score: null, listed: false };
        for (const [name, jv] of Object.entries(pv.joints)) {
          const jat = `${at}.joints.${name}`;
          if (!(KEYPOINT_NAMES as readonly string[]).includes(name)) {
            fail('KEYPOINTS_JOINT_KNOWN', jat, `is not a body-18 joint; one of ${KEYPOINT_NAMES.join(', ')} is required (r and l are the subject's sides)`);
            continue;
          }
          if (!isObject(jv)) {
            fail('KEYPOINTS_FIELD_TYPE', jat, `is ${show(jv)}; an object {state, at?, score?} is required`);
            continue;
          }
          known(jat, jv, ['state', 'at', 'score']);
          const state = jv.state;
          if (!(JOINT_STATES as readonly unknown[]).includes(state)) {
            fail('KEYPOINTS_JOINT_STATE', `${jat}.state`, `is ${show(state)}; one of ${JOINT_STATES.join(', ')} is required`);
            continue;
          }
          const st = state as JointState;
          let pos: [number, number] | null = null;
          if ('at' in jv) {
            if (st === 'missing') fail('KEYPOINTS_POSITION_STATED', `${jat}.at`, `is ${show(jv.at)} on a missing joint; a missing joint has no position — say "occluded" if the producer estimated one`);
            else if (!isFinite2(jv.at)) fail('KEYPOINTS_FIELD_TYPE', `${jat}.at`, `is ${show(jv.at)}; a point [x, y] in painting px is required`);
            else {
              const [x, y] = jv.at;
              if (width !== null && height !== null && (x < 0 || y < 0 || x > width || y > height)) {
                fail('KEYPOINTS_POSITION_INSIDE', `${jat}.at`, `is [${x}, ${y}]; a point inside the ${width}x${height} image is required (0 <= x <= ${width}, 0 <= y <= ${height})`);
              } else pos = [x, y];
            }
          } else if (st === 'observed') fail('KEYPOINTS_POSITION_STATED', `${jat}.at`, 'is absent on an observed joint; an observed joint is a position [x, y] in painting px — say "missing" if there is none');
          let score: number | null = null;
          if ('score' in jv) {
            if (typeof jv.score === 'number' && Number.isFinite(jv.score)) score = jv.score;
            else fail('KEYPOINTS_FIELD_TYPE', `${jat}.score`, `is ${show(jv.score)}; a finite number (the producer's, recorded as given) is required`);
          }
          joints[name as KeypointName] = { state: st, at: pos, score, listed: true };
        }
        if (id !== null) people.push({ id, joints });
      });
    }
  }
  refuseIfAny(problems);
  return { width: width as number, height: height as number, source: t.source as string, people };
}

/** Read and validate a keypoint file from disk. */
export function loadKeypoints(path: string): KeypointFile {
  if (!existsSync(path)) refuseIfAny([{ code: 'KEYPOINTS_FILE_PRESENT', object: path, detail: 'no such file; --keypoints names a keypoint file' }]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    refuseIfAny([{ code: 'KEYPOINTS_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` }]);
  }
  return parseKeypoints(raw, path);
}

/**
 * The person `--person` names. One person and no `--person` is that person;
 * more than one and no `--person` is refused naming the ids — nothing picks
 * one (not the largest, not the first).
 */
export function choosePerson(file: KeypointFile, id: string | undefined, label: string): KeypointPerson {
  const ids = file.people.map((p) => `"${p.id}"`).join(', ');
  if (id === undefined) {
    if (file.people.length === 1) return file.people[0];
    refuseIfAny([{ code: 'KEYPOINTS_PERSON_CHOSEN', object: label, detail: `holds ${file.people.length} people (${ids}) and no --person names one; --person <id> is required, because nothing here picks a person` }]);
  }
  const p = file.people.find((q) => q.id === id);
  if (p === undefined) refuseIfAny([{ code: 'KEYPOINTS_PERSON_CHOSEN', object: `--person ${id}`, detail: `names no person in ${label}; its ids are ${ids}` }]);
  return p as KeypointPerson;
}

/** Hold the file's image size to the painting's: a file measured on another image is not this painting's. */
export function checkImageSize(file: KeypointFile, w: number, h: number, label: string, painting: string): void {
  if (file.width === w && file.height === h) return;
  refuseIfAny([
    {
      code: 'KEYPOINTS_IMAGE_SIZE',
      object: `${label} width, height`,
      detail: `are ${file.width}x${file.height}; the painting ${painting} is ${w}x${h}, and a keypoint file is read only against the image it was measured on`,
    },
  ]);
}

/** One joint as the proposer reads it: rig px where the file gave a position. */
export interface RigJoint {
  state: JointState;
  /** Rig px, by the overlay's map; `null` when the file gave no position. */
  at: [number, number] | null;
  score: number | null;
  listed: boolean;
}

/** One person's joints in rig px, with what the proposer's notes say about where they came from. */
export interface RigJoints {
  person: string;
  source: string;
  painting: [number, number];
  rig: [number, number];
  joints: Record<KeypointName, RigJoint>;
}

/**
 * A person's joints taken to rig px by the overlay's map: `drawLandmarks`
 * resizes the painting (`width`x`height`) onto the `W`x`H` rig canvas, which
 * takes `(x, y)` to `(x * W / width, y * H / height)`.
 */
export function toRigJoints(file: KeypointFile, person: KeypointPerson, W: number, H: number): RigJoints {
  const joints = {} as Record<KeypointName, RigJoint>;
  for (const n of KEYPOINT_NAMES) {
    const j = person.joints[n];
    joints[n] = { state: j.state, at: j.at === null ? null : [(j.at[0] * W) / file.width, (j.at[1] * H) / file.height], score: j.score, listed: j.listed };
  }
  return { person: person.id, source: file.source, painting: [file.width, file.height], rig: [W, H], joints };
}
