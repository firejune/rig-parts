/**
 * `rig-parts painting`: what a painting must be before See-through runs on it,
 * read off the painting and its body-18 joints alone (issue #350).
 *
 * A painting with the arms against the body, the hands together or the legs
 * painted as one column is found today at the far end of the pipeline — a
 * sleeve layer that holds the torso, a leg chain that drags the other leg, a
 * dance clip that tears. Every one of those is decidable at minute one from two
 * things: where the figure is (the painting's pixels) and where its joints are
 * (the keypoint file `propose --keypoints` reads, `src/keypoints.ts`). This
 * module decides them, and `docs/PAINTING.md` says why each one matters.
 *
 * **Definitions, each one a sentence and no tuned number:**
 *
 * - **Ground** is a pixel the repository already calls background: alpha at or
 *   below {@link OPAQUE_ALPHA_ABOVE} (not painted, `src/layers.ts`), or every
 *   colour channel above {@link NEAR_WHITE_MIN} (near-white, the one test the
 *   assemble stage and the layer plausibility figures share).
 * - **The background** is the ground that reaches the image's edge: every
 *   ground pixel 4-connected to a ground pixel on the border. A white highlight
 *   inside the figure is ground and not background, because line art closes it
 *   off; so a blouse that is white does not read as a hole in the figure.
 * - **The figure** is every pixel that is not background.
 * - **A gap between two joints** is at least one background pixel on the
 *   straight line between them, sampled at `n + 1` evenly spaced points with
 *   `n = max(ceil(max(|dx|, |dy|)), 1)` — at least one point per pixel crossed
 *   — each read at the pixel that holds it (floor, the image's right and bottom
 *   edges taken as the last column and row).
 *
 * **The rules, each a refusal by name:**
 *
 * - `PAINTING_BACKGROUND_PLAIN` — every border pixel is ground. A plain light
 *   background is what makes the figure readable at all; a border pixel that is
 *   not ground is scenery, a floor, a gradient, or the figure cut by the frame.
 * - `PAINTING_JOINTS_STATED` — the eight joints the gap rules read (wrists,
 *   hips, knees, ankles) are `observed` with a position. An occluded wrist is a
 *   hand the painting does not show.
 * - `PAINTING_JOINT_ON_FIGURE` — every observed joint's pixel is figure, not
 *   background. A joint off the figure is a keypoint file for another painting,
 *   or a limb the painting does not hold where the file says.
 * - `PAINTING_ARM_CLEAR` — on each side, a gap between the wrist and the hip
 *   of the same side. None is an arm painted against the body.
 * - `PAINTING_HANDS_APART` — a gap between the two wrists. None is hands
 *   together: clasped, or touching.
 * - `PAINTING_LEGS_APART` — a gap between the two knees and a gap between the
 *   two ankles. None is legs painted as one column at that joint.
 *
 * Pure: the caller reads the files and hands over a raster and a person.
 */
import type { Problem } from './errors.ts';
import type { KeypointPerson } from './keypoints.ts';
import { NEAR_WHITE_MIN, OPAQUE_ALPHA_ABOVE } from './layers.ts';
import type { Raster } from './raster/types.ts';
import type { KeypointName } from './skeleton.ts';

/** The joints the gap rules read, in the order a refusal lists them. */
export const PAINTING_JOINTS: readonly KeypointName[] = ['r_wrist', 'l_wrist', 'r_hip', 'l_hip', 'r_knee', 'l_knee', 'r_ankle', 'l_ankle'];

/** The four gap rules' pairs: the rule, the two joints, and what the pair is called in a line. */
export const PAINTING_GAPS: ReadonlyArray<readonly [string, KeypointName, KeypointName, string]> = [
  ['PAINTING_ARM_CLEAR', 'r_wrist', 'r_hip', 'right arm (r_wrist to r_hip)'],
  ['PAINTING_ARM_CLEAR', 'l_wrist', 'l_hip', 'left arm (l_wrist to l_hip)'],
  ['PAINTING_HANDS_APART', 'r_wrist', 'l_wrist', 'hands (r_wrist to l_wrist)'],
  ['PAINTING_LEGS_APART', 'r_knee', 'l_knee', 'knees (r_knee to l_knee)'],
  ['PAINTING_LEGS_APART', 'r_ankle', 'l_ankle', 'ankles (r_ankle to l_ankle)'],
];

/** What each gap rule requires, in the words its refusal ends with. */
const GAP_REQUIRED: Readonly<Record<string, string>> = {
  PAINTING_ARM_CLEAR: 'the arm painted clear of the body, so the line from the wrist to the hip of its side crosses background',
  PAINTING_HANDS_APART: 'the hands painted apart, so the line between the wrists crosses background',
  PAINTING_LEGS_APART: 'the legs painted apart, so the line between the two joints crosses background',
};

/** One gap reading: the pair, the line's length and samples, and how many of them are background. */
export interface GapReading {
  rule: string;
  a: KeypointName;
  b: KeypointName;
  what: string;
  from: [number, number];
  to: [number, number];
  samples: number;
  background: number;
}

export interface PaintingReading {
  width: number;
  height: number;
  /** Pixels on the border, counted once each. */
  border: number;
  /** Border pixels that are not ground, and the first one in raster order. */
  borderNotGround: number;
  firstBorderNotGround: [number, number] | null;
  backgroundPx: number;
  figurePx: number;
  /** Every observed joint, its pixel, and whether that pixel is figure. */
  joints: Array<{ name: KeypointName; at: [number, number]; pixel: [number, number]; onFigure: boolean }>;
  /** The gap readings whose two joints are both observed with a position. */
  gaps: GapReading[];
}

/** Whether pixel `i` of `r` is ground: not painted, or near-white in every channel. */
function isGround(r: Raster, i: number): boolean {
  const d = r.data;
  const o = i * 4;
  return d[o + 3] <= OPAQUE_ALPHA_ABOVE || (d[o] > NEAR_WHITE_MIN && d[o + 1] > NEAR_WHITE_MIN && d[o + 2] > NEAR_WHITE_MIN);
}

/** The background: every ground pixel 4-connected to a ground pixel on the border. One byte per pixel, 1 = background. */
export function backgroundMask(r: Raster): Uint8Array {
  const { width: w, height: h } = r;
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number): void => {
    if (bg[i] === 0 && isGround(r, i)) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  return bg;
}

/** The pixel holding a continuous painting point: floor, the right and bottom edges taken as the last column and row. */
export function pixelOf(at: readonly [number, number], w: number, h: number): [number, number] {
  return [Math.min(Math.floor(at[0]), w - 1), Math.min(Math.floor(at[1]), h - 1)];
}

/** The pixels the line from `a` to `b` is sampled at: `n + 1` evenly spaced points, `n = max(ceil(max(|dx|, |dy|)), 1)`. */
export function linePixels(a: readonly [number, number], b: readonly [number, number], w: number, h: number): Array<[number, number]> {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const n = Math.max(Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))), 1);
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) out.push(pixelOf([a[0] + (dx * i) / n, a[1] + (dy * i) / n], w, h));
  return out;
}

/** Read the painting against the person's joints: every figure the rules decide on, before any rule decides. */
export function readPainting(r: Raster, person: KeypointPerson): PaintingReading {
  const { width: w, height: h } = r;
  const bg = backgroundMask(r);
  let border = 0;
  let borderNotGround = 0;
  let firstBorderNotGround: [number, number] | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y !== 0 && y !== h - 1 && x !== 0 && x !== w - 1) continue;
      border++;
      if (!isGround(r, y * w + x)) {
        borderNotGround++;
        firstBorderNotGround ??= [x, y];
      }
    }
  }
  let backgroundPx = 0;
  for (const v of bg) backgroundPx += v;
  const joints: PaintingReading['joints'] = [];
  for (const [name, j] of Object.entries(person.joints) as Array<[KeypointName, KeypointPerson['joints'][KeypointName]]>) {
    if (j.state !== 'observed' || j.at === null) continue;
    const pixel = pixelOf(j.at, w, h);
    joints.push({ name, at: j.at, pixel, onFigure: bg[pixel[1] * w + pixel[0]] === 0 });
  }
  const gaps: GapReading[] = [];
  for (const [rule, a, b, what] of PAINTING_GAPS) {
    const ja = person.joints[a];
    const jb = person.joints[b];
    if (ja.state !== 'observed' || jb.state !== 'observed' || ja.at === null || jb.at === null) continue;
    const line = linePixels(ja.at, jb.at, w, h);
    let background = 0;
    for (const [x, y] of line) background += bg[y * w + x];
    gaps.push({ rule, a, b, what, from: ja.at, to: jb.at, samples: line.length, background });
  }
  return { width: w, height: h, border, borderNotGround, firstBorderNotGround, backgroundPx, figurePx: w * h - backgroundPx, joints, gaps };
}

const pt = (p: readonly [number, number]): string => `[${p[0]}, ${p[1]}]`;

/** The refusals a reading earns, every one at once, in the order the module's comment lists the rules. */
export function paintingProblems(reading: PaintingReading, person: KeypointPerson, painting: string, keypoints: string): Problem[] {
  const problems: Problem[] = [];
  if (reading.borderNotGround > 0) {
    const f = reading.firstBorderNotGround as [number, number];
    problems.push({
      code: 'PAINTING_BACKGROUND_PLAIN',
      object: `painting ${painting}`,
      detail: `${reading.borderNotGround} of its ${reading.border} border pixels are not background-coloured, the first at ${pt(f)}; every border pixel near-white (each channel above ${NEAR_WHITE_MIN}) or unpainted (alpha ${OPAQUE_ALPHA_ABOVE} or less) is required — a plain light background, with the whole figure inside the frame`,
    });
  }
  for (const n of PAINTING_JOINTS) {
    const j = person.joints[n];
    if (j.state === 'observed' && j.at !== null) continue;
    problems.push({
      code: 'PAINTING_JOINTS_STATED',
      object: `${keypoints} person "${person.id}" joint ${n}`,
      detail: `is ${j.listed ? j.state : 'not listed'}${j.at === null ? '' : ` at ${pt(j.at)}`}; observed with a position is required — the gap rules read ${PAINTING_JOINTS.join(', ')}, and a joint the painting does not show is a limb it cannot rig`,
    });
  }
  for (const j of reading.joints) {
    if (j.onFigure) continue;
    problems.push({
      code: 'PAINTING_JOINT_ON_FIGURE',
      object: `${keypoints} person "${person.id}" joint ${j.name}`,
      detail: `is at ${pt(j.at)}, and pixel ${pt(j.pixel)} is background (ground connected to the painting's edge); a joint on the figure is required — a file measured on another painting, or a limb that is not where the file says`,
    });
  }
  for (const g of reading.gaps) {
    if (g.background > 0) continue;
    problems.push({
      code: g.rule,
      object: `painting ${painting} ${g.what}`,
      detail: `the line from ${pt(g.from)} to ${pt(g.to)} crosses no background: 0 of its ${g.samples} sampled pixels; ${GAP_REQUIRED[g.rule]}`,
    });
  }
  return problems;
}

/** The lines a reading prints, before any refusal: the figure, every joint and every gap, each with its numbers. */
export function paintingLines(reading: PaintingReading): string[] {
  const out = [
    `  painting ${reading.width}x${reading.height}: background ${reading.backgroundPx} px, figure ${reading.figurePx} px; border ${reading.border} px, ${reading.borderNotGround} not background-coloured`,
  ];
  const on = reading.joints.filter((j) => j.onFigure).length;
  out.push(`  joints: ${reading.joints.length} observed, ${on} on the figure${on === reading.joints.length ? '' : ` (off: ${reading.joints.filter((j) => !j.onFigure).map((j) => j.name).join(', ')})`}`);
  for (const g of reading.gaps) out.push(`  gap ${g.what}: ${g.background} of ${g.samples} sampled pixels are background`);
  return out;
}

/** Read and judge: the lines to print and every refusal, which the caller prints before it throws them at once. */
export function checkPainting(r: Raster, person: KeypointPerson, painting: string, keypoints: string): { lines: string[]; problems: Problem[] } {
  const reading = readPainting(r, person);
  return { lines: paintingLines(reading), problems: paintingProblems(reading, person, painting, keypoints) };
}
