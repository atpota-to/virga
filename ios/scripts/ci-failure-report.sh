#!/usr/bin/env bash
# Prints why an iOS CI step failed, so a crash or a failing test can be read
# in the job log rather than only in the uploaded result bundle:
#   - each result bundle's failing tests and their messages;
#   - each crash report written in the last two hours (a test process that
#     crashes takes every test in its bundle down with it, and the log then
#     lists them all as failing without saying why), with the crashed
#     thread's frames.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios="$(cd "$here/.." && pwd)"

for bundle in "$ios"/build/*.xcresult; do
  [ -d "$bundle" ] || continue
  echo "::group::Failures in $(basename "$bundle")"
  if ! xcrun xcresulttool get test-results summary --path "$bundle" --format json 2>/dev/null | python3 -c '
import json, sys
summary = json.load(sys.stdin)
failures = summary.get("testFailures", [])
print(f"{summary.get(\"result\", \"?\")}: {summary.get(\"passedTests\", \"?\")} passed, {summary.get(\"failedTests\", \"?\")} failed")
for f in failures:
    print(f"- {f.get(\"targetName\", \"\")} {f.get(\"testName\", \"\")}: {f.get(\"failureText\", \"\")}")
'; then
    xcrun xcresulttool get test-results summary --path "$bundle" 2>&1 | head -200
  fi
  echo "::endgroup::"
done

found=0
while IFS= read -r report; do
  found=1
  echo "::group::Crash report $(basename "$report")"
  python3 - "$report" <<'PY' || head -c 30000 "$report"
import json, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
header, _, body = text.partition("\n")
meta = json.loads(header)
crash = json.loads(body)
print("process:", crash.get("procName"), "| app:", meta.get("app_name"), "| bundle:", meta.get("bundleID"))
exc = crash.get("exception", {})
print("exception:", exc.get("type"), exc.get("signal"), exc.get("subtype", ""))
term = crash.get("termination", {})
if term:
    print("termination:", term.get("indicator", ""), term.get("reasons", ""))
for key in ("asi", "lastExceptionBacktrace", "crashInfo"):
    if crash.get(key):
        print(key + ":", json.dumps(crash[key])[:2000])
images = crash.get("usedImages", [])
for thread in crash.get("threads", []):
    if not thread.get("triggered"):
        continue
    print("crashed thread:", thread.get("name", ""), thread.get("queue", ""))
    for frame in thread.get("frames", [])[:60]:
        image = images[frame["imageIndex"]].get("name", "?") if frame.get("imageIndex", -1) < len(images) else "?"
        print(f"  {image:30} {frame.get('symbol', hex(frame.get('imageOffset', 0)))} + {frame.get('symbolLocation', 0)}")
PY
  echo "::endgroup::"
done < <(find "$HOME/Library/Logs/DiagnosticReports" -name '*.ips' -mmin -120 2>/dev/null)
[ "$found" = 1 ] || echo "No crash reports were written."
