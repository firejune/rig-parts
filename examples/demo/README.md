# demo

A generated full-body character — prompted as an adult woman in a white and
pink frilled idol dress, with very long twin tails, a large ribbon hair bow, a
star hair ornament and dangling star earrings — chosen from eighteen measured
candidates to show what the
pipeline does with hair and cloth that hang. Its heavy inputs (the painting,
the two images See-through was fed, and the `full` and `head` See-through
layer sets) live in the
[spine-parts-examples](https://github.com/firejune/spine-parts-examples)
repository, which also holds the generation record, the candidate table and
the licence; `bun run fetch-examples` copies them into `inputs/` here
(gitignored). What is tracked is the light half: `config.json` (the
reference's config converted to this schema, `src/config.ts`; its `bones`,
`meshes`, `regions` and `motion` are the proposal's, unedited, while
`seethrough.head_box` and the `hair_back` plan entry carry the reference run's
two input-stage corrections), `proposal.json` (what the proposer wrote — the
`propose` stage), and under `expected/` the reference implementation's
outputs, for the TypeScript stages to be compared against — `parts.json`
(`assemble`), `rig.json`, `motion.json` and `mesh_report.json` (`rig`), and
`check.json`, `gate_spine-html.txt` and `gate_spine.txt` (`check`, the last
two being spine-rigc's gate lines for its two profiles). `sheets/` holds the
reference's contact sheets of the two layer sets and of the assembled parts
(`sheet`); the reference implementation's rendered loop and README images live in the [spine-parts-examples](https://github.com/firejune/spine-parts-examples) repository under `demo/python-reference/`, for comparison only.
