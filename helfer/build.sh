#!/bin/sh
# Baut den EventKit-Helfer nach helfer/bin/rb-kalender (Info.plist eingebettet).
set -e
cd "$(dirname "$0")"
mkdir -p bin
swiftc -O rb-kalender.swift -o bin/rb-kalender -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
codesign --force --sign "${RB_SIGNATUR:-HyperRec Code Signing}" --identifier de.ralfw.rundblick.kalender bin/rb-kalender 2>/dev/null || codesign --force --sign - --identifier de.ralfw.rundblick.kalender bin/rb-kalender
echo "helfer/bin/rb-kalender gebaut"
