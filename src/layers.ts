/**
 * The input contract: one See-through decomposition as a `LayerSet`.
 *
 * Two readers, one shape. See-through reaches a user by more than one route
 * (README, *See-through routes*), and two of them leave different files:
 *
 * - **the ComfyUI wrapper form** — a `layers.json` manifest beside one RGBA PNG
 *   per layer. The manifest is the wrapper's own: `width`/`height` of the
 *   canvas and, per layer, `name` (the tag), `filename`, the layer's box as
 *   `left`/`top`/`right`/`bottom` in canvas pixels (right and bottom
 *   exclusive: **[observed]** every PNG is exactly `(right-left)x(bottom-top)`),
 *   and `depth_median`, See-through's per-layer depth, where a LARGER value is
 *   further back. `readWrapperLayers` reads it.
 * - **an upstream `.psd`** — one pixel layer per tag, the layer name being the
 *   tag and the PSD stacking order being the draw order. `readPsdLayers`
 *   reads it. ⚠️ No upstream PSD has been measured by this reader yet: it is
 *   written to that stated contract and tested on PSDs the selftest writes, so
 *   it refuses anything outside the contract (hidden layers, non-normal
 *   blending, opacity, clipping, masks, bit depths other than 8) by name rather
 *   than interpreting it.
 *
 * Both return layers in DRAW ORDER, back to front. For the wrapper that is
 * descending `depth_median` with ties kept in manifest order — a stable sort,
 * which is what the reference implementation's `sorted(..., key=-depth)` is —
 * and for a PSD it is the stacking order itself, with `depth` null because a
 * PSD carries none. Every refusal is collected and thrown once, so one run
 * names every missing file.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { initializeCanvas, type Layer as PsdLayer, readPsd } from 'ag-psd';
import { type Problem, refuseIfAny } from './errors.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { acceptedTagNames, readTag, type TagReading } from './tags.ts';

/** Alpha strictly above this counts as painted. The reference uses the same cut for its ghost clean-up and its sheets. */
export const OPAQUE_ALPHA_ABOVE = 8;

export interface Layer {
  /** As the input names it; always a v3 tag, possibly with a `-r`/`-l` side. */
  name: string;
  tag: TagReading;
  /** The file the pixels came from, or null for a PSD layer. */
  file: string | null;
  /** The layer's own pixels, `(right-left)x(bottom-top)`, straight alpha. */
  pixels: Raster;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** See-through's `depth_median` (larger = further back), or null where the input carries none. */
  depth: number | null;
  /** 0 is drawn first (furthest back). */
  drawOrder: number;
  /** Pixels with alpha above `OPAQUE_ALPHA_ABOVE`. */
  opaquePx: number;
}

export interface LayerSet {
  form: 'wrapper' | 'psd';
  /** The manifest or PSD that was read. */
  source: string;
  canvas: { w: number; h: number };
  /** In draw order, back to front. */
  layers: Layer[];
}

function opaque(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > OPAQUE_ALPHA_ABOVE) n++;
  return n;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function describe(v: unknown): string {
  return v === undefined ? 'absent' : JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// the wrapper form
// ---------------------------------------------------------------------------

const MANIFEST_KEYS = ['prefix', 'timestamp', 'layers', 'width', 'height'] as const;
const MANIFEST_REQUIRED = ['layers', 'width', 'height'] as const;
const LAYER_KEYS = ['name', 'filename', 'left', 'top', 'right', 'bottom', 'depth_median', 'depth_filename'] as const;
const LAYER_REQUIRED = ['name', 'filename', 'left', 'top', 'right', 'bottom', 'depth_median'] as const;

/**
 * Read the wrapper form from a directory holding `layers.json`, or from the
 * manifest path itself.
 *
 * A layer's PNG is looked for in the two places the two known layouts put it,
 * and the choice is never silent: `<dir>/<filename>` (the wrapper's own output
 * directory, flat) and `<dir>/parts/<name>.png` (the layout a fetcher that
 * renames by tag writes). One present is used; neither is a refusal naming
 * both; both present with different bytes is a refusal, because picking one
 * would be a guess.
 *
 * ⚠️ An unknown key is refused, in the manifest and in a layer. The wrapper is
 * not this repository's, and a field it adds tomorrow could carry meaning (an
 * order, a scale) that silently ignoring would get wrong — so the reader says
 * which key it does not know and stops.
 */
export function readWrapperLayers(path: string): LayerSet {
  const manifestPath = existsSync(path) && statSync(path).isDirectory() ? join(path, 'layers.json') : path;
  const dir = dirname(manifestPath);
  const problems: Problem[] = [];
  const refuse = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  if (!existsSync(manifestPath)) {
    refuse('LAYERS_MANIFEST_PRESENT', manifestPath, 'no such file; a See-through wrapper output directory holds layers.json');
    refuseIfAny(problems);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    refuse('LAYERS_MANIFEST_IS_JSON', manifestPath, `does not parse as JSON: ${(err as Error).message}`);
    refuseIfAny(problems);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    refuse('LAYERS_MANIFEST_IS_JSON', manifestPath, `holds ${describe(manifest)}; an object with width, height and layers is required`);
    refuseIfAny(problems);
  }
  const m = manifest as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (!(MANIFEST_KEYS as readonly string[]).includes(key)) {
      refuse('LAYERS_KEY_KNOWN', `${manifestPath} key "${key}"`, `is not a wrapper manifest field; known: ${MANIFEST_KEYS.join(', ')}`);
    }
  }
  for (const key of MANIFEST_REQUIRED) {
    if (!(key in m)) refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "${key}"`, 'is absent and required');
  }
  const width = m.width;
  const height = m.height;
  if ('width' in m && (!isInt(width) || width < 1)) {
    refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "width"`, `is ${describe(width)}; a positive integer is required`);
  }
  if ('height' in m && (!isInt(height) || height < 1)) {
    refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "height"`, `is ${describe(height)}; a positive integer is required`);
  }
  if ('layers' in m && !Array.isArray(m.layers)) {
    refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "layers"`, `is ${describe(m.layers)}; an array is required`);
  }
  refuseIfAny(problems);
  const W = width as number;
  const H = height as number;
  const entries = m.layers as unknown[];
  if (entries.length === 0) refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "layers"`, 'is empty; at least one layer is required');

  const read: Array<Omit<Layer, 'drawOrder'> & { index: number }> = [];
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const at = `${basename(manifestPath)} layers[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      refuse('LAYERS_FIELD_PRESENT', at, `is ${describe(entry)}; an object is required`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const label = typeof e.name === 'string' ? `layer "${e.name}"` : at;
    let ok = true;
    // Uniqueness first, before any other problem can end this entry's checks:
    // a duplicate beside an entry that is also malformed is still a duplicate.
    if (typeof e.name === 'string') {
      if (seen.has(e.name)) {
        refuse('LAYERS_NAME_UNIQUE', label, `appears at layers[${seen.get(e.name)}] and layers[${index}]; a tag names one layer`);
        ok = false;
      } else seen.set(e.name, index);
    }
    for (const key of Object.keys(e)) {
      if (!(LAYER_KEYS as readonly string[]).includes(key)) {
        refuse('LAYERS_KEY_KNOWN', `${label} key "${key}"`, `is not a wrapper layer field; known: ${LAYER_KEYS.join(', ')}`);
        ok = false;
      }
    }
    for (const key of LAYER_REQUIRED) {
      if (!(key in e)) {
        refuse('LAYERS_FIELD_PRESENT', `${label} field "${key}"`, 'is absent and required');
        ok = false;
      }
    }
    if (!ok) return;
    if (typeof e.name !== 'string') {
      refuse('LAYERS_FIELD_PRESENT', `${at} field "name"`, `is ${describe(e.name)}; a tag string is required`);
      return;
    }
    const name = e.name;
    const tag = readTag(name);
    if (tag === null) {
      refuse('LAYERS_TAG_KNOWN', `layer "${name}"`, `is not a See-through v3 tag; one of ${acceptedTagNames().join(', ')} is required`);
      ok = false;
    }
    for (const key of ['left', 'top', 'right', 'bottom'] as const) {
      if (!isInt(e[key])) {
        refuse('LAYERS_FIELD_PRESENT', `layer "${name}" field "${key}"`, `is ${describe(e[key])}; an integer is required`);
        ok = false;
      }
    }
    if (typeof e.depth_median !== 'number' || !Number.isFinite(e.depth_median)) {
      refuse('LAYERS_FIELD_PRESENT', `layer "${name}" field "depth_median"`, `is ${describe(e.depth_median)}; a finite number is required`);
      ok = false;
    }
    if (typeof e.filename !== 'string' || e.filename === '') {
      refuse('LAYERS_FIELD_PRESENT', `layer "${name}" field "filename"`, `is ${describe(e.filename)}; a file name is required`);
      ok = false;
    }
    if (!ok || tag === null) return;
    const left = e.left as number;
    const top = e.top as number;
    const right = e.right as number;
    const bottom = e.bottom as number;
    if (left < 0 || top < 0 || right > W || bottom > H || left >= right || top >= bottom) {
      refuse(
        'LAYERS_BBOX_INSIDE_CANVAS',
        `layer "${name}"`,
        `box left ${left} top ${top} right ${right} bottom ${bottom}; a non-empty box inside the ${W}x${H} canvas is required`,
      );
      return;
    }
    const flat = join(dir, e.filename as string);
    const byTag = join(dir, 'parts', `${name}.png`);
    const present = [flat, byTag].filter((p) => existsSync(p));
    if (present.length === 0) {
      refuse('LAYERS_PNG_PRESENT', `layer "${name}"`, `neither ${flat} nor ${byTag} exists; one of them is required`);
      return;
    }
    const bytes = present.map((p) => new Uint8Array(readFileSync(p)));
    if (bytes.length === 2 && Buffer.compare(Buffer.from(bytes[0]), Buffer.from(bytes[1])) !== 0) {
      refuse('LAYERS_PNG_UNAMBIGUOUS', `layer "${name}"`, `${flat} and ${byTag} both exist with different bytes; exactly one source is required`);
      return;
    }
    let pixels: Raster;
    try {
      pixels = decodePngBytes(bytes[0], present[0]);
    } catch (err) {
      refuse('LAYERS_PNG_DECODES', `layer "${name}"`, (err as Error).message);
      return;
    }
    if (pixels.width !== right - left || pixels.height !== bottom - top) {
      refuse(
        'LAYERS_PNG_MATCHES_BBOX',
        `layer "${name}"`,
        `${present[0]} is ${pixels.width}x${pixels.height}; the manifest box is ${right - left}x${bottom - top}`,
      );
      return;
    }
    read.push({
      name,
      tag,
      file: present[0],
      pixels,
      left,
      top,
      right,
      bottom,
      depth: e.depth_median as number,
      opaquePx: opaque(pixels),
      index,
    });
  });
  refuseIfAny(problems);
  // Stable: Array.prototype.sort is stable, so equal depths keep manifest order.
  const ordered = [...read].sort((a, b) => (b.depth as number) - (a.depth as number));
  return {
    form: 'wrapper',
    source: manifestPath,
    canvas: { w: W, h: H },
    layers: ordered.map(({ index: _index, ...rest }, drawOrder) => ({ ...rest, drawOrder })),
  };
}

// ---------------------------------------------------------------------------
// the PSD form
// ---------------------------------------------------------------------------

let canvasStubbed = false;

/** The image-data shape ag-psd asks its factory for, named off ag-psd's own signature rather than a DOM lib. */
type PsdImageData = ReturnType<NonNullable<Parameters<typeof initializeCanvas>[1]>>;

/**
 * ag-psd decodes into `ImageData` objects and asks a canvas factory for them,
 * even with `useImageData`. There is no canvas here and none is wanted, so the
 * factory hands back a plain `{ width, height, data }` and the canvas
 * constructor throws: a code path that needed a real canvas would be one that
 * rasterises something (a text layer, a composite), which this reader refuses
 * anyway.
 */
function stubCanvas(): void {
  if (canvasStubbed) return;
  initializeCanvas(
    () => {
      throw new Error('spine-parts reads PSD pixel data only; this PSD asked for a canvas');
    },
    (width: number, height: number) =>
      ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as PsdImageData,
  );
  canvasStubbed = true;
}

/** PSD colour mode 3 is RGB, the only one See-through writes and the only one read here. */
const PSD_RGB = 3;

export function readPsdLayers(path: string): LayerSet {
  const problems: Problem[] = [];
  const refuse = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  if (!existsSync(path)) {
    refuse('PSD_FILE_PRESENT', path, 'no such file');
    refuseIfAny(problems);
  }
  stubCanvas();
  let psd;
  try {
    psd = readPsd(readFileSync(path), {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
    });
  } catch (err) {
    refuse('PSD_PARSES', path, `ag-psd could not read it: ${(err as Error).message}`);
    refuseIfAny(problems);
    throw err;
  }
  if (psd.colorMode !== PSD_RGB) refuse('PSD_IS_RGB8', path, `colour mode ${String(psd.colorMode)}; RGB (3) is required`);
  if (psd.bitsPerChannel !== 8) refuse('PSD_IS_RGB8', path, `${String(psd.bitsPerChannel)} bits per channel; 8 are required`);
  const W = psd.width;
  const H = psd.height;
  const leaves: PsdLayer[] = [];
  const walk = (children: PsdLayer[] | undefined, trail: string): void => {
    for (const layer of children ?? []) {
      const where = `${trail}${layer.name ?? '(unnamed)'}`;
      if (layer.hidden) refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, 'is hidden; every layer of a decomposition is drawn');
      if (layer.opacity !== undefined && layer.opacity !== 1) {
        refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, `has opacity ${layer.opacity}; 1 is required`);
      }
      if (layer.children !== undefined) {
        if (layer.blendMode !== undefined && layer.blendMode !== 'pass through' && layer.blendMode !== 'normal') {
          refuse('PSD_LAYER_PLAIN', `PSD group "${where}"`, `blends "${layer.blendMode}"; pass through or normal is required`);
        }
        walk(layer.children, `${where}/`);
        continue;
      }
      if (layer.blendMode !== undefined && layer.blendMode !== 'normal') {
        refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, `blends "${layer.blendMode}"; normal is required`);
      }
      if (layer.clipping) refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, 'is a clipping layer; none is required');
      if (layer.mask !== undefined) refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, 'carries a layer mask; none is required');
      leaves.push(layer);
    }
  };
  walk(psd.children, '');
  if (leaves.length === 0) refuse('PSD_HAS_LAYERS', path, 'holds no pixel layer; one per See-through tag is required');
  const seen = new Set<string>();
  const layers: Layer[] = [];
  leaves.forEach((layer) => {
    const name = layer.name ?? '';
    const tag = readTag(name);
    if (tag === null) {
      refuse('LAYERS_TAG_KNOWN', `PSD layer "${name}"`, `is not a See-through v3 tag; one of ${acceptedTagNames().join(', ')} is required`);
      return;
    }
    if (seen.has(name)) {
      refuse('LAYERS_NAME_UNIQUE', `PSD layer "${name}"`, 'appears twice; a tag names one layer');
      return;
    }
    seen.add(name);
    const img = layer.imageData;
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const right = layer.right ?? 0;
    const bottom = layer.bottom ?? 0;
    if (img === undefined || img.width === 0 || img.height === 0) {
      refuse('PSD_LAYER_HAS_PIXELS', `PSD layer "${name}"`, 'carries no pixel data; a painted layer is required');
      return;
    }
    if (left < 0 || top < 0 || right > W || bottom > H) {
      refuse(
        'LAYERS_BBOX_INSIDE_CANVAS',
        `PSD layer "${name}"`,
        `box left ${left} top ${top} right ${right} bottom ${bottom}; a box inside the ${W}x${H} canvas is required`,
      );
      return;
    }
    if (img.width !== right - left || img.height !== bottom - top) {
      refuse('LAYERS_PNG_MATCHES_BBOX', `PSD layer "${name}"`, `pixels are ${img.width}x${img.height}; the layer box is ${right - left}x${bottom - top}`);
      return;
    }
    const pixels: Raster = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
    layers.push({
      name,
      tag,
      file: null,
      pixels,
      left,
      top,
      right,
      bottom,
      depth: null,
      drawOrder: layers.length,
      opaquePx: opaque(pixels),
    });
  });
  refuseIfAny(problems);
  return { form: 'psd', source: path, canvas: { w: W, h: H }, layers };
}

/** Read whichever form `path` is: a `.psd` file, or a wrapper directory / `layers.json`. */
export function readLayers(path: string): LayerSet {
  if (/\.psd$/i.test(path)) return readPsdLayers(path);
  if (existsSync(path) && (statSync(path).isDirectory() || basename(path) === 'layers.json')) return readWrapperLayers(path);
  refuseIfAny([
    {
      code: 'LAYERS_INPUT_KIND',
      object: path,
      detail: existsSync(path)
        ? 'is neither a .psd file nor a directory holding layers.json nor a layers.json'
        : 'does not exist; a .psd file or a See-through wrapper output directory is required',
    },
  ]);
  throw new Error('unreachable');
}
