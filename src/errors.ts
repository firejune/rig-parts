/**
 * The one error shape every stage refuses with.
 *
 * An agent that cannot see the image reads these and nothing else, so a
 * problem carries three things the reader can act on without guessing: the
 * CODE it can grep for, the OBJECT it concerns (a layer, a config field, a
 * file), and a sentence naming the value found and the value required. A
 * refusal that says only "invalid" is not a refusal this repository writes.
 *
 * A reader collects every problem it can find before it throws, so one run
 * names every missing field rather than one per attempt.
 */
export interface Problem {
  /** Upper-snake name of the rule that refused, e.g. `LAYERS_PNG_PRESENT`. */
  code: string;
  /** The thing refused, spelled the way the input spells it: `layer "face"`, `config.bones[3].parent`. */
  object: string;
  /** What was found and what was required. */
  detail: string;
}

export function problemLine(p: Problem): string {
  return `${p.code}: ${p.object} — ${p.detail}`;
}

export class PartsError extends Error {
  readonly problems: readonly Problem[];

  constructor(problems: readonly Problem[]) {
    super(problems.map(problemLine).join('\n'));
    this.name = 'PartsError';
    this.problems = problems;
  }
}

/** Throw once, with every problem, if there are any. */
export function refuseIfAny(problems: readonly Problem[]): void {
  if (problems.length > 0) throw new PartsError(problems);
}
