# Feature Compatibility Matrix

Audit date: 2026-11-22 · Code: branch `audit/conversion-fidelity` (base `8ffc8cb`) · See also [CONVERSION_FIDELITY_AUDIT.md](CONVERSION_FIDELITY_AUDIT.md), [LOSS_CATALOG.md](LOSS_CATALOG.md).

**No feature is "Fully supported and device-verified".** No ToonBridge output has yet been opened in ToonSquid with recorded results, so the best possible status today is *Structurally supported, device-unverified*.

Columns:
- **Parse:** does `xfl/parse.ts` read it?
- **IR:** is it in `ir.ts`?
- **Resolve:** does `resolver/resolver.ts` carry it through?
- **Write:** does `tsproj/writer.ts` write it?
- **Valid.:** does `tsproj/validator.ts` check it?
- **Device:** confirmed inside ToonSquid?

Cell values: ✓ yes · ~ partly · ✗ no · n/a.

The **TS format** column says what ToonSquid's file format can hold. Evidence is either *observed* (seen in the app-made samples `00_baseline.tsproj`, `Effect.tsproj` or `Perspective_revert_engineer.tsproj`), the handbook, or *unknown*.

Statuses:
- **SSDU:** Structurally supported, device-unverified
- **Partial:** Partially supported
- **Approx:** Approximated
- **Unsupported:** Unsupported
- **No source:** Source information unavailable

## Visual elements

| Feature | Parse | IR | Resolve | Write | Valid. | Device | Status | What is lost or approximated | TS format |
|---|---|---|---|---|---|---|---|---|---|
| Solid fills | ✓ | ✓ | ✓ | ✓ | ✓ (finite coords) | ✗ | SSDU | Even/odd vs non-zero rule not compared | Observed (vector layer type 1 `f`) |
| Vector shapes (edges → contours, holes) | ✓ | ✓ | ✓ | ✓ | ~ (structure only) | ✗ | SSDU | No device check for fills with holes | Observed |
| Linear gradients | ~ first colour only | ~ `fallback` | ~ | solid colour | ✗ | ✗ | Approx | All stops but the first, the gradient matrix and the spread mode | **Observed:** path layer (type 3) `fC.g` with `s`, `e` points, `t:0`, colour stops `{c,l}` |
| Radial gradients | ~ first colour only | ~ | ~ | solid colour | ✗ | ✗ | Approx | Same as linear, plus the focal point | Handbook: path layers support radial; field values (`t:1`?) **unknown** |
| Bitmap fills | ✗ (`unsupported`, no fallback) | ~ | dropped (`FILL_UNSUPPORTED`) | ✗ | ✗ | ✗ | Unsupported | Whole fill region missing | No bitmap fill type observed; pixel layers use proprietary `DVTX` textures |
| Strokes (solid) | ✓ colour, weight | ✓ | ✓ | ✓ (`sW`, `jS:1`, `cS:1` fixed) | ✗ | ✗ | Partial | Caps, joins, miter limit, scale mode, hinting ignored without a report | Path layers have caps/joins/alignment (`cS`, `jS`, `sA` observed; value meaning unknown) |
| Stroke styles (dashed, dotted, ragged, stipple, hatched, variable width) | ~ | ✗ | solid | solid | ✗ | ✗ | Approx (reported) | Pattern and width profile | Dashes not supported (handbook) |
| Gradient strokes | ~ first colour | ~ | ~ | solid | ✗ | ✗ | Approx | Gradient | Path layer stroke can be a gradient (handbook) |
| Text (static, dynamic, input, TLF) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (reported `XFL_TEXT`) | All text | **Observed:** text layer type 2 `t`, `fN` (font), `fS` (size), `tf`, `op`. Handbook: solid colour, stroke, L/C/R alignment, line and letter spacing. Colour/alignment JSON keys **unknown** |
| Embedded images (bitmap instances) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (reported `XFL_BITMAP`) | Image | Pixel layer type 0 + `res_shared_textures` + `Textures/<id>` in `DVTX…bv41` (Apple LZ4) format: **observed, not decoded** |
| Groups (DOMGroup) | ✓ | flattened | ✓ | as shapes | ✗ | ✗ | Approx | Visual kept; the group as an editable unit is lost (not reported) | Group layers exist (handbook); JSON **unknown** |
| Drawing objects | ✓ (as shapes) | ✓ | ✓ | ✓ | ✗ | ✗ | SSDU | — | — |
| Rectangle/Oval primitives | ✗ (twin `DOMShape` read when present) | — | — | — | ✗ | ✗ | Partial (reported) | Primitive parameters (corner radius etc.) | — |

## Timeline

| Feature | Parse | IR | Resolve | Write | Valid. | Device | Status | What is lost or approximated | TS format |
|---|---|---|---|---|---|---|---|---|---|
| Layers and order | ✓ | ✓ | ✓ (reversed, bottom-first) | ✓ `lO` | ✓ | ✗ | SSDU | — | Observed |
| Hidden layers | ✓ | ✓ | **dropped** | ✗ | ✗ | ✗ | Partial (reported `LAYER_HIDDEN`) | The layer and its art are not in the file at all | **Observed:** timeline layer `Vi:false` (could be kept hidden) |
| Locked layers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (not reported) | Lock state | Lock exists (handbook); key **unknown** |
| Guide layers | ✓ | ✓ | dropped | ✗ | ✗ | ✗ | Partial (reported) | Guide art (not rendered in Animate either); **motion-guide paths** for classic tweens lost and not reported as such | — |
| Mask layers | ✓ kind | ✓ | **dropped; masked layers drawn unmasked** | ✗ | ✗ | ✗ | Unsupported (reported) | Masking: visible art changes | Handbook: alpha mask, mask layer **below** the masked layer, hide/invert. **Observed:** `MD:{cl,hM,iv,v}` on timeline and path layers (meaning inferred, unconfirmed) |
| Masked-layer link (`parentLayerIndex`) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (not reported) | Which layers a mask applies to | See mask |
| Folder layers | ✓ kind | ✓ | flattened (children kept) | ✗ | ✗ | ✗ | Approx (reported info) | Folder structure | Group layers; JSON **unknown** |
| Keyframes | ✓ | ✓ | ✓ | ✓ (drawings `s..e`) | ✓ ranges | ✗ | SSDU | — | Observed |
| Blank keyframes | ✓ | ✓ | ✓ (gap) | ✓ | ✓ | ✗ | SSDU | — | Observed |
| Held frames | ✓ | ✓ | ✓ (one drawing held) | ✓ | ✓ | ✗ | SSDU | — | Observed |
| Zero-length frames (XFL `duration="0"`) | forced to 1 | ✗ | — | — | ✗ | ✗ | Approx (not reported) | Shifts later keyframes by 1 frame (rare in XFL; common after JPEXS, see Loss Catalog L-01) | — |
| Frame labels / comments / anchors | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (not reported) | Labels | Frame markers with comment and colour exist (handbook); clip `ma:[]` in samples, structure **unknown** |
| Multiple scenes | ✓ | ✓ | ✓ (one scene clip each) | ✓ `scenes` table | ✓ | ✗ | SSDU (samples have 1 scene only) | — | `scenes(id,index)` observed |
| Scene/page references | n/a in XFL | — | — | — | — | — | No source | — | — |
| ActionScript (frame/instance) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (never executed; **not reported**) | Scripts (`stop()`, `gotoAndPlay`) change playback in Animate | No scripting in ToonSquid |

## Animation

| Feature | Parse | IR | Resolve | Write | Valid. | Device | Status | What is lost or approximated | TS format |
|---|---|---|---|---|---|---|---|---|---|
| Graphic symbols | ✓ | ✓ | ✓ native clip + Time, or snapshot | ✓ `cl`, `K ti` | ✓ refs | ✗ | SSDU | Time semantics unconfirmed on device | Observed |
| Movie clips | ✓ | ✓ | ✓ loop from first appearance, continuous across keyframes | ✓ | ✓ | ✗ | Approx (reported) | Independent timing, scripts | — |
| Button symbols | ✓ | ✓ | frame 1 only | ✓ | ✓ | ✗ | Approx (reported) | Over/Down/Hit states | — |
| Nested symbols | ✓ | ✓ | ✓ recursive, cycle-guarded | ✓ | ✓ cycles | ✗ | SSDU | — | Observed |
| Loop modes: loop / play once / single frame | ✓ | ✓ | ✓ (frame maths; `lo` not written) | ~ | ✗ | ✗ | Partial | Loop mode is not set on the symbol layer; correct frames come from drawing splits | `lo:{md,en,s,e}` observed, meanings **unknown** |
| Loop modes: loop reverse / play once reverse (Animate 2019+) | ✗ (→ `loop`) | ✗ | wrong direction | — | ✗ | ✗ | Approx (**silent**) | Plays forwards | Boomerang only (not the same) |
| First-frame offset | ✓ | ✓ | ✓ | ✓ (Time) | ✗ | ✗ | SSDU | — | — |
| Graphic `lastFrame` (Animate 2019+) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (**silent**) | Loop range end | `lo.s/e` may hold a range (**unknown**) |
| Motion (classic) tweens | ✓ | ✓ | baked per frame (one drawing per frame) | ✓ | ✗ | ✗ | Approx (reported) | Editable tween; easing model unverified | **Observed:** keyframe tracks `K` (`pos`, `sX`, `sY`, `rot`, `op`, `ti`) with easing records `tp`, `iC`, `oC`, `md` on clip and vector layers |
| Custom easing | detected only | flag | standard ease | — | ✗ | ✗ | Approx (reported) | Curve shape | Custom easing curves exist (handbook); JSON **unknown** |
| Rotation (auto / CW / CCW × n) | ✓ | ✓ | ✓ | baked | ✗ | ✗ | SSDU | — | — |
| Tween options: scale off, orient to path, snap | ✗ | ✗ | scale always tweened | — | ✗ | ✗ | Approx (**silent**) | "Scale" unchecked still scales | — |
| Colour-effect / filter tweens | start key only (alpha lerped) | ✓ | alpha only | ✓ alpha | ✗ | ✗ | Approx (**silent**) | Tint/brightness/filter fades jump | `op` track observed |
| Motion tweens (object-based, "motion object") | ✗ | → `other` | held | — | ✗ | ✗ | Unsupported (reported) | Whole tween | — |
| Shape tweens | ✓ kind | ✓ | held at start (reported) | — | ✗ | ✗ | Unsupported | All in-betweens | No morph structure observed |
| Symbol replacement (swap between keyframes) | ✓ | ✓ | ✓ new drawing; tween between two symbols held | ✓ | ✗ | ✗ | SSDU | — | — |
| Animated symbol timing | ✓ | ✓ | ✓ play runs | ✓ | ✗ | ✗ | SSDU | Pixel-identical to snapshot mode in our renderer only | — |
| IK / bones | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (**silent**) | Armature poses | — |

## Appearance

| Feature | Parse | IR | Resolve | Write | Valid. | Device | Status | What is lost or approximated | TS format |
|---|---|---|---|---|---|---|---|---|---|
| Position, scale, rotation, pivot | ✓ | ✓ | ✓ decompose | ✓ `tf` | ✗ | ✗ | SSDU | Rotation sign confirmed on shape layers only | Observed |
| Skew | ✓ | ✓ | baked into paths (default) / Perspective / off | ✓ | ~ (effect fields) | ✗ | Approx (exact geometry; extra clip copies) | Editability of the skew | Perspective type 121 observed |
| Alpha | ✓ | ✓ | ✓ | ✓ `op` | ✗ | ✗ | SSDU | — | Observed |
| Brightness | ✓ | ✓ | → Adjustments | ✓ | ✗ | ✗ | Approx (reported) | Curve differs | Type 104 observed |
| Tint | ✓ | ✓ | dropped | ✗ | ✗ | ✗ | Unsupported (reported) | Colour | No tint effect observed |
| Advanced colour (RGBA × + offset) | ✓ | ✓ | dropped | ✗ | ✗ | ✗ | Unsupported (reported) | Colour | — |
| Blend modes | ✓ | ✓ | ✓ by name; Invert/Alpha/Erase lost | ✓ `bM` | ✗ | ✗ | SSDU / Partial | Invert, Alpha, Erase | `bM` 0–26 decoded |
| Blur | ✓ | ✓ | ✓ one radius | ✓ type 100 | ✗ | ✗ | Approx | X/Y separate, quality; radius scale uncalibrated | Observed |
| Drop shadow | ✓ | ✓ | ✓; inner lost | ✓ type 101 | ✗ | ✗ | Approx | Inner, knockout, alpha/strength | Observed (no alpha in colour) |
| Glow | ✓ | ✓ | → zero-offset drop shadow; inner lost | ✓ | ✗ | ✗ | Approx | Inner, knockout | — |
| Bevel, gradient glow, gradient bevel | ✓ name | ✓ | dropped | ✗ | ✗ | ✗ | Unsupported (reported) | Filter | — |
| Adjust Color | ✓ | ✓ | ✓ | ✓ type 104 | ✗ | ✗ | Approx | Response curves not compared | Observed |
| 3D rotation / position (movie clips) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (**silent**) | 3D transform | — |
| Instance `isVisible="false"` | ✗ | ✗ | shown | — | ✗ | ✗ | Approx (**silent**) | Instance should be hidden | `Vi` observed on layers |

## Media

| Feature | Parse | IR | Resolve | Write | Valid. | Device | Status | What is lost or approximated | TS format |
|---|---|---|---|---|---|---|---|---|---|
| Audio | counted only (`XFL_MEDIA`) | ✗ | ✗ | ✗ | ~ (asset checks) | ✗ | Unsupported (reported as a count) | Sound | **Observed:** `res_audio_clips(id,'wav')`, `Audio/<id>.wav` + JSON sidecar `{id,cC,sR,fT,na,du}`, audio layer type 9 `aC{fT,id}`, timeline layer `iA:true` |
| Frame sound (`soundName`, sync, loops, in/out) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (**silent**) | Where and how a sound plays | Audio clips can be trimmed and shifted (handbook); fields **unknown** |
| Video | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (reported) | Video | `res_video_clips`, `Videos/` exist; no sample |
| Embedded media references (bitmap/sound items) | count only | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported (reported as a count) | Item names are not listed | XFL keeps media in `bin/*.dat` (Animate's own format) |
| Media sync with timeline | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Unsupported | — | Audio desyncs if FPS changes (handbook) |
