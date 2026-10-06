/**
 * Skeletons for the structure suite (issue #85): small enough that every row
 * the comparison prints can be computed by hand from this file.
 *
 * Nothing here is a character and nothing here stands for one; the bone names
 * are role words so a reader can follow the arithmetic.
 *
 * `BASE` (proposal form, rig px, y down):
 *
 *     root
 *     └ hip    [100, 200]                       no tip
 *       ├ chest  [100, 150]  tip [100, 110]     length 40, pointing up (-90 deg as drawn)
 *       │ └ head   [100, 100]  tip [100, 60]    length 40, pointing up
 *       │   └ eye    [90, 80]                   no tip, a leaf
 *       └ hem0   [80, 200]  -> hem1 [80, 230]   length 30, pointing down (+90 deg)
 *         └ hem1  [80, 230]  tip [80, 250]      length 20, pointing down
 *
 * Roles: root and hip bind nothing and parent others (control); chest is a
 * mesh segment, hem0 and hem1 a chain segment, head and eye carry regions
 * (deforms). Two controls, five that deform.
 *
 * `ARM` and its rig form `armRig()` are for the rig.json reader: every bone
 * points along +x or has no length, so rigc's exact frame transforms give the
 * world positions with no rounding at all (an unturned frame is the identity
 * exactly), and the stage maps them back to the config's integers.
 *
 *     ARM (rig px)                         armRig(stage x -100, y 0, 200x300)
 *     root                                 root   world (0, 0)
 *     └ hip   [100, 200]                   hip    local (0, 100)    world (0, 100)
 *       └ arm  [120, 150] tip [160, 150]   arm    local (20, 50)    world (20, 150), length 40, rotation 0
 *         └ hand [160, 150]                hand   local (40, 0)     world (60, 150)
 *
 * The stage rule: rig px = (wx - stage.x, stage.height - (wy - stage.y)), so
 * hip (0, 100) -> (100, 200), arm (20, 150) -> (120, 150), hand (60, 150) ->
 * (160, 150), and arm's tip (20 + 40, 150) -> (160, 150).
 */

export type Json = Record<string, unknown>;

/** A fresh copy each call, so a control's edit cannot reach another's input. */
export function base(): Json {
  return {
    bones: [
      { name: 'hip', parent: 'root', at: [100, 200] },
      { name: 'chest', parent: 'hip', at: [100, 150], tip: [100, 110] },
      { name: 'head', parent: 'chest', at: [100, 100], tip: [100, 60] },
      { name: 'eye', parent: 'head', at: [90, 80] },
      { chain: 'hem', parent: 'hip', points: [[80, 200], [80, 230]], tip: [80, 250] },
    ],
    meshes: { robe: { grid: 8, r: 6, segments: ['hem', ['chest', [100, 150], [100, 110]]] } },
    regions: { face: 'head', iris: 'eye' },
    motion: { duration: 4, tracks: [{ chain: 'hem', amps: [1, 2], period: 2, phase: 0, lag: 0.1 }] },
  };
}

type BoneJson = { name?: string; chain?: string; parent: string; at?: number[]; tip?: number[]; points?: number[][] };

/** `base()` with one bone entry edited (by its `name` or `chain`). */
export function baseWith(entry: string, edit: (b: BoneJson) => BoneJson): Json {
  const b = base();
  b.bones = (b.bones as BoneJson[]).map((e) => ((e.name ?? e.chain) === entry ? edit({ ...e }) : e));
  return b;
}

/** `base()` with every name in `renames` changed, as a bone, a parent, a segment, a region bone. */
export function baseRenamed(renames: Readonly<Record<string, string>>): Json {
  const r = (n: string): string => renames[n] ?? n;
  const b = base();
  b.bones = (b.bones as BoneJson[]).map((e) => ({ ...e, ...(e.name === undefined ? {} : { name: r(e.name) }), parent: r(e.parent) }));
  b.meshes = { robe: { grid: 8, r: 6, segments: ['hem', [r('chest'), [100, 150], [100, 110]]] } };
  b.regions = { face: r('head'), iris: r('eye') };
  return b;
}

export function arm(): Json {
  return {
    bones: [
      { name: 'hip', parent: 'root', at: [100, 200] },
      { name: 'arm', parent: 'hip', at: [120, 150], tip: [160, 150] },
      { name: 'hand', parent: 'arm', at: [160, 150] },
    ],
    meshes: { sleeve: { grid: 8, r: 6, segments: ['arm'] } },
    regions: { glove: 'hand' },
    motion: { duration: 4, tracks: [{ bone: 'hip', prop: 'rotate', amp: 1, period: 4, phase: 0 }] },
  };
}

/** `ARM` as a rig.json; `skeleton` is the stage, or absent when null. */
export function armRig(skeleton: { x: number; y: number; width: number; height: number } | null = { x: -100, y: 0, width: 200, height: 300 }): Json {
  return {
    spec: 'rigc-rig/1',
    name: 'arm_rig',
    ...(skeleton === null ? {} : { skeleton }),
    bones: [
      { name: 'root', x: 0, y: 0 },
      { name: 'hip', parent: 'root', x: 0, y: 100 },
      { name: 'arm', parent: 'hip', x: 20, y: 50, rotation: 0, length: 40 },
      { name: 'hand', parent: 'arm', x: 40, y: 0 },
    ],
    slots: [
      { name: 'sleeve', bone: 'arm', attachment: 'sleeve' },
      { name: 'glove', bone: 'hand', attachment: 'glove' },
    ],
    skins: {
      default: {
        sleeve: { sleeve: { type: 'mesh', image: 'sleeve.png', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], hull: 3, weights: [[{ bone: 'arm', x: 0, y: 0, weight: 1 }], [{ bone: 'arm', x: 1, y: 0, weight: 1 }], [{ bone: 'arm', x: 0, y: 1, weight: 1 }]] } },
        glove: { glove: { image: 'glove.png', x: 0, y: 0 } },
      },
    },
  };
}

/**
 * A rig whose roles cover every rule: `aim` an ik target, `src` a transform
 * source, `w1`/`w2` mesh weights, `rb` a region's slot bone, `ub` an
 * unweighted mesh's slot bone, `grp` parents only, `leaf` binds and parents
 * nothing. `root` parents. The ik constraint bends `w1` (constrained, not a
 * target), so `w1` stays `deforms`.
 */
export function roleRig(): Json {
  return {
    spec: 'rigc-rig/1',
    name: 'role_rig',
    skeleton: { x: 0, y: 0, width: 100, height: 100 },
    bones: [
      { name: 'root' },
      { name: 'grp', parent: 'root' },
      { name: 'w1', parent: 'grp', length: 10 },
      { name: 'w2', parent: 'grp' },
      { name: 'aim', parent: 'root' },
      { name: 'src', parent: 'root' },
      { name: 'rb', parent: 'root' },
      { name: 'ub', parent: 'root' },
      { name: 'leaf', parent: 'root' },
    ],
    slots: [
      { name: 'cloth', bone: 'w1', attachment: 'cloth' },
      { name: 'badge', bone: 'rb', attachment: 'badge' },
      { name: 'flat', bone: 'ub', attachment: 'flat' },
    ],
    skins: {
      default: {
        cloth: { cloth: { type: 'mesh', image: 'cloth.png', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], hull: 3, weights: [[{ bone: 'w1', x: 0, y: 0, weight: 1 }], [{ bone: 'w2', x: 1, y: 0, weight: 1 }], [{ bone: 'w2', x: 0, y: 1, weight: 1 }]] } },
        badge: { badge: { image: 'badge.png', x: 0, y: 0 } },
        flat: { flat: { type: 'mesh', image: 'flat.png', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], hull: 3, vertices: [0, 0, 1, 0, 0, 1] } },
      },
    },
    constraints: [
      { type: 'ik', name: 'reach', bones: ['w1'], target: 'aim' },
      { type: 'transform', name: 'follow', bones: ['w2'], source: 'src' },
    ],
  };
}
