#!/bin/bash
# Extracts one .pmtiles file per target listed in a targets file.
#
# Usage:   ./extract.sh targets.txt [BUILD_DATE]
#          FORCE=1 ./extract.sh targets.txt      # re-extract files that already exist
#
# Targets file format:
#   zoom 15                        sets --maxzoom for the lines below it
#   minzoom 11                     (optional) sets --minzoom for the current section
#   name minlon,minlat,maxlon,maxlat   one extract, written to sources/name.pmtiles
#   name                           no bbox: whole planet at the section's zoom range
#   # comments and blank lines are ignored

set -euo pipefail

TARGETS_FILE="${1:?usage: $0 targets.txt [BUILD_DATE]}"
TARGETDATE="${2:-20261007}"
SOURCE="https://build.protomaps.com/${TARGETDATE}.pmtiles"
OUTDIR="sources"
DEFAULT_MINZOOM=0
FORCE="${FORCE:-0}"

[[ -f $TARGETS_FILE ]] || { echo "No such file: $TARGETS_FILE" >&2; exit 1; }
mkdir -p "$OUTDIR"

maxzoom=""
minzoom="$DEFAULT_MINZOOM"
line_no=0
failures=0

die() {
  echo "$TARGETS_FILE line $line_no: $1" >&2
  exit 1
}

extract() {
  local name=$1 bbox=$2
  local out="$OUTDIR/$name.pmtiles"
  local args=(--minzoom="$minzoom" --maxzoom="$maxzoom")

  if [[ -n $bbox ]]; then
    args+=(--bbox="$bbox")
  fi

  if [[ -f $out && $FORCE != 1 ]]; then
    echo "skip     $name (already exists; FORCE=1 to redo)"
    return
  fi

  echo "extract  $name  zoom ${minzoom}-${maxzoom}${bbox:+  bbox=$bbox}"
  if ! pmtiles extract "$SOURCE" "$out" "${args[@]}"; then
    echo "FAILED   $name" >&2
    rm -f "$out"
    failures=$((failures + 1))
  fi
}

while IFS= read -r raw || [[ -n $raw ]]; do
  line_no=$((line_no + 1))
  line=${raw%%#*}
  read -r -a fields <<< "$line" || true
  [[ ${#fields[@]} -eq 0 ]] && continue

  case ${fields[0]} in
    zoom)
      [[ ${#fields[@]} -eq 2 && ${fields[1]} =~ ^[0-9]+$ ]] || die "expected 'zoom N'"
      maxzoom=${fields[1]}
      minzoom=$DEFAULT_MINZOOM
      ;;
    minzoom)
      [[ -n $maxzoom ]] || die "'minzoom' appears before any 'zoom' line"
      [[ ${#fields[@]} -eq 2 && ${fields[1]} =~ ^[0-9]+$ ]] || die "expected 'minzoom N'"
      minzoom=${fields[1]}
      ;;
    *)
      [[ -n $maxzoom ]] || die "target '${fields[0]}' appears before any 'zoom' line"
      case ${#fields[@]} in
        1) extract "${fields[0]}" "" ;;
        2) extract "${fields[0]}" "${fields[1]}" ;;
        *) die "expected 'name' or 'name minlon,minlat,maxlon,maxlat'" ;;
      esac
      ;;
  esac
done < "$TARGETS_FILE"

if [[ $failures -gt 0 ]]; then
  echo "$failures extract(s) failed." >&2
  exit 1
fi
echo "Done."