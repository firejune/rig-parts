/**
 * The one door to the coordinate conversion.
 *
 * Everything this package measures is in crop pixels — y down, origin at the
 * top-left — because that is what a painting, a See-through layer and a part
 * PNG are. Spine's world is y up with its origin at the bottom-left of the
 * crop. spine-rigc owns that conversion (`src/transform.ts`: `cropToSpineY`,
 * `toBoneLocal`, `computeWorldTransforms`) and its own doctrine forbids a
 * second copy of it anywhere, so this package does not write one: every stage
 * that needs Spine coordinates imports them from here, and here re-exports
 * rigc's.
 *
 * A y flip written anywhere else in `src/` is the defect this file exists to
 * prevent; the selftest holds the tree to it.
 */
export { computeWorldTransforms, cropToSpineY, toBoneLocal } from 'spine-rigc/src/transform.ts';
export type { BoneTransform } from 'spine-rigc/src/transform.ts';
