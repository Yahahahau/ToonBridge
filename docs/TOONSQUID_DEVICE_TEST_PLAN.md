# ToonSquid Real-Device Test Plan

Purpose: record what ToonSquid actually does with ToonBridge output. Nothing in the compatibility matrix moves to "device-verified" until a row below has a recorded result.

## Setup (fill in)

| Item | Value |
|---|---|
| Tester | |
| Date | |
| Device and iPadOS version | |
| ToonSquid version (Settings → About) | |
| ToonBridge commit | `8ffc8cb` (files delivered 2026-11-22) |

Files:
- `BoyFriend_Assets.tsproj`: 45.4 MB, 109 clips, from JPEXS → XFL.
- `GF_assets.tsproj`: 1.9 MB, 31 clips.

**Known before testing (files of 2026-11-22):** both files contain the JPEXS zero-length-frame shift (Loss Catalog L-01). Files converted with the patched JPEXS (Phase B2 and later) do not. Some layers start one frame late, so a missing part on frame 1 of `GF Dancing Beat`, `GF Cheer` and the BF poses is expected. Record it, but do not count it as a ToonSquid bug.

## How to record

For each check, record:
- **Pass / Fail / Partial / Not tested**,
- a screenshot or screen recording file name,
- a one-line note.

Record playback with the iPad screen recorder at the project frame rate (24 fps).

## Checklist (repeat for each file)

| # | Check | How | Result | Evidence | Note |
|---|---|---|---|---|---|
| 1 | Opens without error | Files → Import/Open the `.tsproj` | | | Note any alert text exactly |
| 2 | Project settings | Canvas 1920×1080, 24 fps | | | |
| 3 | Scene layers present | Compare the layer list with the source scene layer names | | | Mask layers are intentionally absent. Since B3.1, hidden and guide layers are present but switched off (BF/GF have none) |
| 4 | Library | Clips have the symbol names (no `@frame` tags); count ≈ 109 / 31 | | | |
| 5 | Positions | Frame 1 vs the reference image: same place, size, rotation | | | Reference PNGs available on request |
| 6 | Symbols animate | Play the scene; animated symbols move, not stills | | | |
| 7 | **Time track** | Select a symbol layer drawing; read *Time*. Step frame by frame: does the clip show frame *Time* at the drawing's first frame, then +1 each frame? | | | Decides whether Time is 1-based and counts from the drawing start |
| 8 | **Looping** | A symbol drawing longer than its clip: does it loop (Normal)? | | | We do not write `lo`; record the mode shown in the UI |
| 9 | Held poses | A held keyframe shows a still pose for its whole length | | | |
| 10 | Colours | No missing fills, no black or white blocks, no wrong colours | | | |
| 11 | Blend modes | BF miss poses (Hard Light) look like the source, not washed out | | | |
| 12 | Effects | Blur, drop shadow and adjustments on symbol layers render and are listed in the layer's effects | | | |
| 13 | Skewed parts | Skewed limbs look right (skew is baked into the paths) | | | |
| 14 | Seams | Zoom 400 % on joins between colours and outlines: no hairline gaps | | | |
| 15 | Playback vs source | Play the whole scene; compare timing with the Animate/SWF reference video | | | |
| 16 | Editing | Select a vector layer → move a node; select a clip → enter it and edit; undo | | | |
| 17 | Save and reopen | Save, close, reopen: same result | | | |
| 18 | Performance | Scrubbing and playback smoothness; memory warnings | | | BF file is 45 MB |

## Format questions to answer at the same time

These unblock items in the audit. Each needs a small file made **in ToonSquid** and sent back unchanged.

| # | Make this in ToonSquid | Answers |
|---|---|---|
| Q1 | A path layer with a **radial** gradient fill, plus one with a gradient stroke | Radial `t` value, focal point, stroke gradient key |
| Q2 | A text layer: red colour, centre-aligned, 2 lines, stroke on | Text colour, alignment and stroke keys |
| Q3 | Two layers, the lower one used as a mask (Toggle Mask), once normal and once inverted/hidden | Meaning of `MD.cl`, `hM`, `iv`; where the mask sits |
| Q4 | A group layer containing two layers; a second group with loop mode Boomerang | Group layer type and JSON |
| Q5 | An imported PNG (small, known colours) | `DVTX` texture container layout |
| Q6 | A symbol layer with loop mode *Don't Loop*, one with *Boomerang*, one with Start/End set | `lo.md`, `lo.en`, `lo.s`, `lo.e` meanings |
| Q7 | A frame marker with a comment and colour | Marker (`ma`) structure |
| Q8 | A locked layer and a hidden layer | Lock key; confirm `Vi:false` |
| Q9 | An audio clip trimmed at the start and shifted | Audio trim/offset fields |
| Q10 | A position keyframe pair with Ease In Out (cubic) and one custom curve | Easing record `tp` / `iC` / `oC` / `md` values |

## Phase B3 device check (B3.5, 2026-11-27)

**Status: Not tested on a device.** Everything below the line "Automated" was checked by the converter, the validator, a structure test and our own preview renderer. None of it shows what ToonSquid does.

### Sample

| Item | Value |
|---|---|
| File | `B3_device_check.tsproj` (239,042 bytes, sha1 `b7331cd01a2afe90bbdbfb2e9d6dde4ce8f7eb24`) |
| Download | Private claude.ai artifact page *B3 device check* (owner's link: https://claude.ai/artifact/JXncmdxzabcup67m8tLmX8): button **Download package** saves `B3_device_check_package.zip` (`.tsproj` + reference image + README). Also attached to the chat of 2026-11-27. A GitHub Release could not be created from the session that made it (release API refused). Not committed: `*.tsproj` is gitignored; rebuild it with the script below |
| Made by | `npx tsx scripts/device/make-b3-device-check.ts out.tsproj`: a hand-written **synthetic XFL test fixture** run through the normal pipeline (parse → resolve → write → validate). The `.tsproj` is not edited by hand; rebuilding gives the same sha1 |
| Timeline | Scene `B3 device check`, 1920×1080, **12 fps, 24 frames** (2 s) |
| Library | `Counter 1-6` (6 frames: frame *n* shows *n* squares, each frame its own colour), `Ball` (one blue square) |
| Reference | `B3_device_check_expected.png`: frames 1, 2, 3, 6, 7, 12, 24 from our own renderer. It does **not** draw Gaussian Blur, so the ball looks sharp there |

Layers, top to bottom as ToonSquid should list them:

| Layer | Expected state | What is in the file |
|---|---|---|
| `HIDDEN - should not show` | switched off | full-canvas magenta square, frames 1–24, `Vi:false` |
| `[Guide] guide path` | switched off | cyan 200 px square near the bottom centre, frames 1–24, `Vi:false` |
| `forward loop 1-6` | on | **one** symbol drawing 1–24, clip `Counter 1-6`, Time 1. Looping past frame 6 is left to ToonSquid's own loop setting (not written) |
| `reverse loop 6-1` | on | 24 one-frame symbol drawings on the same clip, Time 6, 5, 4, 3, 2, 1, repeated |
| `blur tween` | on | 24 one-frame symbol drawings of `Ball`, moving right 1200 → 1500 px, each with one Gaussian Blur effect, radius 0 → 59.99, rising every frame |
| `white background` | on | white canvas-size square |

### Steps on the iPad

1. On the iPad, open the artifact page and tap **Download package**, then open the zip in Files to unzip it (or save the `.tsproj` attached in the chat). Check the sha1 if you can. Open `B3_device_check.tsproj` in ToonSquid (Files → Share → ToonSquid, or ToonSquid's import). Write down any alert text exactly.
2. Open scene `B3 device check`. Take a screenshot of the canvas and the full layer list (**B3-01, B3-02**).
3. Tap the visibility toggle of `HIDDEN - should not show`: the canvas should turn magenta. Screenshot, then toggle it back off (**B3-03**). Do the same for `[Guide] guide path`: a cyan square should appear near the bottom centre (**B3-04**).
4. Go to frame 1 and step forward one frame at a time to frame 13. On each frame write the number of squares in the top row and the second row (**B3-05, B3-06**). Expected: top 1 2 3 4 5 6 1 2 3 4 5 6 1; second 6 5 4 3 2 1 6 5 4 3 2 1 6.
5. Select the `forward loop 1-6` drawing. Screenshot the properties: clip, **Loop Mode**, **Time** (**B3-07**). Do the same for the frame-2 drawing of `reverse loop 6-1`, which should show Time 5 (**B3-08**).
6. Select the `blur tween` drawing at frames 1, 12 and 24. Screenshot its effects list and the Gaussian Blur radius each time (**B3-09**). Expected radius: 0, about 28.7, about 60.
7. Play the scene in a loop and screen-record at least 2 loops (**B3-10**). The ball should get blurrier steadily while it moves right, not jump at the end.
8. Save, close and reopen the project. Repeat step 2 (**B3-11**).
9. Fill in the table below and send back the screenshots and recording with the file names used here.

### Results

Use **Pass / Fail / Partial / Not tested**. Evidence = file name of your screenshot or recording.

| # | Check | Pass when | Result | Evidence | Note |
|---|---|---|---|---|---|
| B3-01 | Opens | Project opens without an alert; 1920×1080, 12 fps, 24 frames | Not tested | `B3-01_open.png` | |
| B3-02 | Layer list and canvas | 6 layers in the order above; hidden and guide layers listed but off; canvas white with two counters and the ball; no magenta, no cyan | Not tested | `B3-02_layers.png` | Answers Q8 (`Vi:false`) |
| B3-03 | Hidden layer art kept | Switching it on shows full magenta | Not tested | `B3-03_hidden_on.png` | |
| B3-04 | Guide layer art kept | Switching it on shows the cyan square, layer named `[Guide] guide path` | Not tested | `B3-04_guide_on.png` | |
| B3-05 | Forward counter frames 1–6 | Top row shows 1 → 6 squares | Not tested | `B3-05_forward.txt` | Answers check 7 (Time 1 = clip frame 1) |
| B3-06 | Forward counter loops | Frames 7–13 show 1 → 6 → 1 again | Not tested | `B3-05_forward.txt` | Depends on ToonSquid's default loop (check 8 / Q6); nothing written for it |
| B3-07 | Reverse counter | Second row shows 6 → 1, repeated 4 times | Not tested | `B3-06_reverse.txt` | Tests that Time picks the clip frame (check 7) |
| B3-08 | Symbol properties | Forward drawing: clip `Counter 1-6`, Time 1, record the Loop Mode shown. Reverse frame 2: Time 5 | Not tested | `B3-07_forward_props.png`, `B3-08_reverse_props.png` | Record the Loop Mode label exactly |
| B3-09 | Blur values | Effect `Gaussian Blur` listed; radius rises (0 → ~28.7 → ~60) | Not tested | `B3-09_blur_f1.png`, `_f12.png`, `_f24.png` | Radius scale vs Animate is not calibrated |
| B3-10 | Blur playback | Blur grows smoothly over the 24 frames | Not tested | `B3-10_playback.mov` | |
| B3-11 | Save and reopen | Same layers, visibility and playback after reopening | Not tested | `B3-11_reopen.png` | Shows whether ToonSquid keeps `Vi:false` |

### Automated (done, not device evidence)

- Validator: PASS (ZIP, structure, SQLite schemas, canvas/fps, layer, drawing, timeline and symbol references).
- `tests/b3-device-check.test.ts` (8 tests) re-opens the written bytes and checks: layer order and `Vi`, hidden/guide art, the forward drawing (1–24, Time 1), reverse Time sequence 6…1 ×4 on one clip, one Gaussian Blur row per blur frame with rising radius, deterministic sha1, and the diagnostics (no loss).

### Known limits of this sample

- The forward counter only loops if ToonSquid loops a symbol layer by default. ToonBridge writes no loop setting (`lo` meanings undecoded, Q6). If B3-06 fails, it says the default is not Normal; it is not a reverse-playback bug.
- The reverse order follows Adobe's documentation; there is no Animate render to compare against.
- Blur radius = 2σ of Animate's box blur (not calibrated against ToonSquid). The ball also moves, so check 9 is read at fixed frames.
- The sample has no masks, text, sound, gradients or instance-level hidden symbols. These are outside B3.

## Result log

| Date | File | Checks passed | Failed | Notes / links |
|---|---|---|---|---|
| | | | | |
