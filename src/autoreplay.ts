/**
 * The automatic mode's acceptance loop with a replay (issue #126, rigc#1266
 * mechanism 2, rig-c 2.24.0): what the rig stage does with an `auto` part
 * whose full reduction is refused by the motion gate (`src/automotion.ts`).
 *
 * rig-c's `reduceMesh` reports `changes.acceptedAt`, one entry per accepted
 * operation — `{ step, kind, count, sourceVertices }`, `step` the attempt
 * number it was taken at and `kind` a refinement `insertion`, a single
 * `removal` or a `boundary-run` (from rig-c 2.25.0, rigc#1279; before it the
 * entries were the bare attempt numbers) — and takes `stopAfterAccepted: n`,
 * which returns byte for byte the mesh the same call held after its n-th
 * accepted operation, terminated `replayed-to-accepted-step` (the contract:
 * rig-c's docs/MESH_REDUCTION.md §2 and §7, *Mechanism 2 — implemented*).
 * Every step below is an operation, not a vertex: a boundary run removes two
 * or more vertices in one step. The choosing is this package's (mechanism 3,
 * agreed on issue #126 as Q8), and it is done this way:
 *
 * 1. **The domain.** N = `acceptedAt.length` operations; the first I of them
 *    are the refinement's insertions ({@link refinementSteps}: the entries up
 *    to the last of kind `insertion` — rig-c refines inside the declared
 *    regions, then removes). A step at or below I is the
 *    source, refined or not, and is never written as an automatic result —
 *    writing the source would silently defeat the mode, so a search that finds
 *    no removal step passing is refused, "no reduction passes the motion
 *    bound" ({@link noReductionProblem}). Step N is the full result, which the
 *    gate already refused. So only the removal steps I+1 .. N−1 are probed, and
 *    a replay inside the refinement — which rig-c returns unaccepted, a
 *    refinement step not being required to meet the targets — is never asked
 *    for.
 * 2. **The search** ({@link bisectAccepted}): a bisection on n over (I, N),
 *    lo = I taken as passing and hi = N as failing; each probe replays step
 *    n, holds it to the same acceptance as the full result ({@link
 *    replayVerdict}: the termination rig-c promised, every declared geometry
 *    row passing), compiles it and compares it with the source on the idle's
 *    **grid** frames only ({@link selectionSchedule}: the schedule walks no
 *    irr frame at all, so none can inform the choice). It keeps the largest n
 *    it saw pass. Validity along the order is not monotone (the contract's M3
 *    measured it), so the search finds *a* passing prefix by bisection, not
 *    necessarily the last, and the row says so ({@link REPLAY_RULE}). Its
 *    length is at most ⌈log₂(N − I)⌉ replays ({@link maxReplays}) — derived
 *    from the domain, not an author's number; no config knob exists.
 * 3. **The acceptance.** The chosen replay is written into the rig, which goes
 *    through rigc's gate again as written, and is compared with the source on
 *    the whole idle — grid and irr — with the grid frames declared
 *    `selection` and the irr frames held out ({@link splitSchedule};
 *    `heldOutClaim` true, by rig-c's walk). It is accepted only when rig-c's
 *    verdict is `accepted` on every frame, the held-out ones included;
 *    otherwise {@link heldOutProblem} names the selection value and the held-out
 *    value with the worst frame of each. Nothing is written otherwise.
 *
 * The probe — a replay, a build, a comparison — runs in the rig stage
 * (`src/build.ts`), the one place this package runs rigc. Pure: no clock, no
 * randomness, nothing read or written.
 */
import type { AcceptedOperation, MeasureRow, MeshQualityReport, MotionSchedule, ReducedMesh } from 'rig-c/mesh';
import { autoVerdict, terminationText } from './automesh.ts';
import { idleSchedule, localRow, motionRowText } from './automotion.ts';
import type { Problem } from './errors.ts';

/** What the row and the build line say the search is, in so many words. */
export const REPLAY_RULE =
  'bisection over acceptedAt by stopAfterAccepted (rigc#1266 mechanism 2): removal steps only, selected on the idle grid frames with the irr frames held out, accepted on the whole idle; it finds a passing prefix, not necessarily the last (validity along the order is not monotone)';

/** The idle's `grid` frame ids, in walk order, from the frames rig-c walked in `report` — never typed, never the irr ones. */
export function gridFrameIds(report: MeshQualityReport): string[] {
  return (report.candidates[0]?.motion?.schedule.walked ?? []).filter((f) => f.phase === 'grid').map((f) => f.id);
}

/** The search's schedule: {@link idleSchedule} walking the `grid` phase alone, every frame of it `selection`. */
export function selectionSchedule(grid: readonly string[]): MotionSchedule {
  const s = idleSchedule();
  return { ...s, phases: ['grid'], selection: [...grid] };
}

/** The final acceptance's schedule: {@link idleSchedule} whole — grid and irr — with the grid frames `selection`, so every irr frame is held out. */
export function splitSchedule(grid: readonly string[]): MotionSchedule {
  return { ...idleSchedule(), selection: [...grid] };
}

/**
 * I: the operations of `acceptedAt` that are the refinement's insertions — the
 * entries up to and including the last of kind `insertion`, found by `kind`
 * and not by a count of vertices (rigc#1279: an operation may remove several).
 * rig-c refines first and then removes, so they are a prefix; 0 when there is
 * none.
 */
export function refinementSteps(acceptedAt: readonly AcceptedOperation[]): number {
  for (let i = acceptedAt.length - 1; i >= 0; i--) if (acceptedAt[i].kind === 'insertion') return i + 1;
  return 0;
}

/** Two accepted operations are the same operation: the same attempt number, kind, count and source vertices in order. */
export function sameOperation(a: AcceptedOperation, b: AcceptedOperation): boolean {
  return a.step === b.step && a.kind === b.kind && a.count === b.count && a.sourceVertices.length === b.sourceVertices.length && a.sourceVertices.every((v, i) => v === b.sourceVertices[i]);
}

/** An operation in a phrase: `12 removal [7]`, `40 boundary-run x3 [3, 4, 5]`. */
export function operationText(o: AcceptedOperation | undefined): string {
  if (o === undefined) return 'none';
  return `${o.step} ${o.kind}${o.count === 1 ? '' : ` x${o.count}`}${o.sourceVertices.length === 0 ? '' : ` [${o.sourceVertices.join(', ')}]`}`;
}

/** The most replays a bisection over the removal steps (I, N) takes: ⌈log₂(N − I)⌉, 0 when there is no step strictly between. */
export function maxReplays(accepted: number, inserted: number): number {
  const span = accepted - inserted;
  return span <= 1 ? 0 : Math.ceil(Math.log2(span));
}

/** One probe of the search: the step replayed and what it read on the selection frames. */
export interface ReplayProbe {
  step: number;
  /** `pass`: accepted on selection; `fail`: compared and not accepted; `refused`: the replay or its build was refused before a comparison. */
  verdict: 'pass' | 'fail' | 'refused';
  /** The attachment-level `MQ_LOCAL_DEFORMATION` on the selection frames, or null when nothing was compared. */
  value: number | null;
  frame: string | null;
  /** Why a `refused` probe was refused; null otherwise. */
  reason: string | null;
}

/**
 * The bisection (module header, step 2): lo = `lo` taken as passing, hi = `hi`
 * as failing; while a step lies strictly between, probe the middle one
 * (rounded down) and move lo up to it when it passes, hi down to it when it does
 * not. Returns the largest step seen to pass — `lo` itself when none did — and
 * every probe in the order taken. Deterministic: the order depends only on
 * the answers.
 */
export function bisectAccepted(lo: number, hi: number, probe: (step: number) => ReplayProbe): { chosen: number; probes: ReplayProbe[] } {
  const probes: ReplayProbe[] = [];
  let a = lo;
  let b = hi;
  while (b - a > 1) {
    const mid = Math.floor((a + b) / 2);
    const p = probe(mid);
    probes.push(p);
    if (p.verdict === 'pass') a = mid;
    else b = mid;
  }
  return { chosen: a, probes };
}

/**
 * The acceptance of one replay (module header, steps 1–2): the termination the
 * contract promises for `stopAfterAccepted: step` — `replayed-to-accepted-step`
 * with `acceptedSteps` the step and `candidatesTried` the full run's
 * `acceptedAt[step − 1].step`, its own `acceptedAt` the full run's first `step`
 * operations, each the same operation ({@link sameOperation}) —
 * and then {@link autoVerdict}'s rule, the full result's: the candidate
 * `accepted` with every declared geometry row passing. A replay that breaks the
 * promise is `AUTO_MESH_TERMINATION` naming the step and the difference; one
 * that keeps it but does not meet the targets is `AUTO_MESH_ACCEPTED`, as the
 * full result would be.
 */
export function replayVerdict(
  object: string,
  step: number,
  acceptedAt: readonly AcceptedOperation[],
  result: { mesh: ReducedMesh | null; report: MeshQualityReport },
): { accepted: true; mesh: ReducedMesh; candidatesTried: number } | { accepted: false; problem: Problem } {
  const t = result.report.termination;
  const own = result.report.candidates[0]?.changes?.acceptedAt ?? null;
  const want = acceptedAt[step - 1]?.step;
  const broken =
    want === undefined
      ? `was asked for a step the full run never took (it accepted ${acceptedAt.length} operation(s))`
      : t === null || t.reason !== 'replayed-to-accepted-step'
      ? `ended ${terminationText(t)}`
      : t.acceptedSteps !== step
        ? `reports acceptedSteps ${t.acceptedSteps}`
        : t.candidatesTried !== want
          ? `reports candidatesTried ${t.candidatesTried} where the full run's acceptedAt[${step - 1}].step is ${want}`
          : own === null || own.length !== step || own.some((o, i) => !sameOperation(o, acceptedAt[i]))
            ? `reports acceptedAt of ${(own ?? []).length} operation(s) (first differing: ${operationText((own ?? []).find((o, i) => acceptedAt[i] === undefined || !sameOperation(o, acceptedAt[i])))}), not the full run's first ${step}`
            : null;
  if (broken !== null || want === undefined) {
    return {
      accepted: false,
      problem: {
        code: 'AUTO_MESH_TERMINATION',
        object,
        detail: `rig-c's reduceMesh with stopAfterAccepted ${step} ${broken}; the contract (rigc#1268) promises replayed-to-accepted-step with acceptedSteps ${step} and candidatesTried ${want ?? 'the full run\'s acceptedAt[n - 1].step'}, and a replay that breaks it is not a candidate`,
      },
    };
  }
  const v = autoVerdict(object, result);
  if (!v.accepted) return v;
  return { accepted: true, mesh: v.mesh, candidatesTried: want };
}

/** One role's reading of the attachment-level local-deformation row: value, state and worst frame, or null when that role walked no frame. */
export interface RoleReading {
  value: number | null;
  state: MeasureRow['state'];
  frame: string | null;
}

/** The local-deformation row's `selection` and `held-out` readings (rig-c's `byRole`). */
export function roleReadings(report: MeshQualityReport): { selection: RoleReading | null; held_out: RoleReading | null; bound: { op: '<=' | '>='; value: number } | null } {
  const r = localRow(report);
  const by = r?.motion?.byRole;
  const of = (x: { value: number | null; state: MeasureRow['state']; frame: string | null } | null | undefined): RoleReading | null => (x === null || x === undefined ? null : { value: x.value, state: x.state, frame: x.frame });
  return { selection: of(by?.selection), held_out: of(by?.heldOut), bound: r?.bound ?? null };
}

/** A role's reading in a phrase: `0.93 <= 1 at idle@grid@1`, the operator turned when it fails. */
export function readingText(r: RoleReading | null, bound: { op: '<=' | '>='; value: number } | null): string {
  if (r === null) return 'not walked';
  if (r.value === null || bound === null) return `${r.state}`;
  const op = r.state === 'pass' ? bound.op : bound.op === '<=' ? '>' : '<';
  return `${r.value} ${op} ${bound.value} at ${r.frame ?? 'every frame'}`;
}

/** The probes in one phrase: `step 12 pass 0.4 at …, step 18 fail 1.2 at …`. */
export function probesText(probes: readonly ReplayProbe[]): string {
  if (probes.length === 0) return 'no step lies strictly between the source and the full result';
  return probes.map((p) => `step ${p.step} ${p.verdict}${p.value === null ? '' : ` ${p.value} at ${p.frame ?? 'every frame'}`}${p.reason === null ? '' : ` (${p.reason})`}`).join(', ');
}

/**
 * The refusal when the search keeps no removal step (module header, step 1):
 * the source is not written as an automatic result. Names the full result's
 * reading, the domain and every probe.
 */
export function noReductionProblem(object: string, full: string, accepted: number, inserted: number, probes: readonly ReplayProbe[]): Problem {
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `no reduction passes the motion bound: the full result (accepted step ${accepted} of ${accepted}) ${full}; a bisection over the removal steps ${inserted + 1}..${accepted - 1} by stopAfterAccepted, ` +
      `selected on the idle grid frames with the irr frames held out, kept none (${probesText(probes)}); the source${inserted > 0 ? `, refined or not (steps 0..${inserted}),` : ' (step 0)'} is not an automatic result, and nothing is built in its place — raise the motion bound, protect the vertices that carry the motion (protect.weightJump), or put the part in contour mode`,
  };
}

/** The refusal of a chosen replay that the whole idle does not accept: the selection and held-out values, the worst frame of each, and every failing row. */
export function heldOutProblem(object: string, step: number, accepted: number, report: MeshQualityReport, failing: string): Problem {
  const r = roleReadings(report);
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `the replay to accepted step ${step} of ${accepted}, chosen on the idle grid frames, is not accepted on the whole idle: selection ${readingText(r.selection, r.bound)}; held out ${readingText(r.held_out, r.bound)} (${failing}); ` +
      'a candidate chosen on some frames must pass on the frames it was not chosen by, and nothing is built in its place',
  };
}

/**
 * The final acceptance of a chosen replay (module header, step 3): null when
 * rig-c accepts it on the whole schedule — every frame, the held-out ones
 * included — else {@link heldOutProblem} with every gated row that did not pass.
 */
export function finalVerdict(object: string, step: number, accepted: number, report: MeshQualityReport): Problem | null {
  const c = report.candidates[0];
  if (c !== undefined && c.accepted) return null;
  const failing = [...(c?.geometry?.rows ?? []), ...(c?.motion?.rows ?? [])].filter((r) => r.bound !== null && r.state !== 'pass');
  return heldOutProblem(object, step, accepted, report, failing.length > 0 ? failing.map(motionRowText).join('; ') : 'a required motion row was not measured');
}

/** What `mesh_report.json`'s row carries about a search that chose a replay (`replay`, before `deformation`). */
export interface ReplayRow {
  rule: string;
  /** The full run's `acceptedAt` length: N operations. */
  accepted_steps: number;
  /** The refinement's insertions among them: I (operations 1..I, {@link refinementSteps}). */
  refinement_steps: number;
  /** The operation written: I < n < N. */
  chosen_step: number;
  /** `reduceMesh` calls with `stopAfterAccepted`: one per probe. */
  replays: number;
  /** ⌈log₂(N − I)⌉ ({@link maxReplays}). */
  max_replays: number;
  /** The candidates tried across the replays (each replay's `candidatesTried` — `acceptedAt[n − 1].step` — summed); the full run's own is the `quality_report`'s. */
  candidates_tried: number;
  /** The full result's reading on the whole idle, as the gate refused it. */
  full: RoleReading | null;
  probes: ReplayProbe[];
  /** The chosen replay on the whole idle, per role, from the final comparison. */
  selection: RoleReading | null;
  held_out: RoleReading | null;
}
