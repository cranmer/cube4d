#!/usr/bin/env bash
# Build and launch the original Java MagicCube4D, for comparing the port against the real thing.
#
# Compiles out-of-tree into build/mc4d-java so the submodule stays exactly as checked out --
# it is a read-only reference, and a stray .class file in it would show up as a dirty submodule.
#
# The .wav and .png files next to the legacy sources are loaded as classpath resources, so they
# have to be copied alongside the classes or the app starts without sound or icons.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LEGACY="$ROOT/magiccube4d/src"
OUT="$ROOT/build/mc4d-java"

if [[ ! -d "$LEGACY" ]]; then
  echo "error: $LEGACY missing. Run: git submodule update --init" >&2
  exit 1
fi

# Rebuild only when a source file is newer than the last build, so repeat launches are instant.
if [[ ! -f "$OUT/com/superliminal/magiccube4d/MC4DSwing.class" ]] ||
   [[ -n "$(find "$LEGACY" -name '*.java' -newer "$OUT/com/superliminal/magiccube4d/MC4DSwing.class" -print -quit)" ]]; then
  echo "building..."
  mkdir -p "$OUT"
  # -nowarn: the legacy source predates generics and trips thousands of raw-type warnings.
  javac -nowarn -d "$OUT" -sourcepath "$LEGACY" "$LEGACY/com/superliminal/magiccube4d/MC4DSwing.java"
  find "$LEGACY" -maxdepth 1 -type f -not -name '*.java' -exec cp {} "$OUT/" \;
fi

exec java -cp "$OUT" com.superliminal.magiccube4d.MC4DSwing "$@"
