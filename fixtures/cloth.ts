/**
 * The cloth recipe's fixture (issue #364): a figure on a 240x360 rig with a
 * skirt, long back hair as two tails, and a front hair with one lock hanging
 * below the chin, every part a set of flat rectangles, and the recipe that
 * hangs trees on all three. Nothing here is art and nothing stands for any.
 *
 * By hand (fixtures/propose.ts's rules): the face 100,40 40x50 puts the eye
 * axis at x 120, the eye line at y 65, the chin at y 90, the neck at y 96 and
 * head at y 84. The skirt's top, y 160, + 0.14 face heights puts the hip at
 * (120, 167); the trees root 20 px below it, y 187, and tip 4 px above the
 * skirt's bottom, y 276. The skirt widens in three tiers (60, 80 and 100 px),
 * so a tree's cell centre moves outward as it goes down: the trees fan.
 * The back hair ends at y 300, below neck + 0.5 face heights (121), so it
 * hangs chains: per side, from the eye line, y 65, to y 296; its two tails
 * are x 50..79 and 160..189, one each side of the axis. The front hair's
 * strand below the chin + 4 (y 94) is x 116..125, y 94..144, 51 rows, over
 * 0.3 face heights (15): one lock, rooted 0.22 face heights above the eye
 * line (y 54) and tipped 5 px below it (y 150).
 */
import type { ClothRecipes } from '../src/cloth.ts';
import type { ProposeFixturePart } from './propose.ts';

export const CLOTH_RIG = { w: 240, h: 360 };

export const CLOTH_PARTS: ProposeFixturePart[] = [
  {
    name: 'hair_back',
    from: 'head:back hair',
    x: 50,
    y: 20,
    w: 140,
    h: 280,
    colour: [90, 60, 40],
    rects: [
      [70, 20, 100, 50],
      [50, 70, 30, 230],
      [160, 70, 30, 230],
    ],
  },
  {
    name: 'skirt',
    from: 'full:bottomwear',
    x: 70,
    y: 160,
    w: 100,
    h: 120,
    colour: [70, 110, 200],
    rects: [
      [90, 160, 60, 40],
      [80, 200, 80, 40],
      [70, 240, 100, 40],
    ],
  },
  { name: 'face', from: 'head:face', x: 100, y: 40, w: 40, h: 50, colour: [240, 210, 190] },
  {
    name: 'hair_front',
    from: 'head:front hair',
    x: 90,
    y: 25,
    w: 60,
    h: 120,
    colour: [110, 70, 50],
    rects: [
      [90, 25, 60, 30],
      [116, 55, 10, 90],
    ],
  },
];

/** The recipe the fixture is proposed with: every field the recipe has, so every rule runs. Test values, not advice. */
export function clothRecipe(): ClothRecipes {
  return {
    bottomwear: {
      chains: 5,
      links: 5,
      split: { at: 2, into: 2 },
      damping: 0.85,
      alternate_damping: 0.7,
      wind: [2, 10],
      gravity: [5, 30],
      translate: 0.3,
      swing: { scales: [1.2, 1.1, 1, 1.1, 1.2] },
    },
    'back hair': { chains: 2, links: 4, split: { at: 2, into: 2 }, wind: [1, 8], gravity: [4, 24] },
    'front hair': { chains: 1, links: 4, wind: [1, 6], gravity: [2, 12], translate: 0.3 },
  };
}
