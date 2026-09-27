/**
 * See-through's layer vocabulary, as the tags a layer arrives named by.
 *
 * ⭐ These are the **v3** tags — the vocabulary `pipeline.unet.get_tag_version()`
 * reports on the `seethroughv0.0.2_layerdiff3d` weights, read out of the
 * upstream code: 13 body tags and 11 head tags, 24 in all. The older v2
 * vocabulary has 19 tags and a single `hair` tag; it is not what the published
 * v0.0.2 weights emit, and a layer named by it is refused as unknown rather
 * than mapped, because a mapping would be a guess about which v3 tag it meant.
 *
 * Six tags are split left/right by upstream (`_tag_lr_split`, which needs the
 * tag's mask to be two separate blobs): `handwear`, `eyewhite`, `irides`,
 * `eyelash`, `eyebrow`, `ears`. A split layer is named `<tag>-r` / `<tag>-l`.
 * **[observed]** on wrapper output: `-r` is the half at the smaller image x —
 * the character's right as they face the viewer — and the wrapper emits both
 * halves even when one is a few pixels (a 6x6 `handwear-l` beside a 275x352
 * `handwear-r`), so "both halves present" says nothing about the split having
 * found two real blobs.
 *
 * `head` is in the v3 list but is not emitted as a layer: upstream's README
 * says the pipeline "stratifies the character into up to 23 semantic layers"
 * (24 tags less `head`, whose pass arrives as its parts), and **[observed]**
 * no wrapper output read so far carries one. It stays in the vocabulary
 * because it is upstream's word.
 *
 * Nothing downstream classifies a part by its NAME. The role of a part — what
 * a proposer may do with it — is read from the tag it came from, which is why
 * `parts.json` records `from` for every part.
 */

export const BODY_TAGS = [
  'front hair',
  'back hair',
  'head',
  'neck',
  'neckwear',
  'topwear',
  'handwear',
  'bottomwear',
  'legwear',
  'footwear',
  'tail',
  'wings',
  'objects',
] as const;

export const HEAD_TAGS = [
  'headwear',
  'face',
  'irides',
  'eyebrow',
  'eyewhite',
  'eyelash',
  'eyewear',
  'ears',
  'earwear',
  'nose',
  'mouth',
] as const;

export type BaseTag = (typeof BODY_TAGS)[number] | (typeof HEAD_TAGS)[number];

/** The tags upstream splits into `-r` / `-l` halves. */
export const SPLIT_TAGS = ['handwear', 'eyewhite', 'irides', 'eyelash', 'eyebrow', 'ears'] as const;

export type SplitTag = (typeof SPLIT_TAGS)[number];
export type Side = 'r' | 'l';

/** Every v3 tag, in the order upstream lists them. */
export const V3_TAGS: readonly BaseTag[] = [...BODY_TAGS, ...HEAD_TAGS];

export interface TagReading {
  /** The name as the layer carries it: `eyebrow-l`, `front hair`. */
  name: string;
  base: BaseTag;
  /** `null` for an unsplit tag or an unsplit form of a split tag. */
  side: Side | null;
  group: 'body' | 'head';
}

/**
 * Read a layer name as a v3 tag, or `null` when it is not one.
 *
 * Accepted: any of the 24 base tags, and `<tag>-r` / `<tag>-l` for the six
 * split tags. A suffix on a tag upstream never splits (`topwear-l`) is not a
 * tag — upstream cannot have produced it, so accepting it would be accepting a
 * layer somebody renamed.
 */
export function readTag(name: string): TagReading | null {
  const split = /^(.+)-([rl])$/.exec(name);
  if (split !== null && (SPLIT_TAGS as readonly string[]).includes(split[1])) {
    const base = split[1] as SplitTag;
    return { name, base, side: split[2] as Side, group: groupOf(base) };
  }
  if ((V3_TAGS as readonly string[]).includes(name)) {
    const base = name as BaseTag;
    return { name, base, side: null, group: groupOf(base) };
  }
  return null;
}

function groupOf(tag: BaseTag): 'body' | 'head' {
  return (HEAD_TAGS as readonly string[]).includes(tag) ? 'head' : 'body';
}

/** Every name `readTag` accepts, sorted — what a refusal quotes as "required". */
export function acceptedTagNames(): string[] {
  const names = new Set<string>(V3_TAGS);
  for (const t of SPLIT_TAGS) {
    names.add(`${t}-r`);
    names.add(`${t}-l`);
  }
  return [...names].sort();
}

/** The mirror of a split layer name (`eyebrow-l` <-> `eyebrow-r`), or `null` for an unsided one. */
export function pairOf(name: string): string | null {
  const t = readTag(name);
  if (t === null || t.side === null) return null;
  return `${t.base}-${t.side === 'r' ? 'l' : 'r'}`;
}
