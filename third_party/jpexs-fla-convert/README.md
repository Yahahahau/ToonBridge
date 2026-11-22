# JPEXS FLA Convert — ToonBridge patch (LGPL-2.1)

ToonBridge can't read binary (Flash 5 – CS4) FLA files in the browser yet. Users convert them to XFL first with **JPEXS FLA Convert**, then import the zipped XFL. This folder holds one small fix to that tool, published as source.

| | |
|---|---|
| Upstream | https://github.com/jindrapetrik/jpexs-fla-convert |
| Pinned upstream commit | `6d4a715ef8c4fe06675a186b9dcc286b9c841c04` ("chore: add fla format history file") |
| Upstream copyright | Copyright (C) 2026 JPEXS |
| Upstream licence | GNU Lesser General Public License 2.1 or later: [LICENSE-LGPL-2.1.md](LICENSE-LGPL-2.1.md) (copied unchanged from upstream) |
| Our change | [0001-zero-length-frames-keep-timing.patch](0001-zero-length-frames-keep-timing.patch), the complete source change, against the commit above |
| Changed file | `src/com/jpexs/flash/fla/exporter/BinaryFlaToXflExporter.java` (one file) |

## What the patch changes

Upstream JPEXS widens every zero-length frame of a binary FLA to one frame when exporting XFL. Frame starts are the sum of the earlier durations, so every later keyframe on that layer moves one frame later.

The patch changes this:
- **Empty** zero-length frames are omitted. They take no time, so later keyframes keep their start. "Empty" means no art, children, script, label, sound, tween or morph.
- **Zero-length frames that hold anything** keep the old behaviour (one frame), so no content is lost. The timing change is reported (`outcome=modified`).
- **An empty zero-length frame that is the only timed frame of its layer** also keeps the old behaviour.
- **IK pose and motion-object layers** also keep the old behaviour.
- **Reports:** `FRAME_DURATION` names the timeline, layer, frame and outcome. `UNLINKED_PAGE` gives a summary (layers, keyframes, frames, objects).

Nothing else in JPEXS is changed. The modified file carries a dated notice of the change in its header comment, as LGPL-2.1 §2(a) requires.

## Build (source only, no binaries in this repository)

```sh
third_party/jpexs-fla-convert/build.sh /tmp/jpexs-tb
java -cp /tmp/jpexs-tb/classes com.jpexs.flash.fla.Main convert --format CS6 --container xfl old.fla out.xfl
```

`build.sh` does the following:
1. Clones upstream.
2. Checks out the pinned commit.
3. Verifies and applies the patch.
4. Compiles it with `javac` (JPEXS targets Java 8; the regression test needs Java 11+; no other dependencies).

Zip the `out.xfl` folder **including `conversion-report.txt`** and import it. ToonBridge shows that report in its own report, in a separate "From the legacy FLA converter (JPEXS)" section.

Regression test (ToonBridge code; it only uses JPEXS at run time):

```sh
javac -cp /tmp/jpexs-tb/classes -d /tmp/zt third_party/jpexs-fla-convert/test/ZeroDurationFramesTest.java
java  -cp /tmp/jpexs-tb/classes:/tmp/zt ZeroDurationFramesTest [dir to write the fixture .fla / .xfl.zip files]
```

## LGPL-2.1 obligations

This is a summary for this project, not legal advice.

**What this repository distributes:**
- the patch (source),
- the licence text,
- a build script,
- small test programs that *use* JPEXS (LGPL §5 "work that uses the Library").

**What it does not distribute:**
- no JPEXS binary or class file;
- the ToonBridge web app does not contain, load or link JPEXS. The user runs JPEXS separately on their own computer.

**Anyone who distributes a patched JPEXS build** (a jar, an installer, or bundled with something else) must:
1. **Licence:** ship it under LGPL-2.1, with the licence text and all upstream copyright notices kept intact (§1, §2).
2. **Change notice:** keep the notice of the change in the modified file (§2(a)).
3. **Source:** give recipients the complete corresponding source, or a written offer for it (§4, or §6 if combined with other code). That source is the upstream source at the pinned commit plus this patch.
4. **Combined works:** if they combine it with their own code, allow modification and reverse engineering for debugging the modified library, and let users relink or replace JPEXS (§6). Keeping JPEXS a separate, replaceable program, as here, is the simplest way.
5. **Approval:** not ship such a build from ToonBridge until a maintainer has reviewed these points.

The fix should also be offered upstream. **Not done yet.**
