/**
 * The two images See-through is fed, cut from the painting.
 *
 * - **full** — the painting centred horizontally on a WHITE square whose side
 *   is the painting's height (See-through's own pad is black, and a black
 *   margin reads to it as part of the figure). The reference pasted at
 *   `((side - w) // 2, 0)`, which is centred only because its paintings are
 *   portrait; a landscape painting would have gone to the top of the square
 *   with nothing saying so. `proposeHeadBox` (`src/headbox.ts`) maps the full
 *   run back through exactly this pad — x carries it and y does not — so a
 *   landscape painting is refused here, by name, as it is there.
 * - **head** — `seethrough.head_box` cut from the painting at its exact size.
 *   Written only when the config sets a head box; the config loader has
 *   already refused a box that is not a non-empty square.
 *
 * Pure raster. The reference converted the painting to RGB, which DROPS alpha
 * rather than compositing it — a translucent pixel would have kept whatever
 * colour sat under it. Neither dropping nor compositing is a value the input
 * states, so a painting with any pixel below alpha 255 is refused.
 *
 * Measured against the reference's own `st_input_full.png` and
 * `st_input_head.png` for the public examples: the selftest's
 * `inputs-examples` suite compares them pixel for pixel whenever
 * `bun run fetch-examples` has put them on disk.
 */
import type { CharacterConfig } from './config.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { crop, pad } from './raster/composite.ts';
import type { Raster } from './raster/types.ts';

export interface SeeThroughInputs {
  full: Raster;
  /** The pad added on the left, in source px (the right gets the remainder). */
  padLeft: number;
  head: Raster | null;
  headBox: readonly [number, number, number, number] | null;
}

const WHITE: readonly [number, number, number, number] = [255, 255, 255, 255];

export function makeInputs(painting: Raster, cfg: Pick<CharacterConfig, 'seethrough'>, label: string): SeeThroughInputs {
  const problems: Problem[] = [];
  const { width: w, height: h } = painting;
  if (w > h) {
    problems.push({
      code: 'INPUTS_PAINTING_PORTRAIT',
      object: label,
      detail: `is ${w}x${h}, landscape; the full run's input pads the painting horizontally onto a square, so a width at most its height is required`,
    });
  }
  let translucent = 0;
  let firstAt = -1;
  for (let i = 0; i < w * h; i++) {
    if (painting.data[i * 4 + 3] !== 255) {
      translucent++;
      if (firstAt === -1) firstAt = i;
    }
  }
  if (translucent > 0) {
    problems.push({
      code: 'INPUTS_PAINTING_OPAQUE',
      object: label,
      detail: `has ${translucent} pixel(s) below alpha 255 (first at ${firstAt % w},${Math.floor(firstAt / w)}); an opaque painting is required, because neither dropping the alpha nor compositing it is stated by the input`,
    });
  }
  const box = cfg.seethrough?.head_box ?? null;
  if (box !== null) {
    const [x0, y0, x1, y1] = box;
    if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) {
      problems.push({
        code: 'INPUTS_HEAD_BOX_INSIDE',
        object: 'config.seethrough.head_box',
        detail: `is [${box.join(', ')}] and the painting is ${w}x${h}; a box inside the painting is required (the crop is not padded)`,
      });
    }
  }
  refuseIfAny(problems);
  const side = h;
  const padLeft = Math.floor((side - w) / 2);
  const full = pad(painting, padLeft, 0, side - w - padLeft, 0, WHITE);
  const head = box === null ? null : crop(painting, box[0], box[1], box[2] - box[0], box[3] - box[1]);
  return { full, padLeft, head, headBox: box };
}
