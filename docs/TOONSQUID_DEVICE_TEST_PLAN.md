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

**Known before testing:** both files contain the JPEXS zero-length-frame shift (Loss Catalog L-01). Some layers start one frame late, so a missing part on frame 1 of `GF Dancing Beat`, `GF Cheer` and the BF poses is expected. Record it, but do not count it as a ToonSquid bug.

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
| 3 | Scene layers present | Compare the layer list with the source scene layer names | | | Hidden, guide and mask layers are intentionally absent today |
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

## Phase B3 checks (2026-11-27)

Sample: `B3_device_check.tsproj` (synthetic, made by ToonBridge from a hand-written XFL; not in the repo). 12 fps, 24 frames.

| # | Check | Pass when | Result |
|---|---|---|---|
| B3-1 | Layer list | `HIDDEN - should not show` and `[Guide] guide path` are listed but switched off; canvas is white | |
| B3-2 | Switch the hidden layer on | Magenta fills the canvas (art was kept) | |
| B3-3 | Forward counter (top) | 1 → 6 squares, then again from 1 | |
| B3-4 | Reverse counter (second row) | 6 → 1 squares, then again from 6 | |
| B3-5 | Blurred ball | Blur grows over the frames, not only at the last frame | |

## Result log

| Date | File | Checks passed | Failed | Notes / links |
|---|---|---|---|---|
| | | | | |
