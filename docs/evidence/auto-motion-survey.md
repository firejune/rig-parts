## The motion gate on the public examples (tools/auto_motion_survey.ts)

Policy: examplePolicy(spacing) (fixtures/automesh.ts) + policyMotion (fixtures/automotion.ts); each part switched alone; the real rig stage, the acceptance loop with a replay included (src/autoreplay.ts), through the installed rig-c 2.33.0. The first table is the full reduction's comparison on the whole idle, every frame held out; the second is the acceptance loop's.

| part | source → full result (hull+interior) | MQ_LOCAL_DEFORMATION value / bound @ worst frame | samples (art) | MQ_STRETCH | MQ_SQUASH | MQ_INVERSION | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| demo/neck | 14+75 → 14+0 | 0.143853 / <= 1 @ idle@irr@1.448497 | 2225 (2211) | 1.017052 @ idle@grid@1.416667 | 0.98606 @ idle@grid@3.416667 | 0 / <= 0 | accepted |
| demo/bottomwear | 293+243 → 282+0 | 1.994599 / <= 1 @ idle@grid@1.083333 | 351276 (350983) | 1.914951 @ idle@irr@3.031831 | 0.403652 @ idle@grid@2.75 | 0 / <= 0 | accepted at replayed step 121 of 254 |
| sample/neck | 26+81 → 26+0 | 0.313914 / <= 1 @ idle@irr@1.448497 | 3375 (3349) | 1.751345 @ idle@irr@3.448497 | 0.255939 @ idle@irr@1.448497 | 0 / <= 0 | accepted |
| sample/sleeves | 198+33 → 190+0 | 1.54423 / <= 1 @ idle@irr@0.448497 | 44410 (44212) | 1.644218 @ idle@irr@0.365164 | 0.376508 @ idle@irr@2.365164 | 0 / <= 0 | accepted at replayed step 39 of 41 |
| sample/topwear | 66+76 → 63+0 | 0.983973 / <= 1 @ idle@grid@1 | 31250 (31184) | 1.131692 @ idle@grid@1 | 0.987527 @ idle@grid@1 | 0 / <= 0 | accepted |
| sample/bottomwear | 107+123 → 101+0 | 1.153585 / <= 1 @ idle@grid@1.5 | 111411 (111304) | 1.188842 @ idle@irr@1.198497 | 0.56553 @ idle@grid@1 | 0 / <= 0 | accepted at replayed step 126 of 129 |
| scarf/hair_front | 54+69 → 53+0 | 0.549338 / <= 1 @ idle@irr@1.865164 | 5461 (5407) | 1.300692 @ idle@irr@1.948497 | 0.72928 @ idle@irr@3.948497 | 0 / <= 0 | accepted |
| scarf/handwear_l | 71+307 → 67+0 | 0.399662 / <= 1 @ idle@irr@2.448497 | 22436 (22365) | 1.056695 @ idle@grid@0.416667 | 0.951582 @ idle@grid@2.416667 | 0 / <= 0 | accepted |

### The acceptance loop (rigc#1266 mechanism 2: a bisection over acceptedAt by stopAfterAccepted)

N is the full run's accepted steps (acceptedAt's length), I the refinement's insertions among them; the bisection probes removal steps strictly between I and N, chooses on the idle's grid frames, and the chosen step is accepted only on the whole idle with the irr frames held out. A part the gate accepts outright runs no replay. Probes are `step verdict value` on the grid frames.

| part | source → full → written (hull+interior) | N (I) | chosen step | replays (at most) | candidates tried in replays | selection @ worst frame | held out @ worst frame | probes | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo/neck | 14+75 → 14+0 → 14+0 | 75 (0) | 75 (the full result) | 0 | 0 | n/a | n/a | none | accepted |
| demo/bottomwear | 293+243 → 282+0 → 283+132 | 254 (0) | 121 | 8 (8) | 3145 | 0.673771 @ idle@grid@2.5 | 0.673683 @ idle@irr@2.531831 | 127 fail 1.003986, 63 pass 0.4218, 95 pass 0.430764, 111 pass 0.700944, 119 pass 0.590652, 123 fail 1.003986, 121 pass 0.673771, 122 fail 1.003986 | accepted at replayed step 121 of 254 |
| sample/neck | 26+81 → 26+0 → 26+0 | 81 (0) | 81 (the full result) | 0 | 0 | n/a | n/a | none | accepted |
| sample/sleeves | 198+33 → 190+0 → 190+2 | 41 (0) | 39 | 6 (6) | 1342 | 0.513379 @ idle@grid@0.416667 | 0.513229 @ idle@irr@0.448497 | 20 pass 0.319381, 30 pass 0.319381, 35 pass 0.340698, 38 pass 0.513379, 39 pass 0.513379, 40 fail 1.035398 | accepted at replayed step 39 of 41 |
| sample/topwear | 66+76 → 63+0 → 63+0 | 79 (0) | 79 (the full result) | 0 | 0 | n/a | n/a | none | accepted |
| sample/bottomwear | 107+123 → 101+0 → 101+3 | 129 (0) | 126 | 7 (8) | 1476 | 0.761734 @ idle@grid@2.166667 | 0.762275 @ idle@irr@2.198497 | 64 pass 0.384496, 96 pass 0.609312, 112 pass 0.731059, 120 pass 0.975432, 124 pass 0.702624, 126 pass 0.761734, 127 fail 1.007386 | accepted at replayed step 126 of 129 |
| scarf/hair_front | 54+69 → 53+0 → 53+0 | 70 (0) | 70 (the full result) | 0 | 0 | n/a | n/a | none | accepted |
| scarf/handwear_l | 71+307 → 67+0 → 67+0 | 311 (0) | 311 (the full result) | 0 | 0 | n/a | n/a | none | accepted |

### The schedule walked

- demo/neck: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- demo/bottomwear: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
  - the replayed step's acceptance: frames grid 49, irr 48; held out true, selection 49 frame(s), every one a grid frame: true
- sample/neck: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- sample/sleeves: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
  - the replayed step's acceptance: frames grid 49, irr 48; held out true, selection 49 frame(s), every one a grid frame: true
- sample/topwear: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- sample/bottomwear: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
  - the replayed step's acceptance: frames grid 49, irr 48; held out true, selection 49 frame(s), every one a grid frame: true
- scarf/hair_front: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- scarf/handwear_l: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []

8 of 8 accepted (5 outright, 3 at a replayed step), 0 refused.

## Re-running this evidence

Inputs: the public examples demo, sample, scarf of https://github.com/firejune/spine-parts-examples at commit d55a28258505ef1fcdfac7d5c35126a2c8efdbb6 (the pin in `scripts/fetch-examples.sh`; `bun run fetch-examples` copies them into the gitignored `examples/<key>/inputs`), each with its tracked `examples/<key>/config.json`; rig-c 2.33.0 as `bun install --frozen-lockfile` installs it from `bun.lock`. No other input is read, and nothing is written but standard output (the stages run in a temporary directory, removed afterwards). Each part's wall time and rigc build count go to standard error and are not part of this document.

```sh
bun install --frozen-lockfile
bun run fetch-examples
timeout 2700 bun tools/auto_motion_survey.ts > docs/evidence/auto-motion-survey.md
```
