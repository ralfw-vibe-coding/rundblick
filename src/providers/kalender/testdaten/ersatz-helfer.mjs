#!/usr/bin/env node
// Ersatz für helfer/bin/rb-kalender in Tests: spricht dasselbe JSON-Zeilen-Protokoll.
import { createInterface } from 'node:readline';
const sende = o => process.stdout.write(JSON.stringify(o) + '\n');
createInterface({ input: process.stdin }).on('line', zeile => {
  const a = JSON.parse(zeile);
  if (a.op === 'zugriff') { process.stdout.write('kein json\n'); sende({ id: 9999, ok: true }); sende({ ereignis: 'geaendert' }); return sende({ id: a.id, ok: true, daten: 'erlaubt' }); }
  if (a.op === 'kalender') return sende({ id: a.id, ok: true, daten: [{ id: 'k1', name: 'Arbeit', konto: 'iCloud', farbe: '#ff0000' }] });
  if (a.op === 'termine' && a.von === 'fehler') return sende({ id: a.id, ok: false });
  if (a.op === 'termine' && a.von === 'still') return;
  if (a.op === 'termine' && a.von === 'ende') process.exit(0);
  if (a.op === 'termine') return sende({ id: a.id, ok: true, daten: [{ id: 't1', kalenderId: 'k1', titel: 'X', datum: a.von, start: '09:00', dauer: 30, ort: '' }] });
});
