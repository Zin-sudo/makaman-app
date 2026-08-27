#!/bin/sh
# Roll the app's appearance back to where it stood before the Tier 6 theme work.
#
# Restores the WHOLE index.html, not a stylesheet. That is not laziness: most of this
# app's styling lives in inline style= attributes on the elements themselves, so putting
# back only the <style> blocks would restore a small fraction of the appearance and leave
# the rest in whatever state the theme pass had reached — which is worse than either end
# of the change.
#
#   sh reference/css-baseline/restore.sh          # roll back
#   sh reference/css-baseline/restore.sh --check  # show what would change, touch nothing
#
# Run from the repository root.
set -e
BASE="reference/css-baseline/index.pre-v2.html"
APP="app/index.html"
MIRROR="app/Job Ticket System.dc.html"

[ -f "$BASE" ] || { echo "Missing $BASE — run this from the repository root."; exit 1; }

if [ "$1" = "--check" ]; then
  if cmp -s "$BASE" "$APP"; then
    echo "app/index.html is already the pre-v2 baseline. Nothing to roll back."
  else
    echo "Lines that would change:"
    diff "$BASE" "$APP" | grep -c '^[<>]' || true
    echo "(run without --check to roll back)"
  fi
  exit 0
fi

cp "$BASE" "$APP"
cp "$APP" "$MIRROR"
cmp "$APP" "$MIRROR"
echo "Rolled back to the pre-v2 baseline, and the .dc.html mirror is back in step."
echo "Nothing is committed. Check it, then commit or 'git checkout -- app/' to undo this."
