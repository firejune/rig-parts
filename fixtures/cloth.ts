/**
 * The cloth recipe's fixture (issue #364): a figure on a 240x360 rig with a
 * skirt, long back hair as two tails, and a front hair with one lock hanging
 * below the chin, every part a set of flat rectangles, and a recipe that
 * hangs trees on all three. Nothing here is art and nothing stands for any.
 *
 * By hand (fixtures/propose.ts's rules): the face 100,44 40x50 puts the eye
 * axis at x 120, the eye line at y 69, the chin at y 94, the neck at y 100 and
 * head at y 88. The skirt's top, y 160, + 0.14 face heights puts the hip at
 * (120, 167); the trees root 20 px below it, y 187, and tip 4 px above the
 * skirt's bottom, y 276. The skirt widens in three tiers (60, 80 and 104 px),
 * so a tree's cell centre moves outward as it goes down: the trees fan.
 * The back hair ends at y 300, below neck + 0.5 face heights (125), so it
 * hangs chains: per side, from the eye line, y 69, to y 296; its two tails
 * are x 50..75 and 164..189, one each side of the axis. The front hair's
 * strand below the chin + 4 (y 98) is x 116..125, y 98..148, 51 rows, over
 * 0.3 face heights (15): one lock, rooted 0.22 face heights above the eye
 * line (11 px above it) and tipped 5 px below it (y 154).
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
      [72, 20, 96, 52],
      [50, 72, 26, 228],
      [164, 72, 26, 228],
    ],
  },
  {
    name: 'skirt',
    from: 'full:bottomwear',
    x: 68,
    y: 160,
    w: 104,
    h: 120,
    colour: [72, 110, 200],
    rects: [
      [90, 160, 60, 40],
      [80, 200, 80, 40],
      [68, 240, 104, 40],
    ],
  },
  { name: 'face', from: 'head:face', x: 100, y: 44, w: 40, h: 50, colour: [240, 210, 190] },
  {
    name: 'hair_front',
    from: 'head:front hair',
    x: 90,
    y: 25,
    w: 60,
    h: 124,
    colour: [110, 72, 50],
    rects: [
      [90, 25, 60, 34],
      [116, 59, 10, 90],
    ],
  },
];

/**
 * The recipe the fixture is proposed with: every field the recipe has, so every rule runs. The values are this
 * fixture's, chosen to exercise each rule (a skirt of four trees on a swing, forked after one link; two trees a side
 * of back hair; a lock and the fringe), not advice; `length_ratio` and `strength` are left out so the recipe's own
 * defaults are the ones built and measured.
 */
export function clothRecipe(): ClothRecipes {
  return {
    bottomwear: {
      chains: 4,
      links: 3,
      split: { at: 1, into: 2 },
      damping: 0.85,
      alternate_damping: 0.7,
      wind: [2, 10],
      gravity: [5, 30],
      translate: 0.2,
      swing: { scales: [1.3, 1, 1, 1.3] },
    },
    'back hair': { chains: 2, links: 3, split: { at: 1, into: 2 }, wind: [1, 8], gravity: [4, 24] },
    'front hair': { chains: 1, links: 3, wind: [1, 6], gravity: [2, 12], translate: 0.2 },
  };
}

/**
 * Issue #402: a dress — a skirt See-through returned inside `topwear` — on a
 * 240x480 rig, beside the same figure in a waist-length `topwear` (a blouse).
 * There is no `bottomwear` part. Flat rectangles; nothing here is art.
 *
 * By hand: the face, the hair and the eye axis are the cloth fixture's (axis
 * x 120, fh 50, neck y 100). The figure runs from the back hair's top row, y
 * 20, to the legs' last, y 470, so with no bottomwear the hip is 0.32 of that
 * height below its top: 20 + 0.32 × 450 = 164, on the axis; chest y 100 +
 * 0.5 × 64 = 132. The topwear rule's waist line is hip + 0.25 face heights,
 * y 176.5.
 *
 * The dress is a bodice x 96..143 (rows 100..169) over three tiers widening
 * to 60, 80 and 104 px (rows 170..209, 210..249, 250..289); its box ends at y
 * 290, past 176.5, so it hangs. Its art across the 24-row band at the hip,
 * rows 152..175, is x 90..149 (the bodice and the first tier's top rows): 60
 * px; across its last 24 rows, 266..289, x 68..171: 104 px, wider. Its art's
 * rows below the hip are 165 to 289. The blouse is the bodice alone: its box
 * ends at y 170, above 176.5, so it does not hang. The shift is the bodice
 * carried straight down to y 290 (a straight coat): it hangs, and is 48 px
 * across at the hip and across its last 24 rows alike, so it is not wider.
 */
export const DRESS_RIG = { w: 240, h: 480 };

const DRESS_BODICE: [number, number, number, number] = [96, 100, 48, 70];

export const DRESS: ProposeFixturePart = {
  name: 'dress',
  from: 'full:topwear',
  x: 68,
  y: 100,
  w: 104,
  h: 190,
  colour: [200, 72, 90],
  rects: [DRESS_BODICE, [90, 170, 60, 40], [80, 210, 80, 40], [68, 250, 104, 40]],
};

export const SHIFT: ProposeFixturePart = { name: 'shift', from: 'full:topwear', x: 96, y: 100, w: 48, h: 190, colour: [200, 72, 90], rects: [[96, 100, 48, 190]] };

export const BLOUSE: ProposeFixturePart = { name: 'blouse', from: 'full:topwear', x: 96, y: 100, w: 48, h: 70, colour: [200, 72, 90], rects: [DRESS_BODICE] };

/** The figure around the topwear: the cloth fixture's head (its face and both hairs) and two legs down to y 470. */
export function dressParts(topwear: ProposeFixturePart): ProposeFixturePart[] {
  const head = CLOTH_PARTS.filter((p) => p.name !== 'skirt');
  return [
    ...head,
    topwear,
    {
      name: 'legs',
      from: 'full:legwear',
      x: 100,
      y: 290,
      w: 40,
      h: 181,
      colour: [60, 60, 60],
      rects: [
        [100, 290, 14, 181],
        [126, 290, 14, 181],
      ],
    },
  ];
}
