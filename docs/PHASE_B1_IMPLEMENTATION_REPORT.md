# Phase B1 — Locatable Diagnostics & Zero-Silent-Loss Reporting

Date: 2026-11-22 · Branch `fix/locatable-diagnostics` (from `audit/conversion-fidelity` @ `b3157d8`) · Scope: audit items **F2** and **F3** only.

**Not done here** (per the brief): F1 (JPEXS patch), F4 (reverse loops, tween fixes), F5 (layer visibility), gradients, masks, text, audio.

## 1. Result

- **Diagnostics now carry source locations:**
  - scene or symbol, layer name and position, frame range, element, and the source attribute or element.
  - Each location is counted once, so counts are affected items, not frames.
- **All 18 previously silent loss categories** from `LOSS_CATALOG.md` are now reported with a location (table in section 3).
- **`TWEEN_UNPAIRED` is corrected.** On `Boyfriend_But_Better`:

  | Diagnostic | Before | After |
  |---|---|---|
  | `TWEEN_UNPAIRED` | ×171 | ×0 |
  | `TWEEN_BAKED` | ×93 (frames) | ×15 (tweens) |
  | `TWEEN_SYMBOL_SWAP` | ×16 | ×6 |

  The 11 tweens on a layer's last keyframe (Animate holds them too) are no longer reported.
- **Conversion output is byte-identical** to before on all three real files. sha1 values match `b3157d8`:
  - `Boyfriend_But_Better` `dca54e90…`
  - `BF` (JPEXS) `e1a5fe72…`
  - `GF` (JPEXS) `66210753…`

  A test now guards the first one.

## 2. Files changed

| File | Change |
|---|---|
| `src/engine/diagnostics.ts` | New model: `DiagLocation`, severities `loss / unsupported / approx / warn / info` with levels `error / warning / info`, location de-duplication, display limit (`LOCATION_LIMIT = 25`) with an exact `count` and `hiddenLocations`, `formatLocation()` |
| `src/engine/ir.ts` | Source metadata kept for later phases, not converted: frame `label`, `sound`, `hasScript`, `zeroDuration`; layer `index`, `locked`, `outline`, `parentIndex`, `animationType`; instance `loopSource`, `lastFrame`, `hidden`, `has3D`, `hasScript`; tween `scale`, `orientToPath`, `snap`; stroke `meta` (caps, joints, miter, scale mode, hairline); shape `group` id |
| `src/engine/xfl/parse.ts` | Every parser diagnostic gets a location; detection of all F3 items; media items listed by name; bitmap and unknown fills reported where they occur |
| `src/engine/resolver/resolver.ts` | Layer → source owner map; every resolver diagnostic gets a location. New tween semantics: no report for last-keyframe tweens; `TWEEN_SYMBOL_SWAP`, `TWEEN_UNPAIRED` (group tweens) and `TWEEN_BROKEN_SOURCE` (info) told apart. New: `GRAPHIC_LAST_FRAME`, `TS_LOOP_MODE`, `TWEEN_SCALE_FLAG`, `TWEEN_ORIENT_NO_GUIDE`, `TWEEN_COLOR_FILTER`. Duplicate `FILL_UNSUPPORTED` / `STROKE_UNSUPPORTED` removed (the parser reports them at the element) |
| `src/engine/convert.ts` | `OUTPUT_NO_THUMBNAILS` |
| `src/engine/report.ts`, `index.ts` | Text report: totals per severity, locations under each item, "… N more" line; `diagSummary()` |
| `src/pages/ReportView.tsx`, `ConvertPage.tsx`, `styles.css` | Report UI (section 5) |
| `tests/diagnostics.test.ts` (new), `tests/realfiles.test.ts` | Tests (section 6) |

## 3. The 18 silent categories → how they are now accounted for

All are **reported, not converted.** Conversion behaviour is unchanged.

| Audit ID | Source information | Diagnostic(s) | Severity |
|---|---|---|---|
| P-04 | Stroke caps, joins, scale mode, hairline | `STROKE_CAPS_JOINS`, `STROKE_SCALE_MODE`, `STROKE_HAIRLINE` | approx |
| P-08 | Flattened groups | `GROUP_FLATTENED`; tweened group → `TWEEN_UNPAIRED` | approx |
| P-09 | Zero-duration frames | `FRAME_ZERO_DURATION` | warn |
| P-10 | Frame labels, comments, anchors | `FRAME_LABEL` | unsupported |
| P-11 | Frame sounds + sync / loop | `FRAME_SOUND` (sync and loop in the location) | loss |
| P-12 | ActionScript (frame and instance) | `SCRIPT_IGNORED`. **Presence only:** never parsed, evaluated or copied | unsupported |
| P-13 | Locked / outline layers | `LAYER_LOCKED`, `LAYER_OUTLINE` | unsupported |
| P-14 | `parentLayerIndex` | `LAYER_MASKED`, `LAYER_MOTION_GUIDE`, `LAYER_IN_FOLDER`, `LAYER_PARENT_MISSING` | loss / loss / info / warn |
| P-15 | Reverse loop modes | `LOOP_REVERSE` (+ `LOOP_UNKNOWN` for any other unknown value) | approx |
| P-16 | Graphic `lastFrame` | `GRAPHIC_LAST_FRAME` (only when it actually cuts the loop short) | approx |
| P-17 | `motionTweenScale` / `OrientToPath` / `Snap` | `TWEEN_SCALE_FLAG` (scale off but scale changes); `TWEEN_ORIENT_NO_GUIDE` (info, no effect without a guide); with a guide, the layer gets `LAYER_MOTION_GUIDE` | approx / info / loss |
| P-18 | Hidden instances | `INSTANCE_HIDDEN` | loss |
| P-19 | 3D transforms | `TRANSFORM_3D` (`<matrix3D>`, `rotationX`, `rotationY`, `z`) | loss |
| P-22 | IK / armature | `IK_ARMATURE`; object-based motion layers → `XFL_MOTION_OBJECT_LAYER` | loss |
| R-07 | Colour / filter tween limits | `TWEEN_COLOR_FILTER` | approx |
| W-01 | Loop mode not written to TSProj | `TS_LOOP_MODE` | unsupported |
| W-02 | Thumbnails not written | `OUTPUT_NO_THUMBNAILS` | info |
| W-03 | Lock / visibility flags not written | `LAYER_LOCKED` (lock); hidden layers keep `LAYER_HIDDEN` (now located) | unsupported / loss |

Also fixed from the catalog:
- **Rep-01:** diagnostics had no location.
- **L-03:** tween over-counting.
- **P-21:** media items are now listed by name.

## 4. Before / after examples

**Boyfriend_But_Better, text report — before:**

```
[loss] XFL_MEDIA ×2: 2 media library item(s) (bitmaps/sounds/video) are not converted
[approx] TWEEN_BAKED ×93: Motion tweens are baked per frame; …
[approx] TWEEN_SYMBOL_SWAP ×16: Motion tween between two different symbols: held at the start keyframe
[approx] TWEEN_UNPAIRED ×171: Motion tween without a single instance at both keyframes: held at the start keyframe
```

**After:**

```
Diagnostics: 1 lost (2 places), 2 unsupported (39), 8 approximated (82), 0 warnings (0), 12 info
[loss] XFL_MEDIA ×2: Media library item (bitmap / sound / video) is not converted
    at "DOMDocument.xml" · <DOMBitmapItem name="Bitmap 1">
    at "DOMDocument.xml" · <DOMBitmapItem name="Bitmap 2">
[unsupported] LAYER_LOCKED ×29: Layer lock is not written (ToonSquid lock flag not decoded yet)
    at Symbol "BF hit" › layer "Layer 3" (#2) · locked="true"
    …
    … and 4 more location(s) not listed
[unsupported] TS_LOOP_MODE ×10: Loop mode is not written as a ToonSquid loop setting; the correct frames are baked into the drawings instead
    at Scene "Scene 1" › layer "BF dies Layer" (#1) · frames 1–26 · element 1 · loop="play once"
[approx] TWEEN_BAKED ×15: Classic tween baked frame by frame; the easing model … is not yet compared with Animate
[approx] TWEEN_SYMBOL_SWAP ×6: Classic tween between two different symbols: held at the start keyframe (no interpolation)
[approx] TWEEN_COLOR_FILTER ×2: Colour effect / filter change in a tween is not interpolated: …
```

`LAYER_LOCKED`, `TS_LOOP_MODE` and `TWEEN_COLOR_FILTER` did not exist before: those were silent.

## 5. Report UI

The existing ToonBridge style is kept: Box, Label, rows, facts grid and the existing colours.

- **Summary:** distinct items and affected places for Lost, Unsupported, Approximated, Warnings and Info.
- **Needs attention:** every non-info diagnostic. Each row shows:
  - the severity label,
  - the code (monospace),
  - the explanation,
  - the affected count,
  - a collapsible **Where** list: Symbol/Scene › Layer (#n) · Frames · Element · source.
- **When the list is capped:** "…and N more not listed (the count above is complete)".
- **How things were converted:** info items, kept separate so they do not hide real problems.
- **Overview tab:** the Unsupported count appears separately.
- **Checked:** server-rendered with real data and screenshotted in headless Chrome at 1100 px and 390 px. A narrow-screen fix was added: the message moves under the label. It has **not** been checked in the live app on an iPad.

## 6. Tests

**New `tests/diagnostics.test.ts`:** 14 tests, each on a small hand-written XFL fixture.

- **Model:**
  - a location raised many times counts once;
  - the display cap keeps the true count;
  - severity → level mapping.
- **F3 detection, location, frame range, count:**
  - label, sound and script. The script sets a global flag if run; the flag stays unset, and the script text is not in the report.
  - lock, outline, mask, guide and folder hierarchy;
  - reverse loop, `lastFrame`, hidden, 3D, instance script, loop mode;
  - groups, zero-duration frames, stroke caps/joins/scale mode;
  - IK pose layer;
  - thumbnails.
- **F2 semantics:**
  - a 10-frame tween counts 1;
  - a tween on the last keyframe gives no report;
  - scale flag and colour-change detection;
  - symbol swap vs group tween vs broken source tween, told apart;
  - held frames give no tween diagnostics (no false positive).
- **Integrity:**
  - no duplicate diagnostics or locations;
  - reports and output bytes are deterministic.

**`tests/realfiles.test.ts`, one new test:**
- `Boyfriend_But_Better` output sha1 unchanged.
- `TWEEN_BAKED` = 15, `TWEEN_SYMBOL_SWAP` = 6, `TWEEN_UNPAIRED` = 0.

**Runs on 2026-11-22:**

| Run | Files | Tests |
|---|---|---|
| Without external fixtures | 8 passed, **1 skipped** | 55 passed, **4 skipped** (`realfiles.test.ts`: not run, not counted as passed) |
| With `A2T_FIXTURES` (real BF / GF / Boyfriend files) | 9 passed | 61 passed |
| `npm run build` | — | OK |
| `npm run check:icons` | — | OK |

The 3 real-file outputs were also compared byte-for-byte with the pre-B1 outputs: identical.

## 7. Remaining unimplemented items

- **F1:** JPEXS zero-length-frame shift. JPEXS's own report items (`FRAME_DURATION`, `UNLINKED_PAGE`) are still not imported into the ToonBridge report.
- **F4 / F5 and every conversion change:** reverse loops, `lastFrame`, tween scale flag, colour/filter interpolation, hidden/guide layers kept hidden, gradients, masks, text, audio, labels → markers, groups → group layers. All are **reported only**.
- **App history:** the list in `App.tsx` still stores lost / approx / warning counts only, not unsupported.

## 8. Known limitations

- **Resolver diagnostics only appear for frames that are actually shown.** A symbol frame never displayed anywhere gets no resolver diagnostic. Parser diagnostics cover every frame.
- **Vector shape results are cached.** `SEAM_*`, `FILL_MISSING` and `STROKE_MISSING` give the location of the first use of a shape only.
- **Some messages contain values** (blur sizes, blend mode names, filter lists), so they split into several items. Each still has its locations.
- **"Element" is the top-level element of the keyframe.** Shapes inside a flattened group share their group's element number.
- **Group tweens are only recognised for groups made of shapes.** A tweened group that contains symbol instances is reported as `TWEEN_BROKEN_SOURCE` (info).
- **`motionTweenSnap` is not reported on its own.** It has no effect without a motion guide; with one, the layer's `LAYER_MOTION_GUIDE` covers it.
- **Layer colour (the timeline outline colour) is not reported.** It is display-only.
- **IK and 3D detection is by element and attribute name.** It is tested on fixtures only; no real IK or 3D file was available.
- **Severity calls are judgement:**
  - `TS_LOOP_MODE` is *unsupported*, although the visible frames are correct.
  - `TWEEN_BROKEN_SOURCE` is *info*, because Animate also does not interpolate it.
- **Nothing here is device-verified.**
