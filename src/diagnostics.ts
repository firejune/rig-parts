/**
 * What `propose` looked at, said (issue #86): the coverage lines lint's
 * per-bone record prints, and the basis file written beside the proposal.
 *
 * ## Coverage
 *
 * `lint` (`src/propose.ts`) returns, beside its findings, one record per bone
 * of the spec: the checks that read it, or why none did. {@link coverageLines}
 * prints one line per bone and a summary that counts "checked, clean",
 * "checked, LINT" and "not checked" apart, with the roles
 * (`src/structure.ts`'s {@link configRoles}, imported, never derived again).
 * The lines are printed after every line `propose` printed before them, so
 * nothing that was printed before changes.
 *
 * ## The basis file
 *
 * `basis.json` (spec {@link BASIS_SPEC}) records, for every bone the proposal
 * places, what its origin — and its tip, where the proposal states one —
 * rests on: a joint (`joint`), a measurement off a part (`mask`), a rule of
 * proportion (`ratio`) or other bones (`derived`), recorded in `propose()`
 * where the placement happens. Under `propose --compare <config>` each bone
 * also says whether the config's bone differs from the proposal's and by how
 * far, through `src/structure.ts`'s comparison (origin, tip and parent); a
 * bone only one side has is said to be that, and nothing more is inferred —
 * a difference is a fact, not a verdict on either side. No confidence figure
 * is computed anywhere; a score a keypoint file carried is recorded as the
 * file's.
 *
 * The file is written only after green: {@link checkBasis} holds it to the
 * proposal and the parts before anything is written, and refuses by name.
 * Fixed key order, two-space indent, trailing newline — the same inputs
 * write the same bytes.
 */
import { type Problem, refuseIfAny } from './errors.ts';
import { BASIS_KINDS, type BasisKind, type BoneBasis, type BoneCoverage, COVERAGE_OUTCOMES, coverageOutcome, expand, FRAME_KEYS, type FrameBasis, type FrameKey, type PartSet, type Placement, type Proposal, type ProposalBasis } from './propose.ts';
import { BONE_ROLES, type BoneRole, compareStructure, readSkeleton } from './structure.ts';

export const BASIS_SPEC = 'spine-parts-basis/1';

/** The file's name, beside `proposal.json`. */
export const BASIS_FILE = 'basis.json';

/**
 * Under `--compare`: the config's bone against the proposal's. `status` is
 * `differs` when its origin or tip is anywhere else, or its parent is another
 * bone, or one side states a tip the other does not; `proposal only` when the
 * config has no bone of that name.
 */
export interface ConfigDelta {
  status: 'same' | 'differs' | 'proposal only';
  /** Rig px between the two origins; `null` for a bone the config does not have. */
  origin_px: number | null;
  /** Rig px between the two tips; `null` with `tip_why` when it is not a figure. */
  tip_px: number | null;
  tip_why: string | null;
  parent: { proposal: string; config: string | null };
}

export interface BasisRecord extends BoneBasis {
  /** `null` without `--compare`. */
  config: ConfigDelta | null;
}

export interface BasisFile {
  spec: typeof BASIS_SPEC;
  frame: Record<FrameKey, FrameBasis>;
  /** The config `--compare` named, as `structure.ts` labels it; `null` without `--compare`. */
  compared_with: string | null;
  bones: BasisRecord[];
  /** Under `--compare`, the config's bones the proposal does not have; `null` without it. */
  config_only: string[] | null;
}

/**
 * Hold the record to the proposal before it is written: one record per
 * proposed bone, in the proposal's order, and every name it gives resolves —
 * each part to a part of the set, each bone to a bone of the proposal. A
 * `joint` placement names at least one joint and every other kind none; a
 * `derived` placement names at least one bone; a constant is a finite number.
 */
export function checkBasis(P: PartSet, proposal: Proposal, basis: ProposalBasis): void {
  const problems: Problem[] = [];
  const names = [...expand(proposal.bones).byName.keys()];
  const bones = new Set(names);
  const parts = new Set(P.recs.map((p) => p.name));
  const recorded = basis.bones.map((b) => b.bone);
  if (recorded.join('\n') !== names.join('\n')) {
    const missing = names.filter((n) => !recorded.includes(n));
    const extra = recorded.filter((n) => !bones.has(n));
    const twice = recorded.filter((n, i) => recorded.indexOf(n) !== i);
    problems.push({
      code: 'BASIS_RECORDS_EVERY_BONE',
      object: BASIS_FILE,
      detail:
        `records ${recorded.length} bone(s) for the proposal's ${names.length}; one record per proposed bone, in the proposal's order, is required` +
        `${missing.length > 0 ? `; none for ${missing.join(', ')}` : ''}${extra.length > 0 ? `; records ${extra.join(', ')}, which the proposal does not place` : ''}${twice.length > 0 ? `; twice: ${twice.join(', ')}` : ''}` +
        `${missing.length === 0 && extra.length === 0 && twice.length === 0 ? ' (the same bones in another order)' : ''}`,
    });
  }
  for (const [k, f] of Object.entries(basis.frame)) {
    for (const p of f.parts) if (!parts.has(p)) problems.push({ code: 'BASIS_NAMES_RESOLVE', object: `${BASIS_FILE} frame.${k}`, detail: `names the part "${p}", which parts.json does not hold` });
  }
  const hold = (b: BoneBasis, which: 'origin' | 'tip', pl: Placement): void => {
    const object = `${BASIS_FILE} bone "${b.bone}" ${which}`;
    if (!BASIS_KINDS.includes(pl.kind)) problems.push({ code: 'BASIS_KIND_KNOWN', object, detail: `has the kind ${JSON.stringify(pl.kind)}; one of ${BASIS_KINDS.join(', ')} is required` });
    for (const p of pl.parts) if (!parts.has(p)) problems.push({ code: 'BASIS_NAMES_RESOLVE', object, detail: `names the part "${p}", which parts.json does not hold` });
    for (const n of pl.bones) if (!bones.has(n)) problems.push({ code: 'BASIS_NAMES_RESOLVE', object, detail: `names the bone "${n}", which the proposal does not place` });
    for (const f of pl.frame) if (!FRAME_KEYS.includes(f)) problems.push({ code: 'BASIS_NAMES_RESOLVE', object, detail: `names the frame quantity "${f}"; one of ${FRAME_KEYS.join(', ')} is required` });
    if (pl.kind === 'joint' && pl.joints.length === 0) problems.push({ code: 'BASIS_KIND_HOLDS', object, detail: 'is a joint placement that names no joint; a joint placement names the joints it took' });
    if (pl.kind !== 'joint' && pl.joints.length > 0) problems.push({ code: 'BASIS_KIND_HOLDS', object, detail: `is a ${pl.kind} placement that names the joint(s) ${pl.joints.map((j) => j.name).join(', ')}; only a joint placement takes a joint` });
    if (pl.kind === 'derived' && pl.bones.length === 0) problems.push({ code: 'BASIS_KIND_HOLDS', object, detail: 'is a derived placement that names no bone; a derived placement names the bones it is derived from' });
    for (const c of pl.constants) if (!Number.isFinite(c.value)) problems.push({ code: 'BASIS_KIND_HOLDS', object, detail: `carries the constant ${c.name} = ${c.value}; a finite number is required` });
  };
  for (const b of basis.bones) {
    hold(b, 'origin', b.origin);
    if (b.tip !== null) hold(b, 'tip', b.tip);
  }
  refuseIfAny(problems);
}

/**
 * The basis file: the proposal's record held by {@link checkBasis} and, given
 * the config `--compare` read, each bone against the config's through
 * `src/structure.ts` (equal names; the proposal is the left side).
 */
export function basisFile(P: PartSet, proposal: Proposal, basis: ProposalBasis, compared: { where: string; config: unknown } | null): BasisFile {
  checkBasis(P, proposal, basis);
  if (compared === null) return { spec: BASIS_SPEC, frame: basis.frame, compared_with: null, bones: basis.bones.map((b) => ({ ...b, config: null })), config_only: null };
  const left = readSkeleton(proposal, 'proposal');
  const right = readSkeleton(compared.config, compared.where);
  const c = compareStructure(left, right, null);
  const rows = new Map(c.rows.map((r) => [r.left, r]));
  const bones = basis.bones.map((b): BasisRecord => {
    const l = left.byName.get(b.bone);
    const r = right.byName.get(b.bone);
    const row = rows.get(b.bone);
    if (l === undefined || r === undefined || row === undefined) {
      return { ...b, config: { status: 'proposal only', origin_px: null, tip_px: null, tip_why: 'the config has no bone of this name', parent: { proposal: l?.parent ?? '', config: null } } };
    }
    const origin = 'value' in row.origin ? row.origin.value : null;
    const tip = 'value' in row.tip ? row.tip.value : null;
    // structure.ts names the sides left and right; here the left is the proposal and the right the config.
    const tipWhy = 'skip' in row.tip ? row.tip.skip.replace(/^left: /, 'proposal: ').replace(/(^|; )right: /, '$1config: ') : null;
    const differs = origin !== 0 || row.parent.kind !== 'same' || (tip !== null && tip !== 0) || (l.tip === null) !== (r.tip === null);
    return { ...b, config: { status: differs ? 'differs' : 'same', origin_px: origin, tip_px: tip, tip_why: tipWhy, parent: { proposal: l.parent ?? '', config: r.parent } } };
  });
  const placed = new Set(basis.bones.map((b) => b.bone));
  // `root` is every rig's and states no position on either side: not a bone either one placed.
  const configOnly = right.bones.map((b) => b.name).filter((n) => n !== 'root' && !placed.has(n));
  return { spec: BASIS_SPEC, frame: basis.frame, compared_with: right.label, bones, config_only: configOnly };
}

/** Fixed key order, two-space indent, trailing newline. */
export function serializeBasis(f: BasisFile): string {
  return `${JSON.stringify(f, null, 2)}\n`;
}

/** Bones per basis kind of their origin, in {@link BASIS_KINDS} order. */
export function basisCounts(f: BasisFile): Record<BasisKind, number> {
  const out: Record<BasisKind, number> = { joint: 0, mask: 0, ratio: 0, derived: 0 };
  for (const b of f.bones) out[b.origin.kind]++;
  return out;
}

/** The line `propose` prints after writing the file. */
export function basisLine(f: BasisFile, out: string): string {
  const k = basisCounts(f);
  const kinds = BASIS_KINDS.map((x) => `${k[x]} ${x}`).join(', ');
  let cmp = '';
  if (f.compared_with !== null) {
    const n = (s: ConfigDelta['status']): number => f.bones.filter((b) => b.config?.status === s).length;
    cmp = `; against ${f.compared_with}: ${n('differs')} differ, ${n('same')} same, ${n('proposal only')} in the proposal only, ${(f.config_only ?? []).length} in the config only`;
  }
  return `wrote ${BASIS_FILE} (${f.bones.length} bone record(s) by the basis of their origin: ${kinds}${cmp}) under ${out}`;
}

/** One coverage line per bone, then the summary. Every line starts `coverage`. */
export function coverageLines(coverage: readonly BoneCoverage[]): string[] {
  const out: string[] = [];
  for (const c of coverage) {
    const role = c.role === null ? 'role not read' : c.role.role;
    const outcome = coverageOutcome(c);
    if (outcome === 'not checked') out.push(`coverage ${c.bone} [${role}]: not checked — ${c.why.join('; ')}`);
    else out.push(`coverage ${c.bone} [${role}]: ${outcome} — read by ${c.read.join(', ')}${c.lint > 0 ? `; named by ${c.lint} LINT line(s)` : ''}`);
  }
  const by = (o: (typeof COVERAGE_OUTCOMES)[number]): number => coverage.filter((c) => coverageOutcome(c) === o).length;
  const roles: Record<BoneRole, number> = { target: 0, deforms: 0, control: 0, unclassified: 0 };
  let unread = 0;
  for (const c of coverage) {
    if (c.role === null) unread++;
    else roles[c.role.role]++;
  }
  out.push(
    `coverage: ${coverage.length} bone(s) — ${by('checked, clean')} checked and clean, ${by('checked, LINT')} checked with a LINT line, ${by('not checked')} not checked; ` +
      `roles ${BONE_ROLES.map((r) => `${roles[r]} ${r}`).join(', ')}${unread > 0 ? `, ${unread} not read` : ''}`,
  );
  return out;
}
