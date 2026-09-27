#!/usr/bin/env bash
# Fetches the heavy inputs of the public example characters — each painting,
# the two images See-through was fed, and the two See-through layer sets — from
# https://github.com/firejune/spine-parts-examples into the gitignored
# examples/<key>/inputs/ of this checkout.
#
# What lives HERE, tracked, is the light half of each example: its config, the
# proposal, the reference implementation's outputs under expected/, and small
# contact sheets. The heavy half is ~40 MB of PNG per character, which is why it
# is a sibling repository rather than part of this one, and why it is fetched.
#
#   bash scripts/fetch-examples.sh               clone the PINNED commit
#   bash scripts/fetch-examples.sh --from <dir>  copy from a local working copy
#
# 🔒 The commit is PINNED, never a branch. The selftest compares what the
# readers see in these inputs against expected/parts.json, which is tracked
# here; a fetch that followed the other repository's main would let an upstream
# edit turn this tree red — or, worse, green — with no change in this tree. A
# new pin is a change to this file, reviewed like any other.
#
# `--from` copies a working copy on disk and verifies no commit, so it says it is
# UNPINNED on every line it prints about itself. It exists for preparing an
# upstream change before it is pushed, and for machines with no network.
#
# Any file already on disk is KEPT, never overwritten, and the count kept is
# printed per character. That makes a re-run cheap, and it is also why CI does
# not cache examples/: a restored cache would freeze the inputs at whatever an
# earlier run fetched.
#
# 🚨 The script never reports success on an empty or partial fetch: every
# character it fetches must end up holding painting.png, both st_input images
# and both layers.json manifests before the exit status may be 0.
set -euo pipefail

REPO_URL="https://github.com/firejune/spine-parts-examples"
# ⚠️ PLACEHOLDER. Set this to the full 40-character commit of spine-parts-examples
# these fixtures were compared against. The script refuses to run until it is.
PINNED_COMMIT=aaf679914ceb08576ef707296223c0d428d5dec3

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/examples"

from=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      [ $# -ge 2 ] || { echo "fetch-examples: --from needs a directory" >&2; exit 2; }
      from="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "fetch-examples: unknown argument \"$1\"; usage: fetch-examples.sh [--from <dir>]" >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$DEST" ]; then
  echo "fetch-examples: $DEST does not exist, so there is no example here to fetch inputs for" >&2
  exit 1
fi

work=""
cleanup() { [ -n "$work" ] && rm -rf "$work"; return 0; }
trap cleanup EXIT

if [ -n "$from" ]; then
  if [ ! -d "$from" ]; then
    echo "fetch-examples: --from names $from, which is not a directory" >&2
    exit 2
  fi
  upstream="$(cd "$from" && pwd)"
  echo "fetch-examples: UNPINNED — copying the working copy at $upstream; no commit is verified"
else
  case "$PINNED_COMMIT" in
    __*__ | "")
      echo "fetch-examples: refused — PINNED_COMMIT in scripts/fetch-examples.sh is still the placeholder \"$PINNED_COMMIT\"." >&2
      echo "  Set it to the commit of $REPO_URL these examples were compared against;" >&2
      echo "  until then the only way to fetch is --from <a local working copy>, which is unpinned." >&2
      exit 1
      ;;
  esac
  if ! printf '%s' "$PINNED_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "fetch-examples: refused — PINNED_COMMIT \"$PINNED_COMMIT\" is not a full 40-character commit id; a branch, tag or short id can move" >&2
    exit 1
  fi
  work="$(mktemp -d)"
  upstream="$work/spine-parts-examples"
  git init -q "$upstream"
  git -C "$upstream" remote add origin "$REPO_URL"
  if ! git -C "$upstream" fetch -q --depth 1 origin "$PINNED_COMMIT"; then
    echo "fetch-examples: could not fetch commit $PINNED_COMMIT from $REPO_URL" >&2
    exit 1
  fi
  git -C "$upstream" -c advice.detachedHead=false checkout -q FETCH_HEAD
  got="$(git -C "$upstream" rev-parse HEAD)"
  if [ "$got" != "$PINNED_COMMIT" ]; then
    echo "fetch-examples: asked for $PINNED_COMMIT and checked out $got" >&2
    exit 1
  fi
  echo "fetch-examples: $REPO_URL at $PINNED_COMMIT"
fi

# copy_keep <src> <dst> — copy one file unless dst already exists. Prints nothing;
# the caller counts.
copied=0
kept=0
copy_keep() {
  if [ -e "$2" ]; then
    kept=$((kept + 1))
  else
    mkdir -p "$(dirname "$2")"
    cp "$1" "$2"
    copied=$((copied + 1))
  fi
}

# The character keys here are the directories holding a config.json; upstream's
# are the directories holding a painting.png.
fetched=0
missing_upstream=""
incomplete=""
for dir in "$DEST"/*/; do
  key="$(basename "$dir")"
  [ -f "$DEST/$key/config.json" ] || continue
  src="$upstream/$key"
  if [ ! -f "$src/painting.png" ]; then
    missing_upstream="$missing_upstream $key"
    continue
  fi
  copied=0
  kept=0
  out="$DEST/$key/inputs"
  copy_keep "$src/painting.png" "$out/painting.png"
  for f in "$src"/inputs/*; do
    [ -f "$f" ] && copy_keep "$f" "$out/$(basename "$f")"
  done
  # layers/<run>/{layers.json,meta.json,parts/*.png}; names hold spaces
  # ("back hair.png"), so every expansion is quoted.
  while IFS= read -r rel; do
    copy_keep "$src/$rel" "$out/$rel"
  done < <(cd "$src" && find layers -type f | LC_ALL=C sort)
  gap=""
  for need in painting.png st_input_full.png st_input_head.png layers/full/layers.json layers/head/layers.json; do
    [ -f "$out/$need" ] || gap="$gap $need"
  done
  if [ -n "$gap" ]; then
    incomplete="$incomplete $key(missing:$gap)"
  fi
  n=$(find "$out" -type f | wc -l | tr -d ' ')
  echo "  $key: $copied file(s) copied, $kept kept as already on disk, $n in examples/$key/inputs"
  fetched=$((fetched + 1))
done

for dir in "$upstream"/*/; do
  key="$(basename "$dir")"
  [ -f "$upstream/$key/painting.png" ] || continue
  [ -f "$DEST/$key/config.json" ] || echo "  note: upstream has \"$key\", which has no examples/$key/config.json here; not fetched"
done

status=0
if [ -n "$missing_upstream" ]; then
  for key in $missing_upstream; do
    echo "fetch-examples: WARNING — examples/$key has no counterpart upstream (no $key/painting.png), so its inputs were not fetched" >&2
  done
  # A warning and not a failure: the selftest's corpus suite refuses a partial
  # set of inputs by name, and a fetch that fails here would hide which of the
  # other examples it did fetch.
fi
if [ -n "$incomplete" ]; then
  echo "fetch-examples: incomplete after the fetch:$incomplete" >&2
  status=1
fi
if [ "$fetched" -eq 0 ]; then
  echo "fetch-examples: fetched nothing — no examples/<key>/config.json found a counterpart upstream" >&2
  status=1
fi
if [ "$status" -eq 0 ]; then
  echo "fetch-examples: $fetched example(s) ready under examples/*/inputs${from:+ (UNPINNED)}"
fi
exit "$status"
