#!/usr/bin/env bash
# Compile the exporter tools against the legacy MagicCube4D source.
#
# The generated puzzle assets are a wire format -- grip indices in them are referenced by every
# saved solve -- so the JDK is pinned. Override with JAVA_HOME if you know what you are doing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LEGACY="$ROOT/magiccube4d/src"

PINNED_JDK="21"

if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in "$HOME/Library/Java/JavaVirtualMachines"/jdk-${PINNED_JDK}*/Contents/Home \
                   /Library/Java/JavaVirtualMachines/*jdk-${PINNED_JDK}*/Contents/Home; do
    [[ -x "$candidate/bin/javac" ]] && { JAVA_HOME="$candidate"; break; }
  done
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/javac" ]]; then
  echo "error: no JDK $PINNED_JDK found. Install Temurin $PINNED_JDK or set JAVA_HOME." >&2
  exit 1
fi

if [[ ! -d "$LEGACY" ]]; then
  echo "error: $LEGACY missing. Run: git submodule update --init" >&2
  exit 1
fi

mkdir -p "$HERE/bin"
# -nowarn: the legacy source predates generics and trips thousands of raw-type warnings.
"$JAVA_HOME/bin/javac" -nowarn -d "$HERE/bin" \
  -sourcepath "$LEGACY:$HERE/src" \
  "$HERE"/src/com/superliminal/export/*.java

echo "built with $("$JAVA_HOME/bin/javac" -version 2>&1) -> $HERE/bin"
