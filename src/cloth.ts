/**
 * The cloth and hair recipe (issue #364): what `propose --cloth` drafts for a
 * `bottomwear` part and for `back hair` and `front hair` when the config's
 * `cloth` block names that tag — dense trees hung from the attachment bone,
 * physics on every link, and no idle key on any of them.
 *
 * The purpose is the world, not the loop: cloth and hair move because the
 * body under them moves and because the consumer blows wind or turns gravity
 * (the owner's direction, 2026-10-13). So each link carries a declared
 * response — rig-c's physics `wind` and `gravity`, each a scalar multiplier of
 * the environment the consumer sets (spine-core's skeleton-level `windX/windY`
 * and `gravityX/gravityY`) — that grows from the root to the tip. The
 * direction is the consumer's, and nothing here writes one.
 *
 * ⭐ Strength does not fall along a chain. A tip reads soft because each
 * link turns on top of every link above it, so the motion accumulates down
 * the chain at one strength; only the edge branch is declared softer.
 *
 * The rules, each a function of the recipe and the part's art (AUTHORING §3,
 * *Recipe: cloth and hair that answer the world*):
 *
 * - **Trees.** `chains` trees hang across the piece: tree k owns the cell
 *   [k/N, (k+1)/N] of the art's width in every row (for `back hair`, of each
 *   side's art, either side of the eye axis), and its links sit at the cell's
 *   centre in the 24-row band at their row. With `split: {at, into}` the first
 *   `at` links are the tree's trunk, and the trunk's tip forks into `into`
 *   branches, each the centre of its share of the cell, down to the tip row.
 *   Without `split`, each tree is one chain.
 * - **Lengths.** Every path from root to tip has `links` links, and link j's
 *   length is the first's times q^j, q = `length_ratio`^(1/(links − 1)), the
 *   whole spanning the root row to the tip row: the links shorten toward the
 *   tip.
 * - **Stiffness.** A trunk link takes `strength.trunk`, a branch link
 *   `strength.branch`, and the **edge** — the outermost branch on each outer
 *   side of the piece (without `split`, the outermost tree) — `strength.edge`.
 *   Every spring is held to the step's stability bound ({@link springStable}).
 * - **Response.** Link j of a path of n links takes `wind` and `gravity` at
 *   t = j/(n − 1) of the way from the declared root value to the tip value (a
 *   single-link path takes the tip value: it is a dangling end).
 * - **Out of phase.** `alternate_damping`, when declared, is the damping of
 *   every odd tree; the even ones take `damping`.
 * - **Translate.** `translate`, when declared, is the `x` and `y` mix of a
 *   second physics constraint on the last link of every path, beside its
 *   rotation, with no wind or gravity response ({@link physics} says why).
 * - **Part** (`bottomwear` only, issue #402). `part` names a `topwear` part
 *   that takes the skirt's recipe as well: a skirt See-through returned inside
 *   `topwear` (a dress). Its trees hang from the hip over its art below the
 *   hip, by the skirt's own rule, in place of the robe chains the topwear rule
 *   drafts; its art above the hip stays on the chest. The proposer never picks
 *   such a part by itself: it names a candidate, and the author declares it.
 *   A `bottomwear` part lying on that part's tree links (a hem returned as a
 *   layer of its own) rides them, as a layer on a tail does ({@link tailOverlap}),
 *   and gets no trees of its own (issue #416): one skirt, one set of trees.
 * - **Swing** (`bottomwear` only). `swing.scales` declares one shared pendulum:
 *   a bone `<prefix>swing` under the attachment at the centre of the root row,
 *   one link long, with physics; each tree's first link takes the swing's
 *   rotation times its scale (a transform constraint, local source and target,
 *   additive) instead of a physics constraint of its own.
 *
 * Two numbers have defaults, {@link RECIPE_LENGTH_RATIO} and
 * {@link RECIPE_STRENGTH}: the recipe's own, chosen and measured on this
 * package's synthetic fixture (`fixtures/cloth.ts`); each says what was
 * measured. Every other number is the author's.
 *
 * Pure: no clock, no randomness; every value is a function of its inputs.
 */
import type { ConfigConstraint, Point } from './config.ts';
import type { Mask } from './raster/types.ts';
import { pyRound } from './round.ts';
import { segmentDistance } from './weights.ts';

/** The tags a `cloth` recipe may name: the parts the proposer drafts chains on that hang. */
export const CLOTH_TARGETS = ['bottomwear', 'back hair', 'front hair'] as const;
export type ClothTarget = (typeof CLOTH_TARGETS)[number];

/** The per-branch stiffness of a tree. */
export interface ClothStrength {
  trunk: number;
  branch: number;
  edge: number;
}

/** One target's recipe, as `config.cloth.<tag>` declares it. */
export interface ClothRecipe {
  chains: number;
  links: number;
  split?: { at: number; into: number; hold_tip?: boolean };
  length_ratio?: number;
  strength?: ClothStrength;
  damping?: number;
  alternate_damping?: number;
  /** `[root, tip]`: the wind response of a path's first link and of its last. */
  wind: [number, number];
  /** `[root, tip]`: the gravity response of a path's first link and of its last. */
  gravity: [number, number];
  translate?: number;
  swing?: { scales: number[] };
  /** `bottomwear` only: a `topwear` part or its named cut skirt piece the skirt's trees are drafted on. */
  part?: string;
}

export type ClothRecipes = Partial<Record<ClothTarget, ClothRecipe>>;

/**
 * 📐 The default ratio of a path's last link to its first: 0.5, the recipe's
 * own. Measured on the cloth fixture (fixtures/cloth.ts, rig-c 2.47.1, the
 * selftest's CK420 build): see AUTHORING §3, *Recipe: cloth and hair*, which
 * holds the figures. Links halve from root to tip, whatever their count.
 */
export const RECIPE_LENGTH_RATIO = 0.5;

/**
 * 📐 The default stiffness: trunk and branch 100 — rig-c's own default
 * `strength`, so the trunk and the main branches are as stiff as an
 * undeclared spring — and the edge 50, half of it: the edge is the one part
 * declared softer. The recipe's own, measured on the cloth fixture
 * (AUTHORING §3, *Recipe: cloth and hair*). Each is below the stability bound
 * at every damping in [0, 1] ({@link springStable}: 100/3600 against at
 * least 2).
 */
export const RECIPE_STRENGTH: Readonly<ClothStrength> = { trunk: 100, branch: 100, edge: 50 };

/** rig-c's default physics `damping` (its `RigPhysicsConstraint` doc: "Defaults: 0.5 / 100 / 0.85 / 1 / 0 / 0 / 1"), which a recipe without `damping` runs at. */
export const RIGC_DEFAULT_DAMPING = 0.85;

/** rig-c's default physics `fps` (`step = 1/fps`) and `mass` (`massInverse = 1/mass`), neither of which a recipe sets. */
export const RIGC_DEFAULT_FPS = 60;
export const RIGC_DEFAULT_MASS = 1;

/**
 * The stability of one physics spring at its step (A23's inequality). Per step
 * spine-core does `v += -strength·x·step·massInverse; x += v·step; v *=
 * d`, d = damping^(60·step). In (x, v·step) that is the matrix
 * [[1 − k, 1], [−d·k, d]], k = strength·massInverse·step², with trace
 * 1 − k + d and determinant d; both eigenvalues lie inside the unit circle
 * exactly when 0 < k < 2(1 + d) (and d < 1; at d = 1 the spring rings without
 * decay but does not grow). Returns k, the bound and whether k is below it.
 */
export function springStable(strength: number, damping: number, fps = RIGC_DEFAULT_FPS, mass = RIGC_DEFAULT_MASS): { k: number; bound: number; ok: boolean } {
  const step = 1 / fps;
  const k = (strength / mass) * step * step;
  const bound = 2 * (1 + damping ** (60 * step));
  return { k, bound, ok: k > 0 && k < bound };
}

/** The decimals a drafted physics number is written to: enough for a ramp of a few links, short enough to read. */
export const CLOTH_DECIMALS = 6;

/** What a link is in its tree, which sets its stiffness. */
export type LinkRole = 'trunk' | 'branch' | 'edge';

/** One drafted chain of a tree. */
export interface TreeChain {
  chain: string;
  parent: string;
  points: Point[];
  tip: Point;
  /** One rule per point, then the tip's: what each was read off. */
  why: string[];
  tipWhy: string;
  /** Which tree (0-based, across the piece or its side) this chain belongs to. */
  tree: number;
  /** The role of each link. */
  roles: LinkRole[];
  /** Each link's depth from its tree's root (0 = the root link). */
  depths: number[];
  /** Whether each link is the last of its path. */
  last: boolean[];
}

/** Which outer sides of the piece are edges: both (a skirt, a lock), or one side of the eye axis (back hair). */
export type EdgeSides = 'both' | 'r' | 'l';

export interface TreeInput {
  /** The chains' name prefix: tree k's trunk is `<prefix><k>_`, its branches `<prefix><k><a|b|…>_`. */
  prefix: string;
  parent: string;
  /** The root row (the first link's origin) and the tip row (the last link's tip), rig px, y down. */
  rootY: number;
  tipY: number;
  /** The art's x at row y, `frac` of the way across the cell's frame (0 = the frame's left edge), or null when the band holds no art there. */
  xAt: (y: number, frac: number) => number | null;
  /** Where a link falls when its band holds no art. */
  fallbackX: (frac: number) => number;
  /** What the cell's frame is, for the rules: "skirt's art", "the r side of back's art". */
  frame: string;
  edges: EdgeSides;
}

/** The rows the n links of a path start at, then its tip's: lengths in the ratio q^j, from root row to tip row. */
export function linkRows(rootY: number, tipY: number, links: number, ratio: number): number[] {
  const q = links === 1 ? 1 : ratio ** (1 / (links - 1));
  const w: number[] = [];
  for (let j = 0; j < links; j++) w.push(q ** j);
  const total = w.reduce((a, b) => a + b, 0);
  const rows = [rootY];
  let acc = 0;
  for (let j = 0; j < links; j++) {
    acc += w[j];
    rows.push(j === links - 1 ? tipY : rootY + ((tipY - rootY) * acc) / total);
  }
  return rows;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The trees of one piece, in tree order, each trunk before its branches. */
export function draftTrees(input: TreeInput, r: ClothRecipe): TreeChain[] {
  const n = r.chains;
  const ratio = r.length_ratio ?? RECIPE_LENGTH_RATIO;
  const rows = linkRows(input.rootY, input.tipY, r.links, ratio);
  const at = r.split === undefined ? r.links : r.split.at;
  const into = r.split === undefined ? 1 : r.split.into;
  const out: TreeChain[] = [];
  const x = (y: number, f: number): number => input.xAt(y, f) ?? input.fallbackX(f);
  const pt = (y: number, f: number): Point => [pyRound(x(y, f), 0), pyRound(y, 0)];
  const rowRule = (j: number): string =>
    `link ${j}'s row: ${j === 0 ? 'the root row' : `the root row + ${pyRound((rows[j] - rows[0]) / (rows[r.links] - rows[0]), 4)} of the span to the tip row`} (lengths in the ratio ${pyRound(ratio, 6)} last to first)`;
  const outerSide = (k: number, b: number): boolean => {
    const left = k === 0 && b === 0;
    const right = k === n - 1 && b === into - 1;
    return input.edges === 'both' ? left || right : input.edges === 'r' ? left : right;
  };
  for (let k = 0; k < n; k++) {
    const fc = (k + 0.5) / n;
    const trunkLinks = Math.min(at, r.links);
    const trunkEdge = into === 1 && outerSide(k, 0);
    const trunk: TreeChain = {
      chain: `${input.prefix}${k}_`,
      parent: input.parent,
      points: [],
      tip: pt(rows[trunkLinks], fc),
      why: [],
      tipWhy: `${trunkLinks === r.links ? 'the tip row' : `link ${trunkLinks}'s row, the fork`}, ${pyRound(fc, 6)} of the way across ${input.frame} (tree ${k} of ${n}, the centre of its cell)`,
      tree: k,
      roles: [],
      depths: [],
      last: [],
    };
    for (let j = 0; j < trunkLinks; j++) {
      trunk.points.push(pt(rows[j], fc));
      trunk.why.push(`${rowRule(j)}, ${pyRound(fc, 6)} of the way across ${input.frame} in the 24-row band there (tree ${k} of ${n}, the centre of its cell)`);
      trunk.roles.push(into === 1 ? (trunkEdge ? 'edge' : 'trunk') : 'trunk');
      trunk.depths.push(j);
      trunk.last.push(into === 1 && j === trunkLinks - 1);
    }
    out.push(trunk);
    if (into === 1) continue;
    for (let b = 0; b < into; b++) {
      const fb = (k + (b + 0.5) / into) / n;
      const ch: TreeChain = {
        chain: `${input.prefix}${k}${LETTERS[b]}_`,
        parent: `${trunk.chain}${trunkLinks - 1}`,
        points: [],
        tip: pt(rows[r.links], fb),
        why: [],
        tipWhy: `the tip row, ${pyRound(fb, 6)} of the way across ${input.frame} (branch ${b} of ${into} of tree ${k}, the centre of its share of the cell)`,
        tree: k,
        roles: [],
        depths: [],
        last: [],
      };
      const edge = r.split?.hold_tip === true ? false : outerSide(k, b);
      for (let j = trunkLinks; j < r.links; j++) {
        ch.points.push(j === trunkLinks ? trunk.tip : pt(rows[j], fb));
        ch.why.push(j === trunkLinks ? `the fork: the trunk ${trunk.chain}'s tip` : `${rowRule(j)}, ${pyRound(fb, 6)} of the way across ${input.frame} in the 24-row band there (branch ${b} of ${into} of tree ${k})`);
        ch.roles.push(edge ? 'edge' : 'branch');
        ch.depths.push(j);
        ch.last.push(j === r.links - 1);
      }
      out.push(ch);
    }
  }
  return out;
}

/** The value t of the way from a `[root, tip]` pair's root to its tip, to {@link CLOTH_DECIMALS}. */
function ramp(pair: readonly [number, number], t: number): number {
  return pyRound(pair[0] + t * (pair[1] - pair[0]), CLOTH_DECIMALS);
}

/** Where link `depth` of a path of `links` links sits on the root-to-tip ramp. */
export function rampAt(depth: number, links: number): number {
  return links === 1 ? 1 : depth / (links - 1);
}

/** The physics constraint name of a bone. */
export function physicsName(bone: string): string {
  return `${bone}_physics`;
}

/** The translate constraint name of a bone (a dangling end's flutter). */
export function translateName(bone: string): string {
  return `${bone}_translate`;
}

/**
 * A link's physics, its fields in a fixed order: the rotation with the link's
 * wind and gravity response, and — on the last link of a path, when the recipe
 * declares `translate` — a second constraint moving x and y by that mix, with
 * the same stiffness and damping and no response at all.
 *
 * ⭐ Why the flutter carries no response: spine-core scales a translate
 * spring's wind and gravity by the skeleton's reference scale (100 by
 * default) and a rotation's by the link's length over it, so one response on
 * both components pushes the end ~100/length times further sideways than it
 * turns it. Measured on the cloth fixture (fixtures/cloth.ts, its recipe, the
 * recipe's default strength, rig-c 2.47.1's render under spine-core's default
 * environment), check's TEXTURE_STRETCH severity (ceiling 1.927) with the
 * translate mix at 0.2 / 0.5 / 1: split so, 1.382 / 1.388 / 1.398; with the
 * link's response on the translate too, 1.65 / 3.233 / 3.814.
 */
function physics(bone: string, r: ClothRecipe, role: LinkRole, t: number, tree: number, last: boolean): ConfigConstraint[] {
  const s = r.strength ?? RECIPE_STRENGTH;
  const damping = tree % 2 === 1 && r.alternate_damping !== undefined ? r.alternate_damping : r.damping;
  const c: ConfigConstraint = { type: 'physics', name: physicsName(bone), bone, rotate: 1, strength: s[role] };
  if (damping !== undefined) c.damping = damping;
  c.wind = ramp(r.wind, t);
  c.gravity = ramp(r.gravity, t);
  if (!last || r.translate === undefined) return [c];
  const tr: ConfigConstraint = { type: 'physics', name: translateName(bone), bone, x: r.translate, y: r.translate, strength: s[role] };
  if (damping !== undefined) tr.damping = damping;
  return [c, tr];
}

/** The swing bone's name for a prefix. */
export function swingName(prefix: string): string {
  return `${prefix}_swing`;
}

/**
 * The constraints of a piece's trees: with a swing, the swing's physics and
 * one transform per tree first, then a physics constraint per link in bone
 * order — a parent's before its child's, so each spring reads its parent's
 * settled pose. `swingRest` is the swing's setup rotation in its parent's
 * frame, Spine degrees (y up), which the transform subtracts so the trees take
 * only the swing's motion.
 */
export function treeConstraints(trees: readonly TreeChain[], r: ClothRecipe, swing: { bone: string; rest: number } | null): ConfigConstraint[] {
  const out: ConfigConstraint[] = [];
  if (swing !== null && r.swing !== undefined) {
    out.push(...physics(swing.bone, r, 'trunk', 0, 0, false));
    const scales = r.swing.scales;
    for (const t of trees) {
      if (t.depths[0] !== 0) continue;
      out.push({
        type: 'transform',
        name: `${swing.bone}_${t.tree}`,
        source: swing.bone,
        bones: [`${t.chain}0`],
        localSource: true,
        localTarget: true,
        additive: true,
        properties: { rotate: { offset: swing.rest, to: { rotate: { scale: scales[t.tree] } } } },
        mixRotate: 1,
      });
    }
  }
  for (const t of trees) {
    t.points.forEach((_, i) => {
      if (swing !== null && t.depths[i] === 0) return;
      out.push(...physics(`${t.chain}${i}`, r, t.roles[i], rampAt(t.depths[i], r.links), t.tree, t.last[i]));
    });
  }
  return out;
}

/**
 * The physics of a chain the recipe does not shape (the fringe's columns,
 * whose two links the fringe rule places): every link a trunk link of a
 * one-tree path, an outer column's links the edge's, on the recipe's ramp
 * over the chain's own links.
 */
export function chainConstraints(chain: string, links: number, tree: number, edge: boolean, r: ClothRecipe): ConfigConstraint[] {
  const out: ConfigConstraint[] = [];
  for (let i = 0; i < links; i++) out.push(...physics(`${chain}${i}`, r, edge ? 'edge' : 'trunk', rampAt(i, links), tree, i === links - 1));
  return out;
}

/**
 * The one note a piece drafted by the recipe gets. `via` is the part's own
 * `from` when the recipe reached it by `part` rather than by its tag
 * (issue #402); absent, the note is the one written before the field existed.
 */
export function clothNote(part: string, tag: ClothTarget, trees: readonly TreeChain[], r: ClothRecipe, constraints: number, extra: string, via?: string): string {
  const defaults: string[] = [];
  if (r.length_ratio === undefined) defaults.push(`length_ratio ${RECIPE_LENGTH_RATIO}`);
  if (r.strength === undefined) defaults.push(`strength ${RECIPE_STRENGTH.trunk}/${RECIPE_STRENGTH.branch}/${RECIPE_STRENGTH.edge}`);
  const shape = r.split === undefined ? `${r.links} link(s) each` : `a ${r.split.at}-link trunk forking into ${r.split.into} branches${r.split.hold_tip === true ? ' (tip held)' : ''}, ${r.links} links root to tip`;
  return (
    `${part} (${via === undefined ? tag : `${via}, which config.cloth."${tag}".part names`}): config.cloth."${tag}" -> ${r.chains} tree(s)${extra}, ${shape} (${trees.map((t) => t.chain).join(', ')}); ` +
    `${constraints} constraint(s), physics on every link, wind ${r.wind[0]} -> ${r.wind[1]} and gravity ${r.gravity[0]} -> ${r.gravity[1]} root to tip (multipliers of the consumer's environment; no direction is drafted), no idle key` +
    (defaults.length === 0 ? '' : `; the recipe's own defaults, measured on its synthetic fixture (AUTHORING §3): ${defaults.join(', ')}`)
  );
}

/**
 * Issue #391: a part wrapped round a tail the recipe drafted rides that tail's links. One span of the tail: a segment
 * of the back hair's mesh as the recipe drafts it — the head's fixed segment, or one tree link from its origin to the
 * next link (the last to the chain's tip), named by the link's bone.
 */
export interface TailSpan {
  bone: string;
  a: Point;
  b: Point;
  /** Whether the span is a tree link (false: the head's fixed segment). */
  link: boolean;
}

/** A tail the recipe drafted: the back hair part, its opaque mask on the rig canvas, and its mesh's spans in segment order. */
export interface Tail {
  part: string;
  mask: Mask;
  spans: TailSpan[];
}

/** Where a part's opaque pixels lie against a drafted tail. */
export interface TailOverlap {
  /** Per span, in the tail's order: the part's pixels over the tail's art whose nearest span it is. */
  counts: number[];
  /** The part's pixels over the tail's art (the sum of `counts`). */
  over: number;
  /** The part's opaque pixels in all. */
  total: number;
}

/**
 * Which span of the tail each of the part's pixels over the tail's art belongs to: every pixel where both masks are
 * set is given to the span nearest it — the distance the weights read (`segmentDistance`, `src/weights.ts`), so a
 * span here is the art the tail's own weights give mostly to that bone — the first in the tail's order on a tie. No
 * threshold: a span the part touches by one pixel is one the part overlaps, and the counts are said in the note.
 * Pure; the part's mask and the tail's are on the same canvas.
 */
export function tailOverlap(tail: Tail, part: Mask, box: { x: number; y: number; w: number; h: number }): TailOverlap {
  const counts = tail.spans.map(() => 0);
  let over = 0;
  let total = 0;
  const W = part.width;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = y * W + x;
      if (part.data[i] === 0) continue;
      total++;
      if (tail.mask.data[i] === 0) continue;
      over++;
      let best = 0;
      let bd = Infinity;
      tail.spans.forEach((s, k) => {
        const d = segmentDistance([x, y], s.a, s.b);
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      counts[best]++;
    }
  }
  return { counts, over, total };
}
