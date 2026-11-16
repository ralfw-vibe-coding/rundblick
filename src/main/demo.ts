// Beispieldaten (RB_DEMO=1) – angelegt über das Body interface, also mit echten Events.
import { plusTage } from '../basis/datum';
import type { Body } from '../body/interface';
import type { Datum } from '../schema/werte';

export async function demoDatenAnlegen(body: Body, heute: Datum): Promise<void> {
  const d = (n: number) => plusTage(heute, n);
  const neu = async (titel: string, x: Omit<Parameters<Body['aufgabeErfassen']>[0], 'titel'> = {}) => {
    const r = await body.aufgabeErfassen({ titel, ...x });
    return r.ok ? r.ids!.aufgabeId! : '';
  };
  const a1 = await neu('Angebot Möbeltischlerei Hüttner schreiben', { tags: ['kunde'], verantwortlich: 'Ralf', frist: d(2), status: 'inarbeit', beschreibung: 'Relaunch-Angebot in drei Paketen.' });
  const a2 = await neu('Folien „Prompting 2026“ überarbeiten', { tags: ['workshop'], frist: d(4), status: 'bereit' });
  const a3 = await neu('Steuerunterlagen Q3 ans Steuerbüro', { tags: ['büro'], frist: d(-2) });
  await neu('Stromzähler Chalet ablesen lassen', { tags: ['chalet'], verantwortlich: 'Ivan', ort: 'Dobrinishte', wiedervorlage: d(9) });
  await neu('Blogartikel Vibe-Coding-Ampel', { tags: ['blog'], status: 'blockiert', beschreibung: 'Wartet auf Review von Markus.' });
  const a6 = await neu('Bewerbungsfilm: Rohschnitt sichten', { tags: ['vorgestellt'], verantwortlich: 'Markus', frist: d(5), status: 'bereit' });
  const a8 = await neu('Kontakte-App: vCard-Import testen', { tags: ['dev'], status: 'inarbeit' });
  const a9 = await neu('Rechnung Office Day an Merck', { tags: ['büro'], frist: d(0), status: 'bereit' });
  await neu('Spieleabend vorbereiten', { tags: ['privat'], frist: d(6) });
  const a11 = await neu('Workshop-Feedback auswerten', { tags: ['workshop'], status: 'erledigt' });
  await neu('Winterreifen wechseln', { tags: ['auto'], wiedervorlage: d(4) });
  const a13 = await neu('Spike: Event Store für Rundblick', { tags: ['dev'], status: 'bereit' });
  const a14 = await neu('Geschenk für Lena', { tags: ['privat'], frist: d(12) });
  const a15 = await neu('Call Codelution: Relaunch-Abstimmung', { tags: ['kunde'], status: 'blockiert', ort: 'Zoom' });
  await neu('Newsletter Dezember entwerfen', { tags: ['blog'], frist: d(15), status: 'backlog' });
  const a17 = await neu('Coaching-Session Vibe Coach', { tags: ['coaching'], ort: 'Zoom' });
  await neu('Reisekosten Oktober einreichen', { tags: ['büro'], status: 'backlog' });
  const a19 = await neu('Website-Texte Villa Kunterbunt prüfen', { tags: ['kunde'], verantwortlich: 'Ralf', frist: d(8), status: 'bereit' });
  await neu('Fahrradkette ölen', { tags: ['privat'] });
  const a21 = await neu('HTML Presenter: Export-Bug', { tags: ['dev'], frist: d(1), status: 'inarbeit' });
  await neu('Podcast über Vibe Coding', { tags: ['blog'], status: 'idee' });
  await neu('Gastbeitrag t3n', { tags: ['blog'], status: 'abgebrochen', beschreibung: 'Redaktion hat abgesagt.' });

  const b = (aufgabeId: string, n: number, dauer: number, start: string | null = null) => body.buchungAnlegen({ aufgabeId, datum: d(n), dauer, start });
  await b(a1, 1, 120); await b(a1, 3, 30, '16:00');
  await b(a2, 3, 180); await b(a2, 4, 60);
  await b(a8, 0, 90); await b(a21, 0, 60); await b(a9, 0, 30); await b(a3, 0, 90);
  await b(a15, 1, 60, '14:00'); await b(a13, 4, 240); await b(a17, 3, 90, '10:00');
  await b(a6, 2, 60); await b(a19, 7, 120); await b(a14, 11, 60);
  const z = await body.buchungEintragen({ titel: 'Zahnarzt', beschreibung: 'Kontrolle', datum: d(2), start: '08:30', dauer: 45 });
  if (z.ok) await body.buchungAendern({ buchungId: z.ids!.buchungId!, belegt: false });
  await body.buchungEintragen({ titel: 'Belege sortieren', datum: d(2), dauer: 60 });
  await body.aufgabeAbschliessen({ aufgabeId: a11 });
}
