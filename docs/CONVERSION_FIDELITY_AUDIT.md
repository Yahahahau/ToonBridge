# Conversion Fidelity Audit — Phase A

Audit date: 2026-11-22 · Branch `audit/conversion-fidelity` (base `8ffc8cb`) · **Audit only: no engine code was changed.**

Companion documents:
- [FEATURE_COMPATIBILITY_MATRIX.md](FEATURE_COMPATIBILITY_MATRIX.md): every feature, per stage, with a status.
- [LOSS_CATALOG.md](LOSS_CATALOG.md): every loss, its stage, and whether it is reported.
- [TOONSQUID_DEVICE_TEST_PLAN.md](TOONSQUID_DEVICE_TEST_PLAN.md): manual checks and the format questions to answer.

## 1. Summary

- **No conversion is device-verified yet.** Validation proves file structure; our renderer proves internal consistency. Neither proves what ToonSquid shows.
- **The biggest measured fidelity bug is upstream of ToonBridge.**
  - JPEXS turns 37 zero-length first frames into 1-frame blanks. This delays those layers by one frame against the rest of their symbol (e.g. `GF Dancing Beat`: 3 of 5 layers end at 31 instead of 30).
  - The two `.tsproj` files delivered on 2026-11-22 carry this error.
- **18 losses are silent today.** These violate "never silently lose data". The worst are:
  - reverse loop modes played forwards,
  - colour and filter tweens that jump,
  - `motionTweenScale="false"` ignored,
  - hidden instances shown,
  - frame sounds, labels and scripts dropped without mention.
- **Diagnostics cannot be located.** They are merged by message with no symbol, layer or frame. One count (`TWEEN_UNPAIRED ×171`) is mostly frames Animate also holds.
- **ToonSquid can hold more than we write.** The app-made samples show:
  - native gradients on path layers (`fC.g`),
  - text layers,
  - hidden layers (`Vi:false`),
  - mask flags (`MD`),
  - keyframe tracks (`K`: `pos`, `sX`, `sY`, `rot`, `op`, `ti`),
  - audio layers with WAV assets,
  - pixel layers with `DVTX` textures.

  Several current losses can therefore become **editable** conversions without rasterising anything.
- **The real sample files exercise only part of the feature set.** None uses gradients, masks, text, bitmaps on stage, shape tweens or sound. Those paths have no real-file test coverage.

## 2. Pipeline trace

| Stage | File | What it keeps | Where loss happens |
|---|---|---|---|
| Binary FLA → XFL (external) | JPEXS `BinaryFlaToXflExporter` | Names, layers, keyframes, tweens, shapes, filters | Zero-length frames → 1 (timing shift); unlinked pages skipped |
| ZIP read | `zip/reader.ts` | All entries; tolerant of broken central directories | — |
| XFL → IR | `xfl/parse.ts`, `ir.ts` | Solid paint, edges, instances (matrix, pivot, loop, first frame, blend, alpha, colour effect, filters), frames (index, duration, tween kind, ease, rotation), layer kind and visibility, scenes, symbols | **Paint:** gradients cut to one colour; bitmap fills, text, bitmaps, video, primitives dropped. **Timeline data never read:** labels, sounds, scripts, lock, `parentLayerIndex`, reverse loops, `lastFrame`, tween scale/orient flags, instance visibility, 3D, IK. Groups flattened; `duration=0` forced to 1 |
| IR → TS model | `resolver/resolver.ts`, `effects/plan.ts` | Symbols as clips (native playback), per-frame tween baking with keyframe guard, skew baking, seam underlays, blend isolation, filters → effects | Hidden/guide/mask layers dropped (masked art unmasked); shape tweens held; colour and filter tweens not interpolated; tint and advanced colour dropped; inner shadow/glow, bevels, Invert/Alpha/Erase dropped |
| TS model → `.tsproj` | `tsproj/writer.ts` | Vector layers (type 1), clip layers (type 4, `K ti`), effects (100/101/104/121), `bM`, `op` | Only vector type 1 used (no path type 3, text type 2, pixel type 0, audio type 9); `lo` never written; no thumbnails |
| Validation | `tsproj/validator.ts` | ZIP, SQLite schemas, references, frame ranges, cycles, finite coordinates | Structure only: no visuals, effect value ranges or `K` track checks |
| Report | `report.ts`, `diagnostics.ts` | Feature table, stats, merged diagnostics | No locations; per-frame counts inflate numbers |

## 3. Current known losses — findings

Full detail is in the Loss Catalog, section C.

| Loss | Finding | Editable route | Rasterising needed? |
|---|---|---|---|
| Gradients | Path layers store linear gradients natively (observed). Radial is supported per the handbook; field values unknown | Yes: one path layer per gradient region | No (pad spread). Reflect/repeat spread: maybe |
| Bitmap fills / images | Only pixel layers hold images; texture format `DVTX` + LZ4 not decoded | Image stays an image (pixel layer), clipped by a mask | Image itself is raster; no extra rasterising |
| Text | Text layer type 2 observed (string, font, size). Colour and alignment keys unknown | Yes for single-style text with an available font | Only if the font is missing **and** exact look is required |
| Masks | ToonSquid masks are alpha masks placed below the masked layer. Animate masks sit above and use fills | Yes once mask and group JSON are confirmed; fallback = exact vector clipping | No for solid fills |
| Shape tweens | No morph in ToonSquid; XFL lacks the in-between algorithm | Per-frame vector drawings when keyframe structures match (approximate) | No |
| Audio | Structure fully observed (asset, sidecar, layer, timeline flag) | Yes (audio layer) | n/a |
| Video | Tables exist; no sample | — | — |
| JPEXS zero-length frames | All are empty first frames; dropping them restores the cross-layer lengths exactly | n/a (timing) | No |
| JPEXS unlinked pages | All 6 hold art (corrected in Phase B2: 5 were wrongly called empty), 1 with 13 instances (deleted symbol). Unreachable from the document | Optional "Recovered" clip | No |

## 4. Conversion modes

| | Editable mode (current default, extended) | Visual Preservation mode |
|---|---|---|
| Goal | Keep vectors, layers, symbols and timing editable; report what cannot be kept | Match the source look; keep supported parts editable, raster only the affected group |
| Needs | Path, text, audio and hidden-layer writers (structures observed); mask/group JSON (Q3/Q4) | Everything in Editable **plus** the pixel-layer writer (`DVTX`, Q5) **plus** a trusted rasteriser for the unsupported element |
| Fidelity | Exact for vectors, solid colours, gradients and masks once implemented; approximate for text without fonts and for shape tweens | Close for the affected group, limited by our renderer (text needs the fonts; filters need calibration) |
| Editability | High | Rasterised groups become pixel drawings, one per frame |
| File size / performance | Small–medium | Grows with frames × raster area; iPad memory risk on long sequences |
| Status | Can proceed item by item | **Blocked:** texture format unknown, and our renderer is not a verified Animate reference |

Recommendation: extend Editable mode first. Treat Visual Preservation mode as a later, opt-in mode, after Q5 is answered and a reference-render source (Animate PNG exports) exists. Never rasterise a whole animation.

## 5. Prioritised fixes

For each fix:
- **Edit:** whether the result stays editable.
- **Raster:** whether selective rasterising is needed.

### F1 · Zero-length frame shift (JPEXS) — fixes visible timing on every legacy file

- **Root cause:** JPEXS exporter `duration <= 0 → 1` (`BinaryFlaToXflExporter.java`).
- **Change:** a patched JPEXS build that skips zero-duration frames, so later frames keep their start. Publish the patch (LGPL-2.1). In ToonBridge, read JPEXS's `conversion-report.txt` when it is inside the uploaded zip and show its items.
- **Affected:** external JPEXS build; `README.md`; `src/engine/convert.ts` (report import).
- **Improvement:** 37 layers back in sync; symbols get their original lengths (`GF Dancing Beat` 30, `GF Cheer` 21).
- **Risks:** a zero-length frame that is *not* empty or *not* first has not been seen yet. Handle it explicitly and report it.
- **Tests:** per-symbol layer-end equality on GF and BF; frame-1 contact sheet.
- **Edit:** yes. **Raster:** no.

### F2 · Locatable, honest diagnostics — makes every other fix measurable

- **Root cause:** `Diagnostics` keys on code + message, and counts frames.
- **Change:**
  - Add a location (clip/symbol, layer, frame range, element index).
  - Count per tween, keyframe or element.
  - Stop reporting tweens on a layer's last keyframe as losses.
- **Affected:** `diagnostics.ts`, `parse.ts`, `resolver.ts`, `report.ts`, UI report view (text only).
- **Improvement:** users can find each loss. `TWEEN_UNPAIRED ×171` becomes "6 symbol swaps" with their names.
- **Risks:** report size on big files. Cap the listed locations per code.
- **Tests:** snapshot of report items for small fixtures.
- **Edit/Raster:** n/a.

### F3 · Report the 18 silent losses

- **Root cause:** the parser never reads these attributes.
- **Change:** read and report:
  - frame labels, sounds and scripts (listed, never executed),
  - lock, `parentLayerIndex`,
  - reverse loops, `lastFrame`,
  - tween scale/orient/snap,
  - `isVisible`, 3D, IK,
  - groups flattened, `duration=0`,
  - stroke caps/joins,
  - colour/filter tweens,
  - `lo` not written.
- **Affected:** `parse.ts`, `ir.ts`, `resolver.ts`.
- **Improvement:** no silent loss left.
- **Risks:** low; additive.
- **Tests:** one small hand-made XFL fixture per attribute asserting the diagnostic.
- **Edit/Raster:** n/a.

### F4 · Cheap correctness fixes in frame and tween maths

- **Root cause:** missing modes in `symbolFrame` and the tween code.
- **Change:**
  - `loop reverse` / `play once reverse` / `lastFrame` frame maths,
  - honour `motionTweenScale="false"`,
  - `isVisible="false"` → not drawn,
  - interpolate colour effects and filter values during tweens (baked per frame like transforms).
- **Affected:** `parse.ts`, `ir.ts`, `resolver.ts`, `effects/plan.ts`.
- **Improvement:** correct playback direction and fades.
- **Risks:** per-frame effect variants create more drawings and clips.
- **Tests:** unit timelines like `tests/holds.test.ts` with expected frame sequences.
- **Edit:** yes. **Raster:** no.

### F5 · Keep hidden (and optionally guide) layers, hidden

- **Root cause:** the resolver drops them.
- **Change:** write timeline layers with `Vi:false` (observed) instead of dropping them.
- **Affected:** `resolver.ts`, `model.ts`, `writer.ts`, `validator.ts`.
- **Improvement:** no art missing from the file; the user can unhide it.
- **Risks:** bigger files. Hidden layers must not render: check on device (test plan #3).
- **Tests:** writer output has `Vi:false`; the render excludes the layer.
- **Edit:** yes. **Raster:** no.

### F6 · Native gradients via path layers

- **Root cause:** `parsePaint` keeps one colour; the writer has only vector type 1.
- **Change:**
  - Keep full gradients in `Paint`.
  - Route each gradient fill region to a type-3 path layer `{p, fC:{g:…}}`.
  - Do linear first; do radial after Q1.
  - Gradient strokes likewise.
- **Affected:** `ir.ts`, `parse.ts`, `resolver.ts`, `model.ts`, `writer.ts`, `validator.ts`, seam code (gradient regions get no colour underlay).
- **Improvement:** gradients exact and editable.
- **Risks:**
  - path layers are even-odd (check hole handling);
  - more layers per drawing;
  - the matrix → `s`/`e` maths needs a test.
- **Tests:** gradient fixture; JSON keys ⊆ app-made keys; render comparison with gradient support added to `render-preview`.
- **Edit:** yes. **Raster:** no.

### F7 · Tint and advanced colour effects baked into vector colours

- **Root cause:** `planColor` drops them.
- **Change:** colour-variant clips, like the skew variants. Apply the Animate colour transform to each solid or gradient stop colour inside the symbol.
- **Affected:** `resolver.ts`, `effects/plan.ts`.
- **Improvement:** exact colour for vector content.
- **Risks:**
  - clip count grows;
  - filters inside the symbol are not colour-transformed (report it);
  - tweened tints need per-frame variants.
- **Tests:** colour fixture; pixel check in our renderer.
- **Edit:** yes (colours baked). **Raster:** no.

### F8 · Masks

- **Root cause:** the resolver drops mask layers.
- **Change:**
  - **Step 1:** parse `parentLayerIndex` (F3).
  - **Step 2:** fallback = exact vector clipping of solid-fill masked content by the mask's fill area (polygon boolean). Editable paths; the mask is no longer live.
  - **Step 3:** native ToonSquid mask after Q3/Q4.
- **Affected:** `parse.ts`, `resolver.ts`, new `geometry/clip.ts`, `writer.ts`.
- **Improvement:** masked art correct instead of unmasked.
- **Risks:**
  - boolean ops on curves are hard: flatten-then-clip changes node structure;
  - animated masks need per-frame clipping.
- **Tests:** mask fixtures (static, animated mask, masked symbol).
- **Edit:** yes (paths); live mask only with the native route. **Raster:** no for solid fills.

### F9 · Frame labels → markers (after Q7) and audio (structure observed)

- **Root cause:** not parsed.
- **Change:**
  - **Audio:** write WAV + sidecar + `res_audio_clips` + type-9 layer.
  - **Needs:** decoding XFL `bin/*.dat` sound data or using the original file when present.
- **Affected:** `parse.ts`, `ir.ts`, `resolver.ts`, `writer.ts`, `validator.ts` (asset checks exist).
- **Improvement:** sound and labels kept.
- **Risks:**
  - sound `.dat` format work;
  - Event/Stream sync semantics differ (report);
  - file size.
- **Tests:** audio fixture; validator asset integrity.
- **Edit:** yes. **Raster:** n/a.

### F10 · Text layers (after Q2)

- **Root cause:** not parsed.
- **Change:** single-style text → type-2 text layer (string, font, size, colour, alignment, transform). Multi-style → one layer per run plus a report.
- **Affected:** `parse.ts`, `ir.ts`, `resolver.ts`, `writer.ts`.
- **Improvement:** text kept and editable.
- **Risks:**
  - font availability on the iPad;
  - text box metrics differ (position drift).
- **Tests:** text fixture; device check.
- **Edit:** yes. **Raster:** only as an opt-in fallback for missing fonts.

### F11 · Later / larger

- **Native `K`-track tweens:** editable motion instead of baked frames. Needs Q10 and device checks of the easing records.
- **Pixel layers and bitmaps** (after Q5): `DVTX` writer plus Animate `.dat` bitmap decoding. This also unlocks Visual Preservation mode.
- **Shape-tween approximation:** for matching keyframe structures.
- **Groups and folders:** as ToonSquid group layers (after Q4).

## 6. Test improvements (to build in the next phase)

1. **Source-vs-output count tests** for every real file, using `scripts/audit/census.py`:
   - layers, keyframes, instances and shapes per symbol vs resolver stats and written rows.
   - Every difference must be explained by a diagnostic.
2. **Timing tests:**
   - per-symbol length, and per-layer end frames equal where the source has them equal (this would have caught L-01);
   - expected symbol-frame sequences for loop modes.
3. **Reference integrity:** symbol references and nesting depth; assets present; no dangling clip.
4. **Small feature fixtures:** hand-written XFL, one per feature in the matrix. Each asserts either correct output or a specific diagnostic.
5. **Transform tests:** sample points through the Animate matrix vs the written `tf` (exists for tweens; extend to all instances).
6. **Contact sheets and visual diffs:**
   - use `scripts/render-reference.ts` (XFL) vs `scripts/render-preview.ts` (TSProj) on representative frames;
   - label them "internal consistency" — **not** proof of ToonSquid rendering.
   - When Animate PNG exports exist, add them as true references.
7. **Determinism:** exists for the Boyfriend sample; extend to every fixture (same bytes twice).
8. **Real-file tests stay visibly skipped** without `A2T_FIXTURES`:
   - today: 41 passed, 3 skipped without fixtures;
   - 46 tests with fixtures, all passing.

## 7. Recommended order

1. F2 + F3 (honest, locatable report). Then measure everything else against it.
2. F1 (JPEXS zero-length frames), then re-deliver BF and GF.
3. F4 and F5 (small, contained correctness fixes).
4. Device test round 1 (test plan) and app-made samples Q1–Q10.
5. F6 gradients, F7 colour effects.
6. F8 masks (fallback first, native after Q3/Q4).
7. F9 audio and labels, F10 text.
8. F11 items; Visual Preservation mode last.

## 8. Unresolved questions for review

1. **JPEXS patch:** may we build and ship instructions for a patched JPEXS (zero-length frames dropped)? The patch source would be published under LGPL-2.1. The alternative is reporting only.
2. **Device testing:** who runs the test plan, and can they make the ten small app-made files (Q1–Q10)?
3. **Animate references:** is Adobe Animate available to export PNG sequences of BF and GF symbols? Without them, visual tests only prove internal consistency.
4. **Hidden and guide layers:** keep them as hidden layers (bigger files, nothing lost) or keep dropping them?
5. **Unlinked page `S 75`:** offer it as an optional "Recovered" clip, or only report it?
6. **Shape tweens:** is an approximate per-frame morph acceptable when clearly labelled, or should they stay held?
7. **Visual Preservation mode:** confirm it waits until the texture format and a reference source exist.
