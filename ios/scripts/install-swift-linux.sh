#!/usr/bin/env bash
# Installs the Swift toolchain named in ios/.swift-version for Ubuntu 24.04
# into $SWIFT_HOME (default ~/.swift-toolchain) and prints the bin directory.
# CI caches $SWIFT_HOME; locally, any Swift 6 toolchain works.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$(tr -d '[:space:]' < "$here/../.swift-version")"
home="${SWIFT_HOME:-$HOME/.swift-toolchain}"
name="swift-${version}-RELEASE-ubuntu24.04"
if [ ! -x "$home/$name/usr/bin/swift" ]; then
  mkdir -p "$home"
  url="https://download.swift.org/swift-${version}-release/ubuntu2404/swift-${version}-RELEASE/${name}.tar.gz"
  echo "Downloading $url" >&2
  curl -fsSL "$url" | tar xz -C "$home"
fi
echo "$home/$name/usr/bin"
