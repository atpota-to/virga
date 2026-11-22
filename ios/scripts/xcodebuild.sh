#!/usr/bin/env bash
# Builds and tests on an iOS Simulator (macOS with Xcode only).
#
#   ios/scripts/xcodebuild.sh package-test   VirgaKit's tests, on iOS
#   ios/scripts/xcodebuild.sh app-test       the app, its unit and UI tests
#   ios/scripts/xcodebuild.sh ipad-test      the app's UI tests on an iPad
#   ios/scripts/xcodebuild.sh build          the app, no tests
#
# Picks the newest available iPhone simulator unless SIMULATOR_ID is set;
# ipad-test picks the newest available iPad unless IPAD_SIMULATOR_ID is set
# (from 900 points wide the app has its sidebar, which the iPhone never
# shows). Results go to ios/build/<step>.xcresult.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios="$(cd "$here/.." && pwd)"
step="${1:-app-test}"
mkdir -p "$ios/build"

# The newest available simulator whose name starts with $1: a Pro first
# (not the iPad mini's A17 Pro), then the last by name (the larger).
newest_simulator() {
  xcrun simctl list devices available --json | python3 -c '
import json, sys, re
prefix = sys.argv[1]
data = json.load(sys.stdin)["devices"]
best = None
for runtime, devices in data.items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m:
        continue
    version = (int(m.group(1)), int(m.group(2)))
    for d in devices:
        if d.get("isAvailable") and d["name"].startswith(prefix):
            key = (version, "Pro" in d["name"] and "mini" not in d["name"], d["name"])
            if best is None or key > best[0]:
                best = (key, d["udid"], d["name"], runtime)
if not best:
    sys.exit("no available %s simulator" % prefix)
print(best[1])
print(f"Using {best[2]} ({best[3]})", file=sys.stderr)
' "$1"
}

if [ "$step" = ipad-test ]; then
  SIMULATOR_ID="${IPAD_SIMULATOR_ID:-$(newest_simulator iPad)}"
elif [ -z "${SIMULATOR_ID:-}" ]; then
  SIMULATOR_ID="$(newest_simulator iPhone)"
fi
destination="platform=iOS Simulator,id=$SIMULATOR_ID"
common=(-destination "$destination" -skipPackagePluginValidation -skipMacroValidation CODE_SIGNING_ALLOWED=NO)

# Boots the simulator and waits until it has finished booting, before the
# build, so it has settled by the time the tests start. Left to xcodebuild,
# it boots as the first test launches, and on a busy runner a UI test's
# first rotation then times out ("Timed out waiting for confirmation of
# orientation change"). In CI, the simulators an earlier step left running
# are shut down first, so the iPad isn't booting beside the iPhone.
boot_simulator() {
  if [ -n "${CI:-}" ]; then
    xcrun simctl shutdown all || true
  fi
  xcrun simctl bootstatus "$SIMULATOR_ID" -b
}

case "$step" in
  package-test | app-test | ipad-test) boot_simulator ;;
esac

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
  ipad-test)
    cd "$ios"
    [ -d Virga.xcodeproj ] || xcodegen generate
    rm -rf "$ios/build/ipad-test.xcresult"
    xcodebuild test -project Virga.xcodeproj -scheme Virga "${common[@]}" -only-testing:VirgaUITests \
      -resultBundlePath "$ios/build/ipad-test.xcresult"
    ;;
  build)
    cd "$ios"
    [ -d Virga.xcodeproj ] || xcodegen generate
    xcodebuild build -project Virga.xcodeproj -scheme Virga "${common[@]}"
    ;;
  *)
    echo "unknown step $step (package-test, app-test, ipad-test, build)" >&2
    exit 2
    ;;
esac
