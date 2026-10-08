## The motion gate on the public examples (tools/auto_motion_survey.ts)

Policy: examplePolicy(spacing) (fixtures/automesh.ts) + policyMotion (fixtures/automotion.ts); each part switched alone; the real rig stage through the installed rig-c 2.22.0.

| part | source → result (hull+interior) | MQ_LOCAL_DEFORMATION value / bound @ worst frame | samples (art) | MQ_STRETCH | MQ_SQUASH | MQ_INVERSION | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| demo/neck | 14+75 → 14+0 | 0.143853 / <= 1 @ idle@irr@1.448497 | 2225 (2211) | 1.017052 @ idle@grid@1.416667 | 0.98606 @ idle@grid@3.416667 | 0 / <= 0 | accepted |
| demo/bottomwear | 293+243 → 282+0 | 1.994599 / <= 1 @ idle@grid@1.083333 | 351276 (350983) | 1.914951 @ idle@irr@3.031831 | 0.403652 @ idle@grid@2.75 | 0 / <= 0 | refused AUTO_MESH_MOTION |
| sample/neck | 26+81 → 26+0 | 0.313914 / <= 1 @ idle@irr@1.448497 | 3375 (3349) | 1.751345 @ idle@irr@3.448497 | 0.255939 @ idle@irr@1.448497 | 0 / <= 0 | accepted |
| sample/sleeves | 198+33 → 190+0 | 1.54423 / <= 1 @ idle@irr@0.448497 | 44410 (44212) | 1.644218 @ idle@irr@0.365164 | 0.376508 @ idle@irr@2.365164 | 0 / <= 0 | refused AUTO_MESH_MOTION |
| sample/topwear | 66+76 → 63+0 | 0.983973 / <= 1 @ idle@grid@1 | 31250 (31184) | 1.131692 @ idle@grid@1 | 0.987527 @ idle@grid@1 | 0 / <= 0 | accepted |
| sample/bottomwear | 107+123 → 101+0 | 1.153585 / <= 1 @ idle@grid@1.5 | 111411 (111304) | 1.188842 @ idle@irr@1.198497 | 0.56553 @ idle@grid@1 | 0 / <= 0 | refused AUTO_MESH_MOTION |
| scarf/hair_front | 54+69 → 53+0 | 0.549338 / <= 1 @ idle@irr@1.865164 | 5461 (5407) | 1.300692 @ idle@irr@1.948497 | 0.72928 @ idle@irr@3.948497 | 0 / <= 0 | accepted |
| scarf/handwear_l | 71+307 → 67+0 | 0.399662 / <= 1 @ idle@irr@2.448497 | 22436 (22365) | 1.056695 @ idle@grid@0.416667 | 0.951582 @ idle@grid@2.416667 | 0 / <= 0 | accepted |

### The schedule walked

- demo/neck: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- demo/bottomwear: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- sample/neck: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- sample/sleeves: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- sample/topwear: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- sample/bottomwear: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- scarf/hair_front: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []
- scarf/handwear_l: idle at 12 fps; frames grid 49, irr 48; physics step dt 0.08333333333333333, warmupSteps 0; held out true, selection []

### Refusals

- demo/bottomwear: AUTO_MESH_MOTION: config.meshes.bottomwear.auto — the reduced mesh against its unreduced source on the idle (geometry pass, motion fail) is not accepted: MQ_LOCAL_DEFORMATION fail 1.994599 against <= 1 at idle@grid@1.083333; every declared bound passing in motion is required (motionRequired), and nothing is built in its place
- sample/sleeves: AUTO_MESH_MOTION: config.meshes.sleeves.auto — the reduced mesh against its unreduced source on the idle (geometry pass, motion fail) is not accepted: MQ_LOCAL_DEFORMATION fail 1.54423 against <= 1 at idle@irr@0.448497; every declared bound passing in motion is required (motionRequired), and nothing is built in its place
- sample/bottomwear: AUTO_MESH_MOTION: config.meshes.bottomwear.auto — the reduced mesh against its unreduced source on the idle (geometry pass, motion fail) is not accepted: MQ_LOCAL_DEFORMATION fail 1.153585 against <= 1 at idle@grid@1.5; every declared bound passing in motion is required (motionRequired), and nothing is built in its place

5 of 8 accepted, 3 refused.
