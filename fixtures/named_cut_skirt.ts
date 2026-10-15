/** A real assemble.cuts input: flat synthetic art, never a private cut. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, cutLines } from '../src/assemble.ts';
import { readLayers } from '../src/layers.ts';
import { writeParts } from '../src/parts.ts';
import type { Cut } from '../src/config.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { assembleConfig, paint, writeRun, type RunLayerSpec } from './assemble_fixture.ts';
import { DRESS, DRESS_RIG, HEM, HEM_BELOW, dressParts } from './cloth.ts';
import type { ProposeFixturePart } from './propose.ts';

export const WAIST_CUT: Cut = {
  from: 'dress', into: 'skirt_piece',
  polygon: [[0, 170], [240, 170], [240, 480], [0, 480]],
  draw: 'front', overlap: 0,
};

export function namedCutParts(hem: 'overlap' | 'below' | null = null): ProposeFixturePart[] {
  // The face fixes the same eye axis and face height as the public dress fixture.
  // No hair recipe is needed to ask which garment gets the skirt trees.
  return [...dressParts(DRESS).filter((p) => ['face', 'dress', 'legs'].includes(p.name)),
    ...(hem === null ? [] : [hem === 'overlap' ? HEM : HEM_BELOW])];
}

/** Read real wrapper layers, run the actual stage and emit its gated parts. */
export function writeNamedCutFixture(dir: string, options: { cut?: boolean; draw?: Cut['draw']; hem?: 'overlap' | 'below' | null; extraCut?: boolean } = {}): { out: string; result: ReturnType<typeof assemble>; lines: string[] } {
  mkdirSync(dir, { recursive: true });
  const parts = namedCutParts(options.hem ?? null);
  const layers = (run: 'full' | 'head'): RunLayerSpec[] => parts.filter((p) => p.from.startsWith(run + ':')).map((p, i) => ({
    name: p.from.slice(run.length + 1), depth: (parts.length - i) / 10,
    // FULL: square padding is 120 source px on either side, k=1.
    // HEAD: [0,0,240,240] on a 480 square, k=1/2, hence doubled rectangles.
    rects: (p.rects ?? [[p.x, p.y, p.w, p.h]]).map(([x, y, w, h]) => ({
      x0: run === 'full' ? x + 120 : 2 * x,
      y0: run === 'full' ? y : 2 * y,
      x1: run === 'full' ? x + w + 120 : 2 * (x + w),
      y1: run === 'full' ? y + h : 2 * (y + h), colour: p.colour,
    })),
  }));
  writeRun(join(dir, 'full'), layers('full'), 480);
  writeRun(join(dir, 'head'), layers('head'), 480);
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(paint(DRESS_RIG.w, DRESS_RIG.h, [128, 128, 128], [])));
  const plan = parts.map((p): [string, 'full' | 'head', string] => [p.name, p.from.startsWith('head:') ? 'head' : 'full', p.from.slice(p.from.indexOf(':') + 1)]);
  const config = assembleConfig({ plan, extend: [], rigScale: 1, resolution: 480, headBox: [0, 0, 240, 240] });
  const cuts: Cut[] = options.cut === false ? [] : [{ ...WAIST_CUT, draw: options.draw ?? WAIST_CUT.draw }];
  if (options.extraCut) cuts.push(
    { from: 'dress', into: 'neck_piece', polygon: [[0, 100], [240, 100], [240, 110], [0, 110]], draw: 'front', overlap: 0 },
    { from: 'legs', into: 'leg_piece', polygon: [[0, 350], [240, 350], [240, 400], [0, 400]], draw: 'back', overlap: 0 },
  );
  (config.assemble as Record<string, unknown>).cuts = cuts;
  (config.regions as Record<string, string>).skirt_piece = 'anchor';
  if (cuts.length === 0) delete (config.regions as Record<string, string>).skirt_piece;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  const out = join(dir, 'assembled');
  const lines: string[] = [];
  const result = assemble({ source: paint(DRESS_RIG.w, DRESS_RIG.h, [128, 128, 128], []),
    full: readLayers(join(dir, 'full')), head: readLayers(join(dir, 'head')),
    resolution: 480, headBox: [0, 0, 240, 240], rigScale: 1, plan,
    extend: [], patches: [], cuts, seamRule: 'near-white', projectRule: 'core',
  });
  // The real assembler has returned green. Only its measured records and
  // cropped output images are written; no PartRecord is forged here.
  mkdirSync(join(out, 'parts'), { recursive: true });
  writeParts(join(out, 'parts.json'), result.parts);
  for (const { record, image } of result.images) writeFileSync(join(out, 'parts', record.name + '.png'), encodePngBytes(image));
  writeFileSync(join(out, 'recomposite_rig.png'), encodePngBytes(result.recomposite));
  lines.push(...cutLines(result.cuts));
  writeFileSync(join(dir, 'assemble.log'), lines.join('\n') + '\n');
  return { out, result, lines };
}
