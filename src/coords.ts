/**
 * The one door to the coordinate conversion.
 *
 * Everything this package measures is in crop pixels — y down, origin at the
 * top-left — because that is what a painting, a See-through layer and a part
 * PNG are. Spine's world is y up with its origin at the bottom-left of the
 * crop. rig-c owns that conversion (`src/transform.ts`: `cropToSpineY`,
 * `toBoneLocal`, `computeWorldTransforms`) and its own doctrine forbids a
 * second copy of it anywhere, so this package does not write one: every stage
 * that needs Spine coordinates imports them from here, and here re-exports
 * rigc's.
 *
 * A y flip written anywhere else in `src/` is the defect this file exists to
 * prevent; the selftest holds the tree to it.
 *
 * The same goes for a bone's frame. Since issue #73 a chain link is turned to
 * point along its chain, so a point under it is placed by inverting the
 * link's setup matrix: `src/rig.ts` evaluates the setup pose with rigc's
 * `computeExactFrameTransforms` (the textbook arithmetic, in which an
 * unturned bone's frame is the identity exactly, so a bone that is not turned
 * writes the very numbers it wrote before) and binds through `toBoneLocal`;
 * `flattenRig` goes back through `toWorld`. No rotation matrix is written out
 * by hand in this package.
 */
export { computeExactFrameTransforms, computeWorldTransforms, cropToSpineY, normaliseDegrees, toBoneLocal, toWorld } from 'rig-c/src/transform.ts';
export type { BoneTransform } from 'rig-c/src/transform.ts';
