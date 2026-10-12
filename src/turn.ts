/**
 * The turn control (issue #251): one bone nothing keys, and each part carried
 * sideways a fraction of that bone's offset, the fraction ordered by the part's
 * See-through depth — nearest furthest, the pivot depth staying put.
 *
 * 🧭 **The law is a turn's, not a chosen curve.** A figure turned by a small
 * angle θ about a vertical axis standing at depth `pivot`, seen without
 * perspective, moves each point sideways by `sin θ · (pivot − depth)` in depth
 * units: linear in depth, zero at the pivot, opposite signs on either side of
 * it. The depth unit's size in pixels is nothing See-through states, so the
 * dial is normalised by the nearest part instead:
 *
 *     fraction(part) = (pivot − depth(part)) / (pivot − depth(nearest))
 *
 * The nearest part (the smallest `depth_median`, larger being further back)
 * travels exactly the control's offset, the pivot depth 0, a part behind the
 * pivot the other way. The dial's unit is therefore the nearest part's travel
 * in rig px, and how far a consumer turns it is the consumer's.
 *
 * ⚖️ **The pivot `propose` drafts** ({@link turnPivot}) is the mean of the
 * carried parts' depths weighted by their `opaque_px`: the one depth at which
 * `Σ opaque_px · fraction = 0`, so the painted pixels' centroid does not slide
 * under the dial — the figure turns about its own middle rather than drifting
 * with it. It is a config field (`turn.pivot`), so a person corrects it there;
 * the rig stage recomputes every fraction from it.
 *
 * Depths are See-through's per-layer `depth_median` only. Issue #250 measured
 * that the depth maps do not carry relief inside a layer, so a part moves as
 * one piece. Pure: no file, no clock.
 */
import { pyRound } from './round.ts';

/**
 * The layers that ride on the face (issue #271): See-through makes no depth
 * of their own for them, so `propose` does not read theirs. The eye group —
 * eyewhite, irides, eyelash, eyebrow — is cut from one depth map predicted for
 * the combined eyes layer (`compose_list` in See-through's
 * `common/utils/inference_utils.py`, commit df019de), which is why
 * `eyewhite-r` and `eyewhite-l` read the same median in every run measured
 * for #251; nose and mouth are clamped by See-through to the face's median
 * minus {@link TURN_RIDER_OFFSET} when they read behind it (the same file,
 * lines 528-531). Their own medians disagreed across the two runs by up to
 * 0.474 (demo `eyebrow-r`, #251's table), and the disagreement swapped their
 * order against the face. Matched on the layer's base tag, either side.
 */
export const TURN_RIDER_TAGS: readonly string[] = ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'nose', 'mouth'];

/** The tag of the part the riders take their depth from. */
export const TURN_CARRIER_TAG = 'face';

/** See-through's own offset between a clamped face feature and the face (`face − 0.001`, the file named at {@link TURN_RIDER_TAGS}). */
export const TURN_RIDER_OFFSET = 0.001;

/**
 * A rider's depth: its carrier's, {@link TURN_RIDER_OFFSET} nearer when the
 * rider is drawn after the carrier (above it) and as much further when it is
 * drawn before (under it), so the draw order the depths imply is the one
 * parts.json holds.
 */
export function turnRiderDepth(carrier: number, above: boolean): number {
  return above ? carrier - TURN_RIDER_OFFSET : carrier + TURN_RIDER_OFFSET;
}

/** The control bone the rig stage adds under `root` when the config has `turn`: nothing keys it, and its local x is the dial. */
export const TURN_BONE = 'turn';

/** The places a pivot and a fraction are written to. */
export const TURN_PLACES = 6;

/** `config.turn`: the pivot depth and each carried part's See-through `depth_median`. */
export interface TurnSpec {
  pivot: number;
  depths: Record<string, number>;
}

/** One carried part: its depth and the fraction of the control's offset it travels. */
export interface TurnFraction {
  part: string;
  depth: number;
  fraction: number;
}

/** The nearest part of a turn: the smallest depth, the first such part in `depths`' key order. */
export function turnNearest(depths: Readonly<Record<string, number>>): { part: string; depth: number } | null {
  let best: { part: string; depth: number } | null = null;
  for (const [part, depth] of Object.entries(depths)) if (best === null || depth < best.depth) best = { part, depth };
  return best;
}

/**
 * `(pivot − depth) / (pivot − nearest)`, to {@link TURN_PLACES} places, with a
 * negative zero written as 0. The caller holds `pivot > nearest` (the loader
 * refuses anything else, `CONFIG_TURN_PIVOT_BEHIND_NEAREST`).
 */
export function turnFraction(pivot: number, nearest: number, depth: number): number {
  const f = pyRound((pivot - depth) / (pivot - nearest), TURN_PLACES);
  return f === 0 ? 0 : f;
}

/** Every carried part's fraction, in `order` (parts.json's draw order); a name in `order` the spec does not list is not carried. */
export function turnFractions(spec: TurnSpec, order: readonly string[]): TurnFraction[] {
  const nearest = turnNearest(spec.depths);
  if (nearest === null) return [];
  return order.filter((p) => Object.hasOwn(spec.depths, p)).map((part) => ({ part, depth: spec.depths[part], fraction: turnFraction(spec.pivot, nearest.depth, spec.depths[part]) }));
}

/**
 * The pivot `propose` drafts: `Σ area · depth / Σ area` over the carried
 * parts, to {@link TURN_PLACES} places — the depth at which the painted
 * pixels' centroid does not move under the dial. Null with no area.
 */
export function turnPivot(rows: ReadonlyArray<{ depth: number; area: number }>): number | null {
  let a = 0;
  let ad = 0;
  for (const r of rows) {
    a += r.area;
    ad += r.area * r.depth;
  }
  return a > 0 ? pyRound(ad / a, TURN_PLACES) : null;
}

/** The leaf bone that carries `part`'s share of `bone` under the turn: an identity child of `bone`, so it follows everything `bone` does. */
export function turnTwin(part: string, bone: string): string {
  return `${TURN_BONE}_${part}_${bone}`;
}

/** The transform constraint that carries `part`. */
export function turnConstraintName(part: string): string {
  return `${TURN_BONE}_${part}`;
}
