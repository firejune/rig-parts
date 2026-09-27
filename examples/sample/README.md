# sample

A generated full-body character — prompted as an adult woman with long wavy
hair in a cream blouse and a navy pinafore dress, standing with her hands
clasped in front of the waist — made to
be this repository's plain public fixture: base checkpoint, no LoRA, and a rig
the reference implementation built from its own proposal with no hand edit.
Its heavy inputs (the painting, the two images See-through was fed, and the
`full` and `head` See-through layer sets) live in the
[spine-parts-examples](https://github.com/firejune/spine-parts-examples)
repository, which also holds the generation record and the licence;
`bun run fetch-examples` copies them into `inputs/` here (gitignored). What is
tracked is the light half: `config.json` (the reference's config converted to
this schema, `src/config.ts`), `proposal.json` (what the proposer wrote — the
`propose` stage), and under `expected/` the reference implementation's outputs,
for the TypeScript stages to be compared against — `parts.json` (`assemble`;
its `visible_px`, `occluded_px` and `visible_not_projected_px` are this port's
counts, which the reference does not write, inserted from this port's own
default build with every reference value left as it was),
`rig.json`, `motion.json` and `mesh_report.json` (`rig`), and `check.json`,
`gate_spine-html.txt` and `gate_spine.txt` (`check`, the last two being
spine-rigc's gate lines for its two profiles). `sheets/` holds the reference's
contact sheets of the two layer sets and of the assembled parts (`sheet`).
