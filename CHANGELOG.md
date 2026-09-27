# Changelog

## [0.3.0](https://github.com/firejune/spine-parts/compare/v0.2.0...v0.3.0) (2026-09-27)


### Features

* **assemble:** --propose-plan drops a layer that is mostly translucent, background-coloured or out of proportion, and says which rule — layers prints the three figures ([#39](https://github.com/firejune/spine-parts/issues/39)) ([84ac886](https://github.com/firejune/spine-parts/commit/84ac8861b3c2a28dd23e52eae348ba9707638fc9)), closes [#21](https://github.com/firejune/spine-parts/issues/21)
* **assemble:** assemble.patches cuts an extra part from the painting with a painting: provenance that parts.json, propose and check accept — and check --parts says what it takes ([#42](https://github.com/firejune/spine-parts/issues/42)) ([e44b01d](https://github.com/firejune/spine-parts/commit/e44b01dc48e6858a246842ff409b2f7bb785798f))
* **assemble:** the recomposite error is a map and a list of uncovered holes with their boxes, and check reports it as a line no gate can see ([#40](https://github.com/firejune/spine-parts/issues/40)) ([6629d5c](https://github.com/firejune/spine-parts/commit/6629d5c217b1fe9b586df1ce095eb1f9c2a82384))
* **propose:** hanging strands on an accessory are found, noted and given pendulum chains instead of hanging stiff on a fixed bone ([#37](https://github.com/firejune/spine-parts/issues/37)) ([fff0b84](https://github.com/firejune/spine-parts/commit/fff0b84fc8d6abdefd01df8ede4181b0e48fbc7d))


### Bug Fixes

* **assemble:** assemble reads the config through the early door — plan and seethrough are all it needs before propose — and a control runs the README loop in order on a fresh config ([#41](https://github.com/firejune/spine-parts/issues/41)) ([92b0eed](https://github.com/firejune/spine-parts/commit/92b0eedbf495d136f1d9e11bf344c811a46530e1))
* **propose:** hip comes from the waist and is linted against the chest; clasped hands are one region rather than two sleeve chains on one line ([#34](https://github.com/firejune/spine-parts/issues/34)) ([8515ffe](https://github.com/firejune/spine-parts/commit/8515ffe49f814e5af1c7effc7ec77c14f934c145))
* **rig:** a lash that reaches above the lid is cut at a clear row into a still piece — the eyelid crease no longer squashes, and the rest pose is byte-identical ([#38](https://github.com/firejune/spine-parts/issues/38)) ([7d6bd6a](https://github.com/firejune/spine-parts/commit/7d6bd6a424e0ba031d0534db0a9f0a80eba10524)), closes [#26](https://github.com/firejune/spine-parts/issues/26)

## [0.2.0](https://github.com/firejune/spine-parts/compare/v0.1.0...v0.2.0) (2026-09-27)


### Features

* **assemble:** parts.json counts visible, occluded and visible-but-not-projected pixels apart, and --project visible takes every visible pixel of a thin part from the painting ([#29](https://github.com/firejune/spine-parts/issues/29)) ([986a0a9](https://github.com/firejune/spine-parts/commit/986a0a9100acac1e891d8f580d89db2e52e227b0)), closes [#9](https://github.com/firejune/spine-parts/issues/9)
* **check:** six of the reference guide's eye-only judgements become named check lines — breath, blink hole, chain lag, tip over root, still regions — each with its bar and its SKIP ([#30](https://github.com/firejune/spine-parts/issues/30)) ([27f24ec](https://github.com/firejune/spine-parts/commit/27f24ec7dcb4b46f9ed29ee528a56937ceb088c3))
* **loop:** an indexed APNG with a shared palette — the README-sized animation is lossless PNG structure with a measured palette error ([#27](https://github.com/firejune/spine-parts/issues/27)) ([5e85bb0](https://github.com/firejune/spine-parts/commit/5e85bb0145222e6df7774afb8961a204b3b4e491))


### Bug Fixes

* **comfy:** comfy paint reads the config through the early door — key and generation are all it needs ([#18](https://github.com/firejune/spine-parts/issues/18)) ([c5c01be](https://github.com/firejune/spine-parts/commit/c5c01beb86f105107e8496b97e4d902262c5a7f8)), closes [#17](https://github.com/firejune/spine-parts/issues/17)

## 0.1.0 (2026-09-27)


### Features

* **assemble:** merge the full and head See-through runs into rig-space parts, measured against the reference ([#14](https://github.com/firejune/spine-parts/issues/14)) ([6c2602a](https://github.com/firejune/spine-parts/commit/6c2602ad6f8239abf46e0a87a0ad221569dbd695))
* **build:** one command from painting to packed atlas, an end-to-end examples chain, and the 0.1.0 README, authoring guide, skill and demo ([#16](https://github.com/firejune/spine-parts/issues/16)) ([9ed1183](https://github.com/firejune/spine-parts/commit/9ed11834418333ec0f9d267ce6b46750fe883922))
* **check:** build, gate, render and measure a rig through spine-rigc, and encode its idle as APNG and GIF ([#8](https://github.com/firejune/spine-parts/issues/8)) ([722e67b](https://github.com/firejune/spine-parts/commit/722e67b28943aeaf02aef20aaffb04ecfe74addc))
* **comfy:** the optional ComfyUI adapter (comfy paint, comfy seethrough) and the inputs command ([#15](https://github.com/firejune/spine-parts/issues/15)) ([a9c778a](https://github.com/firejune/spine-parts/commit/a9c778a6e98335fe2af38e674fdb57920443c279))
* **examples:** two public example characters, fetched inputs, and a corpus suite that reads them ([#3](https://github.com/firejune/spine-parts/issues/3)) ([7f4b4af](https://github.com/firejune/spine-parts/commit/7f4b4afa204f6271bfef4b8bb637f5a307589790))
* **propose:** bones, meshes, regions and an idle from the parts' tags, the overlay to correct against, LINT, compare and a head box held inside the painting ([#5](https://github.com/firejune/spine-parts/issues/5)) ([a00fe94](https://github.com/firejune/spine-parts/commit/a00fe940250d9af068064d676cfe0207ab4e7fd9))
* **rig:** author rig.json and motion.json from the config and the parts — lattice meshes, segment weights, regions, the idle — and write them only after spine-rigc is green on them ([#4](https://github.com/firejune/spine-parts/issues/4)) ([e8165bc](https://github.com/firejune/spine-parts/commit/e8165bcd98054fae33a98af4306fbf9c1a485bac))
