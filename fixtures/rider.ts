/**
 * Issue #391's fixture: a strip wrapped round a two-link tail. The cloth fixture's figure (fixtures/cloth.ts) without
 * its skirt and front hair — a face and long back hair as two tails — with two headwear layers and a recipe that hangs
 * one two-link tree a side. Every part is a set of flat rectangles; nothing here is art and nothing stands for any.
 *
 * By hand (fixtures/cloth.ts's numbers): the face 100,44 40x50 puts the eye axis at x 120, the eye line at y 69, and
 * head at (120, 88); back hair's fixed segment on head runs from there up to 13 px below the part's top, (120, 33).
 * The back hair ends at y 300, so the recipe hangs a tree a side from the eye line, y 69, to 4 px above the part's
 * bottom, y 296. Two links at the recipe's default ratio 0.5: q = 0.5, weights 1 and 0.5 of 1.5, so link 1 starts at
 * row 69 + 227/1.5 = 220.33 -> 220. Below the cap (rows 72 on) the right side's art is the tail alone, x 50..75, so
 * link 1 runs down its centre column, x 62 (62.5 rounded to even), from row 220 to the tip row 296.
 *
 * - `strip` (full:headwear) 44,250 38x12, all opaque: 456 px, of which the 26 columns x 12 rows over the right tail,
 *   x 50..75, are over the tail's art: 312 px. Each is within 13 px of link 1 (x 62, rows 220..296) and at least 30 px
 *   from link 0, which ends at link 1's origin (62, 220); the other 144 px are off the hair, as a ribbon's loops are.
 *   So the strip overlaps one link, `hairback_r0_1`, and rides it alone.
 * - `knot` (head:headwear, the head run's layer of the tag) 110,22 20x10, all opaque: 200 px, every one over the back
 *   hair's cap (72..167 x 20..71) and within 15 px of back hair's head segment's upper end (120, 33) — the farthest,
 *   (110, 22) or (129, 22), is sqrt(10² + 11²) = 14.9 px from it — while every link lies on or below the eye line, y
 *   69, at least 38 rows below the knot's last row, 31. It overlaps head's span and no link: it stays on head. It is
 *   the smaller headwear layer, so the accessory rule makes it a region on head.
 */
import type { ClothRecipes } from '../src/cloth.ts';
import type { ProposeFixturePart } from './propose.ts';
import { CLOTH_PARTS, CLOTH_RIG } from './cloth.ts';

export const RIDER_RIG = CLOTH_RIG;

/** The strip's box: 456 px, 312 of them over the right tail. */
export const RIDER_STRIP: ProposeFixturePart = { name: 'strip', from: 'full:headwear', x: 44, y: 250, w: 38, h: 12, colour: [200, 30, 40] };

/** The knot's box: 200 px, all over the back hair's cap, nearest its head segment. */
export const RIDER_KNOT: ProposeFixturePart = { name: 'knot', from: 'head:headwear', x: 110, y: 22, w: 20, h: 10, colour: [200, 30, 40] };

/** The figure: back hair and the face from the cloth fixture, then the two headwear layers, in draw order. */
export function riderParts(strip: ProposeFixturePart = RIDER_STRIP): ProposeFixturePart[] {
  return [...CLOTH_PARTS.filter((p) => p.name === 'hair_back'), strip, RIDER_KNOT, ...CLOTH_PARTS.filter((p) => p.name === 'face')];
}

/** One two-link tree a side; the response values are this fixture's, any that grow root to tip. */
export function riderRecipe(): ClothRecipes {
  return { 'back hair': { chains: 1, links: 2, wind: [1, 4], gravity: [1, 4] } };
}
