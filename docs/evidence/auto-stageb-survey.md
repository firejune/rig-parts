## Stage B on the public examples (tools/auto_motion_survey.ts --config)

Policy: examplePolicy(spacing) (fixtures/automesh.ts) + policyMotion (fixtures/automotion.ts) — maxBoundaryDeviation 1, source tolerance 1, motion bound 1 rig px — plus each configuration's opt-ins and nothing else (STAGE_B_CONFIGS in the tool: baseline {}, boundaryRuns {"boundaryRuns":{"maxVertices":8}}, retriangulate {"retriangulate":"delaunay"}, removalOrder {"removalOrder":"deformation-load"}, all {"boundaryRuns":{"maxVertices":8},"retriangulate":"delaunay","removalOrder":"deformation-load"}); each part switched alone; the real rig stage with the motion gate and the acceptance loop (src/autoreplay.ts), through the installed rig-c 2.28.0. N is the full run's accepted operations (acceptedAt's length; a boundary run is one), I the refinement's insertions among them. "chosen" is the row the stage wrote — a replayed step's when the acceptance loop chose one.

### Counts, search and motion

| part | config | source → full → chosen (hull+interior) | N (I) | chosen step | replays (at most) | candidates: full run / replays | full run's termination | MQ_BOUNDARY_DEVIATION (chosen) | full result's motion (every frame held out) | chosen: selection / held out | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo/neck | baseline | 14+75 → 14+0 → 14+0 | 75 (0) | 75 (the full result) | 0 | 103 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 4.55368 against <= 1, removing source vertex 13 | 0 (pass) | 0.143853 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| demo/neck | boundaryRuns | 14+75 → 14+0 → 14+0 | 75 (0) | 75 (the full result) | 0 | 299 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 4.55368 against <= 1, removing source vertex 13 | 0 (pass) | 0.143853 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| demo/neck | retriangulate | 14+75 → 14+0 → 14+0 | 75 (0) | 75 (the full result) | 0 | 103 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 4.55368 against <= 1, removing source vertex 13 | 0 (pass) | 0.081004 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| demo/neck | removalOrder | 14+75 → 14+0 → 14+0 | 75 (0) | 75 (the full result) | 0 | 103 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 2.587097 against <= 1, removing source vertex 11 | 0 (pass) | 0.125361 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| demo/neck | all | 14+75 → 14+0 → 14+0 | 75 (0) | 75 (the full result) | 0 | 299 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 2.587097 against <= 1, removing source vertex 11 | 0 (pass) | 0.081004 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| demo/bottomwear | baseline | 293+243 → 282+0 → 283+132 | 254 (0) | 121 | 8 (8) | 1101 / 3145 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 3.116973 against <= 1, removing source vertex 292 | 1 (pass) | 1.994599 / <= 1 @ idle@grid@1.083333 | 0.673771 @ idle@grid@2.5 / 0.673683 @ idle@irr@2.531831 | accepted at replayed step 121 of 254 |
| demo/bottomwear | boundaryRuns | 293+243 → 223+0 → 223+172 | 275 (0) | 103 | 8 (9) | 4029 / 16609 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 3.116973 against <= 1, removing source vertex 292 | 1 (pass) | 1.994599 / <= 1 @ idle@grid@1.083333 | 0.4218 @ idle@grid@1 / 0.421322 @ idle@irr@0.948497 | accepted at replayed step 103 of 275 |
| demo/bottomwear | retriangulate | 293+243 → 282+0 → 283+64 | 254 (0) | 189 | 8 (8) | 1101 / 3658 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 3.116973 against <= 1, removing source vertex 292 | 1 (pass) | 1.118476 / <= 1 @ idle@grid@1 | 0.883705 @ idle@grid@2.916667 / 0.885672 @ idle@irr@2.948497 | accepted at replayed step 189 of 254 |
| demo/bottomwear | removalOrder | 293+243 → 282+0 → 282+98 | 254 (0) | 156 | 8 (8) | 818 / 3490 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.483997 against <= 1, removing source vertex 42 | 1 (pass) | 1.831092 / <= 1 @ idle@irr@1.198497 | 0.657088 @ idle@grid@1 / 0.656323 @ idle@irr@1.031831 | accepted at replayed step 156 of 254 |
| demo/bottomwear | all | 293+243 → 223+0 → 223+6 | 275 (0) | 269 | 8 (9) | 4029 / 17672 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.562189 against <= 1, removing source vertex 44 | 1 (pass) | 1.118476 / <= 1 @ idle@grid@1 | 0.922296 @ idle@grid@2.666667 / 0.921593 @ idle@irr@2.698497 | accepted at replayed step 269 of 275 |
| sample/neck | baseline | 26+81 → 26+0 → 26+0 | 81 (0) | 81 (the full result) | 0 | 133 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 2.33522 against <= 1, removing source vertex 25 | 0 (pass) | 0.313914 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| sample/neck | boundaryRuns | 26+81 → 21+0 → 21+0 | 83 (0) | 83 (the full result) | 0 | 430 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 2.33522 against <= 1, removing source vertex 25 | 0.93576 (pass) | 0.280382 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| sample/neck | retriangulate | 26+81 → 26+0 → 26+0 | 81 (0) | 81 (the full result) | 0 | 133 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 2.33522 against <= 1, removing source vertex 25 | 0 (pass) | 0.115477 / <= 1 @ idle@irr@3.448497 | n/a (no replay) | accepted |
| sample/neck | removalOrder | 26+81 → 26+0 → 26+0 | 81 (0) | 81 (the full result) | 0 | 133 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.264911 against <= 1, removing source vertex 4 | 0 (pass) | 0.313914 / <= 1 @ idle@irr@1.448497 | n/a (no replay) | accepted |
| sample/neck | all | 26+81 → 21+0 → 21+0 | 83 (0) | 83 (the full result) | 0 | 430 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.897629 against <= 1, removing source vertex 3 | 0.93576 (pass) | 0.115477 / <= 1 @ idle@irr@3.448497 | n/a (no replay) | accepted |
| sample/sleeves | baseline | 198+33 → 190+0 → 190+2 | 41 (0) | 39 | 6 (6) | 421 / 1342 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.859962 against <= 1, removing source vertex 197 | 1 (pass) | 1.54423 / <= 1 @ idle@irr@0.448497 | 0.513379 @ idle@grid@0.416667 / 0.513229 @ idle@irr@0.448497 | accepted at replayed step 39 of 41 |
| sample/sleeves | boundaryRuns | 198+33 → 166+0 → 190+33 | 50 (0) | 3 | 5 (6) | 2810 / 4176 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.859962 against <= 1, removing source vertex 197 | 0.982872 (pass) | 1.852178 / <= 1 @ idle@grid@0.416667 | 0.641042 @ idle@grid@0.416667 / 0.640904 @ idle@irr@0.448497 | accepted at replayed step 3 of 50 |
| sample/sleeves | retriangulate | 198+33 → 190+0 → 190+1 | 41 (0) | 40 | 6 (6) | 421 / 1342 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.859962 against <= 1, removing source vertex 197 | 1 (pass) | 1.535519 / <= 1 @ idle@grid@0.333333 | 0.727273 @ idle@grid@0.416667 / 0.726397 @ idle@irr@0.448497 | accepted at replayed step 40 of 41 |
| sample/sleeves | removalOrder | 198+33 → 190+0 → 190+2 | 41 (0) | 39 | 6 (6) | 421 / 1327 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.830511 against <= 1, removing source vertex 114 | 1 (pass) | 1.54423 / <= 1 @ idle@irr@0.448497 | 0.409504 @ idle@grid@0.5 / 0.40926 @ idle@irr@0.448497 | accepted at replayed step 39 of 41 |
| sample/sleeves | all | 198+33 → 166+0 → 166+1 | 50 (0) | 49 | 6 (6) | 2810 / 8793 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.830511 against <= 1, removing source vertex 114 | 1 (pass) | 1.535519 / <= 1 @ idle@grid@0.333333 | 0.957584 @ idle@grid@0.416667 / 0.956808 @ idle@irr@0.365164 | accepted at replayed step 49 of 50 |
| sample/topwear | baseline | 66+76 → 63+0 → 63+0 | 79 (0) | 79 (the full result) | 0 | 205 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.455214 against <= 1, removing source vertex 65 | 0.679775 (pass) | 0.983973 / <= 1 @ idle@grid@1 | n/a (no replay) | accepted |
| sample/topwear | boundaryRuns | 66+76 → 59+0 → 59+0 | 78 (0) | 78 (the full result) | 0 | 1031 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.455214 against <= 1, removing source vertex 65 | 0.991333 (pass) | 0.983973 / <= 1 @ idle@grid@1 | n/a (no replay) | accepted |
| sample/topwear | retriangulate | 66+76 → 63+0 → 63+0 | 79 (0) | 79 (the full result) | 0 | 205 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.455214 against <= 1, removing source vertex 65 | 0.679775 (pass) | 0.979111 / <= 1 @ idle@grid@1 | n/a (no replay) | accepted |
| sample/topwear | removalOrder | 66+76 → 63+0 → 63+0 | 79 (0) | 79 (the full result) | 0 | 205 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.940285 against <= 1, removing source vertex 36 | 0.679775 (pass) | 0.974431 / <= 1 @ idle@grid@1 | n/a (no replay) | accepted |
| sample/topwear | all | 66+76 → 59+0 → 59+0 | 78 (0) | 78 (the full result) | 0 | 1031 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.940285 against <= 1, removing source vertex 36 | 0.991333 (pass) | 0.979111 / <= 1 @ idle@grid@1 | n/a (no replay) | accepted |
| sample/bottomwear | baseline | 107+123 → 101+0 → 101+3 | 129 (0) | 126 | 7 (8) | 331 / 1476 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 3.502178 against <= 1, removing source vertex 106 | 0.904204 (pass) | 1.153585 / <= 1 @ idle@grid@1.5 | 0.761734 @ idle@grid@2.166667 / 0.762275 @ idle@irr@2.198497 | accepted at replayed step 126 of 129 |
| sample/bottomwear | boundaryRuns | 107+123 → 95+0 → 95+3 | 130 (0) | 127 | 7 (8) | 1694 / 6404 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 3.502178 against <= 1, removing source vertex 106 | 0.986394 (pass) | 1.178556 / <= 1 @ idle@irr@1.448497 | 0.761734 @ idle@grid@2.166667 / 0.762275 @ idle@irr@2.198497 | accepted at replayed step 127 of 130 |
| sample/bottomwear | retriangulate | 107+123 → 101+0 → 101+0 | 129 (0) | 129 (the full result) | 0 | 331 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 3.502178 against <= 1, removing source vertex 106 | 0.904204 (pass) | 0.658463 / <= 1 @ idle@irr@3.698497 | n/a (no replay) | accepted |
| sample/bottomwear | removalOrder | 107+123 → 101+0 → 101+0 | 129 (0) | 129 (the full result) | 0 | 331 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.808389 against <= 1, removing source vertex 23 | 0.904204 (pass) | 0.998042 / <= 1 @ idle@grid@0.833333 | n/a (no replay) | accepted |
| sample/bottomwear | all | 107+123 → 95+0 → 95+0 | 130 (0) | 130 (the full result) | 0 | 1694 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.711402 against <= 1, removing source vertex 17 | 0.986394 (pass) | 0.658017 / <= 1 @ idle@grid@3.666667 | n/a (no replay) | accepted |
| scarf/hair_front | baseline | 54+69 → 53+0 → 53+0 | 70 (0) | 70 (the full result) | 0 | 176 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.2 against <= 1, removing source vertex 53 | 0.830455 (pass) | 0.549338 / <= 1 @ idle@irr@1.865164 | n/a (no replay) | accepted |
| scarf/hair_front | boundaryRuns | 54+69 → 47+0 → 47+0 | 73 (0) | 73 (the full result) | 0 | 850 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.792516 against <= 1, removing source vertex 53 | 0.994505 (pass) | 0.549338 / <= 1 @ idle@irr@1.865164 | n/a (no replay) | accepted |
| scarf/hair_front | retriangulate | 54+69 → 53+0 → 53+0 | 70 (0) | 70 (the full result) | 0 | 176 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.2 against <= 1, removing source vertex 53 | 0.830455 (pass) | 0.398103 / <= 1 @ idle@grid@1.916667 | n/a (no replay) | accepted |
| scarf/hair_front | removalOrder | 54+69 → 53+0 → 53+0 | 70 (0) | 70 (the full result) | 0 | 176 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.788854 against <= 1, removing source vertex 33 | 0.830455 (pass) | 0.658783 / <= 1 @ idle@grid@0 | n/a (no replay) | accepted |
| scarf/hair_front | all | 54+69 → 47+0 → 47+0 | 73 (0) | 73 (the full result) | 0 | 850 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.84577 against <= 1, removing source vertex 9 | 0.994505 (pass) | 0.398103 / <= 1 @ idle@grid@1.916667 | n/a (no replay) | accepted |
| scarf/handwear_l | baseline | 71+307 → 67+0 → 67+0 | 311 (0) | 311 (the full result) | 0 | 445 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.511219 against <= 1, removing source vertex 70 | 1 (pass) | 0.399662 / <= 1 @ idle@irr@2.448497 | n/a (no replay) | accepted |
| scarf/handwear_l | boundaryRuns | 71+307 → 62+0 → 62+0 | 313 (0) | 313 (the full result) | 0 | 1344 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.511219 against <= 1, removing source vertex 70 | 0.976187 (pass) | 0.290441 / <= 1 @ idle@grid@0.666667 | n/a (no replay) | accepted |
| scarf/handwear_l | retriangulate | 71+307 → 67+0 → 67+0 | 311 (0) | 311 (the full result) | 0 | 445 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.511219 against <= 1, removing source vertex 70 | 1 (pass) | 0.293174 / <= 1 @ idle@grid@0.583333 | n/a (no replay) | accepted |
| scarf/handwear_l | removalOrder | 71+307 → 67+0 → 67+0 | 311 (0) | 311 (the full result) | 0 | 445 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.22333 against <= 1, removing source vertex 56 | 1 (pass) | 0.293284 / <= 1 @ idle@grid@0.666667 | n/a (no replay) | accepted |
| scarf/handwear_l | all | 71+307 → 62+0 → 62+0 | 313 (0) | 313 (the full result) | 0 | 1344 / 0 | no-further-valid-reduction, blocked by MQ_BOUNDARY_DEVIATION: 1.22333 against <= 1, removing source vertex 56 | 0.976187 (pass) | 0.293091 / <= 1 @ idle@grid@0.583333 | n/a (no replay) | accepted |

### What each opt-in did, and the five allocation rows

Read off the full run's row (what the opt-ins did) and the chosen row (the five rows; the full run's when nothing was written). The five rows are rig-c's, every one undeclared — no bound, never required, never the worst residual. MQ_ALLOCATION_CONTRAST and MQ_DEFORM_LOAD need a motion amplitude; the stage sends none, because its gradation is a number no field declares (src/autoamplitude.ts; the row's motion_amplitude names the term), so both read not-measurable.

| part | config | opt-ins on the full run | MQ_GRADE | MQ_MIN_ANGLE_P10 | MQ_ALLOCATION_CONTRAST | MQ_DEFORM_LOAD | MQ_BOUNDARY_NECESSARY | amplitude |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo/neck | baseline | none | 2.151459 | 6.962706 | not-measurable | not-measurable | 14 | not sent: gradation |
| demo/neck | boundaryRuns | 0 run(s), 0 vertex(es) | 2.151459 | 6.962706 | not-measurable | not-measurable | 14 | not sent: gradation |
| demo/neck | retriangulate | post-pass taken, 11 flip(s) | 1.889501 | 15.841108 | not-measurable | not-measurable | 14 | not sent: gradation |
| demo/neck | removalOrder | order deformation-load | 1.880508 | 6.962706 | not-measurable | not-measurable | 14 | not sent: gradation |
| demo/neck | all | 0 run(s), 0 vertex(es); post-pass taken, 10 flip(s); order deformation-load | 1.889501 | 15.841108 | not-measurable | not-measurable | 14 | not sent: gradation |
| demo/bottomwear | baseline | none | 89.153861 | 3.758556 | not-measurable | not-measurable | 217 | not sent: gradation |
| demo/bottomwear | boundaryRuns | 27 run(s), 65 vertex(es) | 53.10121 | 5.820947 | not-measurable | not-measurable | 217 | not sent: gradation |
| demo/bottomwear | retriangulate | post-pass taken, 247 flip(s) | 99.437563 | 3.29176 | not-measurable | not-measurable | 217 | not sent: gradation |
| demo/bottomwear | removalOrder | order deformation-load | 58.965029 | 2.632919 | not-measurable | not-measurable | 217 | not sent: gradation |
| demo/bottomwear | all | 27 run(s), 65 vertex(es); post-pass taken, 196 flip(s); order deformation-load | 38.818444 | 2.910838 | not-measurable | not-measurable | 217 | not sent: gradation |
| sample/neck | baseline | none | 12.639723 | 0.972962 | not-measurable | not-measurable | 21 | not sent: gradation |
| sample/neck | boundaryRuns | 2 run(s), 5 vertex(es) | 10.047781 | 3.710118 | not-measurable | not-measurable | 21 | not sent: gradation |
| sample/neck | retriangulate | post-pass taken, 28 flip(s) | 5.007915 | 10.344857 | not-measurable | not-measurable | 21 | not sent: gradation |
| sample/neck | removalOrder | order deformation-load | 11.305617 | 3.17983 | not-measurable | not-measurable | 21 | not sent: gradation |
| sample/neck | all | 2 run(s), 5 vertex(es); post-pass taken, 18 flip(s); order deformation-load | 4.163097 | 10.796083 | not-measurable | not-measurable | 21 | not sent: gradation |
| sample/sleeves | baseline | none | 17.13443 | 3.347817 | not-measurable | not-measurable | 166 | not sent: gradation |
| sample/sleeves | boundaryRuns | 12 run(s), 27 vertex(es) | 10.152942 | 7.962265 | not-measurable | not-measurable | 166 | not sent: gradation |
| sample/sleeves | retriangulate | post-pass taken, 83 flip(s) | 13.137638 | 5.440332 | not-measurable | not-measurable | 166 | not sent: gradation |
| sample/sleeves | removalOrder | order deformation-load | 15.47052 | 3.62614 | not-measurable | not-measurable | 166 | not sent: gradation |
| sample/sleeves | all | 12 run(s), 27 vertex(es); post-pass taken, 65 flip(s); order deformation-load | 14.304248 | 5.194429 | not-measurable | not-measurable | 166 | not sent: gradation |
| sample/topwear | baseline | none | 13.496429 | 1.893386 | not-measurable | not-measurable | 59 | not sent: gradation |
| sample/topwear | boundaryRuns | 1 run(s), 6 vertex(es) | 22.258351 | 2.2633 | not-measurable | not-measurable | 59 | not sent: gradation |
| sample/topwear | retriangulate | post-pass taken, 40 flip(s) | 12.796886 | 4.502372 | not-measurable | not-measurable | 59 | not sent: gradation |
| sample/topwear | removalOrder | order deformation-load | 26.854955 | 2.663001 | not-measurable | not-measurable | 59 | not sent: gradation |
| sample/topwear | all | 1 run(s), 6 vertex(es); post-pass taken, 17 flip(s); order deformation-load | 15.986584 | 4.502372 | not-measurable | not-measurable | 59 | not sent: gradation |
| sample/bottomwear | baseline | none | 44.116421 | 0.991873 | not-measurable | not-measurable | 95 | not sent: gradation |
| sample/bottomwear | boundaryRuns | 3 run(s), 8 vertex(es) | 44.116421 | 1.358709 | not-measurable | not-measurable | 95 | not sent: gradation |
| sample/bottomwear | retriangulate | post-pass taken, 63 flip(s) | 39.08807 | 2.896834 | not-measurable | not-measurable | 95 | not sent: gradation |
| sample/bottomwear | removalOrder | order deformation-load | 45.258365 | 0.9364 | not-measurable | not-measurable | 95 | not sent: gradation |
| sample/bottomwear | all | 3 run(s), 8 vertex(es); post-pass taken, 70 flip(s); order deformation-load | 39.08807 | 2.883573 | not-measurable | not-measurable | 95 | not sent: gradation |
| scarf/hair_front | baseline | none | 9.84333 | 4.763642 | not-measurable | not-measurable | 47 | not sent: gradation |
| scarf/hair_front | boundaryRuns | 3 run(s), 6 vertex(es) | 4.626131 | 5.253803 | not-measurable | not-measurable | 47 | not sent: gradation |
| scarf/hair_front | retriangulate | post-pass taken, 31 flip(s) | 9.851021 | 8.055122 | not-measurable | not-measurable | 47 | not sent: gradation |
| scarf/hair_front | removalOrder | order deformation-load | 10.964337 | 1.843776 | not-measurable | not-measurable | 47 | not sent: gradation |
| scarf/hair_front | all | 3 run(s), 6 vertex(es); post-pass taken, 24 flip(s); order deformation-load | 8.849244 | 8.130102 | not-measurable | not-measurable | 47 | not sent: gradation |
| scarf/handwear_l | baseline | none | 21.466776 | 1.275139 | not-measurable | not-measurable | 61 | not sent: gradation |
| scarf/handwear_l | boundaryRuns | 3 run(s), 6 vertex(es) | 7.035701 | 1.296754 | not-measurable | not-measurable | 61 | not sent: gradation |
| scarf/handwear_l | retriangulate | post-pass taken, 61 flip(s) | 15.285174 | 4.398705 | not-measurable | not-measurable | 61 | not sent: gradation |
| scarf/handwear_l | removalOrder | order deformation-load | 22.364194 | 1.296754 | not-measurable | not-measurable | 61 | not sent: gradation |
| scarf/handwear_l | all | 3 run(s), 6 vertex(es); post-pass taken, 41 flip(s); order deformation-load | 15.285174 | 4.398705 | not-measurable | not-measurable | 61 | not sent: gradation |

- baseline: 8 of 8 accepted (5 outright, 3 at a replayed step), 0 refused.
- boundaryRuns: 8 of 8 accepted (5 outright, 3 at a replayed step), 0 refused.
- retriangulate: 8 of 8 accepted (6 outright, 2 at a replayed step), 0 refused.
- removalOrder: 8 of 8 accepted (6 outright, 2 at a replayed step), 0 refused.
- all: 8 of 8 accepted (6 outright, 2 at a replayed step), 0 refused.

## Re-running this evidence

Inputs: the public examples demo, sample, scarf of https://github.com/firejune/spine-parts-examples at commit d55a28258505ef1fcdfac7d5c35126a2c8efdbb6 (the pin in `scripts/fetch-examples.sh`; `bun run fetch-examples` copies them into the gitignored `examples/<key>/inputs`), each with its tracked `examples/<key>/config.json`; rig-c 2.28.0 as `bun install --frozen-lockfile` installs it from `bun.lock`. No other input is read, and nothing is written but standard output (the stages run in a temporary directory, removed afterwards). Each part's wall time and rigc build count go to standard error and are not part of this document.

```sh
bun install --frozen-lockfile
bun run fetch-examples
timeout 2700 bun tools/auto_motion_survey.ts --config baseline,boundaryRuns,retriangulate,removalOrder,all > docs/evidence/auto-stageb-survey.md
```
