# Changelog

## [0.11.0](https://github.com/firejune/spine-parts/compare/v0.10.0...v0.11.0) (2026-10-06)


### Features

* **compare:** compare two skeletons by structure through an explicit bone map ([#88](https://github.com/firejune/spine-parts/issues/88)) ([2452dc6](https://github.com/firejune/spine-parts/commit/2452dc6079c8a2e84370302b091e221717191acb)), closes [#85](https://github.com/firejune/spine-parts/issues/85)
* **propose:** read a posed figure's joints from one explicit keypoint file, place the torso and sleeves from them, and lint by the relations they declare ([#90](https://github.com/firejune/spine-parts/issues/90)) ([4038702](https://github.com/firejune/spine-parts/commit/403870207959fde22bb6296d94a7337dfbba1607)), closes [#75](https://github.com/firejune/spine-parts/issues/75)
* **propose:** say per bone which check read it or why none did, and write beside the proposal what each bone rests on ([#91](https://github.com/firejune/spine-parts/issues/91)) ([e86444c](https://github.com/firejune/spine-parts/commit/e86444ca7282ca0b58aa136f362322f9287db45a)), closes [#86](https://github.com/firejune/spine-parts/issues/86)

## [0.10.0](https://github.com/firejune/spine-parts/compare/v0.9.0...v0.10.0) (2026-10-06)


### Features

* **check:** measure a rig spec with no parts.json or no idle, SKIP by name, and add SETUP_POSE_VS_SOURCE under --source ([#82](https://github.com/firejune/spine-parts/issues/82)) ([989aa00](https://github.com/firejune/spine-parts/commit/989aa00542edce052e6f90d6a0cf9ee1c253ee57)), closes [#77](https://github.com/firejune/spine-parts/issues/77)
* **inputs:** a landscape painting is padded onto its square vertically, and every stage maps the full run back through both pads ([#79](https://github.com/firejune/spine-parts/issues/79)) ([c7a6bdd](https://github.com/firejune/spine-parts/commit/c7a6bdd02c5a7695300d4014b79278eae95a984c)), closes [#78](https://github.com/firejune/spine-parts/issues/78)
* **propose:** a face-less figure gets a proposal, its face box derived from the head run's hair and neck by measured ratios ([#83](https://github.com/firejune/spine-parts/issues/83)) ([88b88f4](https://github.com/firejune/spine-parts/commit/88b88f4868cf40079a9feed2c031cf3d16ef87e7)), closes [#76](https://github.com/firejune/spine-parts/issues/76)
* **rig:** turn each chain bone along its chain and give it a length, without moving anything ([#81](https://github.com/firejune/spine-parts/issues/81)) ([76a3189](https://github.com/firejune/spine-parts/commit/76a31894d7e3bead213460051a73dbf4e3e4bb2f)), closes [#73](https://github.com/firejune/spine-parts/issues/73)

## [0.9.0](https://github.com/firejune/spine-parts/compare/v0.8.2...v0.9.0) (2026-10-05)


### Features

* **config:** a project's own records ride under x- keys, read by nothing — and the painting meta names its sampler fields ([#71](https://github.com/firejune/spine-parts/issues/71)) ([a91d54f](https://github.com/firejune/spine-parts/commit/a91d54fd4b388ecdf044e83a9ce89e58a9298004)), closes [#70](https://github.com/firejune/spine-parts/issues/70)

## [0.8.2](https://github.com/firejune/spine-parts/compare/v0.8.1...v0.8.2) (2026-10-04)


### Bug Fixes

* **deps:** take up spine-rigc 2.10.1 — the header is the setup-pose box, held to getBounds by the atlas instrument; stale sentences made true ([#68](https://github.com/firejune/spine-parts/issues/68)) ([2277d86](https://github.com/firejune/spine-parts/commit/2277d86e406f833371de4447d8e5a67dcc7d5d1e)), closes [#67](https://github.com/firejune/spine-parts/issues/67)

## [0.8.1](https://github.com/firejune/spine-parts/compare/v0.8.0...v0.8.1) (2026-10-03)


### Bug Fixes

* **config:** two tracks on one bone property are refused by the loader, before rigc ([#65](https://github.com/firejune/spine-parts/issues/65)) ([6cf8ac9](https://github.com/firejune/spine-parts/commit/6cf8ac9786a384127867b59bbcdccc74b11656bc)), closes [#49](https://github.com/firejune/spine-parts/issues/49)

## [0.8.0](https://github.com/firejune/spine-parts/compare/v0.7.0...v0.8.0) (2026-10-03)


### ⚠ BREAKING CHANGES

* **check:** the default packed page changes (polygon); --pack-shape rect restores 0.7.0's page. check.json gains a key, pack_mode, after rigc_entry. A rigc older than 2.1.0 on PATH is refused (CHECK_PACK_SHAPE) under the default.

### Features

* **check:** take up spine-rigc 2.1 — read the pack line that ends in its shape, pass --pack-shape through with polygon as the default, and record pack_mode in check.json ([#63](https://github.com/firejune/spine-parts/issues/63)) ([6ed8e4d](https://github.com/firejune/spine-parts/commit/6ed8e4d159f414e67d202368a35a78df2733b828))

## [0.7.0](https://github.com/firejune/spine-parts/compare/v0.6.0...v0.7.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* **rigc:** an install of spine-parts no longer carries spine-core, and its build is gated by rigc's own validator (cli_core.ts); the spine-core round trip runs in this repository's selftest and CI. check.json drops gate_spine_green and adds rigc_entry; check no longer writes gate_spine.txt.

### Features

* **rigc:** take up spine-rigc 2.0 — rig gates through rigc's launcher like check, build's spine-html gate is the one gate, a rigc that stops before its gate prints is quoted, both entries' reports are read by name and check.json records the entry ([#60](https://github.com/firejune/spine-parts/issues/60)) ([992a8fd](https://github.com/firejune/spine-parts/commit/992a8fd009c4a475387897f46e75d1a6da396ffe))

## [0.6.0](https://github.com/firejune/spine-parts/compare/v0.5.0...v0.6.0) (2026-10-01)


### Features

* **check:** the packed page takes rigc's --page-edges, free by default — the examples' pages go from 1024x2048 to 967x1338 and 512x2048 to 479x1166, and --page-edges pot keeps the earlier bytes ([#57](https://github.com/firejune/spine-parts/issues/57)) ([7ab56b4](https://github.com/firejune/spine-parts/commit/7ab56b421fa140278f6211b726eb8ce1906c9944))


### Instrument

* **tools:** atlas_population measures the editor's example atlases and ours with one instrument — regions, page opaque share, figure size at atlas scale ([#55](https://github.com/firejune/spine-parts/issues/55)) ([610bde8](https://github.com/firejune/spine-parts/commit/610bde8715830eadbc5b105cdc3ef66f7975f17a)), closes [#54](https://github.com/firejune/spine-parts/issues/54)

## [0.5.0](https://github.com/firejune/spine-parts/compare/v0.4.0...v0.5.0) (2026-09-28)


### Features

* **check:** TEXTURE_STRETCH measures every mesh triangle's edge stretch over the idle from rigc's geometry export — the reference guide's judgement 6 leaves the eye-only list ([#52](https://github.com/firejune/spine-parts/issues/52)) ([0283a6b](https://github.com/firejune/spine-parts/commit/0283a6b69b084168235d6025c49a722199a01bb1)), closes [#31](https://github.com/firejune/spine-parts/issues/31)


### Bug Fixes

* **check:** STILL_REGIONS_DARK measures the face in the head's own frame — a 2 px slide the screen-space bar let through is now red ([#53](https://github.com/firejune/spine-parts/issues/53)) ([b0d3efe](https://github.com/firejune/spine-parts/commit/b0d3efe45f3a0ce38963b56d355a205b269b4533))
* **propose:** irides without an eyewhite are placed as still regions with the cause in the note, and a blink group naming a bone twice is refused before rigc ([#51](https://github.com/firejune/spine-parts/issues/51)) ([ec963c1](https://github.com/firejune/spine-parts/commit/ec963c18f68ae3b1019ca1c2e7dc5b91263a1eef))


### Documentation

* **seethrough:** upstream's two stages, read at a named revision and measured against our head-crop run — what each route needs ([#48](https://github.com/firejune/spine-parts/issues/48)) ([912c699](https://github.com/firejune/spine-parts/commit/912c699b7ce6a77f500b8b2a9a2112a69bec57a2)), closes [#10](https://github.com/firejune/spine-parts/issues/10)

## [0.4.0](https://github.com/firejune/spine-parts/compare/v0.3.0...v0.4.0) (2026-09-28)


### Features

* **rig:** --idle-keys ctl|direct — the _ctl indirection measured against direct keys with rigc 1.3.0's idleDrivesMeshes declaration ([#43](https://github.com/firejune/spine-parts/issues/43)) ([8a450cc](https://github.com/firejune/spine-parts/commit/8a450cc59c81052fe9008ea71c9bfae45d62cdd7))


### Bug Fixes

* **motion:** the blink's hold spans a loop frame — the 12 fps idle now shows the closed eye on both examples, and the README animation blinks ([#46](https://github.com/firejune/spine-parts/issues/46)) ([48e3e61](https://github.com/firejune/spine-parts/commit/48e3e610524d7b43b190fcfc3a14678533aaff12))
* **propose:** a figure with no eye parts gets no blink — propose says so, and a config with an empty blink group is refused before rigc sees it ([#47](https://github.com/firejune/spine-parts/issues/47)) ([8bc20b4](https://github.com/firejune/spine-parts/commit/8bc20b4dbb41f7403a1b5d0b25b779c8992e5363))

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
