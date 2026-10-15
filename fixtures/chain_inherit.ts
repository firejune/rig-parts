/** Issue #369: synthetic rigid shin/shoe plates and a mesh that forces both link controls.
 * The shin is diagonal, so a thigh's x scale produces shear under normal inheritance.
 * Nothing here is an appearance or source-art claim.
 */
import { block } from './rig.ts';
import type { PartsFile } from '../src/parts.ts';
import type { Raster } from '../src/raster/types.ts';

export function chainInheritParts(): PartsFile {
  const part = (name: string, x: number, y: number, w: number, h: number): PartsFile['parts'][number] => ({
    name, from: `full:${name === 'shin' ? 'legwear' : name === 'shoe' ? 'footwear' : 'topwear'}`, x, y, w, h, opaque_px: w * h,
    projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0,
  });
  return { rig_size: [128, 128], scale_rig_per_source: 0.5,
    parts: [part('shin', 70, 68, 12, 24), part('shoe', 86, 90, 24, 8), part('probe', 60, 24, 8, 44)], ghost_px: {} };
}

export function chainInheritImages(): Map<string, Raster> {
  return new Map(chainInheritParts().parts.map((p) => [p.name, block(p.w, p.h)]));
}

/** `undefined` is the old config, `{}` its explicitly empty opt-in. Shoe modes are independent. */
export function chainInheritConfig(linkInherit?: unknown, shoeInherit?: string, level = false): Record<string, unknown> {
  return {
    key: 'chain-inherit',
    assemble: { rig_scale: 0.5, plan: [['shin', 'full', 'legwear'], ['shoe', 'full', 'footwear'], ['probe', 'full', 'topwear']] },
    bones: [
      { name: 'hip', parent: 'root', at: [64, 24] },
      { chain: 'leg_r', parent: 'hip', points: [[64, 24], [64, 64]], tip: [92, 92], ...(linkInherit === undefined ? {} : { link_inherit: linkInherit }) },
      { name: 'foot_r', parent: 'leg_r1', at: [92, 92], ...(shoeInherit === undefined ? {} : { inherit: shoeInherit }) },
      { name: 'level', parent: 'root', at: [30, 20] },
    ],
    meshes: { probe: { grid: 8, r: 8, segments: ['leg_r'] } },
    regions: { shin: 'leg_r1', shoe: 'foot_r' },
    ...(level ? { constraints: [{ name: 'foot_level', type: 'transform', bones: ['foot_r'], source: 'level', properties: { rotate: { to: { rotate: {} } } } }] } : {}),
    motion: { duration: 1, tracks: [{ chain: 'leg_r', amps: [1, 1], period: 1, phase: 0, lag: 0 }] },
  };
}

/** A non-idle thigh shortening/turn: the shin's own scale is never keyed. */
export function chainInheritProbe(thighScale = 0.8): Record<string, unknown> {
  return { probe: { duration: 1, tracks: [
    { bone: 'leg_r0', property: 'scalex', keys: [{ t: 0, v: [1] }, { t: 0.5, v: [thighScale] }, { t: 1, v: [1] }] },
    { bone: 'leg_r0', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [20] }, { t: 1, v: [0] }] },
  ] } };
}
