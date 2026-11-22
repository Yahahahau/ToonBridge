# Loss Catalog

Audit date: 2026-11-22 · Base commit `8ffc8cb`.

This catalog lists every place where source data is lost or changed. For each loss it gives:
- the **stage** that causes it,
- the **diagnostic code**, if there is one,
- whether the user **sees it** in the report,
- the **evidence**.

"Silent" means no diagnostic is emitted today, which breaks the rule "never silently lose user artwork or animation data".

Stages:
- **JPEXS:** binary FLA → XFL
- **P:** `xfl/parse.ts`
- **R:** `resolver/resolver.ts`
- **W:** `tsproj/writer.ts`
- **V:** `tsproj/validator.ts`
- **Rep:** `report.ts` / `diagnostics.ts`

## A. Losses found on the real sample files

These are measured, not theoretical.

### L-01 · JPEXS: zero-length first frames shift whole layers by +1 frame — **visible, high priority**

- **Stage:** JPEXS `BinaryFlaToXflExporter` (`duration <= 0 → 1`, then `start += duration`).
- **Report:** JPEXS `FRAME_DURATION` in its own `conversion-report.txt`. ToonBridge never sees it.
- **Evidence:** a JPEXS-based inspector (`scripts/audit/InspectBinaryFla.java`, run against the binary records). All 37 cases (BF 33, GF 4) are:
  - the **first** frame of a layer,
  - **empty**,
  - **not** the last frame.

  Because frame start = sum of the previous durations, every later keyframe on that layer moves 1 frame later. Other layers in the same symbol do not move.
- **Measured effect:**
  - `GF Dancing Beat`: layers 1 and 5 end at frame 30; layers 2, 3 and 4 end at 31.
  - `GF Cheer`: layers 5 and 6 end at 21; layer 4 ends at 22.

  The symbol gains one frame. On frame 1 the shifted layers show nothing, so parts of the character are missing. After that, those layers run one frame late.
- **Affected BF symbols:** boyfriend attack, BF idle shaking, BF idle dance, BF dies, BF NOTE LEFT / RIGHT and their MISS versions, BF HEY!!, BF Dead confirm, BF Dead Loop.
- **Correct reading (inferred):** a zero-duration frame takes no time, so the frames after it should keep their original start. The cross-layer lengths support this: unshifted they match exactly. Confirming it in Animate would still be best.
- **Consequence:** the `BoyFriend_Assets.tsproj` and `GF_assets.tsproj` delivered on 2026-11-22 carry this error.

### L-02 · JPEXS: 6 unlinked pages not emitted (BF)

- **Stage:** JPEXS (`UNLINKED_PAGE`: page has no scene or library descriptor).
- **Evidence:** the inspector listed each page:

| Stream | Layers | Frames | Content | Assessment |
|---|---|---|---|---|
| `S 75 1603754658` | 4 (Layer 1–4) | 15 | **13 symbol instances** (`CPicSprite`) | Real artwork. Not in the library and referenced by nothing: most likely a deleted symbol whose stream was never purged |
| `S 70 1603745370` | 1 | 5 | none | Empty |
| `S 73 1603754448` | 1 | 5 | none | Empty |
| `S 69 1603744600` | 1 | 3 | none | Empty |
| `S 62 1603488057` | 1 | 1 | none | Empty |
| `S 66 1603743837` | 1 | 1 | none | Empty |

- **Unused?** Yes. None has a library ID, so no instance and no scene can reach them. They would not appear in Animate's library.
- **Recommendation:**
  - Report all six by stream name in the ToonBridge report (not only in JPEXS's file).
  - Offer `S 75` as an optional "Recovered (unlinked)" clip, off by default.
  - Never drop them silently.

### L-03 · Motion-tween diagnostics over-report

- **Stage:** Rep/R. `TWEEN_UNPAIRED` counts **frames**, not tweens. It also fires for a tween on the **last** keyframe of a layer, where Animate holds as well.
- **Evidence:** `Boyfriend_But_Better` reports `TWEEN_UNPAIRED ×171`. Grouped by tween, there are 15 paired tweens (interpolated), 11 "no next keyframe" (Animate also holds, so this is not a loss) and 6 symbol swaps.
- **Effect:** the real losses are hidden in noise.

### L-04 · Media items in `Boyfriend_But_Better`

- **Stage:** P (`XFL_MEDIA ×2`).
- **Evidence:** `Bitmap 1` and `Bitmap 2` (`bin/M 1 …dat`, `bin/M 2 …dat`) are in the library but have no `DOMBitmapInstance` on any timeline. Nothing visible is lost.
- **Gap:** the report gives a count only, not names or a "used / unused" status.

## B. Losses in the code, by stage

Status: **R** = reported in the conversion report · **S** = silent.

| ID | Stage | What | Code | R/S | Notes |
|---|---|---|---|---|---|
| P-01 | P | Linear/radial gradient → first stop colour | `XFL_GRADIENT` | R | Path layers can hold gradients natively (`fC.g` observed) |
| P-02 | P | Bitmap fill → no fallback; region dropped later | `FILL_UNSUPPORTED` | R | Region disappears entirely |
| P-03 | P | Non-solid stroke styles → solid | `XFL_STROKE_STYLE` | R | |
| P-04 | P | Stroke caps, joins, miter, scale mode | — | **S** | Writer fixes `jS:1`, `cS:1` |
| P-05 | P | Text elements | `XFL_TEXT` | R | No names or positions listed |
| P-06 | P | Bitmap instances | `XFL_BITMAP` | R | |
| P-07 | P | Video, components, compiled clips, primitives, unknown | `XFL_VIDEO`, `XFL_COMPONENT`, `XFL_PRIMITIVE`, `XFL_UNKNOWN_ELEMENT` | R | |
| P-08 | P | `DOMGroup` flattened into parent | — | **S** | Visual OK; group lost for editing |
| P-09 | P | Frame `duration="0"` forced to 1 | — | **S** | Same timing risk as L-01 |
| P-10 | P | Frame labels (`name`, `labelType`) | — | **S** | ToonSquid has frame markers |
| P-11 | P | Frame sounds (`soundName`, sync, loop, in/out) | — | **S** | Only the media item count is reported |
| P-12 | P | Frame ActionScript | — | **S** | Must never run; should still be listed |
| P-13 | P | Layer `locked`, `outline`, colour | — | **S** | Editor state only |
| P-14 | P | Layer `parentLayerIndex` (mask and folder membership) | — | **S** | Needed for masks |
| P-15 | P | Loop modes `loop reverse` / `play once reverse` → `loop` | — | **S** | Plays the wrong direction |
| P-16 | P | Graphic `lastFrame` | — | **S** | Loop range end ignored |
| P-17 | P | Tween `motionTweenScale="false"`, orient to path, snap | — | **S** | Scale tweened anyway |
| P-18 | P | Instance `isVisible="false"` | — | **S** | Hidden instance shown |
| P-19 | P | 3D (`Matrix3D`, `rotationX/Y`) | — | **S** | Flattened to 2D matrix |
| P-20 | P | Motion object tweens (`tweenType="motion object"`) | `XFL_TWEEN_KIND` | R | Held |
| P-21 | P | Media library items | `XFL_MEDIA` | R (count) | Names not listed |
| P-22 | P | IK armature / pose layers | — | **S** | |
| R-01 | R | Hidden layers dropped from file | `LAYER_HIDDEN` | R | ToonSquid could keep them hidden (`Vi:false`) |
| R-02 | R | Guide layers dropped | `LAYER_GUIDE` | R | Motion-guide paths not mentioned |
| R-03 | R | Mask layers dropped, masked layers unmasked | `LAYER_MASK` | R | **Visible change** whenever a mask is used |
| R-04 | R | Folder layers flattened | `LAYER_FOLDER` (info) | R | |
| R-05 | R | Shape tweens held at start | `TWEEN_SHAPE` | R | |
| R-06 | R | Custom ease → standard ease | `TWEEN_CUSTOM_EASE` | R | |
| R-07 | R | Colour effects and filters not interpolated in tweens (alpha only) | — | **S** | Fades jump at the end keyframe |
| R-08 | R | Tint and advanced colour effects dropped | `FX_NO_EQUIVALENT` | R | Exactly bakeable into vector colours |
| R-09 | R | Inner shadow/glow, bevels, gradient filters | `FX_NO_EQUIVALENT` | R | |
| R-10 | R | Invert / Alpha / Erase blend | `BLEND_NO_EQUIVALENT` | R | |
| R-11 | R | Button states other than Up | `XFL_BUTTON` (P) | R | |
| R-12 | R | Movie clip independent timing and scripts | `XFL_MOVIECLIP` (P) | R | |
| R-13 | R | Classic tween baked to per-frame drawings | `TWEEN_BAKED` | R | ToonSquid `K` tracks could keep it editable |
| W-01 | W | `lo` (loop mode) never written | — | **S** | App default is used |
| W-02 | W | Thumbnails not written | — | **S** | App-made files contain `Thumbnails/*.png`; effect unknown |
| W-03 | W | Layer names only; no lock/visibility flags | — | **S** | |
| V-01 | V | Validator checks structure only | — | n/a | Effect field ranges, `K` track shape and visuals not checked |
| Rep-01 | Rep | Diagnostics are merged by code and message, with no location (symbol, layer, frame) | — | n/a | A user cannot find *where* something was lost |

## C. Investigation notes on the known losses

### Gradient fills

- ToonSquid **path layers** (layer type 3) store a gradient fill as `fC:{g:{s:[x,y], e:[x,y], t:0, v:1, g:{v:1, c:[{c:RGBA, l:0..1}, …]}}}`, as observed in `00_baseline`. The `fC` key also takes a plain colour `{c:…}`.
- The handbook says path layers support linear and radial gradients for both fill and stroke. Path layers use the even-odd rule.
- **Mapping:**
  - Each Animate gradient fill region becomes one path layer.
  - Its contours come from the existing `fillContours`.
  - Gradient start and end points come from the Animate gradient matrix: the linear axis −819.2…819.2 px, transformed by that matrix.
- **Unknown:**
  - the radial `t` value,
  - focal point,
  - spread (pad/reflect/repeat),
  - interpolation (RGB / linear RGB).

  One app-made sample with a radial gradient answers the first two.
- **Rasterising is not needed** for linear and radial pad gradients.

### Bitmap fills and images

- ToonSquid has no bitmap fill on paths, as far as the samples show.
- Images live in **pixel layers** (layer type 0, `v:4`), whose pixels sit in `Textures/<textureId>` registered in `res_shared_textures(ownerId=layerId, textureId, width, height, x, y, w, h)`.
- The texture file starts `DVTX 02 01 00 01 00 01` followed by `bv41`, which is Apple's LZ4 block format. The rest of the header is **not decoded**.
- Writing images therefore needs:
  1. the `DVTX` container decoded from a sample with a known image,
  2. decoding of Animate's `bin/*.dat` bitmaps (lossless ARGB/zlib or JPEG; fla-decoder's `lossless.py` documents the lossless layout, MIT).
- A bitmap fill becomes a pixel layer clipped by the fill shape, using a mask.
- **Do not** replace a bitmap fill with a solid colour.

### Text

- **Observed text layer (type 2):** `t` (string), `fN` (font PostScript name), `fS` (px), `tf`, `op`, `v:5`.
- **Handbook:** solid colour, stroke colour and width, alignment L/C/R, line and letter spacing, trim. Text cannot be a gradient.
- **XFL holds** text runs (`DOMTextRun`) with per-run font, size, colour and letter spacing, plus the box size, alignment and orientation.
- **Editable when:** the text has a single run and an installed font. Multi-style runs → one text layer per run, which is approximate in position.
- **Fallback:** XFL holds no glyph outlines. Outlines need the font file, which is not in the XFL. Missing fonts → keep editable text with a font-substitution note.
- The JSON keys for colour and alignment are **unknown**. Defaults are not stored, so a sample with a coloured, centred text is needed.

### Masks

- **Animate:** a mask layer sits **above**. Layers under it with `parentLayerIndex` pointing to it are masked. The mask uses shape **fill** areas: alpha 1, strokes ignored.
- **ToonSquid (handbook):** the mask layer sits **immediately below** the masked layer, uses **alpha**, can be hidden or inverted, and a group can be a mask.
- **Observed:** `MD:{cl:true, hM:false, iv:false, v:1}` on a timeline layer and on a path layer. The likely meanings are `cl` = masked by the layer below, `hM` = hide mask, `iv` = invert. This is **unconfirmed**.
- **Safe mapping:**
  1. Put the masked layers in a group.
  2. Place the mask layer just below that group, hidden (`hM`).
  3. Draw the mask shapes as opaque fills; Animate ignores mask colour and strokes.
- **Unknown:** the group-layer JSON. With one masked layer no group is needed.
- **Fallback:** bake the masked result into vectors by clipping paths, which is exact for solid fills. This is editable, but the mask stops being live.

### Shape tweens

- XFL stores only the two keyframe shapes; the in-between algorithm is not documented.
- **Editable option:** generate per-frame vector drawings when both keyframes have matching edge or contour structure (same fill count and order). Interpolate the node positions and colours. This is approximate, and must be labelled approximate.
- **Otherwise:** hold the start keyframe and switch at the end keyframe, as today, and report per tween with its location.
- No reference renderer exists for Animate shape tweens, so fidelity cannot be measured without Animate exports.

### Audio and video

- **Audio is feasible** with only observed fields:
  - write the WAV to `Audio/<id>.wav`,
  - write the JSON sidecar `Audio/<id>` `{id, cC, sR, fT, na, du, lMD, v}`,
  - add the row `res_audio_clips(id,'wav')`,
  - add an audio layer `type 9 {aC:{v:1, fT:'wav', id}}` in a drawing, on a timeline layer with `iA:true`.
- **Unknown:**
  - trim / offset fields,
  - mp3 support inside projects (the handbook says files are converted to 44.1 kHz on import),
  - how Animate's `bin/*.dat` sound data is stored in XFL. fla-decoder's `audio.py` may help for the binary FLA.
- **Sync modes:**
  - Event / Start / Stop / Stream have no ToonSquid equivalent. Map them to a timeline clip at the keyframe and report the mode.
  - Loop counts → repeated clips.
- **Video:** `res_video_clips` and `Videos/` exist; there is no sample, so it stays unsupported.

## D. Not losses, but unverified

- **Native symbol playback `Time`:** written in the observed form; the device meaning is unconfirmed.
- **Easing model** `p = t + e·t(1−t)`: not compared with Animate output.
- **Blur radius scale, drop-shadow offset sign, Adjust Color curves:** not compared on device.
- **Seam underlays:** our renderer only.
