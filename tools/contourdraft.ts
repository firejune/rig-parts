/**
 * The drafted outline mesh (issue #265 Stage B; it lives in tools/ until propose's default moves): a lattice mesh `propose` would
 * write, turned into a `contour` mesh with a blunt traced outline and rows
 * across its chains — and only where the rig stage will take it. Every choice
 * is written into the config the draft returns (`contour`, `stray`, `ribs`)
 * and said in its note; nothing here is read at the rig stage.
 *
 * - **The outline** is traced at tolerance T and margin T, T one number for
 *   the whole figure ({@link outlineTolerance}).
 * - **The interior** is the ribs' and nothing else: the background spacing
 *   ({@link RIBS_ONLY_SPACING}) is above any part's side, so no lattice point
 *   survives and each rib is its two ends and its own point.
 * - **Dust** — an extra 4-connected island of the art (alpha above
 *   `ART_ALPHA`) of at most {@link DUST_MAX_PX} px and at most
 *   {@link DUST_MAX_SHARE} of the part's art — is left out by a drafted
 *   `stray` equal to the largest such island. A part with any other extra
 *   island (a real piece: an earring's two drops) stays a lattice.
 * - **Ribs** are drafted on every chain the segments name at
 *   {@link DRAFT_STATIONS} stations, and the draft is run through the rig
 *   stage's own `contourMesh`: a rib refusal (`CONTOUR_RIB_*`) lowers that
 *   chain's stations by one, and below 0 drops the chain from `ribs` — for a
 *   crossing, the later chain of the two, so the first keeps its rows. Any
 *   other refusal (`CONTOUR_COVERAGE`, `CONTOUR_ONE_ISLAND`, …) is not
 *   loosened: the part stays a lattice, with the refusal in its note.
 * - A bone segment (not a chain) gets no row: `ribs` take chains only. The
 *   note names it.
 */
import { type ContourChainRibs, contourMesh } from '../src/contour.ts';
import type { ContourMeshSpec, LatticeMeshSpec, Point, RibsSpec } from '../src/config.ts';
import { ART_ALPHA } from '../src/mesh.ts';
import { alphaAbove, connectedComponents, pad, type Raster } from '../src/raster/index.ts';

/** The pad the rig stage puts round every part image (`PAD`, `src/rig.ts`), so the draft runs on the image the stage meshes. */
const IMAGE_PAD = 4;

/**
 * T = max(1, round(H / 554)), H the figure's height in rig px (the union of
 * every part's box). 554 puts T at 2 on the trailer's 1108 px figure, the
 * point Stage A2 measured; it is a constant fitted on three similarly sized
 * examples (heights 1106, 1108, 1185), not a law of figure size.
 */
export const TOLERANCE_FIGURE_DIVISOR = 554;

/** The background spacing that leaves the interior to the ribs: above any part side the rig allows (32768 px is the contour cap; a figure is far below 4096). */
export const RIBS_ONLY_SPACING = 4096;

/** Stations per link the draft starts every chain at (Stage A2 measured 0 and 1). */
export const DRAFT_STATIONS = 1;

/** Dust: an extra island of at most this many art px … */
export const DUST_MAX_PX = 4;

/** … and at most this share of the part's art px. */
export const DUST_MAX_SHARE = 0.001;

/** The figure's outline tolerance, rig px. */
export function outlineTolerance(figureHeight: number): number {
  return Math.max(1, Math.round(figureHeight / TOLERANCE_FIGURE_DIVISOR));
}

export interface ChainLine {
  name: string;
  /** The chain's link origins then its tip, rig px. */
  points: ReadonlyArray<readonly [number, number]>;
}

export interface ContourDraft {
  mode: 'contour';
  mesh: ContourMeshSpec;
  note: string;
  /** Chains the segments name, and those the draft kept ribs on. */
  chains: number;
  ribbed: number;
}

export interface LatticeKept {
  mode: 'grid';
  note: string;
}

/**
 * The draft for one lattice mesh. `image` is the part's own image (unpadded, as
 * `assemble` wrote it) and `at` its box's top-left corner in rig px.
 */
export function draftContourMesh(part: string, image: Raster, at: Point, lattice: LatticeMeshSpec, chains: ReadonlyMap<string, ChainLine>, T: number): ContourDraft | LatticeKept {
  const img = pad(image, IMAGE_PAD, IMAGE_PAD, IMAGE_PAD, IMAGE_PAD, [0, 0, 0, 0]);
  const ox = at[0] - IMAGE_PAD;
  const oy = at[1] - IMAGE_PAD;
  const alpha = new Uint8Array(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];

  // dust, by the rule; a real piece keeps the lattice
  const comp = connectedComponents(alphaAbove(img, ART_ALPHA), 4);
  const sizes = comp.stats.slice(1).map((s) => s.area).sort((a, b) => b - a);
  const art = sizes.reduce((a, b) => a + b, 0);
  const extra = sizes.slice(1);
  const dust = (n: number): boolean => n <= DUST_MAX_PX && n <= DUST_MAX_SHARE * art;
  const pieces = extra.filter((n) => !dust(n));
  if (sizes.length === 0) return { mode: 'grid', note: `${part}: stays grid — no art above alpha ${ART_ALPHA}` };
  if (pieces.length > 0 || (sizes.length > 1 && sizes[0] === sizes[1])) {
    return {
      mode: 'grid',
      note: `${part}: stays grid — its art is ${sizes.length} islands (${sizes.join(', ')} px); ${pieces.length} beside the largest are real pieces, not dust (dust: at most ${DUST_MAX_PX} px and at most ${DUST_MAX_SHARE * 100} % of the part's ${art} art px), and the contour mode meshes one island`,
    };
  }
  const stray = extra.length > 0 ? extra[0] : undefined;

  const named = [...new Set(lattice.segments.filter((s): s is string => typeof s === 'string' && chains.has(s)))];
  const boneSegs = [...new Set(lattice.segments.filter((s) => typeof s !== 'string' || !chains.has(s)).map((s) => (typeof s === 'string' ? s : s[0])))];
  const stations = new Map<string, number>(named.map((c) => [c, DRAFT_STATIONS]));
  const lowered: string[] = [];
  const why = new Map<string, string>();
  const params = (): Parameters<typeof contourMesh>[2] => {
    const ribs: ContourChainRibs[] = [...stations].map(([chain, st]) => ({
      chain,
      points: (chains.get(chain) as ChainLine).points.map(([x, y]) => [x - ox, y - oy] as [number, number]),
      stations: st,
    }));
    return { threshold: ART_ALPHA, tolerance: T, margin: T, spacing: RIBS_ONLY_SPACING, regions: [], ...(stray === undefined ? {} : { stray }), ...(ribs.length === 0 ? {} : { ribs }) };
  };
  for (let round = 0; round <= 2 * named.length + 1; round++) {
    const cm = contourMesh(part, { width: img.width, height: img.height, alpha }, params());
    if (!Array.isArray(cm)) break;
    const rib = cm.filter((p) => p.code.startsWith('CONTOUR_RIB_'));
    const other = cm.filter((p) => !p.code.startsWith('CONTOUR_RIB_'));
    if (other.length > 0) {
      return { mode: 'grid', note: `${part}: stays grid — the contour draft at tolerance ${T}, margin ${T} is refused: ${other.map((p) => `${p.code} ${p.detail}`).join('; ')}` };
    }
    const hit = new Set<string>();
    for (const p of rib) {
      // a crossing lowers the later chain (named in the detail), so the first keeps its rows; any other rib refusal names its own chain
      const later = p.code === 'CONTOUR_RIB_CROSSING' ? /meets rib (\S+) link \d+ station \d+/.exec(p.detail) : null;
      const own = /rib (\S+) link|chain "([^"]+)"/.exec(p.object);
      const chain = later !== null ? later[1] : own === null ? null : (own[1] ?? own[2]);
      if (chain === null || !stations.has(chain)) return { mode: 'grid', note: `${part}: stays grid — ${p.code} ${p.object}: ${p.detail}` };
      const where = p.object.replace(`contour mesh "${part}", `, '');
      if (!hit.has(chain)) why.set(chain, p.code === 'CONTOUR_RIB_CROSSING' && later !== null ? `${p.code}: ${later[0].replace('meets ', '')} meets ${where}` : `${p.code} at ${where}`);
      hit.add(chain);
    }
    for (const chain of hit) {
      const st = stations.get(chain) as number;
      lowered.push(`${chain} ${st} -> ${st > 0 ? st - 1 : 'none'} (${why.get(chain) as string})`);
      if (st > 0) stations.set(chain, st - 1);
      else stations.delete(chain);
    }
    if (round === 2 * named.length + 1) return { mode: 'grid', note: `${part}: stays grid — the ribs did not settle` };
  }
  const ribs: RibsSpec = Object.fromEntries([...stations].map(([c, st]) => [c, { stations: st }]));
  const mesh: ContourMeshSpec = {
    contour: { tolerance: T, margin: T, spacing: RIBS_ONLY_SPACING, ...(stray === undefined ? {} : { stray }) },
    ...(stations.size === 0 ? {} : { ribs }),
    r: lattice.r,
    segments: lattice.segments,
    ...(lattice.exponent === undefined ? {} : { exponent: lattice.exponent }),
    ...(lattice.rule === undefined ? {} : { rule: lattice.rule }),
  };
  const parts = [
    `${part}: contour at tolerance ${T}, margin ${T}, interior from ribs only (spacing ${RIBS_ONLY_SPACING})`,
    stray === undefined ? null : `stray ${stray} drops ${extra.length} dust island(s) of ${extra.join(', ')} px`,
    named.length === 0 ? 'no chain, so no ribs' : `ribs on ${stations.size} of ${named.length} chain(s): ${named.map((c) => (stations.has(c) ? `${c} stations ${stations.get(c) as number}` : `${c} none`)).join(', ')}`,
    lowered.length === 0 ? null : `stations lowered on the stage's refusals, in order: ${lowered.join('; ')}`,
    boneSegs.length === 0 ? null : `bone segment(s) ${boneSegs.join(', ')} get no row (ribs take chains only)`,
  ];
  return { mode: 'contour', mesh, note: parts.filter((x) => x !== null).join('; '), chains: named.length, ribbed: stations.size };
}
