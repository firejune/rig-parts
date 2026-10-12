/**
 * The one length this package writes (issues #270, #279): `sqrt(dx * dx + dy * dy)`.
 *
 * Not `Math.hypot`. The language does not promise how `Math.hypot` rounds, and
 * Bun 1.4.2 rounds it differently on two platforms: on the demo's `earring`,
 * edge 11-10 at idle frame 10 (dx 34.26716181006313, dy 0.5713103861783111),
 * it is 34.27192399143071 on macOS and 34.27192399143072 on Linux, measured,
 * with the posed vertices bit-identical on both. That last bit decided which of
 * two edges 2 ulp apart held a mesh's largest ratio, so `TEXTURE_STRETCH`'s
 * `max_at` named one triangle on one machine and another on the other (#276).
 * A multiply, an add and a square root are each correctly rounded by IEEE 754,
 * so this gives the same bits everywhere (34.27192399143071 on both, measured).
 * At pixel scale `Math.hypot`'s guard against overflow is not needed: a
 * coordinate would have to pass about 1e154 for the squares to overflow.
 *
 * The tree rule `TY15` refuses a call of `Math.hypot` anywhere under `src/` and in
 * `cli.ts`, so every length is this one.
 */
export function edgeLength(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}
