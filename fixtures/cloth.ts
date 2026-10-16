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
import type { RigJoints } from '../src/keypoints.ts';
import { KEYPOINT_NAMES } from '../src/skeleton.ts';
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

/**
 * Issue #416: a ruffle hem See-through returned as a `bottomwear` layer of its own, across the dress's last tier
 * and 6 rows past it: x 64..175, y 270..295, 112x26 = 2912 px. Flat colour; nothing here is art.
 *
 * A `bottomwear` part puts the hip at its top edge + 0.14 face heights (src/propose.ts), which for a hem is not the
 * waist, so the figure is proposed with the hip from joints ({@link dressHipJoints}): r_hip (110, 164) and l_hip
 * (130, 164), whose midpoint is the hip the dress fixture reads without a bottomwear, (120, 164); every figure of the
 * dress's trees is then PR482's (fixtures/cloth.ts's dress: skirt0_ [[105,184],[94,252]] -> [94,286], skirt1_
 * [[134,184],[145,252]] -> [145,286]).
 *
 * By hand: the hem's pixels over the dress's art are rows 270..289 of the last tier, x 68..171, 104 x 20 = 2080 of
 * its 2912. Each is nearest the link skirt0_1 (x 94, rows 252..286) or skirt1_1 (x 145): for a pixel in rows
 * 270..286 the distances are |x - 94| and |x - 145|, and in rows 287..289 both segments end at row 286, so the row
 * term is the same for both; the split is x 119 | 120 (119.5 is the midpoint), 52 columns a side, 1040 px each. No
 * other span is nearer: the first links end at row 252, at least 18 rows above, and the waist line is at row 169.
 * {@link HEM_BELOW} is the same hem moved under the dress's box (y 300..325): over none of its art.
 */
export const HEM: ProposeFixturePart = { name: 'hem', from: 'full:bottomwear', x: 64, y: 270, w: 112, h: 26, colour: [240, 240, 240], rects: [[64, 270, 112, 26]] };

export const HEM_BELOW: ProposeFixturePart = { ...HEM, y: 300, rects: [[64, 300, 112, 26]] };

/** The dress figure's two hip joints, rig px, every other joint missing: the hip at their midpoint, (120, 164). */
export function dressHipJoints(): RigJoints {
  const missing = { state: 'missing' as const, at: null, score: null, listed: false };
  const joints = Object.fromEntries(KEYPOINT_NAMES.map((n) => [n, missing])) as RigJoints['joints'];
  joints.r_hip = { state: 'observed', at: [110, 164], score: null, listed: true };
  joints.l_hip = { state: 'observed', at: [130, 164], score: null, listed: true };
  return { person: 'fixture', source: 'fixtures/cloth.ts', painting: [DRESS_RIG.w, DRESS_RIG.h], rig: [DRESS_RIG.w, DRESS_RIG.h], joints };
}

/**
 * Issue #437: a tail split into two draw layers on {@link CLOTH_RIG} (240x360) —
 * `hair_back` drawn behind the skirt (`x 57..68, y 56..244`, 12x189 px) and
 * `hair_back_front` drawn in front of the skirt (`x 57..68, y 245..299`, 12x55 px) —
 * spanned by one 3-link tree `hairback_r0_` (`[63, 69] -> [63, 172] -> [63, 245] -> [63, 296]`):
 * links 0 and 1 cross `hair_back` (103 and 73 px, 0 on `hair_back_front`) and
 * link 2 crosses `hair_back_front` (51 px, 0 on `hair_back`).
 */
export const SPLIT_TAIL_PARTS: ProposeFixturePart[] = [
  {
    name: 'hair_back',
    from: 'full:back hair',
    x: 57,
    y: 56,
    w: 12,
    h: 189,
    colour: [90, 60, 40],
    rects: [[57, 56, 12, 189]],
  },
  CLOTH_PARTS[1]!,
  CLOTH_PARTS[2]!,
  {
    name: 'hair_front',
    from: 'head:front hair',
    x: 90,
    y: 25,
    w: 60,
    h: 34,
    colour: [110, 72, 50],
    rects: [[90, 25, 60, 34]],
  },
  {
    name: 'hair_back_front',
    from: 'full:back hair',
    cut_from: 'hair_back',
    x: 57,
    y: 245,
    w: 12,
    h: 55,
    colour: [90, 60, 40],
    rects: [[57, 245, 12, 55]],
  },
];

/** An uncrossed headwear part above the eye line (`y 20..35`), for the negative control on `cloth."back hair".parts`. */
export const SPLIT_TAIL_UNCROSSED: ProposeFixturePart = {
  name: 'knot',
  from: 'head:headwear',
  x: 108,
  y: 20,
  w: 24,
  h: 16,
  colour: [200, 60, 80],
  rects: [[108, 20, 24, 16]],
};

export function splitTailRecipe(parts: string[] = ['hair_back', 'hair_back_front']): ClothRecipes {
  return {
    'back hair': {
      chains: 1,
      links: 3,
      wind: [1, 8],
      gravity: [4, 24],
      parts,
    },
  };
}

/**
 * Issue #438: a floor-spread skirt on {@link CLOTH_RIG} (240x360) whose side
 * wings spread out on the floor (`x 40..79` and `x 160..199, y 230..279`) while
 * the middle hem ends at `y 229` above bare thighs (`legs` at `x 84..115` and
 * `x 124..155, y 215..334`). Under a uniform `tipY = p.y + p.h - 4 = 276`, the
 * middle trees' branch tips (`[90, 276]`, `[110, 276]`, `[129, 276]`, `[149, 276]`)
 * land on bare thigh (`skirt` alpha 0, `legs` alpha 255) and their middle links
 * (`skirt1b_1` at `[110, 256]`, `skirt2a_1` at `[129, 256]`) trigger the two
 * `LINT <bone> at [x, y] is off the art of mesh 'skirt'` lines; when each column
 * places its tip from the cloth's own alpha row (`y = 226` for trees 1 and 2,
 * `y = 276` for trees 0 and 3), every tip sits on opaque cloth (`alpha = 255`)
 * and all off-art LINT lines are absent.
 */
export const FLOOR_SKIRT_PARTS: ProposeFixturePart[] = [
  CLOTH_PARTS[0]!,
  {
    name: 'legs',
    from: 'full:legwear',
    x: 84,
    y: 215,
    w: 72,
    h: 120,
    colour: [240, 210, 190],
    rects: [
      [84, 215, 32, 120],
      [124, 215, 32, 120],
    ],
  },
  {
    name: 'skirt',
    from: 'full:bottomwear',
    x: 40,
    y: 160,
    w: 160,
    h: 120,
    colour: [72, 110, 200],
    rects: [
      [80, 160, 80, 35],
      [40, 195, 160, 35],
      [40, 230, 40, 50],
      [160, 230, 40, 50],
    ],
  },
  CLOTH_PARTS[2]!,
  CLOTH_PARTS[3]!,
];

/**
 * Issue #438: a variant of {@link FLOOR_SKIRT_PARTS} whose rightmost column
 * (`k = 3`, `x = 160..199`) holds cloth only in the waistband above the root row
 * (`y = 160..186 < rootY = 187`), so column 3 has no cloth below `rootY` and
 * gets no tree drafted there, with a note saying so.
 */
export const FLOOR_SKIRT_EMPTY_COL_PARTS: ProposeFixturePart[] = FLOOR_SKIRT_PARTS.map((p) =>
  p.name === 'skirt'
    ? {
        ...p,
        rects: [
          [80, 160, 120, 27],
          [40, 187, 120, 43],
          [40, 230, 40, 50],
        ],
      }
    : p,
);

