#!/usr/bin/env bash
# Builds public/pets/{png,svg}/*, public/pets/accessories/*, public/pets/pets.json and public/pets/contact-sheet.png
# from scripts/pets/pets.html.
# Needs Google Chrome (headless) and perl (ships with Git Bash).
#
#   bash scripts/pets/build.sh                       # everything
#   ONLY_ACCESSORIES=1 bash scripts/pets/build.sh    # just the habit accessories (leaves the pet images alone)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)/public/pets"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
PROFILE="$(mktemp -d)"
winpath() { cygpath -m "$1"; }
chrome() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$(winpath "$PROFILE")" "$@" 2>/dev/null; }
shot() { chrome --screenshot="$(winpath "$2")" --window-size=512,512 --default-background-color=00000000 "file:///$(winpath "$1")"; }

mkdir -p "$ROOT/svg" "$ROOT/png" "$ROOT/accessories"
chrome --dump-dom "file:///$(winpath "$HERE/pets.html")" > "$PROFILE/dom.html"

# Habit accessories: see-through overlays, one per pet + accessory (acc-<pet>-<accessory>)
perl -0777 -ne '
  while (/<script type="text\/plain" id="acc-([^"]+)">(.*?)<\/script>/gs) { open my $f, ">", "'"$ROOT"'/accessories/$1.svg" or die; print $f $2; close $f; }
' "$PROFILE/dom.html"
for svg in "$ROOT"/accessories/*.svg; do
  [ -e "$svg" ] || continue
  shot "$svg" "$ROOT/accessories/$(basename "$svg" .svg).png"
done

if [ -z "${ONLY_ACCESSORIES:-}" ]; then
  perl -0777 -ne '
    while (/<script type="text\/plain" id="svg-([^"]+)">(.*?)<\/script>/gs) { open my $f, ">", "'"$ROOT"'/svg/$1.svg" or die; print $f $2; close $f; }
    if (/<script type="application\/json" id="manifest">(.*?)<\/script>/s) { open my $f, ">", "'"$ROOT"'/pets.json" or die; print $f $1, "\n"; close $f; }
  ' "$PROFILE/dom.html"

  for svg in "$ROOT"/svg/*.svg; do
    shot "$svg" "$ROOT/png/$(basename "$svg" .svg).png"
  done
  chrome --screenshot="$(winpath "$ROOT/contact-sheet.png")" --window-size=1240,1960 "file:///$(winpath "$HERE/pets.html")"
fi
rm -rf "$PROFILE"
echo "built $(ls "$ROOT"/png/*.png | wc -l) pet pngs and $(ls "$ROOT"/accessories/*.png 2>/dev/null | wc -l) accessory pngs"
