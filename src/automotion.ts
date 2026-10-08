/**
 * The motion gate of the automatic mesh mode (issue #126, item 3): a reduced
 * mesh is written only when it moves like the mesh it was reduced from, on the
 * rig's own idle, measured by spine-rigc's `compareMeshesInMotion`
 * (`spine-rigc/meshcompare`, 2.20.x) and held to the bounds the author wrote in
 * `meshes.<part>.auto.motion` (`AutoMotionSpec`, `src/config.ts`).
 *
 * ## What is compared
 *
 * - **The reference** is the rig with the part's unreduced, gated source mesh
 *   — the alpha >= 1 contour mesh `autoSource` returns, with the triangles and
 *   UVs `reduceMesh` was handed and its source weights, bound exactly as the
 *   reduced mesh is ({@link AutoMotionCase.reference}). **The candidate** is the
 *   rig the stage writes, with the reduced mesh. The two are one `RigSpec` with
 *   that one attachment swapped and nothing else; spine-rigc's allowlist
 *   (`COMPARE_INPUTS_DIFFER`) refuses anything else, and its refusal is carried
 *   here by code.
 * - Both go through spine-rigc's `build` under the same gate — the candidate
 *   packed, as the stage writes it, the reference compiled without packing
 *   (issue #135: the comparison allowlists atlas layout, and nothing reads a
 *   reference's pages) — and the comparison reads each build's
 *   `skeleton.model.json` as text. The builds run in the rig stage
 *   (`src/build.ts`), the one place this package runs rigc; this module is
 *   handed the two texts and stays pure.
 *
 * ## The schedule ({@link idleSchedule})
 *
 * The idle exactly as `check` renders it (`rigc render --animation idle --fps
 * IDLE_FPS`): the animation `idle` at {@link IDLE_FPS} fps over its whole
 * duration, physics reset at time 0 and stepped by `1 / IDLE_FPS` — the
 * render's step (spine-rigc's `render_core`) — with `warmupSteps: 0`, the only
 * value spine-rigc accepts (P10). Two phases: `grid`, the frames the render
 * draws, and `irr`, each frame interval's `IRR_OFFSET` past them, which the
 * render never selects. **Nothing here chooses a candidate by motion** — the
 * candidate is the one `reduceMesh` returned on geometry alone (item 2) — so
 * `selection` is empty and every frame is held out from selection by
 * construction.
 *
 * ## Stimulus ({@link motionStimulus})
 *
 * A comparison over frames that do not deform the part reads 0 and would pass
 * over nothing. Every bone the part binds moving by one affine map (a key on
 * an ancestor they share, or on the one bone a single-bone part binds) carries
 * every sample of both meshes to the same point — a barycentric combination
 * commutes with an affine map — so it is not a stimulus. The part is
 * stimulated when the idle keys, with changing values, a bone that is (or is
 * an ancestor of) some of the bound bones but not all of them; otherwise it is
 * refused `AUTO_MESH_NO_STIMULUS` before anything is compiled. Constraints are
 * not read: a part only a constraint would move is refused, never passed.
 *
 * ## Acceptance ({@link motionVerdict})
 *
 * `motionRequired: true`. The part is kept only when the candidate's
 * `accepted` is true (its geometry section and its motion section both
 * `pass`). Otherwise `AUTO_MESH_MOTION` names every gated row that did not
 * pass with its value, bound and worst frame; a refusal by spine-rigc of the
 * comparison's input — `COMPARE_REFERENCE_FAILS` included — is
 * `AUTO_MESH_MOTION_INPUT` carrying its code.
 *
 * Pure: no clock, no randomness, nothing read or written.
 */
import { MeshReductionError, type AlphaMask, type ArtFitBounds, type MeasureRow, type MeshQualityReport, type MotionBounds, type MotionSchedule, writeMeshQualityReport } from 'spine-rigc/mesh';
import { compareMeshesInMotion, type MotionComparisonInput } from 'spine-rigc/meshcompare';
import type { AutoMotionSpec } from './config.ts';
import type { Problem } from './errors.ts';
import { IDLE_FPS, type MotionSpec } from './motion.ts';
import type { MeshAttachment, RigBone } from './rig.ts';

/** The animation the motion gate walks: the idle, the one animation the rig stage writes and `check` renders. */
export const MOTION_ANIMATION = 'idle';

/** The reference's and the candidate's ids in the comparison's report. */
export const REFERENCE_ID = 'source';
export const CANDIDATE_ID = 'reduced';

/** The `why` written into `invariants.deformMayFold` for a part whose `motion.deformMayFold` is true. */
export const DEFORM_MAY_FOLD_WHY = 'spine-parts: the author set meshes.<part>.auto.motion.deformMayFold, so the motion gate lists this slot\'s folds rather than refusing them';

/**
 * The schedule of the motion gate: the idle as `check` renders it (module
 * header). `warmupSteps` is the literal 0 — no other value is ever sent.
 */
export function idleSchedule(): MotionSchedule {
  return {
    frames: [{ animation: MOTION_ANIMATION, fps: IDLE_FPS }],
    phases: ['grid', 'irr'],
    physics: { mode: 'step', dt: 1 / IDLE_FPS, warmupSteps: 0 },
    selection: [],
  };
}

/** Everything the rig stage needs to run one automatic part's motion gate, built by `buildRig` beside the part's attachment. */
export interface AutoMotionCase {
  part: string;
  /** `config.meshes.<part>.auto`, the object every refusal names. */
  object: string;
  /** The author's bounds; absent only on a spec built in code past the loader, which the stage refuses by name. */
  motion: AutoMotionSpec | undefined;
  /** The unreduced source as the rig writes a mesh: the reference's attachment. */
  reference: MeshAttachment;
  /** The padded part image's alpha, the art both builds are measured against. */
  mask: AlphaMask;
  /** What the source and the result were each held to by `reduceMesh`: the reference's and the candidate's art fit here. */
  sourceBounds: ArtFitBounds;
  artFit: ArtFitBounds;
  minArtSamples: number;
  /** Each declared region as spine-rigc held density on it, part-local px, with its art sample floor. */
  regions: Array<{ name: string; polygon: Array<[number, number]>; minArtSamples: number }>;
  /** The bones the reference's weights bind, sorted. */
  boundBones: string[];
}

/** The bones the idle keys with changing values: each track's bone, and every member of a group a track keys. */
export function movingKeyedBones(motion: MotionSpec): string[] {
  const out = new Set<string>();
  for (const t of motion.animations.idle.tracks) {
    const first = JSON.stringify(t.keys[0]?.v ?? null);
    if (t.keys.every((k) => JSON.stringify(k.v) === first)) continue;
    if (t.bone !== undefined) out.add(t.bone);
    if (t.group !== undefined) for (const b of motion.groups[t.group] ?? []) out.add(b);
  }
  return [...out].sort();
}

/**
 * Whether the idle can deform a part bound to `bound` (module header,
 * *Stimulus*): the keyed bones that do, or none. A keyed bone deforms the part
 * when it is, or is an ancestor of, at least one bound bone and not all of
 * them: then those bones move by its key and the others do not. A key that
 * reaches every bound bone (their shared ancestor, the one bone of a
 * single-bone part, or a bound bone every other one hangs from) moves them all
 * by one affine map, which carries both meshes' samples alike.
 */
export function motionStimulus(bones: readonly RigBone[], motion: MotionSpec, bound: readonly string[]): { by: string[]; keyed: string[] } {
  const parent = new Map(bones.map((b) => [b.name, b.parent ?? null]));
  const keyed = movingKeyedBones(motion);
  const under = (bone: string, k: string): boolean => {
    for (let b: string | null = bone; b !== null; b = parent.get(b) ?? null) if (b === k) return true;
    return false;
  };
  const by = keyed.filter((k) => {
    const reached = bound.filter((b) => under(b, k)).length;
    return reached > 0 && reached < bound.length;
  });
  return { by, keyed };
}

/** The refusal of a part the idle cannot deform. */
export function noStimulusProblem(c: AutoMotionCase, keyed: readonly string[]): Problem {
  return {
    code: 'AUTO_MESH_NO_STIMULUS',
    object: c.object,
    detail:
      `the part binds [${c.boundBones.join(', ')}] and the idle keys [${keyed.join(', ') || 'nothing'}] with changing values; none of those keys moves some bound bones against the others, so no frame deforms the part and a comparison would read 0 over nothing — ` +
      'missing stimulus is not a PASS. Put the part in contour or grid mode, or key a bone it binds (a chain link it is weighted to)',
  };
}

/** The comparison's whole input for one part: the two documents, the art, the author's bounds and {@link idleSchedule}. */
export function motionInput(c: AutoMotionCase, motion: AutoMotionSpec, reference: string, candidate: string, schedule: MotionSchedule = idleSchedule()): MotionComparisonInput {
  const bounds: MotionBounds = {
    maxLocalDeformation: motion.maxLocalDeformation,
    ...(motion.maxStretch === undefined ? {} : { maxStretch: motion.maxStretch }),
    ...(motion.minStretch === undefined ? {} : { minStretch: motion.minStretch }),
  };
  return {
    reference: { id: REFERENCE_ID, model: reference },
    candidates: [{ id: CANDIDATE_ID, model: candidate }],
    attachments: [
      {
        attachment: { skin: null, slot: c.part, attachment: c.part },
        art: { mask: c.mask, threshold: 1, frame: { space: 'part-local-drawing-px-y-down', width: c.mask.width, height: c.mask.height, pageScale: 1, conversion: 'texels = px * pageScale' } },
        finalThreshold: 1,
        minArtSamples: c.minArtSamples,
        regions: c.regions.map((r) => ({ name: r.name, polygon: r.polygon.map(([x, y]) => [x, y] as [number, number]), minArtSamples: r.minArtSamples })),
      },
    ],
    referenceArtFit: c.sourceBounds,
    candidateArtFit: c.artFit,
    schedule,
    bounds,
    motionRequired: true,
    perFrame: false,
  };
}

/** One comparison: spine-rigc's report, or its refusal of the input carried by code. */
export function runComparison(object: string, input: MotionComparisonInput): MeshQualityReport | Problem {
  try {
    return compareMeshesInMotion(input);
  } catch (err) {
    if (!(err instanceof MeshReductionError)) throw err;
    return { code: 'AUTO_MESH_MOTION_INPUT', object, detail: `spine-rigc's compareMeshesInMotion refused the comparison's input (${err.code}): ${err.message}; nothing is built in the part's place` };
  }
}

/** A gated row in one phrase: code, region, state, value against its bound, the worst frame. */
export function motionRowText(r: MeasureRow): string {
  const region = r.object.region === null ? '' : ` [region "${r.object.region}"]`;
  const at = r.worst?.frame?.id;
  if (r.state === 'pass' || r.state === 'fail' || r.state === 'undeclared') {
    return `${r.code}${region} ${r.state} ${r.value}${r.bound === null ? ' (no bound)' : ` against ${r.bound.op} ${r.bound.value}`}${at === undefined ? '' : ` at ${at}`}`;
  }
  return `${r.code}${region} ${r.state}: ${r.reason ?? ''}`;
}

/** The candidate's rows with a declared bound that did not pass, geometry then motion. */
export function failingRows(report: MeshQualityReport): MeasureRow[] {
  const c = report.candidates[0];
  const rows = [...(c?.geometry?.rows ?? []), ...(c?.motion?.rows ?? [])];
  return rows.filter((r) => r.bound !== null && r.state !== 'pass');
}

/** The verdict: null when the candidate is accepted, else the problem that refuses the part. */
export function motionVerdict(object: string, report: MeshQualityReport): Problem | null {
  const c = report.candidates[0];
  if (c !== undefined && c.accepted) return null;
  const failing = failingRows(report);
  const verdicts = `geometry ${c?.geometry?.verdict ?? 'absent'}, motion ${c?.motion?.verdict ?? 'absent'}`;
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `the reduced mesh against its unreduced source on the idle (${verdicts}) is not accepted: ${failing.length > 0 ? failing.map(motionRowText).join('; ') : 'a required motion row was not measured'}; ` +
      'every declared bound passing in motion is required (motionRequired), and nothing is built in its place',
  };
}

/** One motion row as `mesh_report.json` carries it. */
export interface MotionResidual {
  code: string;
  region: string | null;
  state: MeasureRow['state'];
  value: number | null;
  bound: { op: '<=' | '>='; value: number } | null;
  unit: MeasureRow['unit'];
  worst_frame: string | null;
  samples: number | null;
  art_samples: number | null;
}

/** What replaces `deformation: "unmeasured…"` once the comparison has run and accepted the part. */
export interface MotionDeformation {
  verdict: 'pass' | 'fail' | 'not-measured';
  bounds: { maxLocalDeformation: number; maxStretch: number | null; minStretch: number | null; deformMayFold: boolean };
  rows: MotionResidual[];
  schedule: {
    animation: string;
    fps: number;
    phases: Array<'grid' | 'irr'>;
    physics: MotionSchedule['physics'];
    frames: { grid: number; irr: number };
    held_out: boolean;
    selection: string[];
  };
}

export function motionDeformation(motion: AutoMotionSpec, report: MeshQualityReport): MotionDeformation {
  const c = report.candidates[0];
  const section = c?.motion ?? null;
  const rows: MotionResidual[] = (section?.rows ?? []).map((r) => ({
    code: r.code,
    region: r.object.region,
    state: r.state,
    value: r.value,
    bound: r.bound,
    unit: r.unit,
    worst_frame: r.worst?.frame?.id ?? null,
    samples: r.sampling?.count ?? null,
    art_samples: r.art?.samples ?? null,
  }));
  const walked = section?.schedule.walked ?? [];
  const s = idleSchedule();
  return {
    verdict: section?.verdict ?? 'not-measured',
    bounds: { maxLocalDeformation: motion.maxLocalDeformation, maxStretch: motion.maxStretch ?? null, minStretch: motion.minStretch ?? null, deformMayFold: motion.deformMayFold ?? false },
    rows,
    schedule: {
      animation: MOTION_ANIMATION,
      fps: IDLE_FPS,
      phases: [...s.phases],
      physics: s.physics,
      frames: { grid: walked.filter((f) => f.phase === 'grid').length, irr: walked.filter((f) => f.phase === 'irr').length },
      held_out: section?.schedule.heldOutClaim ?? false,
      selection: [...(section?.schedule.selection ?? [])],
    },
  };
}

/** The attachment-level local-deformation row, the one the build line prints. */
export function localRow(report: MeshQualityReport): MeasureRow | null {
  return report.candidates[0]?.motion?.rows.find((r) => r.code === 'MQ_LOCAL_DEFORMATION' && r.object.region === null) ?? null;
}

/** The build line's motion clause: `motion <value> <= <bound> at <frame>`. */
export function motionClause(report: MeshQualityReport): string {
  const r = localRow(report);
  if (r === null) return 'motion: no local-deformation row';
  if (r.value === null || r.bound === null) return `motion ${r.state}: ${r.reason ?? ''}`;
  const at = r.worst?.frame?.id ?? 'every frame (0 points at nothing)';
  return `motion ${r.value} ${r.state === 'pass' ? r.bound.op : r.bound.op === '<=' ? '>' : '<'} ${r.bound.value} at ${at}`;
}

/** The comparison's whole document, as spine-rigc writes it, parsed so it can sit inside `mesh_report.json`. */
export function motionDocument(report: MeshQualityReport): unknown {
  return JSON.parse(writeMeshQualityReport(report));
}
