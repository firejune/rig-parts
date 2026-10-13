# The painting: what makes one riggable

rig-parts starts from one painting of one character. Making that painting is
yours — on your own GPU, with any generator, or by hand — and this package runs
no model. But a painting the pipeline cannot rig fails late: a sleeve layer that
holds the torso, a leg chain that drags the other leg, a dance clip that tears.
This page lists what the painting must be, why the pipeline needs each thing, and
what breaks without it; gives one generation recipe as a starting point; says how
to paint alternate art for a limb; and describes `rig-parts painting`, the check
that reads the painting before See-through runs on it.

There are two ways in:

- **A generated painting**, decomposed by [See-through](https://github.com/shitagaki-lab/see-through)
  into layers. Everything below is about this route.
- **An artist's own layered file** (a PSD, one layer per part): [AUTHORING §4,
  *For artists*](AUTHORING.md#for-artists-your-own-layered-file-issue-359) and
  *The correction loop*. The requirements below still hold for the figure — a
  limb the artist draws against the body is as hard to move — but there is no
  See-through step to fail, and an artist can paint what a joint hides as a
  `<layer>:hidden` layer.

For the environment that makes a painting (an NVIDIA GPU, an Apple Silicon Mac, or
none), see [rig-c/getting-started](https://github.com/rig-c/getting-started).

## The requirements

Each requirement says what the pipeline needs, what fails without it, and whether
`rig-parts painting` reads it (and under which rule) or only an eye can.

| requirement | why the pipeline needs it | what fails without it | read by |
| --- | --- | --- | --- |
| **Front view** | the proposer and the keypoint file read the subject's right on the image's left of a figure facing the viewer, and the eyes, the blink and the head turn are drafted from a face toward the viewer | a back view has no face part for `propose` to draft from (`PROPOSE_FACE_PRESENT`, or the face-less fallback its first note names) | an eye |
| **Full body, inside the frame** | the figure's height is the proposer's yardstick, and the feet carry the leg chain's last link | a cropped foot is a leg with no ankle; a figure touching the edge reads as background that is not plain | `PAINTING_BACKGROUND_PLAIN` |
| **Arms clear of the body** (an A-pose: arms down and out, a gap under each arm) | See-through separates what it can see; an arm with background round it becomes its own `handwear` and sleeve layers | an arm painted against the side is cut into a layer that holds part of the torso, and no rotation of its bone can swing it clear without dragging the torso's pixels | `PAINTING_ARM_CLEAR`: a gap on the line from each wrist to the hip of its side |
| **Hands apart and open** | each hand is a part on its own arm's chain; open fingers read as a hand at a thumbnail | clasped or touching hands are one `handwear` layer, split only by an `assemble.cuts` polygon drawn by hand; and the clasped hands the README showed until issue #227 did not read as hands above a thumbnail (`examples/demo/README.md`) | `PAINTING_HANDS_APART`: a gap on the line between the wrists. Hands that meet close a loop of arms round the torso, so both arms are refused with them |
| **Legs apart, with a visible gap** | the leg chain needs the legs painted apart (two legs that touch are one column See-through cannot split), and limbs are cut at their joints (#349, AUTHORING §3, *Limbs*), so each knee must be its own | legs that touch at the knee or the ankle come back as one `legwear` silhouette, a cut at the knee takes the other leg's pixels, and a step drags both | `PAINTING_LEGS_APART`: a gap on the line between the knees and on the line between the ankles |
| **Feet facing front** | a foot seen from the front stays inside its leg's column, below the ankle the leg chain ends at | not measured in this repository; read the leg parts on the `sheet` | an eye (body-18 has no foot points) |
| **A plain light background** | See-through and `assemble` read near-white as background (every channel above 235, the one test the assemble rim and the layer plausibility figures share) | scenery, a floor, a cast shadow, a gradient or a vignette is read as more figure — a layer of haze (`PLAN_LAYER_BACKGROUND`), or pixels that belong to no part | `PAINTING_BACKGROUND_PLAIN`: every border pixel near-white or unpainted |
| **Nothing held, no prop across a limb** | each part rides one bone; a prop belongs to no tag See-through knows | a held object joins the hands (`PAINTING_HANDS_APART`) or lands in a hand or garment layer and moves with the wrong bone | partly: a prop that joins the hands is `PAINTING_HANDS_APART`; anything else, an eye |
| **Clothing that leaves the joints unoccluded** | limbs are cut at the elbow and the knee (#349); each lower part carries a cap painted from what the joint hides | long sleeves and tights are fine; a cape over the elbows, a wide skirt over the knees or a forearm in front of the skirt's flare puts two parts' pixels on one joint. `assemble` names the missing cap pixels in its `limb cap:` lines | partly: a skirt over the knees is `PAINTING_LEGS_APART`, a forearm across a skirt is `PAINTING_ARM_CLEAR`; a cape over an elbow, an eye |
| **Resolution and aspect** | See-through runs on a square (`inputs` pads the painting white to a square of its longer side) at `seethrough.resolution` (1024 by default), and a second run on a crop round the head, because the eyes of a full-figure run are too small to separate. A standing figure is taller than wide; `comfy paint` writes twice its latent (832x1216 → 1664x2432) | a landscape painting is padded above and below and spends See-through's square on white; a small painting leaves the head crop too few pixels for the eyes | an eye; `inputs` refuses a translucent painting (`INPUTS_PAINTING_OPAQUE`) and a head box off it |

**One painting, one character.** The keypoint file may hold several people, and
`--person` names the one checked; the pipeline rigs one.

## The check: `rig-parts painting`

```
rig-parts painting --keypoints <keypoints.json> [--person <id>] <painting.png>
```

It runs on the CPU, before See-through, on the painting and its body-18 joints:
the same keypoint file `propose --keypoints` reads (AUTHORING §3, *A posed
figure*), from any estimator or written by hand, measured on this painting (its
`width` and `height` are the painting's, `KEYPOINTS_IMAGE_SIZE`). It writes
nothing. It prints the figure, every joint and every gap with its count, then
`PASS` and exit 0, or a `FAIL` line per refusal and exit 1. Each `FAIL` line ends
with `(see rig-parts guide <RULE>)`, which prints the rule's row in
[AUTHORING §6](AUTHORING.md#6-refusals-the-rule-and-what-has-to-change).

What it reads, each a definition with no tuned number:

- **Ground** — a pixel the package already calls background: alpha 8 or less
  (unpainted, the layer reader's cut), or every colour channel above 235
  (near-white, the assemble stage's and the plausibility figures' test).
- **Background** — the ground that reaches the edge: ground 4-connected to ground
  on the border. A white blouse inside its line art is ground but not background,
  so it is figure.
- **Figure** — everything that is not background.
- **A gap** between two joints — at least one background pixel on the straight
  line between them, sampled once per pixel the line crosses.

The rules: `PAINTING_BACKGROUND_PLAIN` (every border pixel is ground),
`PAINTING_JOINTS_STATED` (the wrists, hips, knees and ankles are `observed` with a
position), `PAINTING_JOINT_ON_FIGURE` (every observed joint's pixel is figure),
`PAINTING_ARM_CLEAR`, `PAINTING_HANDS_APART` and `PAINTING_LEGS_APART` (the gaps in
the table above).

What it does not read: a front view, the feet, a prop that does not join the
hands, a cape over an elbow, the hands' fingers, the face. A green `painting` says
the joints and the silhouette hold the requirements it reads, not that the
painting is good. A shadow or a floor enclosed by the background is figure to it;
the border rule sees it only where it reaches the edge.

## A recipe that is one way, not the only way

Anyone with a different generator reads the requirements above, not this. This
is the `generation` block of the public `demo` example (`examples/demo/config.json`,
with its pose file `examples/demo/pose.json`), which `rig-parts comfy paint`
painted, with three changes: its character's words in `identity` and `costume`
are placeholders, and the words its idol costume needed in `negative_extra`
("microphone, holding microphone, stage, stage lights") are left out; its full record — the candidates, the seed choice and a hand-detailer
pass `comfy paint` does not run — is in
[parts-examples](https://github.com/rig-c/parts-examples):

```json
"generation": {
  "checkpoint": "hassakuXLIllustrious_v13StyleA.safetensors",
  "loras": [],
  "trigger": "",
  "identity": "1girl, solo, adult woman, <your character's hair, eyes, accessories>",
  "sampler": { "steps": 30, "cfg": 6.0, "sampler": "euler_ancestral", "scheduler": "normal" },
  "costume": "<the costume>, fully clothed, empty hands",
  "negative_extra": "revealing clothes, bare shoulders, off shoulder, 2girls, multiple girls, holding, bag, weapon, clouds, cloud, sun, sky, sky background, grey background, blue background, gradient background, scenery, outdoors, from behind, back view, back of head, facing away, vignette, beige background, brown background, dark background, black background, spotlight, lighting gradient, flat color, cel shading, monochrome, lineart",
  "pose": "full body, head to toe, entire body in frame, front view, facing viewer, looking at viewer, standing, arms away from body, hands apart away from skirt, open hands, relaxed fingers, relaxed pose, gentle smile, feet visible, shoes",
  "style": "anime illustration, detailed, soft shading, (white background:1.3), simple background, plain background",
  "negative_pose": "cropped, out of frame, cut off feet, close-up, portrait, upper body, from side, profile, sitting, kneeling, dynamic pose, arms raised, hand on face, contact shadow, cast shadow, floor, multiple views, reference sheet",
  "latent": [832, 1216],
  "seed": 71006,
  "control": { "skeleton": "pose.json", "strength": 0.8, "end_percent": 0.7 }
}
```

Put your character in the two placeholders, and negate what its costume invites.
What each part does:

- **The checkpoint** is public: [Hassaku XL (Illustrious)](https://civitai.com/models/140272)
  v1.3 Style A, no LoRA. `scarf` and the two reference examples used
  [Pony Diffusion V6 XL](https://civitai.com/models/257749) with the same sampler.
- **The control skeleton** is what holds the pose; a pose asked for in words
  alone is one the sampler is free to ignore (`src/skeleton.ts`). `comfy paint`
  draws it as OpenPose body-18 in the annotator's own style and applies it through
  `controlnet-openpose-sdxl-1.0` at strength 0.8, ending at 0.7 of the steps. The
  two built-ins are `stand_sides` (arms nearly straight down at the sides) and
  `stand_clasp` (hands clasped at the waist), neither an A-pose; `pose.json` is a
  pose file (issue #198) with the arms held out: the wrists at (206, 590) and
  (626, 590) on the 832x1216 canvas, the shoulders at (340, 272) and (492, 272).
  A pose file carries no words, so `generation.pose` is required beside it.
- **The pose words** repeat what the skeleton asks — arms away, hands apart and
  open — and the **negatives** refuse what breaks a rig: a held object, a
  background that is not plain, a back or side view, a crop, a cast shadow or a
  floor.
- **The seed** is chosen by looking: the demo's was the best of sixteen candidates,
  read at the hands; generate several and run `rig-parts painting` on each.

What this recipe did not hold, measured: on the demo painting itself, with joints
read by eye, `rig-parts painting` refuses both arms (the forearms cross the
skirt's flare) and the legs at the knees and the ankles (the pose file's knees
and ankles are the built-ins', close together, and the thighhighs touch). So
change the two things it did not ask for, and check the result: move the pose
file's knees and ankles apart and add leg words ("legs apart") to `pose`, and keep
a skirt short or narrow enough that the forearms hang clear of it. How far apart
holds a gap on a given checkpoint is not measured here; `painting` is the
instrument that says.

## Alternate art for a limb

A rig plays its base art in every pose; where a limb turns somewhere the base art
cannot follow (behind the head, toward the camera), the mesh folds.
[rig-c/pose#6](https://github.com/rig-c/pose/issues/6) lets `rig-pose retarget`
switch to an alternate drawing of the limb for those spans, and its report's
`uncovered` list names every fold no alternate covers — that list is the answer
to *which* angles to paint.

To paint one without the character drifting, repaint only the limb:

1. **Start from the base painting**, not from a new generation: the face, the
   costume and the colours stay the base painting's pixels.
2. **Inpaint with a mask along the old and the new limb**: the region the limb
   leaves and the region it moves into, from the shoulder (or hip) down. Keep the
   face out of the mask.
3. **Use the key skeleton as the control**: the body-18 pose the alternate depicts,
   in the painting's space — the same skeleton the pose map's `alternates` entry
   records — drawn the way `comfy paint` draws a pose file.
4. **Run See-through on the result and take the limb's layers** (the sleeve, the
   hand); the rest of that run is discarded. The base rig's other parts stay the
   base painting's.

`comfy paint` does not run an inpainting graph; the demo's hand-detailer pass is
the same idea at hand scale (a masked repaint on the same checkpoint, recorded
beside its painting in parts-examples).
