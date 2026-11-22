#!/usr/bin/env bash
# Builds the ToonBridge-patched JPEXS FLA Convert from upstream source (LGPL-2.1).
# Nothing is downloaded except the pinned upstream commit; no binary is committed to this repository.
# Usage: third_party/jpexs-fla-convert/build.sh <work dir>   ->  <work dir>/classes  (run with: java -cp <work dir>/classes com.jpexs.flash.fla.Main ...)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:?usage: build.sh <work dir>}"
UPSTREAM=https://github.com/jindrapetrik/jpexs-fla-convert
COMMIT=6d4a715ef8c4fe06675a186b9dcc286b9c841c04
mkdir -p "$WORK"
if [ ! -d "$WORK/src/.git" ]; then git clone --quiet "$UPSTREAM" "$WORK/src"; fi
git -C "$WORK/src" checkout --quiet --force "$COMMIT"
git -C "$WORK/src" apply --check "$HERE/0001-zero-length-frames-keep-timing.patch"
git -C "$WORK/src" apply "$HERE/0001-zero-length-frames-keep-timing.patch"
rm -rf "$WORK/classes" && mkdir -p "$WORK/classes"
find "$WORK/src/src" -name '*.java' > "$WORK/sources.txt"
javac -nowarn -encoding UTF-8 -d "$WORK/classes" @"$WORK/sources.txt"
(cd "$WORK/src/src" && find . -type f ! -name '*.java' -exec cp --parents {} "$WORK/classes" \;)
echo "Built patched JPEXS FLA Convert ($COMMIT + ToonBridge patch) in $WORK/classes"
