#!/usr/bin/env bash
# Export every catalog puzzle to a .mc4dpz asset, plus golden twist permutations for the
# TypeScript test suite. Assumes tools/exporter/build.sh has already run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$ROOT/build/assets}"

if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in "$HOME/Library/Java/JavaVirtualMachines"/jdk-21*/Contents/Home \
                   /Library/Java/JavaVirtualMachines/*jdk-21*/Contents/Home; do
    [[ -x "$candidate/bin/java" ]] && { JAVA_HOME="$candidate"; break; }
  done
fi
[[ -x "${JAVA_HOME:-}/bin/java" ]] || { echo "error: no JDK 21 found; set JAVA_HOME" >&2; exit 1; }

"$JAVA_HOME/bin/java" -Xmx8g -Djava.awt.headless=true \
  -cp "$HERE/bin" com.superliminal.export.AssetExporter "$OUT" --goldens --include-3d

# Assets for the puzzles with golden permutations are committed (gzipped) so the TypeScript test
# suite runs without a JDK or a prior export.
mkdir -p "$ROOT/fixtures/assets"
for f in "$ROOT"/fixtures/perm/*.bin.gz; do
  name="$(basename "$f" .bin.gz)"
  cp "$OUT/$name.mc4dpz.gz" "$ROOT/fixtures/assets/"
done
# The manifest records a sha256 of each *uncompressed* asset. That is the thing worth pinning:
# grip indices inside it are a wire format, and a change means every saved solve is reinterpreted.
# Compressed bytes are an implementation detail and are deliberately not compared.
cp "$OUT/manifest.json" "$ROOT/fixtures/manifest.json"
echo "staged $(ls "$ROOT"/fixtures/assets/*.gz | wc -l | tr -d ' ') test fixtures + manifest"
