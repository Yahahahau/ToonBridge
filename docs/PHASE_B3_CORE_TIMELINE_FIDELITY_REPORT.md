# Phase B3 — B2 Verification Gate + Core Timeline & Layer Fidelity

Date: 2026-11-27 · Branch: `phase-b3-core-timeline-fidelity` (from `fix/jpexs-zero-duration-frames` @ `7794368`) · Not merged into `main`.

| Commit | Content |
|---|---|
| `5f6e1b9` | B3.1 hidden and guide layers kept as hidden layers (`Vi:false`) |
| `aeddbd9` | B3.2 reverse loop modes and the graphic loop range (`lastFrame`) |
| `98b6b99` | B3.3 colour effect / filter tweens interpolated (baked per frame) |
| (this commit) | Report, matrix, loss catalog, device test plan |

Nothing in this phase has been checked inside the ToonSquid app. "Verified" below means: checked by real runs of the converter, the validator, and a renderer that reads only the output file.

## 1. Result

- **B2 gate: passed.** Every check was re-run today from scratch (section 2).
- **B3.1 Hidden layers:** hidden layers and guide layers are no longer dropped. Their art is in the file, with the layer switched off (`Vi:false`). This also works inside nested symbols. Guide layers are named `[Guide] …`.
- **B3.2 Reverse playback:** `loop reverse` and `play once reverse` no longer play forwards. Frames are baked in reverse. `lastFrame` now limits the loop range in every mode.
- **B3.3 Colour / filter tweens:** Blur, Adjust Color, Drop Shadow / Glow amounts and colour Brightness now follow the tween frame by frame, instead of jumping at the end keyframe.
- **No ToonSquid schema was guessed.** The only new key written is `Vi:false`, which was observed in an app-made file. Reverse playback and effect tweens reuse structures that were already written (drawings, Time track, effect rows).
- **XFL-only regression:**
  - GF outputs are byte-identical to B2.
  - BF and Boyfriend_But_Better change only in the 21 Gaussian Blur rows of `retry confirm` (B3.3, intended). Every drawing and every other clip is identical.

## 2. B2 verification gate (Part 1)

The checks ran against branch `fix/jpexs-zero-duration-frames` @ `7794368`, not `main`.

| # | Check | How | Result |
|---|---|---|---|
| 1 | JPEXS regression | Clean build: `build.sh` cloned upstream `6d4a715`, applied the patch and compiled. Then `ZeroDurationFramesTest` ran against the patched build and against an unpatched upstream build | Patched: **9/9 PASS**. Upstream: **6 FAIL** (as expected, so the fixtures catch the bug) |
| 2 | Build and tests | `npm run build` (tsc + vite), `vitest` without and with real fixtures, icon check | Build OK. **74 passed / 9 skipped** without fixtures, **83/83** with fixtures. Icons OK |
| 3 | Patch scope | `git diff --stat` after `build.sh` | 1 file, `BinaryFlaToXflExporter.java`, +75 / −2 |
| 4 | Zero-length cases | Java fixtures cover: empty, with content, first frame, only frame, several frames, plus held frames, nested symbols and layers with different starts | All pass on the patched build |
| 5 | Keyframe positions | `compare-timelines.ts` compares the start and duration of every keyframe with the binary records, on all layers | **0 mismatches** (BF and GF) |
| 6 | 37 BF/GF locations | Re-exported **today** from the original `BF.fla` / `GF.fla` with the freshly built patched JPEXS and the upstream build. Source records regenerated with `SourceTimelines.java` (BF output identical to the B2 run) | BF 33/33, GF 4/4 correct after the patch, all 37 wrong in upstream |
| 7 | GF Dancing Beat | Source records | Layers 1 and 5 have no zero-length frame. Layers 2, 3, 4 start with one. All five end at 30 in the source and after the patch (upstream: 31) |
| 8 | XFL-only regression | sha1 guard and 5 regression inputs | Unchanged in B2 (`dca54e90…` etc.) |
| 9 | Diagnostics | `tests/jpexs.test.ts` (24 tests) | `FRAME_DURATION` and `UNLINKED_PAGE` mapped and located |
| 10 | Licensing | Files present | `LICENSE-LGPL-2.1.md`, `README.md` (obligations), patch with a dated modification notice, `build.sh`. **0** `.jar`/`.class` in git |

## 3. B3.1 Hidden layer preservation

**Evidence for the format.** The app-made `00_baseline.tsproj` stores timeline layer "Layer 15" (type 10) with `Vi: false`. The 83 other timeline layers in the samples have no `Vi` key. `Background` layers also use `Vi:false`. So `Vi:false` means "switched off", and an absent key means visible. No `Vi:true` was ever observed, so it is never written.

**Change:**
- **Resolver:**
  - Normal layers with `visible="false"` and guide layers are now converted, in their original position.
  - They count when deciding whether a symbol is animated, and in the snapshot keys. A symbol whose only changing layer is hidden keeps its hidden animation.
  - A hidden layer never hides art below it, so seam bleed is not hidden under invisible art.
- **Writer:** `Vi:false` on those timeline layers. The selected layer in `eS` prefers a visible layer.
- **Validator:** a `Vi` value other than `false` is an error.
- **Preview renderer:** skips `Vi:false` layers.
- **Diagnostics:** `LAYER_HIDDEN` and `LAYER_GUIDE` changed from *loss* to *info* ("kept hidden"), with location and source attribute.

**Not changed:**
- Mask layers are still dropped (`LAYER_MASK`).
- Folders are flattened.
- Instance `isVisible="false"` is still shown (`INSTANCE_HIDDEN`, loss). No visibility key was observed on symbol layers (type 4), and dropping the instance would remove art.
- Guided layers still move in a straight line (`LAYER_MOTION_GUIDE`).

## 4. B3.2 Reverse playback and loop range

**Source semantics.** Adobe's *Elements* help page, section "Graphic Looping":
- *Reverse Loop* plays "last frame" → "first frame" and loops.
- *Reverse Play Once* plays "last frame" → "first frame", then holds "first frame".
- *Loop* and *Play Once* run "first frame" → "last frame".
- "Last frame" defaults to the symbol's last frame.

Without `lastFrame`, forward Loop keeps its previous behaviour (it wraps through the whole symbol), so existing files are unchanged.

**ToonSquid.**
- The handbook lists Don't Loop, Normal and Boomerang. There is no reverse mode, and Boomerang is not equivalent.
- `lo.md` meanings are still undecoded (device question Q6).
- So nothing new is written. Each reverse frame becomes a one-frame drawing that starts the same full symbol clip at the right frame with the existing Time track (`K ti`). This is exact frame by frame, if Time behaves as assumed (device question Q7).

**Change:**
- IR `LoopMode` now includes both reverse modes.
- The parser keeps them, for graphics only (Animate ignores `loop` on movie clips).
- `Resolver.symbolFrame` implements all five modes and the range.

**Diagnostics:**
- `LOOP_REVERSE` (approx): says the order follows Adobe's documentation and was not compared with an Animate render.
- `GRAPHIC_LAST_FRAME` (approx): range applied.
- `TS_LOOP_MODE` (unsupported): now also lists reverse modes, because no ToonSquid loop setting is written.

## 5. B3.3 Colour / filter tweens

**Evidence for the format.**
- Effect rows 100 (Gaussian Blur), 101 (Drop Shadow) and 104 (Adjustments) were decoded earlier from `Effect.tsproj`. None of them carries a `K` keyframe track in any sample. Only the Perspective row (121) does.
- Symbol layers have an `op` K track, but its easing record (`tp`, `iC`, `oC`, `md`) is not decoded.
- So there is **no proven native tween** for these values. They are baked per frame, like transforms already are.

**Change.** New `effects/tween.ts`:
- Every numeric colour-effect and filter value is interpolated with the tween's **eased** time, so values land exactly on both keyframes.
- Values that are not amounts are taken from the start keyframe: quality, knockout, inner, hide object.
- Interpolation only happens when both keyframes have the same filters in the same order.
- The interpolated instance goes through the same `instanceEffects` mapping as keyframes. Diagnostics for in-between frames are silenced; keyframes report their own values.

| Case | Output | Diagnostic |
|---|---|---|
| Blur / Adjust Color / Drop Shadow / Glow amounts / Brightness change | Interpolated, baked per frame | `TWEEN_FX_BAKED` (approx), source e.g. `Blur 67×67 → 177×18` |
| Alpha only | Interpolated as opacity (unchanged) | none. **Fixes a B1 false positive:** an instance without `<color>` tweening to one with only alpha was reported as a colour change (BF `BF dies` layer 11) |
| Tint / advanced colour change | Not shown in any frame (no ToonSquid equivalent) | `TWEEN_COLOR_FILTER` (approx) + keyframe `FX_NO_EQUIVALENT` (loss) |
| Filters differ in kind or order | Start filters held until the end keyframe | `TWEEN_COLOR_FILTER` (approx), source `[blur] → [adjustColor]` |
| Blend mode differs | Start blend held | `TWEEN_BLEND_HELD` (approx) |

**Real file:** `retry confirm` › Layer 3, frames 4–25. The Gaussian Blur radius was held at 38.68 until frame 25. Now it grows 38.81, 39.20, 39.86 … following the ease toward the end value. ToonSquid uses one radius, so the larger of X/Y is used, as before (`FX_APPROX`).

## 6. Tests

New file `tests/b3-timeline-fidelity.test.ts`, 23 tests. All fixtures are **synthetic test fixtures** written by hand; none is an Adobe Animate file. Results are read back from the output `.tsproj` (layers, drawings, effect rows), and playback is checked with a render of the output file.

| Area | Tests |
|---|---|
| Hidden / visible | `Vi:false` with art kept; no `Vi` on visible layers; info diagnostic, no loss; render excludes the hidden colour |
| Layer ordering | 4 alternating hidden/visible layers keep source order |
| Occlusion | A hidden layer above leaves the visible art's paths identical |
| Nested symbols | Hidden layer inside a symbol is kept and its animation is kept |
| Guide layers | `[Guide] name`, `Vi:false`, info diagnostic |
| Validator | Accepts `Vi:false`, rejects `Vi:true` |
| Forward playback | Loop, Play Once, Single Frame frame sequences unchanged |
| Reverse playback | Loop Reverse, Reverse Play Once, with and without `lastFrame`; nested reverse; movie clip ignores reverse; written as one-frame drawings + Time on one clip |
| Loop range | `lastFrame` in all four modes |
| Colour / filter tweens | Blur (exact keyframe ends, monotonic), ease applied, Adjust Color, Brightness, Alpha-only (no false report), Tint (reported, nothing baked), filter kind mismatch (held + reported), blend change (held + reported) |

Updated existing tests:
- `diagnostics.test.ts`: `TS_LOOP_MODE` now also lists the reverse layer.
- `realfiles.test.ts`: sha1 guard updated to `aabaeeda…`, with the reason in the test.

**Results (2026-11-27):**

| Run | Result |
|---|---|
| `vitest` without real fixtures | **97 passed, 9 skipped** (skipped = real-file tests, not counted as passed) |
| `vitest` with `A2T_FIXTURES` (BF/GF patched XFL, Boyfriend_But_Better, app-made samples) | **106 / 106 passed** |
| `npm run build` (tsc + vite) | OK |
| Icon check | OK |
| Validator on BF / GF / Boyfriend_But_Better | PASS |

**Byte-level regression** (5 inputs, B2 commit vs. B3, same converter CLI):

| Input | B2 | B3.1 | B3.2 | B3.3 |
|---|---|---|---|---|
| Boyfriend_But_Better.fla | `dca54e90d49b` | same | same | `aabaeeda4955` (only `retry confirm` blur rows) |
| BF (patched JPEXS) | `7e966227da43` | same | same | `c9977cc25345` (only `retry confirm` blur rows) |
| GF (patched JPEXS) | `0586469beebb` | same | same | same |
| BF (upstream JPEXS) | `e1a5fe72322c` | same | same | `61dd5245be7b` |
| GF (upstream JPEXS) | `662107539de1` | same | same | same |

None of the real files has hidden layers, guide layers, reverse loops or `lastFrame`, so B3.1 and B3.2 are exercised only by synthetic fixtures.

## 7. Limitations

- **No device check.** `Vi:false` was observed but its effect in the app is unconfirmed. Reverse playback depends on Time semantics (Q7) and blur values on the radius scale.
- **Reverse order follows Adobe's documentation.** No Animate render was compared. The documentation is ambiguous about how "first frame" combines with the reverse modes.
- **Colour/filter interpolation is linear per value**, with the tween ease. Animate's exact interpolation (for example of drop-shadow angle, or colours in premultiplied form) was not compared.
- Tint and advanced colour effects are still not shown at all (R-08 / F7).
- Instance-level `isVisible="false"` is still shown (no evidence for a symbol-layer visibility key).
- Motion-guide paths are kept as hidden art, but guided tweens still move straight.
- Native tweens (`K` tracks with easing) are not written. Their easing encoding is not decoded (Q10).

## 8. To check in ToonSquid

The sample `B3_device_check.tsproj` is a synthetic file that is not part of the repo. It has:
- a hidden magenta full-screen layer,
- a guide layer,
- a forward and a reverse 1–6 counter at 12 fps,
- a blurred ball tween.

Check:
1. The magenta layer and `[Guide] guide path` are listed but switched off, and the canvas is white. Switching them on shows them.
2. Top counter: 1 → 6 squares. Second counter: 6 → 1 squares, looping.
3. The ball gets blurrier frame by frame, not only at the last frame.
4. The file opens without errors.

Device questions Q6, Q7, Q8 and Q10 in `TOONSQUID_DEVICE_TEST_PLAN.md` remain open.
