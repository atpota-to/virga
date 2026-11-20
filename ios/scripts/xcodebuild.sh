#!/usr/bin/env bash
# Builds and tests on an iOS Simulator (macOS with Xcode only).
#
#   ios/scripts/xcodebuild.sh package-test   VirgaKit's tests, on iOS
#   ios/scripts/xcodebuild.sh app-test       the app, its unit and UI tests
#   ios/scripts/xcodebuild.sh build          the app, no tests
#
# Picks the newest available iPhone simulator unless SIMULATOR_ID is set.
# Results go to ios/build/<step>.xcresult.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios="$(cd "$here/.." && pwd)"
step="${1:-app-test}"
mkdir -p "$ios/build"

if [ -z "${SIMULATOR_ID:-}" ]; then
  SIMULATOR_ID="$(xcrun simctl list devices available --json | python3 -c '
import json, sys, re
data = json.load(sys.stdin)["devices"]
best = None
for runtime, devices in data.items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m:
        continue
    version = (int(m.group(1)), int(m.group(2)))
    for d in devices:
        if d.get("isAvailable") and d["name"].startswith("iPhone"):
            key = (version, "Pro" in d["name"], d["name"])
            if best is None or key > best[0]:
                best = (key, d["udid"], d["name"], runtime)
if not best:
    sys.exit("no available iPhone simulator")
print(best[1])
print(f"Using {best[2]} ({best[3]})", file=sys.stderr)
')"
fi
destination="platform=iOS Simulator,id=$SIMULATOR_ID"
common=(-destination "$destination" -skipPackagePluginValidation -skipMacroValidation CODE_SIGNING_ALLOWED=NO)

case "$step" in
  package-test)
    cd "$ios/VirgaKit"
    rm -rf "$ios/build/package-test.xcresult"
    xcodebuild test -scheme VirgaKit-Package "${common[@]}" -resultBundlePath "$ios/build/package-test.xcresult"
    ;;
  app-test)
    cd "$ios"
    [ -d Virga.xcodeproj ] || xcodegen generate
    rm -rf "$ios/build/app-test.xcresult"
    xcodebuild test -project Virga.xcodeproj -scheme Virga "${common[@]}" -resultBundlePath "$ios/build/app-test.xcresult"
    ;;
  build)
    cd "$ios"
    [ -d Virga.xcodeproj ] || xcodegen generate
    xcodebuild build -project Virga.xcodeproj -scheme Virga "${common[@]}"
    ;;
  *)
    echo "unknown step $step (package-test, app-test, build)" >&2
    exit 2
    ;;
esac
