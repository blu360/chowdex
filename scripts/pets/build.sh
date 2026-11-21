#!/usr/bin/env bash
# Builds public/pets/{png,svg}/*, public/pets/pets.json and public/pets/contact-sheet.png from scripts/pets/pets.html.
# Needs Google Chrome (headless) and perl (ships with Git Bash).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)/public/pets"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
PROFILE="$(mktemp -d)"
winpath() { cygpath -m "$1"; }
chrome() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$(winpath "$PROFILE")" "$@" 2>/dev/null; }

mkdir -p "$ROOT/svg" "$ROOT/png"
chrome --dump-dom "file:///$(winpath "$HERE/pets.html")" > "$PROFILE/dom.html"

perl -0777 -ne '
  while (/<script type="text\/plain" id="svg-([^"]+)">(.*?)<\/script>/gs) { open my $f, ">", "'"$ROOT"'/svg/$1.svg" or die; print $f $2; close $f; }
  if (/<script type="application\/json" id="manifest">(.*?)<\/script>/s) { open my $f, ">", "'"$ROOT"'/pets.json" or die; print $f $1, "\n"; close $f; }
' "$PROFILE/dom.html"

for svg in "$ROOT"/svg/*.svg; do
  id="$(basename "$svg" .svg)"
  chrome --screenshot="$(winpath "$ROOT/png/$id.png")" --window-size=512,512 --default-background-color=00000000 "file:///$(winpath "$svg")"
done
chrome --screenshot="$(winpath "$ROOT/contact-sheet.png")" --window-size=1240,1480 "file:///$(winpath "$HERE/pets.html")"
rm -rf "$PROFILE"
echo "built $(ls "$ROOT"/png/*.png | wc -l) pngs"
