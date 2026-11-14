#!/bin/sh
set -eu

app=$1
identity=$2
arch=$3
native=$(dirname "$0")
mkdir -p "$app/Contents/MacOS"
cp "$native/capture-app.plist" "$app/Contents/Info.plist"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

compile() {
  /usr/bin/xcrun swiftc -target "$1-apple-macos14.0" -module-cache-path "$scratch/cache" -parse-as-library -O \
    "$native/usb-capture.swift" "$native/USBIdentity.swift" "$native/USBDiscovery.swift" \
    -o "$2"
}

executable="$app/Contents/MacOS/usb-capture"
if [ "$arch" = universal ]; then
  compile arm64 "$scratch/arm64"
  compile x86_64 "$scratch/x86_64"
  /usr/bin/lipo -create "$scratch/arm64" "$scratch/x86_64" -output "$executable"
else
  compile "$arch" "$executable"
fi

if [ "$identity" = - ]; then
  /usr/bin/codesign --force --sign - --options runtime \
    --entitlements "$native/capture-entitlements.plist" "$app"
else
  /usr/bin/codesign --force --sign "$identity" --options runtime --timestamp \
    --entitlements "$native/capture-entitlements.plist" "$app"
fi
/usr/bin/codesign --verify --strict "$app"
