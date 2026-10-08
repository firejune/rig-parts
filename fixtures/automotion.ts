/**
 * The motion bounds of the automatic mesh mode's generated and public cases
 * (issue #126 item 3, `src/automotion.ts`), stated before any comparison was
 * run and not tuned per part. One rule for both policies of
 * `fixtures/automesh.ts`:
 *
 * - `maxLocalDeformation` = the policy's own `targets.maxBoundaryDeviation`,
 *   1 rig px in both (`syntheticPolicy` and `examplePolicy`): the distance the
 *   policy already accepts between the reduced outline and its source's at
 *   the setup pose is the distance the reduced mesh may carry any texel away
 *   from where the source carries it in motion. A rig px is one world unit:
 *   the rig stage writes every bone unscaled (`src/rig.ts`), and the
 *   comparison reports the slot bone's setup map beside each row.
 * - `maxStretch`, `minStretch`: not written — the contract's own rule makes
 *   them reported and not gated, and no number for them is derivable from
 *   either policy.
 * - `deformMayFold`: not written, so false: a fold is refused.
 *
 * Kept apart from `fixtures/automesh.ts` so the geometry policies stay as
 * item 2 stated them; {@link withPolicyMotion} adds the block.
 */
import type { AutoMotionSpec, AutoSpec } from '../src/config.ts';

/** The motion block every generated and public automatic case carries (module header). */
export function policyMotion(spec: AutoSpec): AutoMotionSpec {
  return { maxLocalDeformation: spec.targets.maxBoundaryDeviation };
}

/** A geometry policy with its motion block. */
export function withPolicyMotion(spec: AutoSpec): AutoSpec {
  return { ...spec, motion: policyMotion(spec) };
}
