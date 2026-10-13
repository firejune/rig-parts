/**
 * Flat-colour figures for the `painting` suite (issue #350): a 120x200 canvas,
 * a figure of rectangles whose every gap is counted by hand, and its body-18
 * joints. No claim about appearance is made from them.
 *
 * The passing figure, in painting px (x0, y0, x1, y1, end-exclusive):
 * head [50, 10, 70, 35]; shoulders [25, 35, 95, 42]; torso [45, 42, 75, 100];
 * arms [25, 42, 33, 110] and [87, 42, 95, 110], 12 px clear of the torso;
 * legs [48, 100, 57, 185] and [63, 100, 72, 185], 6 px apart; a white highlight
 * [50, 93, 55, 98] inside the torso under the right hip, closed off from the
 * edge, so it is ground and not background.
 */
import { newRaster, type Raster } from '../src/raster/types.ts';

export type Box = readonly [number, number, number, number];
export type Rgba = readonly [number, number, number, number];

export const CANVAS: readonly [number, number] = [120, 200];
export const WHITE: Rgba = [255, 255, 255, 255];
export const SKIN: Rgba = [230, 190, 170, 255];
export const CLOTH: Rgba = [40, 60, 160, 255];
export const GREY: Rgba = [128, 128, 128, 255];

/** The passing figure's blocks, drawn in order. */
export const FIGURE: ReadonlyArray<readonly [Box, Rgba]> = [
  [[50, 10, 70, 35], SKIN],
  [[25, 35, 95, 42], CLOTH],
  [[45, 42, 75, 100], CLOTH],
  [[25, 42, 33, 110], SKIN],
  [[87, 42, 95, 110], SKIN],
  [[48, 100, 57, 185], SKIN],
  [[63, 100, 72, 185], SKIN],
  [[50, 93, 55, 98], WHITE],
];

/** Paint `blocks` over a `ground`-filled canvas. */
export function paint(blocks: ReadonlyArray<readonly [Box, Rgba]>, ground: Rgba = WHITE): Raster {
  const r = newRaster(CANVAS[0], CANVAS[1]);
  for (let i = 0; i < r.width * r.height; i++) r.data.set(ground, i * 4);
  for (const [[x0, y0, x1, y1], c] of blocks) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data.set(c, (y * r.width + x) * 4);
  return r;
}

type Joint = { state: 'observed' | 'occluded' | 'missing'; at?: [number, number] };

/** The passing figure's joints: each on its block, ears missing. */
export function figureJoints(): Record<string, Joint> {
  const o = (x: number, y: number): Joint => ({ state: 'observed', at: [x, y] });
  return {
    nose: o(60, 22), neck: o(60, 36),
    r_shoulder: o(36, 38), r_elbow: o(29, 75), r_wrist: o(29, 105),
    l_shoulder: o(84, 38), l_elbow: o(91, 75), l_wrist: o(91, 105),
    r_hip: o(52, 95), r_knee: o(52, 140), r_ankle: o(52, 180),
    l_hip: o(68, 95), l_knee: o(68, 140), l_ankle: o(68, 180),
    r_eye: o(55, 18), l_eye: o(65, 18),
    r_ear: { state: 'missing' }, l_ear: { state: 'missing' },
  };
}

/** A keypoint file in the one space `src/keypoints.ts` reads, holding one person. */
export function keypointFile(joints: Record<string, Joint>): Record<string, unknown> {
  return {
    spec: 'spine-parts-keypoints/1',
    space: { units: 'painting-px', origin: 'top-left', y: 'down' },
    width: CANVAS[0],
    height: CANVAS[1],
    source: 'hand-placed on the rig-parts selftest painting fixture',
    people: [{ id: 'a', joints }],
  };
}

/**
 * The mutants, one per rule, each the passing figure with one thing changed,
 * as `[blocks, joints]`:
 * - `armsDown`: the right arm moved down against the torso, [37, 42, 45, 100],
 *   its elbow at (41, 70) and its wrist at (41, 95); the left arm as passing,
 *   so the line between the wrists still crosses the left arm's gap;
 * - `clasped`: both wrists on the torso's midline at (59, 80) and (61, 80), the
 *   forearms drawn in to it ([33, 75, 45, 82] and [75, 75, 87, 82]). Hands that
 *   meet close a loop of arms and shoulders round the torso, so the gap
 *   between each arm and the body is enclosed — ground, not background — and
 *   both arms are refused with the hands, on any figure in one piece;
 * - `legsTogether`: the legs side by side, [48, 100, 60, 185] and
 *   [60, 100, 72, 185];
 * - `offFigure`: the nose put at (5, 5), on the background;
 * - `busy`: a grey block [0, 0, 15, 15] in the top-left corner;
 * - `unstated`: the right wrist said `occluded`, with no position.
 */
export function mutant(kind: 'armsDown' | 'clasped' | 'legsTogether' | 'offFigure' | 'busy' | 'unstated'): [ReadonlyArray<readonly [Box, Rgba]>, Record<string, Joint>] {
  const j = figureJoints();
  const without = (boxes: readonly Box[]): Array<readonly [Box, Rgba]> => FIGURE.filter(([b]) => !boxes.some((x) => x.join() === b.join()));
  const legs: Box[] = [[48, 100, 57, 185], [63, 100, 72, 185]];
  if (kind === 'armsDown') {
    return [[...without([[25, 42, 33, 110]]), [[37, 42, 45, 100], SKIN]], { ...j, r_elbow: { state: 'observed', at: [41, 70] }, r_wrist: { state: 'observed', at: [41, 95] } }];
  }
  if (kind === 'clasped') {
    return [[...FIGURE, [[33, 75, 45, 82], SKIN], [[75, 75, 87, 82], SKIN]], { ...j, r_wrist: { state: 'observed', at: [59, 80] }, l_wrist: { state: 'observed', at: [61, 80] } }];
  }
  if (kind === 'legsTogether') return [[...without(legs), [[48, 100, 60, 185], SKIN], [[60, 100, 72, 185], SKIN]], j];
  if (kind === 'offFigure') return [FIGURE, { ...j, nose: { state: 'observed', at: [5, 5] } }];
  if (kind === 'busy') return [[...FIGURE, [[0, 0, 15, 15], GREY]], j];
  return [FIGURE, { ...j, r_wrist: { state: 'occluded' } }];
}
