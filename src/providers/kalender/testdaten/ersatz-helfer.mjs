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
  const termin = (uid, x) => ({ id: `${uid}@${x.datum}`, kalenderId: x.kalenderId ?? 'k1', titel: x.titel, datum: x.datum, start: x.start, dauer: x.dauer, ort: '', uid, notiz: x.notiz, geaendert: '2026-11-18T10:00:00Z' });
  if (a.op === 'anlegen') return sende({ id: a.id, ok: true, daten: termin('u1', a) });
  if (a.op === 'aendern') return sende({ id: a.id, ok: true, daten: a.uid === 'fehlt' ? null : termin(a.uid, a) });
  if (a.op === 'verschieben') return sende({ id: a.id, ok: true, daten: a.termin === 'fehlt' ? null : { id: `${a.termin}>`, datum: a.datum, start: a.start, dauer: a.dauer } });
  if (a.op === 'entfernen') return sende({ id: a.id, ok: true, daten: a.termin !== 'fehlt' });
  if (a.op === 'loeschen') return sende({ id: a.id, ok: true, daten: a.uid !== 'fehlt' });
  if (a.op === 'lesen') return sende({ id: a.id, ok: true, daten: a.uid === 'fehlt' ? null : termin(a.uid, { titel: 'X', notiz: '', datum: '2026-11-19', start: '10:00', dauer: 60 }) });
  if (a.op === 'termine') return sende({ id: a.id, ok: true, daten: [{ id: 't1', kalenderId: 'k1', titel: 'X', datum: a.von, start: '09:00', dauer: 30, ort: '' }] });
});
