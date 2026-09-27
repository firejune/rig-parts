/**
 * One rule, on purpose.
 *
 * CLAUDE.md says "no `any`, no `as any`, in `src/` or `cli.ts`". A rule that
 * only a reader enforces is a convention; this makes it a gate.
 *
 * It is deliberately not `typescript-eslint`'s recommended set: a lint run that
 * is red on arrival teaches everyone to run it with their eyes closed. Add rules
 * when somebody is prepared to fix what they find.
 *
 * `selftest.ts` is the one file allowed to write `any`, and only between an
 * `eslint-disable @typescript-eslint/no-explicit-any` and the matching
 * `eslint-enable`: its negative controls forge malformed inputs on purpose. This
 * config is what makes those comments mean something, and the selftest's tree
 * control is what checks that every `any` in the file sits between them.
 */
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
