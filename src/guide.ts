/**
 * `rig-parts guide`: a slice of `docs/AUTHORING.md`, read at the moment of the
 * call (issue #343).
 *
 * The guide is one file, and it is the only copy. An agent building a rig
 * reads a failure line, `FAIL  RULE: object — detail (see rig-parts guide
 * RULE)`, and needs the row that maps RULE to what has to change. It should
 * not need the other 330 KB around that row. Every function here takes the
 * guide's text and returns lines cut from it. Nothing is generated or kept
 * apart from the file, so there is nothing to drift.
 *
 * Four readings, each defined on the text alone:
 *
 * - **A ledger table** is a Markdown table, outside a code fence, whose header's
 *   first cell is exactly `rule` (a refusal or a warning) or `line` (a line
 *   `check` prints). Other tables are not read.
 * - **A row's names** are the backticked tokens in its first cell that are
 *   rule names ({@link RULE_NAME}). A wildcard such as `PARTS_*` names
 *   nothing. Each name sits on exactly one row in the whole guide; the
 *   selftest's `TY16` holds that against every name the source can print.
 * - **A row's anchors** are the `<a id="NAME"></a>` tags at the start of its
 *   first cell, one per name. github.com keeps them as `user-content-<name>`,
 *   and its script lowercases a link's fragment before it looks one up, so
 *   `AUTHORING.md#NAME` lands on the row.
 * - **`§n`** is the `## n.` heading and everything up to the next `##`.
 *   **`§n.m`** is the m-th `###` under it, and **`§n.m.k`** the k-th `####`
 *   under that, each counted at read time, up to the next heading of its level
 *   or above. The guide's headings carry no number. `guide §n` and `guide
 *   §n.m` print the numbers they counted beside each child's size.
 *
 * A refusal and the bar it enforces are two names, each with its own row:
 * `CHECK_<LINE>` in a `rule` table, `<LINE>` in a `line` table. `guide` prints
 * the asked name's row first, then `paired with <OTHER>:` and the other one's.
 *
 * The printed form is the one HQ settled for both packages on issue #343:
 * `docs/AUTHORING.md §<addr>, line <N> — under "<heading>"` over each row;
 * `docs/AUTHORING.md §<addr> "<title>", lines <a>–<b>, <X.X> KB` over a
 * section, its children listed beneath in rig-c's columns; an unknown name or
 * section one coded FAIL line on stderr, with rig-c's three-name ranking.
 */
import type { Problem } from './errors.ts';

/** The guide's path inside the package, beside `cli.ts`. */
export const GUIDE_DOC = 'docs/AUTHORING.md';

/** A rule name: upper-case words joined by underscores (`USAGE` and `CHECK_LOOP_CLOSES` alike). */
export const RULE_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** How many of the nearest names an unknown name's refusal lists (the form shared with rig-c). */
export const NEAREST_LISTED = 3;

/** The two header words that make a table a ledger table, and what its rows are. */
export const LEDGER_HEADS = ['rule', 'line'] as const;
export type LedgerKind = (typeof LEDGER_HEADS)[number];

/** A `##` section, a `###` or a `####`: its number, its title, its lines (1-based, end exclusive) and its size. */
export interface GuideSection {
  /** `"6"` for `## 6.`, `"6.3"` for the third `###` under it, `"3.6.1"` for the first `####` under §3.6. */
  number: string;
  /** The heading's text as written (a `##` keeps its `n. `). */
  title: string;
  start: number;
  end: number;
  /** UTF-8 bytes from the heading's line to the next heading of its level or above, each line with its newline. */
  bytes: number;
}

/** One ledger row. */
export interface LedgerRow {
  kind: LedgerKind;
  /** The row's line, 1-based. */
  line: number;
  /** The table's header line and its separator line, as written. */
  header: [string, string];
  /** The row as written. */
  text: string;
  /** The rule names in the first cell, in the order written. */
  names: string[];
  /** The ids of the `<a id="…"></a>` tags at the start of the first cell, in order. */
  anchors: string[];
  /** The deepest numbered section the row sits in (`§n`, `§n.m` or `§n.m.k`). */
  section: GuideSection | null;
  /** The nearest heading above the row, its text as written. */
  heading: string;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Each line, with whether it sits inside a code fence (a fence's own lines count as inside). */
function fenced(lines: readonly string[]): boolean[] {
  let inside = false;
  return lines.map((l) => {
    if (l.startsWith('```')) {
      inside = !inside;
      return true;
    }
    return inside;
  });
}

/** Every `## n.` section, every `###` under one, and every `####` under those, numbered as {@link GuideSection} says. */
export function guideSections(text: string): GuideSection[] {
  const lines = text.split('\n');
  const inFence = fenced(lines);
  const heads: Array<{ level: number; title: string; line: number }> = [];
  lines.forEach((l, i) => {
    const h = inFence[i] ? null : /^(#{1,6}) (.*)$/.exec(l);
    if (h !== null) heads.push({ level: h[1].length, title: h[2], line: i + 1 });
  });
  const out: GuideSection[] = [];
  const counts = [0, 0, 0];
  let chapter: string | null = null;
  heads.forEach((h, k) => {
    if (h.level <= 2) {
      chapter = h.level === 2 ? (/^(\d+)\. /.exec(h.title)?.[1] ?? null) : null;
      counts.fill(0);
    } else if (h.level === 3) {
      counts[1]++;
      counts[2] = 0;
    } else if (h.level === 4) counts[2]++;
    if (chapter === null || h.level > 4 || (h.level === 4 && counts[1] === 0)) return;
    const number = h.level === 2 ? chapter : h.level === 3 ? `${chapter}.${counts[1]}` : `${chapter}.${counts[1]}.${counts[2]}`;
    const next = heads.slice(k + 1).find((x) => x.level <= h.level);
    const end = next === undefined ? lines.length + 1 : next.line;
    const title = h.title;
    const body = lines.slice(h.line - 1, end - 1).join('\n');
    out.push({ number, title, start: h.line, end, bytes: utf8Bytes(body) + (next === undefined ? 0 : 1) });
  });
  return out;
}

/** The ledger rows, in the order written. */
export function ledgerRows(text: string): LedgerRow[] {
  const lines = text.split('\n');
  const inFence = fenced(lines);
  const sections = guideSections(text);
  const rows: LedgerRow[] = [];
  let heading = '';
  let header: [string, string] | null = null;
  let kind: LedgerKind | null = null;
  let inTable = false;
  lines.forEach((l, i) => {
    if (!inFence[i] && /^#{1,6} /.test(l)) heading = l.replace(/^#{1,6} /, '');
    if (inFence[i] || !l.startsWith('|')) {
      inTable = false;
      return;
    }
    const first = (l.split('|')[1] ?? '').trim();
    if (!inTable) {
      inTable = true;
      kind = (LEDGER_HEADS as readonly string[]).includes(first) ? (first as LedgerKind) : null;
      header = [l, lines[i + 1] ?? ''];
      return;
    }
    if (kind === null || header === null || /^:?-+:?$/.test(first)) return;
    const names = [...first.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((t) => RULE_NAME.test(t));
    if (names.length === 0) return;
    const lead = /^((?:<a id="[^"]*"><\/a>)*)/.exec(first)?.[1] ?? '';
    const anchors = [...lead.matchAll(/<a id="([^"]*)"><\/a>/g)].map((x) => x[1]);
    const line = i + 1;
    const holding = sections.filter((s) => s.start <= line && line < s.end).sort((a, b) => b.number.split('.').length - a.number.split('.').length);
    rows.push({ kind, line, header, text: l, names, anchors, section: holding[0] ?? null, heading });
  });
  return rows;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The {@link NEAREST_LISTED} names of `known` nearest `asked`, case aside — rig-c's ranking, the one the shared form
 * fixes: a name `asked` is the start of (or, from three characters, a part of) first; then by edit distance less the
 * prefix the two share; then by name. A list, never a substitute.
 */
export function nearestNames(known: readonly string[], asked: string): string[] {
  const key = asked.toUpperCase();
  const shared = (name: string): number => {
    let k = 0;
    while (k < key.length && k < name.length && key[k] === name[k]) k++;
    return k;
  };
  const score = (name: string): number => {
    const up = name.toUpperCase();
    return up.startsWith(key) || (key.length >= 3 && up.includes(key)) ? -Infinity : editDistance(key, up) - shared(up);
  };
  return [...new Set(known)]
    .map((name) => ({ name, d: score(name) }))
    .sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, NEAREST_LISTED)
    .map((x) => x.name);
}

/** A size as the shared form prints it: KB to one decimal. */
export function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** One row's block: where it is, then the row as written. */
function rowBlock(row: LedgerRow): string[] {
  return [`${GUIDE_DOC}${row.section === null ? '' : ` §${row.section.number}`}, line ${row.line} — under "${row.heading}"`, row.text];
}

/** The other half of a refusal–bar pair: `CHECK_<LINE>` and `<LINE>`, each when the guide has its row. */
function pairOf(name: string, rows: readonly LedgerRow[]): { row: LedgerRow; name: string } | null {
  const other = name.startsWith('CHECK_') ? name.slice('CHECK_'.length) : `CHECK_${name}`;
  const want: LedgerKind = name.startsWith('CHECK_') ? 'line' : 'rule';
  const row = rows.find((r) => r.kind === want && r.names.includes(other));
  return row === undefined ? null : { row, name: other };
}

/** What `guide` answers: the lines to print, or the refusal. */
export type GuideAnswer = { lines: string[] } | { problem: Problem };

/** `guide <RULE>`: the row naming it, then `paired with <OTHER>:` and its pair's; or `GUIDE_RULE_KNOWN` with the nearest names. */
export function guideRule(text: string, name: string): GuideAnswer {
  const rows = ledgerRows(text);
  const own = rows.find((r) => r.names.includes(name));
  if (own === undefined) {
    return { problem: { code: 'GUIDE_RULE_KNOWN', object: `"${name}"`, detail: `no row in ${GUIDE_DOC} names it; the nearest: ${nearestNames(rows.flatMap((r) => r.names), name).join(', ')}` } };
  }
  const pair = pairOf(name, rows);
  return { lines: [...rowBlock(own), ...(pair === null ? [] : [`paired with ${pair.name}:`, ...rowBlock(pair.row)])] };
}

/** `guide §n`, `§n.m` or `§n.m.k`: a line naming the slice, its children's listing when it has children, then the slice. */
export function guideSection(text: string, ask: string): GuideAnswer {
  const sections = guideSections(text);
  const depth = (s: GuideSection): number => s.number.split('.').length;
  const childrenOf = (n: string | null): GuideSection[] => sections.filter((s) => (n === null ? depth(s) === 1 : s.number.startsWith(`${n}.`) && depth(s) === n.split('.').length + 1));
  const m = /^§(\d+(?:\.\d+){0,2})$/.exec(ask);
  const hit = m === null ? undefined : sections.find((s) => s.number === m[1]);
  if (hit === undefined) {
    // The deepest address the asked one shares, and what it holds: never a section put in its place.
    const asked = m === null ? [] : m[1].split('.');
    let parent: GuideSection | undefined;
    for (let d = asked.length - 1; d >= 1 && parent === undefined; d--) parent = sections.find((s) => s.number === asked.slice(0, d).join('.'));
    const kids = childrenOf(parent?.number ?? null);
    const list = kids.length === 0 ? 'none' : kids.map((s) => `§${s.number}`).join(', ');
    const deepest = parent === undefined ? `the guide itself, ${GUIDE_DOC}` : `§${parent.number} "${parent.title}"`;
    return { problem: { code: 'GUIDE_SECTION_KNOWN', object: `"${ask}"`, detail: `no such section; the deepest that exists is ${deepest}, whose sections are: ${list}` } };
  }
  const lines = text.split('\n');
  const head = [`${GUIDE_DOC} §${hit.number} "${hit.title}", lines ${hit.start}–${hit.end - 1}, ${kb(hit.bytes)}`];
  for (const s of childrenOf(hit.number)) head.push(`§${s.number.padEnd(6)} ${kb(s.bytes).padStart(9)}  ${s.title}`);
  return { lines: [...head, '', lines.slice(hit.start - 1, hit.end - 1).join('\n').replace(/\n+$/, '')] };
}
