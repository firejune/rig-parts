/**
 * The motion amplitude of an automatic part (issue #126 Q2, rig-c 2.26.0 /
 * 2.28.0 `motionAmplitude`): what rig-c's two weight-aware allocation rows —
 * `MQ_ALLOCATION_CONTRAST` and `MQ_DEFORM_LOAD` — read, derived from the motion
 * this package already declares and never written by the author. rig-c's
 * contract (docs/MESH_REDUCTION.md §8, *Implemented — the allocation rows*)
 * types it as
 *
 *     { tracks: [{ track, pairs: [{ bones, theta }], epsilon }], gradation }
 *
 * and every term is derived here or refused by name; none is guessed.
 *
 * ## The terms
 *
 * - **A track** is one track of the idle as the rig stage writes it
 *   (`MotionSpec`, after the control bones took their keys), named
 *   `<bone or group>.<property>#<index>`, the index its place in the idle.
 * - **The pairs** are every unordered pair of the bones the part's source
 *   weights bind (sorted), declared in every track that moves at least one of
 *   them relative to another — so no pair a share can move between is left
 *   undeclared, which would leave both rows `not-measurable` (§8: "a pair no
 *   track declares makes both rows not-measurable"). A track moves bone `b`
 *   when a bone it keys is `b` or an ancestor of `b`: Spine bones inherit
 *   their parent's rotation and scale (the rig writes no inherit mode), so a
 *   pair the track moves together — both under one keyed bone — or not at all
 *   keeps its relative linear part, θ 0 (§8: "a bone that does not move is
 *   declared with θ 0"); a pair it moves on one side only gets the track's θ.
 *   A pair moved by two different bones of one group (the blink's `eyes`) has a
 *   relative part that depends on the two bones' frames, which this module does
 *   not compose: it is refused by name.
 * - **θ** = ‖M − I‖ of the pair's relative linear part over the track (§8),
 *   bounded from the track's keys: rig-c's formulas — 2 sin(α / 2) for a
 *   rotation by α, |s − 1| for a scale by s — at the largest |value| (rotate,
 *   degrees, a value Spine adds to the setup rotation) or the value furthest
 *   from 1 (scale, a factor on the setup scale, which the rig writes as 1) over
 *   every key value and every Bézier control value of the track. A cubic Bézier
 *   lies inside the hull of its control points, so this bounds the curve
 *   between keys (it may exceed the sine's true peak by the handles' overshoot;
 *   it never falls short); a named easing (`shut`, `open`) runs between its two
 *   key values. A scale along one axis is a diagonal map, and |s − 1| is its
 *   norm. A translation leaves the linear part unchanged: θ 0 by the contract's
 *   definition. ⚠️ So a pair a translation separates carries no load in rig-c's
 *   reading — the contract's θ has no lever term (§8's correction names it) —
 *   and that is rig-c's definition, not a figure measured here. A shear is
 *   refused: the contract gives no formula for it and this module invents none.
 * - **ε**, drawing px, above 0: the chord error a track tolerates. The one
 *   number the part declares for how far motion may carry art is its motion
 *   bound, `meshes.<part>.auto.motion.maxLocalDeformation` (rig px = drawing
 *   px: the rig's images are the drawing, `pageScale` 1), and it is read as
 *   every track's ε. A bound of 0 is not above 0 and is refused by name.
 * - **G**, `gradation`, px per px: how fast a declared need relaxes away from
 *   its source (§8, read by `MQ_ALLOCATION_CONTRAST` only). **No number this
 *   package's config or rig declares is that rate**: a region's `grade` relaxes
 *   that region's own edge bound, a part may have no region, and G is
 *   attachment-wide. So G is refused by name, always, today — and with it the
 *   whole field, which rig-c refuses without `gradation`. This is the brief's
 *   STOP ("a term needs a number the rig does not declare"), written down
 *   rather than worked around: the rig stage sends no `motionAmplitude`, both
 *   rows read `not-measurable` naming the field left out, and the row says why
 *   (`AutoMeshReport.motion_amplitude`).
 * - **Constraints** move bones by what they solve, not by a key: a rig with
 *   any constraint is refused by name, because no declared amplitude bounds
 *   what a constraint does.
 *
 * Pure: no clock, no randomness, nothing read or written.
 */
import type { MotionAmplitude, TrackAmplitude } from 'rig-c/mesh';
import type { MotionKey, MotionSpec } from './motion.ts';

/** The relative linear part's norm for one track: the largest over its keys' and handles' values, or why it has none. */
export function trackTheta(property: string, keys: readonly MotionKey[]): { theta: number } | { refused: string } {
  const values: number[] = [];
  for (const k of keys) {
    values.push(...k.v);
    if (k.curve !== undefined) values.push(k.curve[1], k.curve[3]);
  }
  if (property === 'rotate') {
    const deg = Math.max(0, ...values.map((v) => Math.abs(v)));
    return { theta: 2 * Math.sin((Math.min(deg, 180) * Math.PI) / 360) };
  }
  if (property === 'scale' || property === 'scalex' || property === 'scaley') return { theta: Math.max(0, ...values.map((v) => Math.abs(v - 1))) };
  if (property === 'translate' || property === 'translatex' || property === 'translatey') return { theta: 0 };
  return { refused: `property "${property}" has no θ in rig-c's contract (rotation 2 sin(α/2), scale |s − 1|, translation 0), and none is invented` };
}

/** Why one term of the amplitude could not be derived: the term's path and the sentence. */
export interface AmplitudeStop {
  term: string;
  detail: string;
}

/** The derivation: the amplitude to send, or every term that stopped it (the tracks derived so far kept for the record). */
export type AmplitudeDerivation = { amplitude: MotionAmplitude } | { stops: AmplitudeStop[]; tracks: TrackAmplitude[] };

/**
 * The amplitude of a part bound to `bound` (module header). `bones` is the
 * rig's bone list (name and parent), `motion` the idle as written,
 * `constraints` the rig's constraint count, `epsilon` the part's
 * `motion.maxLocalDeformation`, and `gradation` the attachment-wide G — which
 * no field of this package carries, so every caller passes null today.
 */
export function deriveMotionAmplitude(args: {
  bones: ReadonlyArray<{ name: string; parent?: string }>;
  motion: MotionSpec;
  constraints: number;
  bound: readonly string[];
  epsilon: number;
  gradation: number | null;
}): AmplitudeDerivation {
  const stops: AmplitudeStop[] = [];
  const parent = new Map(args.bones.map((b) => [b.name, b.parent ?? null]));
  const under = (bone: string, k: string): boolean => {
    for (let b: string | null = bone; b !== null; b = parent.get(b) ?? null) if (b === k) return true;
    return false;
  };
  const bound = [...new Set(args.bound)].sort();
  if (args.constraints > 0) {
    stops.push({ term: 'tracks', detail: `the rig carries ${args.constraints} constraint(s), which move bones by what they solve and not by a key; no declared amplitude bounds that motion` });
  }
  if (!(args.epsilon > 0)) {
    stops.push({ term: 'tracks[].epsilon', detail: `motion.maxLocalDeformation is ${args.epsilon}; ε is the chord error a track tolerates, above 0, and the part declares no other` });
  }
  const tracks: TrackAmplitude[] = [];
  args.motion.animations.idle.tracks.forEach((t, i) => {
    const keyed = t.bone !== undefined ? [t.bone] : (args.motion.groups[t.group ?? ''] ?? []);
    const name = `${t.bone ?? t.group ?? '?'}.${t.property}#${i}`;
    const moverOf = (b: string): string[] => keyed.filter((k) => under(b, k));
    if (!bound.some((b) => moverOf(b).length > 0)) return;
    const th = trackTheta(t.property, t.keys);
    if ('refused' in th) {
      stops.push({ term: `tracks[${name}].pairs[].theta`, detail: th.refused });
      return;
    }
    const pairs: TrackAmplitude['pairs'] = [];
    for (let a = 0; a < bound.length; a++) {
      for (let b = a + 1; b < bound.length; b++) {
        const ma = moverOf(bound[a]);
        const mb = moverOf(bound[b]);
        if (ma.length > 0 && mb.length > 0 && !ma.some((k) => mb.includes(k))) {
          stops.push({ term: `tracks[${name}].pairs[${bound[a]}, ${bound[b]}].theta`, detail: `the track moves "${bound[a]}" by [${ma.join(', ')}] and "${bound[b]}" by [${mb.join(', ')}], two keyed bones of one group; their relative linear part depends on the two bones' frames, which is not derived here` });
          continue;
        }
        const moved = (ma.length > 0) !== (mb.length > 0);
        pairs.push({ bones: [bound[a], bound[b]], theta: moved ? th.theta : 0 });
      }
    }
    tracks.push({ track: name, pairs, epsilon: args.epsilon });
  });
  const G = args.gradation;
  if (G === null) {
    stops.push({
      term: 'gradation',
      detail: "G (px per px, how fast a declared need relaxes away from its source, read by MQ_ALLOCATION_CONTRAST) is a number no field of the config or the rig declares — a region's grade relaxes its own edge bound only, and a part may have none — and none is invented",
    });
  }
  if (stops.length > 0 || G === null) return { stops, tracks };
  return { amplitude: { tracks, gradation: G } };
}

/** What the row says about the amplitude: whether it was sent, and every term that stopped it. */
export interface AmplitudeRow {
  sent: boolean;
  stops: AmplitudeStop[];
}

export function amplitudeRow(d: AmplitudeDerivation): AmplitudeRow {
  return 'amplitude' in d ? { sent: true, stops: [] } : { sent: false, stops: d.stops };
}
