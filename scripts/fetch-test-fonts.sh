#!/usr/bin/env bash
# Populates test-fonts/ from the fonts installed on this machine.
#
# These are licensed system fonts, so they are not committed. The test suite
# skips any test whose fixture is missing, so the suite still runs without
# them -- it just covers less.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test-fonts

copy() {
  if [ -f "$1" ]; then
    cp "$1" "test-fonts/$2"
    echo "  $2"
  else
    echo "  (skipped, not installed) $2"
  fi
}

echo "Collecting test fonts:"
case "$(uname -s)" in
  Darwin)
    copy "/System/Library/Fonts/Supplemental/Arial Black.ttf" ArialBlack.ttf
    copy "/System/Library/Fonts/Supplemental/STIXGeneral.otf" STIXGeneral.otf
    copy "/System/Library/Fonts/Supplemental/Andale Mono.ttf" AndaleMono.ttf
    ;;
  *)
    echo "  No mapping for $(uname -s); copy any TTF/OTF into test-fonts/ by hand."
    ;;
esac

# A spread of constructions for the reference-library tests: one-storey and
# two-storey a, and all three forms of g.
case "$(uname -s)" in
  Darwin)
    echo "Collecting reference-library fixtures:"
    for pair in \
      "/System/Library/Fonts/Supplemental/Georgia.ttf:lib-Georgia.ttf" \
      "/System/Library/Fonts/Supplemental/Futura.ttc:lib-Futura.ttc" \
      "/System/Library/Fonts/Supplemental/Baskerville.ttc:lib-Baskerville.ttc" \
      "/System/Library/Fonts/Supplemental/Didot.ttc:lib-Didot.ttc" \
      "/System/Library/Fonts/Optima.ttc:lib-Optima.ttc" \
      "/System/Library/Fonts/Palatino.ttc:lib-Palatino.ttc" \
      "/System/Library/Fonts/Supplemental/Courier New.ttf:lib-CourierNew.ttf" \
      "/System/Library/Fonts/Supplemental/Verdana.ttf:lib-Verdana.ttf" \
      "/System/Library/Fonts/Supplemental/Times New Roman.ttf:lib-TimesNewRoman.ttf" \
      "/System/Library/Fonts/Supplemental/Trebuchet MS.ttf:lib-TrebuchetMS.ttf"
    do
      copy "${pair%%:*}" "${pair##*:}"
    done
    ;;
esac
