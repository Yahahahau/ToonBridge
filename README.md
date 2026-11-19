<p align="center">
  <img src="public/icon-192.png" width="120" alt="ToonBridge mascot">
</p>

<h1 align="center">ToonBridge</h1>

<p align="center">
  Turn Adobe Animate (XFL) projects into ToonSquid <code>.tsproj</code> files — right in your browser.<br>
  <b>Repository:</b> <a href="https://github.com/Yahahahau/ToonBridge">github.com/Yahahahau/ToonBridge</a>
</p>

> **ภาษาไทย (สรุป):** ToonBridge คือเว็บแอปแปลงโปรเจกต์ **Adobe Animate / Flash (XFL)** เป็นโปรเจกต์ **ToonSquid (`.tsproj`)** ประมวลผลทั้งหมดในเบราว์เซอร์ ไม่อัปโหลดไฟล์ไปที่ใด
> วางไฟล์ → ตรวจข้อมูลโปรเจกต์ → กด Convert → ดาวน์โหลด `.tsproj` พร้อมรายงานสิ่งที่สูญเสีย/ประมาณค่า
> **สถานะ: ทดลอง (V1)** — ไฟล์ผลลัพธ์ผ่านการตรวจโครงสร้างแล้ว แต่ **ยังไม่เคยยืนยันว่าเปิดในแอป ToonSquid ได้จริง** ดูหัวข้อ [Reliability](#reliability) ด้านล่าง

## What is it?

If you animate in Adobe Animate (formerly Flash) and want to continue in ToonSquid, you'd normally redraw everything. ToonBridge reads your Animate project, understands its drawings, symbols, keyframes and motion tweens, and writes a ToonSquid project file you can open and keep working on.

- **Private by design.** Everything runs in your browser. Your project is never uploaded.
- **Honest.** Nothing is dropped silently. Every conversion ends with a report listing what was converted, what was approximated, and what couldn't be converted.
- **Checked before you download.** The output is read back and validated (ZIP, SQLite schema, references, frame ranges…). If the check fails, the download is blocked.
- **Repeatable.** The same input always produces byte-identical output.

## How to use it

1. Open the app and **drop** your project onto the import area (or click to browse).
   Supported: a **ZIP of an XFL project**, or a **ZIP-based `.fla`** (tested with a project saved from Animate 22).
2. Check the project summary (canvas, frame rate, scenes, symbols, keyframes, tweens).
3. Choose how skewed parts should be handled, then press **Convert**.
4. **Download** the `.tsproj`, open it in ToonSquid, and read the **conversion report**.

Older binary `.fla` files aren't supported yet. In Animate, use *File ▸ Save As ▸ Animate Uncompressed Document (.xfl)* and zip the folder.

## Reliability

ToonSquid's file format isn't publicly documented, so everything here is derived from real files made by the app. The status of each part is stated plainly:

| Status | What |
| --- | --- |
| **Structure-verified** (matches app-made files and is re-checked by the validator) | ZIP/SQLite structure and schemas, vector node layout, frame ranges, layer/drawing/clip references |
| **Experimental** (inferred, not yet confirmed inside ToonSquid) | Clip-instance transforms, motion-tween easing, z-order, stroke `jS/cS`, symbol playback (frames are snapshotted instead), **skew via the Perspective effect**, and — most importantly — **opening a generated file in the app** |
| **Not converted** (always reported) | Blend modes on instances, masks, gradient/bitmap fills, text, filters, audio/video, shape tweens, colour effects other than alpha, binary FLA |

**Skew.** ToonSquid has no skew in its transform, so skewed instances are converted with its *Perspective* effect (layer type 121 + corner offsets), whose layout was decoded from an app-made sample. Rendering the written file back matches Animate's own matrices (mean error ≈ 7×10⁻⁵, versus 1.8×10⁻² when skew is ignored), but that only proves the encode/decode maths agree — **not** that ToonSquid interprets the effect the same way. Two safer alternatives are available in the UI: *Bake into paths* (exact, larger file) and *Ignore skew*.

Other limits: conversion runs on the main thread (big projects freeze the page briefly), and output can be large because animated symbols are baked into per-frame snapshots.

## Run it locally

```bash
npm ci
npm run dev          # dev server
npm test             # unit tests + synthetic end-to-end conversion
npm run build        # typecheck + production build -> dist/
npm run check:icons  # validate icons, manifest and every URL in dist/ (also under a sub-path)
```

Tests against real files (not committed — they're third-party artwork):

```bash
A2T_FIXTURES=/path/to/folder npm test     # see tests/fixtures/README.md
npx tsx scripts/convert-cli.ts in.fla out.tsproj          # convert from the command line
npx tsx scripts/render-preview.ts out.tsproj 1 f1.svg     # render a frame back from a written file
npx tsx scripts/compare-skew.ts in.fla outDir             # Animate reference vs. ignore / Perspective / bake
```

## Deploy

- **GitHub Pages:** `.github/workflows/pages.yml` runs tests, builds, checks the icons and publishes `dist/`. Enable it once under *Settings ▸ Pages ▸ Source: GitHub Actions*.
- **Netlify:** `netlify.toml` is ready (`npm run build`, publish `dist`, cache headers for icons and the manifest).
- The build uses relative paths (`base: './'`), so it works at a domain root or under a sub-path such as `/ToonBridge/`. There are no API keys or secrets.
- Icons and the manifest get a `?v=<hash>` suffix at build time, so a redeploy is picked up even by browsers (and GitHub Pages' cache) that hold on to favicons. There is no service worker, so nothing can serve a stale app shell.

## Icons & install-to-home-screen

Icons are generated from the approved mascot artwork in `brand/` by `scripts/make-icons.py` (`npm run icons`), and checked by `scripts/check-icons.mjs`:

| File | Size | Used for |
| --- | --- | --- |
| `favicon.svg`, `favicon.ico` (16/32/48), `favicon-16x16.png`, `favicon-32x32.png` | — | Browser tabs, bookmarks |
| `apple-touch-icon.png` (180), `-167`, `-152` | opaque | iPhone / iPad Home Screen |
| `icon-192.png`, `icon-512.png` | solid background | Android / PWA (`any`) |
| `icon-maskable-512.png` | safe-zone artwork | Android adaptive icons (`maskable`) |
| `icon-master.png` | 1024×1024 | Source for the above |

Automated checks cover file sizes, PNG/ICO/SVG validity, manifest JSON, and that every referenced URL returns 200 at both `/` and `/ToonBridge/`. **Not yet tested on real devices:** Safari on iPhone/iPad, Android Home Screen install, and PWA install prompts.

## Mascot (prepared, not active)

The UI has a reserved spot for an animated mascot driven by a **spritesheet + Sparrow/Starling XML** (`src/mascot/`). It draws nothing until you add assets to `public/mascot/` and set `MASCOT_SOURCE` in `src/mascot/config.ts`; it never invents animation names or triggers. Rotated atlas frames are not supported yet and are reported as an error rather than guessed.

## Architecture

```
src/engine/            No React — runs in the browser and in Node
  zip/reader.ts        Tolerant ZIP reader (central directory, else local-header scan; ZIP64)
  zip/writer.ts        Stored ZIP64, like the app writes (deterministic)
  xfl/edges.ts         R1/R2  twips, quad→cubic, `cubics` attribute
  xfl/parse.ts         XFL → IR (ir.ts)
  geometry/            R3 contours per fill style, bounds, perspective (skew) maths
  resolver/resolver.ts R4–R8  frame ranges, instance transforms, symbol snapshots, tween baking, skew
  tsproj/writer.ts     IR → SQLite (sql.js/WASM) + ZIP
  tsproj/validator.ts  9 checks, reading the output back from its bytes
  report.ts            What is verified / experimental / unsupported
src/ui/, src/App.tsx   Interface (React)   ·   src/mascot/   Spritesheet mascot component
```

**Rules (short).** R1 `#HEX.FF`/twips ÷ 20 → px · R2 use `cubics` if present, else quad→cubic (2/3) · R3 one contour set per fill style · R4 `s = index+1`, `e = index+duration` · R5 `pv = transformationPoint`, `p = M·tp`, `rot = atan2(b,a)`, `sx = √(a²+b²)`, `sy = det/sx` · R6 graphic loop / play once / single frame → pick the symbol frame · R7 deterministic output (UUIDv5 ids, fixed ordering and dates, 4-decimal rounding, stored ZIP) · R8 skew `h = (a·c+b·d)/(a²+b²)`, `M = R·S·[[1,h],[0,1]]`, pivot `pv = A·tp`, Perspective corners `c = (h·y)/width`.

## Credits

ToonBridge is an independent, unofficial tool. ToonSquid and Adobe Animate belong to their respective owners.
