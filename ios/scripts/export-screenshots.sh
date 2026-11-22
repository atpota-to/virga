#!/usr/bin/env bash
# Exports the screenshots a UI-test run kept (XCTAttachment, kept always) from
# its result bundle into ios/build/screenshots/<device>, for CI to upload.
#
#   ios/scripts/export-screenshots.sh app-test iphone
#   ios/scripts/export-screenshots.sh ipad-test ipad
#
# Quiet when there is no bundle (the tests never ran), so it can run always.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios="$(cd "$here/.." && pwd)"
step="${1:?step (app-test or ipad-test)}"
device="${2:?device folder (iphone or ipad)}"
bundle="$ios/build/$step.xcresult"
out="$ios/build/screenshots/$device"
if [ ! -d "$bundle" ]; then
  echo "No result bundle at $bundle"
  exit 0
fi
mkdir -p "$out"
xcrun xcresulttool export attachments --path "$bundle" --output-path "$out" || echo "No attachments exported from $bundle"
