#!/bin/sh
# Signiert die gebaute App mit einer festen Identität (Standard: „HyperRec Code Signing“ aus dem Schlüsselbund).
# Eine stabile Signatur sorgt dafür, dass macOS die Kalender-Freigabe über Neubauten hinweg behält.
# Andere Identität: RB_SIGNATUR="Name" npm run app; ohne Identität im Schlüsselbund wird ad hoc signiert.
set -e
APP="$1"
ID="${RB_SIGNATUR:-HyperRec Code Signing}"
if ! security find-identity -v -p codesigning | grep -q "\"$ID\""; then
  echo "Identität „$ID“ nicht gefunden – signiere ad hoc"; ID="-"
fi
codesign --force --sign "$ID" --identifier de.ralfw.rundblick.kalender "$APP/Contents/Resources/rb-kalender"
codesign --force --deep --sign "$ID" "$APP"
codesign --verify --deep --strict "$APP" && echo "signiert mit: $ID"
