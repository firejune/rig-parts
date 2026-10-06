/**
 * Three generated figures — standing, seated, lying — and a hand-written
 * keypoint file for each (issue #75). Flat colour blocks, as
 * `fixtures/propose.ts` makes them, so every bone the proposer places and
 * every LINT line is computable by hand from the numbers here; the selftest
 * derives each expected value next to its control. Nothing here is art and
 * nothing here stands for any. Painting and rig are the same size (scale 1),
 * so a joint's painting px are its rig px.
 *
 * - **Standing**, on {@link PROPOSE_RIG} (200x300): {@link PROPOSE_PARTS}
 *   (face 80,40 40x50; skirt 60,150 80x100; sleeves 20,100 and 160,100 20x60)
 *   plus two eyewhites, `white_a` (head:eyewhite-r) 86,60 10x6 and `white_b`
 *   (head:eyewhite-l) 104,60 10x6 — box centres (91, 63) and (109, 63), so the
 *   eye axis is x 100.
 * - **Seated**, 200x240: face 80,20 40x50; `dress` (full:bottomwear) 75,110
 *   50x50; `legs` (full:legwear) 125,140 60x90, drawn as the thighs 125,140
 *   60x20 and the shins 165,160 20x70; two bent arms, `arm_a` (full:handwear-r) — upper arm 60,80
 *   12x38 and forearm 60,118 30x12 — and `arm_b` (full:handwear-l) — 128,80
 *   12x38 and 110,118 30x12. Each is 456 + 360 = 816 opaque px.
 * - **Lying**, landscape 300x200, the head on the left: face 20,70 40x50;
 *   `skirt` (full:bottomwear) 60,80 200x40, the body lengthwise; `arm_a`
 *   (full:handwear-r) 70,60 80x14 along its upper side and `arm_b`
 *   (full:handwear-l) 70,126 80x14 along its lower side. The figure spans
 *   y 60..139. Both arms are right of the eye axis (x 40), so without joints
 *   the proposer reads them as one blob on one side — the card's case.
 */
import { KEYPOINTS_SPACE, KEYPOINTS_SPEC } from '../src/keypoints.ts';
import { PROPOSE_PARTS, PROPOSE_RIG, type ProposeFixturePart } from './propose.ts';

export type PoseName = 'standing' | 'seated' | 'lying';

export interface Pose {
  rig: { w: number; h: number };
  parts: ProposeFixturePart[];
  /** The keypoint file, as JSON, in painting px (here also rig px). */
  keypoints: Record<string, unknown>;
}

type J = { state: 'observed' | 'occluded' | 'missing'; at?: [number, number]; score?: number };
const obs = (x: number, y: number): J => ({ state: 'observed', at: [x, y] });

function file(w: number, h: number, source: string, joints: Record<string, J>): Record<string, unknown> {
  return {
    spec: KEYPOINTS_SPEC,
    space: { ...KEYPOINTS_SPACE },
    width: w,
    height: h,
    source,
    people: [{ id: 'a', joints }],
  };
}

export const STANDING_EYES: ProposeFixturePart[] = [
  { name: 'white_a', from: 'head:eyewhite-r', x: 86, y: 60, w: 10, h: 6, colour: [250, 250, 250] },
  { name: 'white_b', from: 'head:eyewhite-l', x: 104, y: 60, w: 10, h: 6, colour: [250, 250, 250] },
];

export const SEATED_RIG = { w: 200, h: 240 };
export const LYING_RIG = { w: 300, h: 200 };

export const SEATED_PARTS: ProposeFixturePart[] = [
  { name: 'face', from: 'head:face', x: 80, y: 20, w: 40, h: 50, colour: [240, 210, 190] },
  { name: 'dress', from: 'full:bottomwear', x: 75, y: 110, w: 50, h: 50, colour: [70, 110, 200] },
  {
    name: 'legs',
    from: 'full:legwear',
    x: 125,
    y: 140,
    w: 60,
    h: 90,
    colour: [60, 60, 70],
    rects: [
      [125, 140, 60, 20],
      [165, 160, 20, 70],
    ],
  },
  {
    name: 'arm_a',
    from: 'full:handwear-r',
    x: 60,
    y: 80,
    w: 30,
    h: 50,
    colour: [240, 240, 240],
    rects: [
      [60, 80, 12, 38],
      [60, 118, 30, 12],
    ],
  },
  {
    name: 'arm_b',
    from: 'full:handwear-l',
    x: 110,
    y: 80,
    w: 30,
    h: 50,
    colour: [240, 240, 240],
    rects: [
      [128, 80, 12, 38],
      [110, 118, 30, 12],
    ],
  },
];

export const LYING_PARTS: ProposeFixturePart[] = [
  { name: 'face', from: 'head:face', x: 20, y: 70, w: 40, h: 50, colour: [240, 210, 190] },
  { name: 'skirt', from: 'full:bottomwear', x: 60, y: 80, w: 200, h: 40, colour: [70, 110, 200] },
  { name: 'arm_a', from: 'full:handwear-r', x: 70, y: 60, w: 80, h: 14, colour: [240, 240, 240] },
  { name: 'arm_b', from: 'full:handwear-l', x: 70, y: 126, w: 80, h: 14, colour: [240, 240, 240] },
];

const SOURCE = 'hand-written for the spine-parts selftest';

export const POSES: Record<PoseName, Pose> = {
  /**
   * Every state at least once: `l_elbow` occluded with a position and a
   * score, `l_ear` occluded with none, `r_ear` listed as missing, the ankles
   * not listed at all.
   */
  standing: {
    rig: PROPOSE_RIG,
    parts: [...PROPOSE_PARTS, ...STANDING_EYES],
    keypoints: file(200, 300, SOURCE, {
      nose: obs(100, 72),
      neck: obs(100, 98),
      r_shoulder: obs(30, 104),
      r_elbow: obs(30, 130),
      r_wrist: obs(30, 152),
      l_shoulder: obs(170, 104),
      l_elbow: { state: 'occluded', at: [170, 130], score: 0.4 },
      l_wrist: obs(170, 152),
      r_hip: obs(90, 160),
      l_hip: obs(110, 160),
      r_knee: obs(92, 230),
      l_knee: obs(108, 230),
      r_eye: obs(92, 63),
      l_eye: obs(112, 67),
      r_ear: { state: 'missing' },
      l_ear: { state: 'occluded' },
    }),
  },
  seated: {
    rig: SEATED_RIG,
    parts: SEATED_PARTS,
    keypoints: file(200, 240, SOURCE, {
      nose: obs(100, 50),
      neck: obs(100, 77),
      r_shoulder: obs(66, 84),
      r_elbow: obs(66, 124),
      r_wrist: obs(84, 124),
      l_shoulder: obs(134, 84),
      l_elbow: obs(134, 124),
      l_wrist: obs(116, 124),
      r_hip: obs(90, 145),
      l_hip: obs(110, 145),
      r_knee: obs(175, 145),
      r_ankle: obs(175, 225),
      l_knee: obs(178, 150),
      l_ankle: obs(178, 225),
    }),
  },
  lying: {
    rig: LYING_RIG,
    parts: LYING_PARTS,
    keypoints: file(300, 200, SOURCE, {
      nose: obs(35, 95),
      neck: obs(62, 100),
      r_shoulder: obs(75, 67),
      r_elbow: obs(110, 67),
      r_wrist: obs(145, 67),
      l_shoulder: obs(75, 133),
      l_elbow: obs(110, 133),
      l_wrist: obs(145, 133),
      r_hip: obs(150, 92),
      l_hip: obs(150, 108),
      r_knee: obs(205, 95),
      r_ankle: obs(255, 95),
      l_knee: obs(205, 105),
      l_ankle: obs(255, 105),
      r_eye: obs(30, 85),
      l_eye: obs(30, 105),
    }),
  },
};
