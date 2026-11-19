#!/bin/sh
# Test-Bank der Phone App: baut die App, legt sie mit Dropbox-Attrappe nach /tmp/rb-phone-site und startet
# einen Server auf http://localhost:5175 (Daten: Event-Dateien aus $1/events, z. B. Demo-Daten des Desktops:
#   RB_PROFIL=/tmp/rb-demoprof RB_DATEN=/tmp/rb-demo RB_DEMO=1 RB_KALENDER=beispiel RB_SCREENSHOT=/tmp/x.png npx electron .).
# Danach z. B.: node tools/phone-test/cdp.mjs /pfad/skript.mjs  (Skript: export default async ({ laden, eval, foto, tippen, klick, beruehren, warten }) => …)
# Hinweis: Im kopflosen Chrome hängt indexedDB.open auf einer frisch angelegten Seite oberster Ebene mit --timeout/--dump-dom –
# darum über cdp.mjs (DevTools-Protokoll) testen.
set -e
DATEN="${1:-/tmp/rb-demo}"
cd "$(dirname "$0")/../.."
npx vite build --config vite.phone.config.ts --logLevel error
rm -rf /tmp/rb-phone-site && cp -r out/phone /tmp/rb-phone-site
cp tools/phone-test/fake-dropbox.js /tmp/rb-phone-site/
python3 - "$DATEN" <<'PY'
import json, os, sys
o = os.path.join(sys.argv[1], 'events')
d = {f: open(os.path.join(o, f)).read() for f in os.listdir(o) if f.endswith('.jsonl')} if os.path.isdir(o) else {}
json.dump(d, open('/tmp/rb-phone-site/test-daten.json', 'w'))
PY
sed -i '' 's#<div id="app"></div>#<div id="app"></div><script src="/fake-dropbox.js"></script>#' /tmp/rb-phone-site/index.html
pkill -f "http.server 5175" 2>/dev/null || true
cd /tmp/rb-phone-site && (python3 -m http.server 5175 >/dev/null 2>&1 &)
echo "Test-Bank: http://localhost:5175 (Dropbox-Attrappe, Daten aus $DATEN)"
