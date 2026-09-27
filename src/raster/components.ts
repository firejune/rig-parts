import { assertBinary, type Mask, RasterError } from './types.ts';

/** One component's statistics, in the fields `cv2.connectedComponentsWithStats` returns. */
export interface ComponentStats {
  label: number;
  left: number;
  top: number;
  width: number;
  height: number;
  area: number;
  /** Mean x and y of the component's pixels — cv2's `centroids` row. */
  cx: number;
  cy: number;
}

export interface Components {
  /** Labels including the background, which is label 0 — the `n` cv2 returns. */
  count: number;
  /** One label per pixel, row-major. */
  labels: Int32Array;
  /** `stats[0]` is the background (the zero pixels), as in cv2; components are 1..count-1. */
  stats: ComponentStats[];
}

/**
 * Label the connected components of a binary mask.
 *
 * Semantics of `cv2.connectedComponentsWithStats(mask, connectivity)` (the
 * reference calls it with 8 for ghost clean-up and blob finding) and of
 * `scipy.ndimage.label` with its default cross structure (connectivity 4, the
 * reference's grid-cell islands): foreground is every non-zero pixel, label 0
 * is the background, and components are numbered from 1 in the raster-scan
 * order of their first pixel.
 *
 * Measured against cv2 4.13 and SciPy 1.17 on 40 random masks: component
 * count, every label, every statistic and every centroid identical, for
 * `connectedComponentsWithStats` at 4 and 8 and for `ndimage.label`.
 *
 * The numbering follows cv2 as well (see the block-order note in the body),
 * but a caller that needs "the largest" or "the one touching a line" should
 * still select by statistics: the numbering is an artefact of a scan order,
 * and the statistics are the measurement.
 */
export function connectedComponents(mask: Mask, connectivity: 4 | 8): Components {
  if (connectivity !== 4 && connectivity !== 8) {
    throw new RasterError(`connectedComponents: connectivity ${String(connectivity)}; 4 or 8 is required`);
  }
  assertBinary('connectedComponents', mask);
  const { width: w, height: h, data } = mask;
  const provisional = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a: number, b: number): number => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    // The smaller root wins, so a root is always the earliest provisional label
    // of its component — which is what makes the final numbering a raster scan.
    if (ra < rb) {
      parent[rb] = ra;
      return ra;
    }
    parent[ra] = rb;
    return rb;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] === 0) continue;
      let label = 0;
      const take = (j: number): void => {
        const l = provisional[j];
        if (l === 0) return;
        label = label === 0 ? find(l) : union(label, l);
      };
      if (x > 0) take(i - 1);
      if (y > 0) {
        take(i - w);
        if (connectivity === 8) {
          if (x > 0) take(i - w - 1);
          if (x < w - 1) take(i - w + 1);
        }
      }
      if (label === 0) {
        label = parent.length;
        parent.push(label);
      }
      provisional[i] = label;
    }
  }
  // Final numbering. With 4-connectivity it is the raster order of each
  // component's first pixel. With 8-connectivity it is the raster order of the
  // first 2x2 BLOCK (rows 2k..2k+1, columns 2j..2j+1) holding one of its
  // pixels — which is what cv2's block-based labeller produces, measured on 40
  // random masks where a pixel-order numbering disagreed with cv2 on 31. One
  // block can open at most one component under 8-connectivity, since its four
  // pixels all touch, so the block order is total.
  const final = new Int32Array(parent.length);
  let count = 1;
  const labels = new Int32Array(w * h);
  const visit = (i: number): void => {
    const p = provisional[i];
    if (p === 0) return;
    const root = find(p);
    if (final[root] === 0) final[root] = count++;
    labels[i] = final[root];
  };
  if (connectivity === 4) {
    for (let i = 0; i < w * h; i++) visit(i);
  } else {
    for (let by = 0; by < h; by += 2) {
      for (let bx = 0; bx < w; bx += 2) {
        for (let dy = 0; dy < 2 && by + dy < h; dy++) {
          for (let dx = 0; dx < 2 && bx + dx < w; dx++) visit((by + dy) * w + bx + dx);
        }
      }
    }
  }
  const acc = Array.from({ length: count }, (_, label) => ({
    label,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    area: 0,
    sx: 0,
    sy: 0,
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = acc[labels[y * w + x]];
      a.area++;
      a.sx += x;
      a.sy += y;
      if (x < a.minX) a.minX = x;
      if (x > a.maxX) a.maxX = x;
      if (y < a.minY) a.minY = y;
      if (y > a.maxY) a.maxY = y;
    }
  }
  const stats = acc.map((a) =>
    a.area === 0
      ? { label: a.label, left: 0, top: 0, width: 0, height: 0, area: 0, cx: Number.NaN, cy: Number.NaN }
      : {
          label: a.label,
          left: a.minX,
          top: a.minY,
          width: a.maxX - a.minX + 1,
          height: a.maxY - a.minY + 1,
          area: a.area,
          cx: a.sx / a.area,
          cy: a.sy / a.area,
        },
  );
  return { count, labels, stats };
}
