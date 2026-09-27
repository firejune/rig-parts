#!/usr/bin/env bun
/**
 * Test-side only: turn a config written for the private reference (the OLD
 * schema) into one `src/config.ts` loads, so the proposer's `--from-config` and
 * `--compare` modes can be measured against the reference's own configs.
 *
 *   bun scripts/strip_old_config.ts <old config.json> <out config.json>
 *
 * It keeps exactly what the propose stage reads and the loader requires —
 * `key`, `assemble`, `bones`, `meshes`, `regions`, `motion` — plus top-level
 * annotations (`note`, `*_note`), and drops every other top-level key, naming
 * each one it dropped. `generation` and `seethrough` go whole: the reference's
 * generation block points at files outside any tree (refused by name in
 * `src/config.ts`), and its head boxes were not always square.
 *
 * ⛔ This lives outside `src/` on purpose. The loader refuses these configs,
 * and that refusal is the product; a stripper inside the package would be a
 * way around it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';

const KEEP = ['key', 'assemble', 'bones', 'meshes', 'regions', 'motion'];

export function stripOldConfig(raw: Record<string, unknown>): { config: Record<string, unknown>; dropped: string[] } {
  const config: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (KEEP.includes(k) || ((k === 'note' || k.endsWith('_note')) && typeof v === 'string')) config[k] = v;
    else dropped.push(k);
  }
  return { config, dropped };
}

if (import.meta.main) {
  const [src, out] = process.argv.slice(2);
  if (src === undefined || out === undefined) {
    console.log('usage: bun scripts/strip_old_config.ts <old config.json> <out config.json>');
    process.exit(2);
  }
  const { config, dropped } = stripOldConfig(JSON.parse(readFileSync(src, 'utf8')) as Record<string, unknown>);
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
  loadConfig(out);
  console.log(`stripped ${dropped.length} top-level key(s): ${dropped.join(', ') || 'none'}; ${out} loads`);
}
