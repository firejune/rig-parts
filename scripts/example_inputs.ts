#!/usr/bin/env bun
/**
 * The one check that holds the public examples' fetched inputs to the commit
 * `scripts/fetch-examples.sh` pins (issue #367), and the copy step of that
 * script, which runs it.
 *
 *   bun scripts/example_inputs.ts sync --upstream <dir> --dest <examples dir> --commit <sha> --tree <ls-tree -r -z output>
 *   bun scripts/example_inputs.ts sync --upstream <dir> --dest <examples dir> --unpinned
 *
 * The script calls this; nobody else needs to. `sync` is the copy step: for
 * every `examples/<key>/config.json` it brings `examples/<key>/inputs/` to
 * exactly the files of the pinned tree, byte for byte, and only then writes
 * `inputs/.fetched.json` — the commit and every file's blob id.
 *
 * ## Where the required hashes come from
 *
 * The pinned commit is the one source of truth. The hash each input must have
 * is the blob id git records for that path in that commit's tree (`git ls-tree
 * -r`), not a manifest kept in this tree beside the pin: a manifest would be a
 * second record of the same commit, and a re-pin that forgot it would leave the
 * two disagreeing. `.fetched.json` is derived from the pin at fetch time, and
 * it is trusted only while its `commit` is the commit the script pins now; the
 * example suites read it through {@link checkExampleInputs}, offline, so they
 * need neither a network nor git.
 *
 * ## What it refuses, by name
 *
 * - `INPUTS_MATCH_PIN` — a file on disk whose blob id is not the pinned
 *   tree's, a file the tree has and the disk does not, a file on disk the tree
 *   does not have. `sync` replaces or removes such a file and prints a line
 *   naming it and both ids; when it cannot, it refuses with the same words and
 *   writes no record.
 * - `INPUTS_FETCH_RECORD` — no `.fetched.json` (inputs fetched before #367, or
 *   by hand), one that does not parse, one written by an UNPINNED `--from`
 *   copy, or one written for a commit other than the pin.
 * - `FETCH_UPSTREAM_MATCHES_TREE` — the checked-out file upstream is not the
 *   blob its tree lists, so the copy would carry something the pin does not.
 *
 * Hashing every input of the four examples (260 files, 95.8 MB) took 168 to
 * 360 ms over three runs on the owner's development machine (Bun 1.x, sha1 from
 * `node:crypto`), so every example suite runs the whole check on every run.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The record a fetch writes beside the inputs, after every file matched. */
export const FETCH_RECORD = '.fetched.json';

/** What a fix says to run. */
const REMEDY = 'run `bun run fetch-examples`';

/** The files every fetched example must hold; the fetch is incomplete without them. */
export const REQUIRED_INPUTS = ['painting.png', 'st_input_full.png', 'st_input_head.png', 'layers/full/layers.json', 'layers/head/layers.json'] as const;

/** git's blob id of these bytes: sha1 over `blob <length>\0` and the bytes, which is what `git hash-object` and `git ls-tree` print. */
export function blobId(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** The commit `scripts/fetch-examples.sh` pins (its `PINNED_COMMIT=` line), or a named absence. */
export function pinnedExamplesCommit(script: string): string {
  const m = /^PINNED_COMMIT=([0-9a-f]{40})\s*$/m.exec(script);
  return m === null ? 'unread (no 40-character PINNED_COMMIT in scripts/fetch-examples.sh)' : m[1];
}

/**
 * Where an upstream file of one example lands under `examples/<key>/inputs/`,
 * or null when the fetch does not carry it: the painting, every file directly
 * under `inputs/`, and everything under `layers/`.
 */
export function inputPathOf(upstreamRel: string): string | null {
  if (upstreamRel === 'painting.png') return upstreamRel;
  if (/^inputs\/[^/]+$/.test(upstreamRel)) return upstreamRel.slice('inputs/'.length);
  if (upstreamRel.startsWith('layers/')) return upstreamRel;
  return null;
}

/** One tree entry of `git ls-tree -r -z`. */
export interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
}

/** `git ls-tree -r -z` output by path. A record that does not have the form is refused by name. */
export function parseTreeListing(text: string): Map<string, TreeEntry> {
  const out = new Map<string, TreeEntry>();
  for (const rec of text.split('\0')) {
    if (rec === '') continue;
    const m = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})\t(.+)$/s.exec(rec);
    if (m === null) throw new Error(`FETCH_TREE_LISTING: a record of the tree listing reads "${rec.slice(0, 80)}"; required "<mode> <type> <40-hex id>\\t<path>"`);
    out.set(m[4], { mode: m[1], type: m[2], oid: m[3] });
  }
  return out;
}

/** Code-unit order: the same in every locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every file under `dir`, as paths relative to it with `/`, in code-unit order. */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort(byCodeUnit)) {
    const p = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, rel));
    else out.push(rel);
  }
  return out.sort(byCodeUnit);
}

/** The blob id of the file at `p`, or null when it cannot be read. */
function blobOf(p: string): string | null {
  try {
    return blobId(readFileSync(p));
  } catch {
    return null;
  }
}

/** The record a fetch writes: the commit (null for an UNPINNED copy) and every input's blob id, keys in code-unit order. */
export interface FetchRecord {
  commit: string | null;
  files: Record<string, string>;
}

/** The record's bytes: fixed key order, sorted files, one trailing newline. */
export function recordText(record: FetchRecord): string {
  const files: Record<string, string> = {};
  for (const k of Object.keys(record.files).sort(byCodeUnit)) files[k] = record.files[k];
  return `${JSON.stringify({ commit: record.commit, files }, null, 2)}\n`;
}

/** The record under `inputsDir`, or the words that refuse it. */
function readRecord(inputsDir: string, label: string, pinned: string): FetchRecord | string {
  const at = `${label}/${FETCH_RECORD}`;
  const path = join(inputsDir, FETCH_RECORD);
  if (!existsSync(path)) {
    return `INPUTS_FETCH_RECORD: ${at} — absent, so nothing says which commit these inputs were fetched at (fetched before issue #367, or by hand); found no record, required one written by a fetch of ${pinned}; ${REMEDY}`;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return `INPUTS_FETCH_RECORD: ${at} — does not parse (${(err as Error).message}); required the record a fetch of ${pinned} writes; ${REMEDY}`;
  }
  const r = raw as { commit?: unknown; files?: unknown };
  const filesOk = typeof r.files === 'object' && r.files !== null && !Array.isArray(r.files) && Object.values(r.files).every((v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v));
  if (!(r.commit === null || (typeof r.commit === 'string' && /^[0-9a-f]{40}$/.test(r.commit))) || !filesOk) {
    return `INPUTS_FETCH_RECORD: ${at} — holds no {commit: <40-hex or null>, files: {<path>: <40-hex blob id>}}; required the record a fetch of ${pinned} writes; ${REMEDY}`;
  }
  return { commit: r.commit as string | null, files: r.files as Record<string, string> };
}

/**
 * Every way the inputs under `inputsDir` (named `label` in the words, as
 * `examples/<key>/inputs`) are not the pinned tree's: empty means they are, byte
 * for byte. The example suites call this before they read an input, and
 * `sync` calls it on what it just wrote.
 */
export function checkExampleInputs(inputsDir: string, label: string, pinned: string): string[] {
  const record = readRecord(inputsDir, label, pinned);
  if (typeof record === 'string') return [record];
  if (record.commit === null) {
    return [`INPUTS_FETCH_RECORD: ${label}/${FETCH_RECORD} — written by an UNPINNED copy (fetch-examples --from a working copy that is not a clean checkout of the pin); found commit none, required ${pinned}; ${REMEDY}`];
  }
  if (record.commit !== pinned) {
    return [`INPUTS_FETCH_RECORD: ${label}/${FETCH_RECORD} — fetched at another commit; found ${record.commit}, required ${pinned} (the pin in scripts/fetch-examples.sh); ${REMEDY}`];
  }
  const out: string[] = [];
  const onDisk = filesUnder(inputsDir).filter((f) => f !== FETCH_RECORD);
  for (const rel of Object.keys(record.files).sort(byCodeUnit)) {
    const want = record.files[rel];
    const p = join(inputsDir, rel);
    if (!existsSync(p)) {
      out.push(`INPUTS_MATCH_PIN: ${label}/${rel} — absent; found no file, required blob ${want} (commit ${pinned}); ${REMEDY}`);
      continue;
    }
    const got = blobOf(p);
    if (got !== want) out.push(`INPUTS_MATCH_PIN: ${label}/${rel} — stale; found blob ${got ?? 'unreadable'}, required blob ${want} (commit ${pinned}); ${REMEDY}`);
  }
  for (const rel of onDisk) {
    if (!(rel in record.files)) out.push(`INPUTS_MATCH_PIN: ${label}/${rel} — not in the pinned tree; found blob ${blobOf(join(inputsDir, rel)) ?? 'unreadable'}, required no file (commit ${pinned}); ${REMEDY}`);
  }
  return out;
}

/** How a file is copied: `copyFileSync`, which a control replaces with one that fails, to plant a file that cannot be re-fetched on every platform (Bun on macOS writes a large file through a read-only one). */
export type Copier = (from: string, to: string) => void;

/** What one example's sync did. */
export interface ExampleSync {
  /** Named lines, one per file replaced or removed. */
  lines: string[];
  /** Refusals by name; when any, no record was written. */
  refusals: string[];
  copied: number;
  replaced: number;
  kept: number;
  removed: number;
  /** Files under the inputs after the sync, the record not counted. */
  total: number;
}

/**
 * The files one example must hold, by path under its inputs, with their blob
 * ids: the tree listing's for a pinned fetch (each checked-out file held to
 * it), the working copy's own for an UNPINNED one. A string is a refusal.
 */
function requiredOf(upstreamKeyDir: string, key: string, listing: Map<string, TreeEntry> | null): { want: Map<string, { oid: string; from: string }>; refusals: string[] } {
  const want = new Map<string, { oid: string; from: string }>();
  const refusals: string[] = [];
  const place = (rel: string, oid: string): void => {
    const dest = inputPathOf(rel);
    if (dest === null) return;
    const prior = want.get(dest);
    if (prior !== undefined) {
      refusals.push(`FETCH_UPSTREAM_MATCHES_TREE: ${key}/${rel} — lands on inputs/${dest}, which ${key}/${prior.from} already fills; required one upstream file per input`);
      return;
    }
    want.set(dest, { oid, from: rel });
  };
  if (listing !== null) {
    for (const [path, e] of [...listing.entries()].sort((a, b) => byCodeUnit(a[0], b[0]))) {
      if (!path.startsWith(`${key}/`)) continue;
      const rel = path.slice(key.length + 1);
      if (inputPathOf(rel) === null) continue;
      if (e.type !== 'blob' || (e.mode !== '100644' && e.mode !== '100755')) {
        refusals.push(`FETCH_UPSTREAM_MATCHES_TREE: ${path} — the tree lists a ${e.type} of mode ${e.mode}; required a regular file (100644 or 100755)`);
        continue;
      }
      const got = blobOf(join(upstreamKeyDir, rel));
      if (got !== e.oid) {
        refusals.push(`FETCH_UPSTREAM_MATCHES_TREE: ${path} — the checked-out file is blob ${got ?? 'unreadable'}; the tree lists ${e.oid}`);
        continue;
      }
      place(rel, e.oid);
    }
  } else {
    const rels = filesUnder(upstreamKeyDir).filter((rel) => inputPathOf(rel) !== null);
    for (const rel of rels) {
      const got = blobOf(join(upstreamKeyDir, rel));
      if (got === null) refusals.push(`FETCH_UPSTREAM_MATCHES_TREE: ${key}/${rel} — unreadable in the working copy`);
      else place(rel, got);
    }
  }
  return { want, refusals };
}

/**
 * Brings `inputsDir` to exactly the files `upstreamKeyDir` carries for this
 * example: a missing file copied, a file whose bytes differ replaced, a file
 * the tree lacks removed — each replacement and removal printed by name — and
 * the record written only when {@link checkExampleInputs} then finds nothing.
 * `commit` is null for an UNPINNED copy, and then `listing` is null too.
 */
export function syncExample(o: { upstreamKeyDir: string; key: string; inputsDir: string; label: string; commit: string | null; listing: Map<string, TreeEntry> | null; copy?: Copier }): ExampleSync {
  const copy = o.copy ?? copyFileSync;
  const res: ExampleSync = { lines: [], refusals: [], copied: 0, replaced: 0, kept: 0, removed: 0, total: 0 };
  const where = o.commit === null ? 'the UNPINNED working copy' : `commit ${o.commit}`;
  const recordPath = join(o.inputsDir, FETCH_RECORD);
  // A record outlives a sync that stops half way only if it is left in place, so it goes first.
  rmSync(recordPath, { force: true });
  const { want, refusals } = requiredOf(o.upstreamKeyDir, o.key, o.listing);
  res.refusals.push(...refusals);
  for (const [rel, { oid, from }] of [...want.entries()].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const dst = join(o.inputsDir, rel);
    const there = existsSync(dst);
    const found = there ? blobOf(dst) : null;
    if (there && found === oid) {
      res.kept++;
      continue;
    }
    let err = '';
    try {
      mkdirSync(dirname(dst), { recursive: true });
      copy(join(o.upstreamKeyDir, from), dst);
    } catch (e) {
      err = (e as Error).message;
    }
    const after = existsSync(dst) ? blobOf(dst) : null;
    if (after !== oid) {
      res.refusals.push(`INPUTS_MATCH_PIN: ${o.label}/${rel} — ${there ? 'stale' : 'absent'} and could not be re-fetched${err === '' ? '' : ` (${err})`}; found blob ${after ?? found ?? 'none'}, required blob ${oid} (${where})`);
      continue;
    }
    if (there) {
      res.replaced++;
      res.lines.push(`  INPUTS_MATCH_PIN replaced ${o.label}/${rel} — the bytes on disk were stale; found blob ${found ?? 'unreadable'}, required blob ${oid} (${where}); re-fetched`);
    } else res.copied++;
  }
  for (const rel of filesUnder(o.inputsDir)) {
    if (rel === FETCH_RECORD || want.has(rel)) continue;
    const found = blobOf(join(o.inputsDir, rel));
    try {
      rmSync(join(o.inputsDir, rel));
      res.removed++;
      res.lines.push(`  INPUTS_MATCH_PIN removed ${o.label}/${rel} — not in ${where}; found blob ${found ?? 'unreadable'}, required no file`);
    } catch (e) {
      res.refusals.push(`INPUTS_MATCH_PIN: ${o.label}/${rel} — not in ${where} and could not be removed (${(e as Error).message}); found blob ${found ?? 'unreadable'}, required no file`);
    }
  }
  const gap = REQUIRED_INPUTS.filter((f) => !existsSync(join(o.inputsDir, f)));
  if (gap.length > 0) res.refusals.push(`FETCH_INPUTS_COMPLETE: ${o.label} — incomplete after the fetch; missing ${gap.join(', ')}`);
  res.total = filesUnder(o.inputsDir).filter((f) => f !== FETCH_RECORD).length;
  if (res.refusals.length > 0) return res;
  const files: Record<string, string> = {};
  for (const [rel, { oid }] of want) files[rel] = oid;
  writeFileSync(recordPath, recordText({ commit: o.commit, files }));
  if (o.commit !== null) {
    // Read back through the suites' own check, so the fetch and the suites cannot disagree about what "current" means.
    const left = checkExampleInputs(o.inputsDir, o.label, o.commit);
    if (left.length > 0) {
      rmSync(recordPath, { force: true });
      res.refusals.push(...left);
    }
  }
  return res;
}

/** The `sync` command the fetch script runs. Returns the exit status. */
export function runSync(argv: readonly string[], log: (s: string) => void = console.log, warn: (s: string) => void = console.error, copy: Copier = copyFileSync): number {
  const arg = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const upstream = arg('--upstream');
  const dest = arg('--dest');
  const commit = arg('--commit');
  const tree = arg('--tree');
  const unpinned = argv.includes('--unpinned');
  if (upstream === null || dest === null || (unpinned ? commit !== null || tree !== null : commit === null || tree === null)) {
    warn('example_inputs sync: usage: sync --upstream <dir> --dest <examples dir> (--commit <sha> --tree <ls-tree -r -z output> | --unpinned)');
    return 2;
  }
  let listing: Map<string, TreeEntry> | null = null;
  if (!unpinned) {
    try {
      listing = parseTreeListing(readFileSync(tree as string, 'utf8'));
    } catch (e) {
      warn(`fetch-examples: ${(e as Error).message}`);
      return 1;
    }
  }
  const tag = unpinned ? ' (UNPINNED)' : '';
  const keys = readdirSync(dest)
    .sort(byCodeUnit)
    .filter((k) => existsSync(join(dest, k, 'config.json')));
  let fetched = 0;
  const refused: string[] = [];
  const missingUpstream: string[] = [];
  for (const key of keys) {
    const src = join(upstream, key);
    if (!existsSync(join(src, 'painting.png'))) {
      missingUpstream.push(key);
      continue;
    }
    const label = `examples/${key}/inputs`;
    const r = syncExample({ upstreamKeyDir: src, key, inputsDir: join(dest, key, 'inputs'), label, commit: unpinned ? null : commit, listing, copy });
    for (const l of r.lines) log(`${l}${tag}`);
    log(`  ${key}: ${r.copied} file(s) copied, ${r.replaced} replaced, ${r.kept} kept (blob id matches ${unpinned ? 'the working copy' : 'the pinned tree'}), ${r.removed} removed, ${r.total} in ${label}${r.refusals.length === 0 ? ` and its ${FETCH_RECORD}` : ', NO record written'}${tag}`);
    refused.push(...r.refusals);
    fetched++;
  }
  for (const key of readdirSync(upstream).sort(byCodeUnit)) {
    if (existsSync(join(upstream, key, 'painting.png')) && !existsSync(join(dest, key, 'config.json'))) log(`  note: upstream has "${key}", which has no examples/${key}/config.json here; not fetched`);
  }
  // A warning and not a failure: the selftest's example suites refuse a partial set of inputs by name, and a fetch that
  // failed here would hide which of the other examples it did fetch.
  for (const key of missingUpstream) warn(`fetch-examples: WARNING — examples/${key} has no counterpart upstream (no ${key}/painting.png), so its inputs were not fetched`);
  let status = 0;
  for (const r of refused) warn(`fetch-examples: ${r}`);
  if (refused.length > 0) status = 1;
  if (fetched === 0) {
    warn('fetch-examples: fetched nothing — no examples/<key>/config.json found a counterpart upstream');
    status = 1;
  }
  if (status === 0) log(`fetch-examples: ${fetched} example(s) ready under examples/*/inputs, each file held to its blob id ${unpinned ? 'in the working copy (UNPINNED; the example suites refuse these inputs by name)' : `at ${commit}`}`);
  return status;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'sync') {
    console.error(`example_inputs: unknown command "${cmd ?? ''}"; usage: bun scripts/example_inputs.ts sync ...`);
    process.exit(2);
  }
  process.exit(runSync(rest));
}
