#!/usr/bin/env bash
# Run from the root of your repo AFTER unzipping this folder's contents over it.
# Edits the template's own files in place (never replaces them), so the plugin/toolchain
# versions the template ships stay intact.
set -euo pipefail

[ -f settings.gradle.kts ] && [ -f patches/build.gradle.kts ] || { echo "run from the repo root"; exit 1; }

if grep -q 'version "1.3.3"' settings.gradle.kts; then
  echo "!! settings.gradle.kts still pins plugin 1.3.3 (from an earlier overlay of mine)."
  echo "   Restore the template's file first:  git restore settings.gradle.kts patches/build.gradle.kts"
  exit 1
fi

# 1. project name
sed -i -E 's/^(rootProject\.name *= *)".*"/\1"pogo-morphe-patches"/' settings.gradle.kts

# 2. hook the payload script into the template's patches build, once
if ! grep -q 'payload.gradle.kts' patches/build.gradle.kts; then
  printf '\napply(from = "payload.gradle.kts")\n' >> patches/build.gradle.kts
fi

# 3. about block (only touches lines that exist)
sed -i -E \
  -e 's/^(\s*name *= *)".*"/\1"Pogo Patches"/' \
  -e 's/^(\s*description *= *)".*"/\1"Pokémon GO patches for Morphe"/' \
  -e 's/^(\s*author *= *)".*"/\1"belalsalah74"/' \
  patches/build.gradle.kts

# 4. template example sources would clash with nothing but add noise; list them
echo "Template example sources you can delete (keep util/PatchListGenerator.kt):"
find patches/src/main/kotlin -name '*.kt' -not -path '*/app/pogo/*' -not -path '*/util/*' 2>/dev/null || true
find extensions -path '*/src/main/java/*' -name '*.java' -not -path '*/app/pogo/*' 2>/dev/null || true
echo
echo "Check patches/build.gradle.kts: about { source = ... } should point at YOUR repo."
echo "Then: ./gradlew buildAndroid --warning-mode all"
