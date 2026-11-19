// Oberfläche der Phone App (PWA). Kennt nur das Body interface – wie der Desktop-Client.
// Aufbau und Bedienung nach dem abgestimmten Entwurf `entwuerfe/phone/index.html` (design.html §16):
// unten Liste · Board · Logbuch, Aufgabe als Vollbild, Angaben und Einstellungen als Schublade,
// Wischen (Archiv/Gesehen/Mülleimer, zweistufig), lange drücken = ziehen, Suche nach Herunterziehen.
import { differenz, kurz, WT, wochentag } from '../../basis/datum';
import { checkboxUmschalten, markdownHtml } from '../../basis/markdown';
import type { AbgleichStand, AufgabeDetails, AufgabeZeile, Board, Body, CommandStatus, LogbuchTag, StatusInfo } from '../../body/interface';
import { wiederholungFelder, wiederholungFreigeben, wiederholungLesen } from '../wiederholung';
import { I } from './icons';

/** Was die PWA-Hülle (Service Worker) beisteuert */
export type Pwa = {
  version: string;
  neueVersion(): boolean;
  neuLaden(): void;
  beiNeuerVersion(cb: () => void): void;
};

type Sicht = 'liste' | 'board' | 'logbuch';
type UiZustand = { sicht: Sicht; offen: string[]; spalteZu: string[]; fertigOffen: string[] };

const UI_SCHLUESSEL = 'rundblick.phone.ui';
const GRUPPEN: [string, string][] = [['faellig', 'Fällig'], ['ohne', 'Ohne Frist'], ['wird', 'Wird fällig'], ['zurueck', 'Zurückgestellt'], ['fertig', 'Abgeschlossen']];
const KAT_FARBE: Record<string, string> = { nichtBegonnen: 'var(--kat-offen)', begonnen: 'var(--kat-begonnen)', beendet: 'var(--kat-beendet)' };
const KAT_VAR: Record<string, string> = { nichtBegonnen: '--kat-offen', begonnen: '--kat-begonnen', beendet: '--kat-beendet' };

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function phoneStarten(body: Body, wurzel: HTMLElement, pwa: Pwa): void {
  // ---------------- Zustand (Klappzustand, „Neu“, Sicht: lokal auf dem Gerät) ----------------
  const gespeichert = ((): Partial<UiZustand> => { try { return JSON.parse(localStorage.getItem(UI_SCHLUESSEL) ?? '{}') as Partial<UiZustand>; } catch { return {}; } })();
  const z = {
    sicht: (gespeichert.sicht ?? 'liste') as Sicht,
    offen: new Set(gespeichert.offen ?? ['neu', 'faellig', 'wird', 'ohne']),
    spalteZu: new Set(gespeichert.spalteZu ?? []),
    fertigOffen: new Set(gespeichert.fertigOffen ?? []),
    suche: false, filter: '',
    detail: null as null | { art: 'aufgabe' | 'notiz'; id: string },
    notizBearbeiten: false,
    logTage: 14,
    stand: null as AbgleichStand | null,
    heute: '',
    spalten: [] as StatusInfo[],
    board: null as Board | null,
  };
  const merken = () => localStorage.setItem(UI_SCHLUESSEL, JSON.stringify({ sicht: z.sicht, offen: [...z.offen], spalteZu: [...z.spalteZu], fertigOffen: [...z.fertigOffen] }));
  // „Neu“ ist geteilter Zustand (AufgabeGesehen) – gilt auf allen Geräten
  const ausNeu = (id: string) => body.aufgabeGesehen({ aufgabeId: id });

  wurzel.innerHTML = `<div class="bildschirm"><div class="haupt"></div>
    <nav class="reiter"><button data-sicht="liste">${I.liste}Liste</button><button data-sicht="board">${I.board}Board</button><button data-sicht="logbuch">${I.logbuch}Logbuch</button></nav>
    <div class="detail"></div><div class="blatt-hg"></div><div class="blatt"></div><div class="toast"></div></div>`;
  const bs = wurzel.querySelector<HTMLElement>('.bildschirm')!;
  const haupt = bs.querySelector<HTMLElement>('.haupt')!;
  const detail = bs.querySelector<HTMLElement>('.detail')!;
  const blattEl = bs.querySelector<HTMLElement>('.blatt')!;
  const blattHg = bs.querySelector<HTMLElement>('.blatt-hg')!;
  const reiter = bs.querySelector<HTMLElement>('.reiter')!;

  let toastUhr: ReturnType<typeof setTimeout> | undefined;
  const toast = (t: string, fehler = false) => {
    const el = bs.querySelector<HTMLElement>('.toast')!;
    el.textContent = t; el.style.background = fehler ? 'rgba(217,45,32,.95)' : '';
    el.classList.add('zeigen'); clearTimeout(toastUhr);
    toastUhr = setTimeout(() => el.classList.remove('zeigen'), fehler ? 4000 : 2000);
  };
  const pruefe = (r: CommandStatus, ok?: string) => { if (!r.ok) { toast(r.fehler.join(' '), true); return false; } if (ok) toast(ok); return true; };

  // ---------------- Bausteine ----------------
  const fristText = (d: string) => {
    const n = differenz(z.heute, d);
    return n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern' : n > 1 && n < 7 ? `${WT[wochentag(d)]} ${kurz(d)}` : kurz(d);
  };
  const frist = (a: AufgabeZeile) => (!a.frist || a.abgeschlossen ? '' : `<span class="frist ${a.dringlichkeit ?? ''}">${I.frist}${fristText(a.frist)}${a.wiederholung ? `<span class="wh-zeichen">${I.wiederholung}</span>` : ''}</span>`);
  const wv = (a: AufgabeZeile) => (!a.wiedervorlage || a.abgeschlossen ? '' : `<span class="frist wv">${I.wiedervorlage}${fristText(a.wiedervorlage)}</span>`);
  const statusChip = (s: StatusInfo | null) => (s ? `<span class="chip"><span class="sdot" style="background:${KAT_FARBE[s.kategorie]}"></span>${esc(s.name)}</span>` : '');
  const chips = (a: { verantwortlich: string; ort: string; tags: string[] }) => [
    a.verantwortlich ? `<span class="chip person">@${esc(a.verantwortlich)}</span>` : '',
    a.ort ? `<span class="chip ort">${I.ort}${esc(a.ort)}</span>` : '',
    ...a.tags.map(t => `<span class="chip">#${esc(t)}</span>`)].join('');
  // unter dem Titel immer: Zeile 1 Fälligkeit, Wiedervorlage · Zeile 2 Status, Verantwortlich, Ort, Tags
  const meta = (a: AufgabeZeile, mitStatus = true) => {
    const t = frist(a) + wv(a), r = (mitStatus ? statusChip(a.status) : '') + chips(a);
    return (t ? `<div class="meta termine">${t}</div>` : '') + (r ? `<div class="meta">${r}</div>` : '');
  };
  const zeileHtml = (a: AufgabeZeile, neu = false) => `<div class="zeile-huelle"><div class="aktionen">${neu
      ? `<button class="gesehen" data-gesehen="${a.id}">${I.gesehen}Gesehen</button>`
      : `<button class="arch" data-arch="${a.id}">${I.archiv}Archiv</button>`}<button class="muell" data-zweistufig="loeschen:${a.id}">${I.muell}</button></div>
    <div class="zeile ${a.abgeschlossen ? 'erledigt' : ''}" data-id="${a.id}"><button class="kreis" data-kreis="${a.id}" data-fertig="${a.abgeschlossen ? 1 : 0}">${a.abgeschlossen ? I.erledigt : I.kreis}</button>
    <div class="mitte"><div class="t"><span class="tt">${esc(a.titel)}</span></div>${meta(a)}</div></div></div>`;

  const wolke = () => {
    const s = z.stand;
    if (!s || !s.verfuegbar) return '';
    const [art, icon, titel] = !s.verbunden ? ['offline', I.wolkeAus, 'nicht verbunden']
      : s.fehler ? ['offline', I.wolkeAus, s.fehler]
        : !s.online ? ['offline', I.wolkeAus, 'offline – alles wird lokal gespeichert']
          : s.wartend || s.laeuft ? ['wartet', I.wolkeHoch, s.wartend ? `${s.wartend} Änderungen warten` : 'gleicht ab …']
            : ['', I.wolkeOk, 'abgeglichen'];
    return `<span class="wolke ${art}" data-wolke title="${esc(titel)}">${icon}</span>`;
  };
  // Update-Knopf rechts neben dem Zahnrad – nur, wenn eine neue Version bereitliegt (hervorgehoben); Tipp = neu laden
  const updateKnopf = () => (pwa.neueVersion() ? `<span class="zahnrad update" data-neu-laden title="Neue Version bereit – neu laden">${I.update}</span>` : '');
  const kopf = (t: string) => `<div class="kopf"><span class="logo"></span><span class="titel">${t}</span>${wolke()}<span class="zahnrad" data-einst title="Einstellungen">${I.einstellungen}</span>${updateKnopf()}</div>`;
  const suche = () => `<div class="suche ${z.suche ? 'offen' : ''}"><div class="feld2">${I.suche}<input data-suche placeholder="Suchen … Titel, #tag, @person" value="${esc(z.filter)}"></div><button data-suche-zu>Abbrechen</button></div>`;

  // ---------------- Sichten ----------------
  async function liste(): Promise<string> {
    const l = await body.liste({ filter: z.filter, ohneStatus: true });
    z.heute = l.heute;
    // „Neu“ ist der Eingang: dort stehende Aufgaben erscheinen erst nach „Gesehen“ in ihrer Gruppe
    const istNeu = new Set(l.neu.map(a => a.id));
    const g = (art: string) => (l.gruppen.find(x => x.art === art)?.aufgaben ?? []).filter(a => !istNeu.has(a.id));
    const nachFrist = (as: AufgabeZeile[]) => as.map((a, i) => ({ a, i })).sort((x, y) => (x.a.frist! < y.a.frist! ? -1 : x.a.frist! > y.a.frist! ? 1 : x.i - y.i)).map(x => x.a);
    const gruppen: Record<string, AufgabeZeile[]> = {
      faellig: nachFrist([...g('ueberfaellig'), ...g('heute')]), wird: nachFrist([...g('woche'), ...g('spaeter')]),
      ohne: g('ohne'), zurueck: l.zurueckgestellt, fertig: l.abgeschlossen,
    };
    let h = kopf('Aufgaben') + suche() + `<div class="erfassen">${I.plus}<input data-erfassen placeholder="Neue Aufgabe … #tag @person !frist" enterkeyhint="done" autocomplete="off"></div><div class="inhalt" data-ziehbar>`;
    const neue = l.neu;
    if (neue.length) {
      h += `<div class="abschnitt neu ${z.offen.has('neu') ? 'offen' : ''}" data-abschnitt="neu">${I.rechts}Neu <span class="n">${neue.length}</span></div>`;
      if (z.offen.has('neu')) h += `<div class="gruppe" data-neu-gruppe>${neue.map(a => zeileHtml(a, true)).join('')}</div>`;
    }
    for (const [k, name] of GRUPPEN) {
      const as = gruppen[k]!;
      if (!as.length) continue;
      h += `<div class="abschnitt ${k} ${z.offen.has(k) ? 'offen' : ''}" data-abschnitt="${k}">${I.rechts}${name} <span class="n">${as.length}</span></div>`;
      if (z.offen.has(k)) h += `<div class="gruppe" data-gruppe="${k}">${as.map(a => zeileHtml(a)).join('')}</div>`;
    }
    if (!neue.length && !Object.values(gruppen).some(x => x.length)) h += `<div class="laden">${z.filter ? 'Nichts gefunden.' : 'Noch keine Aufgaben.'}</div>`;
    return h + '</div>';
  }

  async function board(): Promise<string> {
    const b = await body.board();
    z.heute = b.heute; z.board = b;
    const spalten = b.kategorien.flatMap(k => k.spalten.map(s => ({ ...s, kat: k.id, katName: k.name })));
    const offen = (s: { karten: AufgabeZeile[] }) => s.karten.filter(c => !c.abgeschlossen);
    const fertigTeil = (s: { id: string; karten: AufgabeZeile[] }) => {
      const f = s.karten.filter(c => c.abgeschlossen);
      if (!f.length) return '';
      return `<div class="abgeschlossen ${z.fertigOffen.has(s.id) ? 'offen' : ''}" data-fertig-teil="${s.id}">${I.rechts}Abgeschlossen <span class="n">${f.length}</span></div>` +
        (z.fertigOffen.has(s.id) ? f.map(a => `<div class="karte fertig" data-id="${a.id}"><button class="kreis" data-kreis="${a.id}" data-fertig="1">${I.erledigt}</button><div class="mitte"><div class="t">${esc(a.titel)}</div></div></div>`).join('') : '');
    };
    return kopf('Board') + `<div class="kats">${b.kategorien.map(k => `<button data-kat="${k.id}" style="border-bottom-color:var(${KAT_VAR[k.id]})"><b>${k.spalten.reduce((n, s) => n + offen(s).length, 0)}</b> ${esc(k.name)}</button>`).join('')}</div>
      <div class="spalten">${spalten.map(s => z.spalteZu.has(s.id)
        ? `<div class="spalte zu" data-spalte="${s.id}"><div class="spalte-h" data-spalte-zu="${s.id}"><span class="chev">${I.rechts}</span><span class="sdot" style="background:${KAT_FARBE[s.kat]}"></span><span class="n">${offen(s).length}</span><span class="nm">${esc(s.name)}</span></div></div>`
        : `<div class="spalte" data-spalte="${s.id}"><div class="spalte-h" data-spalte-zu="${s.id}"><span class="chev">${I.rechts}</span><span class="sdot" style="background:${KAT_FARBE[s.kat]}"></span><span class="nm">${esc(s.name)}</span> <span class="n">${offen(s).length}</span><span class="kat">${esc(s.katName)}</span></div>
          <div class="karten">${offen(s).map(a => `<div class="karte" data-id="${a.id}"><button class="kreis" data-kreis="${a.id}" data-fertig="0">${I.kreis}</button><div class="mitte"><div class="t">${esc(a.titel)}</div>${meta(a, false)}</div></div>`).join('') || (s.karten.length ? '' : '<div class="leer">leer</div>')}${fertigTeil(s)}</div></div>`).join('')}</div>
      <div class="punkte">${spalten.map((_s, i) => `<i class="${i === 0 ? 'an' : ''}"></i>`).join('')}</div>`;
  }

  const tagName = (d: string) => { const n = differenz(d, z.heute); return n === 0 ? 'Heute' : n === 1 ? 'Gestern' : `${WT[wochentag(d)]} ${kurz(d)}`; };
  async function logbuch(): Promise<string> {
    const lb = await body.logbuch({ tage: z.logTage, filter: z.filter });
    z.heute = lb.heute;
    const eintrag = (t: LogbuchTag['eintraege'][number]) => {
      const [key, sym, titel, unter, oeffnen] = t.art === 'notiz'
        ? [`log-notiz:${t.notizId}`, `<span class="sym istnotiz">${I.notiz}</span>`, t.titel, '', `notiz:${t.notizId}`]
        : t.art === 'punkt'
          ? [`log-punkt:${t.aufgabeId}|${t.text}`, `<span class="sym">${I.punkt}</span>`, t.text, `Punkt in „${t.aufgabentitel}“`, `aufgabe:${t.aufgabeId}`]
          : [`log-aufgabe:${t.aufgabeId}`, `<span class="sym">${I.erledigt}</span>`, t.titel, '', `aufgabe:${t.aufgabeId}`];
      return `<div class="log-huelle"><div class="aktionen"><button class="muell" data-zweistufig="${esc(key)}">${I.muell}</button></div><div class="eintrag" data-oeffnen="${esc(oeffnen)}"><span class="zeit">${t.uhrzeit ?? ''}</span>${sym}<div><div class="t">${esc(titel)}</div>${unter ? `<div class="eu">${esc(unter)}</div>` : ''}</div></div></div>`;
    };
    return kopf('Logbuch') + suche() + `<div class="notizfeld">${I.logbuch}<input data-notizfeld placeholder="Notiz … #tag" enterkeyhint="done" autocomplete="off"></div><div class="inhalt" data-ziehbar data-logbuch>` +
      lb.tage.map(t => `<div class="tag-h ${t.datum === z.heute ? 'heute' : ''}">${tagName(t.datum)}</div><div class="gruppe">${t.eintraege.map(eintrag).join('')}</div>`).join('') +
      (lb.weiter ? '<div class="laden" data-mehr>Ältere Einträge …</div>' : '') + '</div>';
  }

  // ---------------- Zeichnen ----------------
  let lauf = 0;
  async function zeichnen(): Promise<void> {
    const nr = ++lauf;
    z.stand = await body.abgleich();
    if (z.stand.verfuegbar && !z.stand.verbunden) { willkommen(); return; }
    reiter.style.display = '';
    const scroll = haupt.querySelector('.inhalt')?.scrollTop ?? 0;
    const links = haupt.querySelector('.spalten')?.scrollLeft ?? 0;
    const fokus = document.activeElement as HTMLInputElement | null;
    const fokusSel = fokus?.matches?.('[data-suche],[data-erfassen],[data-notizfeld]') ? [fokus.dataset.suche !== undefined ? '[data-suche]' : fokus.dataset.erfassen !== undefined ? '[data-erfassen]' : '[data-notizfeld]', fokus.value, fokus.selectionStart] as const : null;
    const html = z.sicht === 'liste' ? await liste() : z.sicht === 'board' ? await board() : await logbuch();
    if (nr !== lauf) return; // inzwischen neuer Auftrag
    const zuNeu = (await body.datenstand()).zuNeu;
    if (nr !== lauf) return;
    // Schema-Schutz: ein anderes Gerät ist neuer → Hinweis statt stillem Weglassen
    haupt.innerHTML = (zuNeu ? `<div class="veraltet" data-neu-laden>Ein anderes Gerät nutzt eine neuere Rundblick-Version. Tippen zum Neuladen.</div>` : '') + html;
    const inh = haupt.querySelector('.inhalt'); if (inh) inh.scrollTop = scroll;
    const sp = haupt.querySelector('.spalten'); if (sp) sp.scrollLeft = links;
    if (fokusSel) { const f = haupt.querySelector<HTMLInputElement>(fokusSel[0]); if (f) { f.value = fokusSel[1]; f.focus(); if (fokusSel[2] !== null) f.setSelectionRange(fokusSel[2], fokusSel[2]); } }
    reiter.querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('an', b.dataset.sicht === z.sicht));
    wischenAnbinden(); ziehenAnbinden(); punkteAnbinden();
  }

  function willkommen(): void {
    reiter.style.display = 'none';
    const fehler = new URLSearchParams(location.search).get('error_description');
    haupt.innerHTML = `<div class="willkommen"><img src="/logo.svg" alt=""><h1>Rundblick</h1>
      <p>Deine Aufgaben aus der Rundblick-App am Mac – auch unterwegs und offline.</p>
      <p>Die Daten liegen in deiner Dropbox im Ordner <b>Apps/Rundblick</b>. Rundblick sieht nur diesen Ordner.</p>
      <button data-verbinden>${I.anmelden}Mit Dropbox verbinden</button>${fehler ? `<p class="fehler">${esc(fehler)}</p>` : ''}</div>`;
  }

  // ---------------- Aufgabe (Vollbild) ----------------
  let detailDaten: AufgabeDetails | null = null;
  async function detailZeigen(): Promise<void> {
    if (!z.detail) { detail.classList.remove('offen'); return; }
    if (z.detail.art === 'notiz') return notizZeigen(z.detail.id);
    const a = await body.aufgabe({ aufgabeId: z.detail.id });
    if (!a) { z.detail = null; detail.classList.remove('offen'); return; }
    detailDaten = a;
    const notiz = z.notizBearbeiten
      ? `<textarea class="notiz-text" data-notiz-text placeholder="Notiz … **fett**, *kursiv*, - Liste, - [ ] Punkt, Links mit ://">${esc(a.beschreibung)}</textarea>`
      : `<div class="md" data-notiz-ansicht>${a.beschreibung.trim() ? markdownHtml(a.beschreibung) : '<span class="leer-notiz">Notiz …</span>'}</div>`;
    detail.innerHTML = `<div class="kopf"><button class="knopf" data-zurueck>${I.zurueck}</button><span style="flex:1"></span><button class="knopf" data-arch="${a.id}">${I.archiv}</button><button class="knopf muell2" data-zweistufig="detail-loeschen:${a.id}">${I.muell}</button></div>
      <div class="koerper">
        <div style="display:flex;gap:10px;align-items:flex-start"><button class="kreis" data-kreis="${a.id}" data-fertig="${a.abgeschlossen ? 1 : 0}" style="margin-top:2px">${a.abgeschlossen ? I.erledigt : I.kreis}</button><textarea class="titel-feld" rows="1" data-titel>${esc(a.titel)}</textarea></div>
        <div class="notiz gross ${z.notizBearbeiten ? 'bearbeiten' : ''}">${notiz}</div>
        <div class="feld"><div class="bilder">${a.anhangliste.map((b, i) => `<div class="bild" data-bild="${i}" data-anhang="${b.id}"><b>${b.nr}</b></div>`).join('')}
          <label class="neu" title="Foto aufnehmen oder auswählen">${I.bildNeu}<input type="file" accept="image/*" multiple data-bild-neu hidden></label></div></div>
        <div class="kurzinfo" data-angaben>${zusammenfassung(a)}<span class="chev">${I.hoch}</span></div>
      </div>`;
    detail.classList.add('offen');
    const tf = detail.querySelector<HTMLTextAreaElement>('[data-titel]')!;
    const passen = () => { tf.style.height = 'auto'; tf.style.height = tf.scrollHeight + 'px'; };
    passen(); tf.addEventListener('input', passen);
    tf.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tf.blur(); } });
    tf.addEventListener('blur', async () => {
      const t = tf.value.trim();
      if (t && t !== a.titel) pruefe(await body.aufgabeAendern({ aufgabeId: a.id, aenderungen: { titel: t } }));
    });
    const nt = detail.querySelector<HTMLTextAreaElement>('[data-notiz-text]');
    if (nt) {
      nt.focus(); nt.setSelectionRange(nt.value.length, nt.value.length);
      nt.addEventListener('blur', async () => {
        z.notizBearbeiten = false;
        if (nt.value !== a.beschreibung) pruefe(await body.aufgabeAendern({ aufgabeId: a.id, aenderungen: { beschreibung: nt.value } }));
        void detailZeigen();
      });
    }
    bilderLaden(a);
  }

  const zusammenfassung = (a: AufgabeZeile) => [frist(a), wv(a), statusChip(a.status), chips(a)].join('') || 'Frist, Wiedervorlage, Status, Verantwortlich, Ort, Tags';

  function bilderLaden(a: AufgabeDetails, versuch = 0): void {
    let fehlt = false;
    detail.querySelectorAll<HTMLElement>('[data-anhang]').forEach(async el => {
      if (el.style.backgroundImage) return;
      const b = await body.anhang({ anhangId: el.dataset.anhang! });
      if (b) el.style.backgroundImage = `url(${b.url})`; else fehlt = true;
    });
    // noch nicht da (wird aus der Dropbox geholt): später erneut fragen
    setTimeout(() => { if (fehlt && versuch < 8 && detailDaten?.id === a.id) bilderLaden(a, versuch + 1); }, 1500);
  }

  async function notizZeigen(id: string): Promise<void> {
    const n = await body.notiz({ notizId: id });
    if (!n) { z.detail = null; detail.classList.remove('offen'); return; }
    detail.innerHTML = `<div class="kopf"><button class="knopf" data-zurueck>${I.zurueck}</button><span style="flex:1;color:var(--mute);font-size:13px">${tagName(n.datum)}${n.tags.length ? ' · ' + n.tags.map(t => '#' + esc(t)).join(' ') : ''}</span><button class="knopf muell2" data-zweistufig="notiz-loeschen:${n.id}">${I.muell}</button></div>
      <div class="koerper"><div class="notiz gross ${z.notizBearbeiten ? 'bearbeiten' : ''}">${z.notizBearbeiten
        ? `<textarea class="notiz-text" data-notiztext-log>${esc(n.text)}</textarea>`
        : `<div class="md" data-notiz-ansicht>${markdownHtml(n.text)}</div>`}</div></div>`;
    detail.classList.add('offen');
    const nt = detail.querySelector<HTMLTextAreaElement>('[data-notiztext-log]');
    if (nt) {
      nt.focus();
      nt.addEventListener('blur', async () => {
        z.notizBearbeiten = false;
        if (nt.value.trim() && nt.value !== n.text) pruefe(await body.notizAendern({ notizId: n.id, text: nt.value }));
        void detailZeigen();
      });
    }
  }

  // ---------------- Schubladen ----------------
  const blattZu = () => { blattEl.className = 'blatt'; blattHg.classList.remove('offen'); einstOffen = false; };
  const blattAuf = (html: string, klasse = 'angaben-blatt') => {
    blattEl.className = `blatt ${klasse} offen`; blattEl.innerHTML = html; blattHg.classList.add('offen');
  };

  async function angabenBlatt(): Promise<void> {
    const a = detailDaten; if (!a) return;
    if (!z.spalten.length) z.spalten = (await body.einstellungen()).spalten;
    blattAuf(`<div class="griff"></div><div class="bk">Angaben<button data-blatt-zu>Fertig</button></div><div class="angaben">
      <div class="zwei"><div class="feld"><label>Frist</label><div class="wert">${I.frist}<input type="date" data-angabe="frist" value="${a.frist ?? ''}"></div></div>
        <div class="feld"><label>Wiedervorlage</label><div class="wert">${I.wiedervorlage}<input type="date" data-angabe="wiedervorlage" value="${a.wiedervorlage ?? ''}"></div></div></div>
      <div class="feld"><label>Wiederholung (ab Frist)</label><div class="wert" data-wh-feld>${I.wiederholung}${wiederholungFelder(a.wiederholung, false, !a.frist)}</div></div>
      <div class="feld"><label>Status</label><div class="status-chips"><button class="${!a.status ? 'an' : ''}" data-status="">ohne</button>${z.spalten.map(s => `<button class="${a.status?.id === s.id ? 'an' : ''}" data-status="${s.id}"><span class="sdot" style="background:${KAT_FARBE[s.kategorie]}"></span>${esc(s.name)}</button>`).join('')}</div></div>
      <div class="zwei"><div class="feld"><label>Verantwortlich</label><div class="wert"><input data-angabe="verantwortlich" value="${esc(a.verantwortlich)}" autocomplete="off"></div></div>
        <div class="feld"><label>Ort</label><div class="wert">${I.ort}<input data-angabe="ort" value="${esc(a.ort)}" autocomplete="off"></div></div></div>
      <div class="feld"><label>Tags</label><div class="wert"><input data-angabe="tags" value="${esc(a.tags.map(t => '#' + t).join(' '))}" placeholder="#tag #noch-einer" autocomplete="off" autocapitalize="off"></div></div>
    </div>`);
  }

  let einstOffen = false;
  let abmeldenFragen = false;
  let abmeldenUhr: ReturnType<typeof setTimeout> | undefined;
  async function einstellungen(): Promise<void> {
    einstOffen = true;
    const s = z.stand ?? await body.abgleich();
    const zuletzt = s.zuletzt ? new Date(s.zuletzt) : null;
    const vor = zuletzt ? Math.round((Date.now() - zuletzt.getTime()) / 60000) : null;
    blattAuf(`<div class="griff"></div><div class="bk">Einstellungen<button data-blatt-zu>Fertig</button></div><div class="angaben">
      <div class="feld"><label>Dropbox</label><div class="einst-gruppe">
        <div class="einst-zeile">${I.wolke}Verbunden<span class="rechts ok">${I.haken}${esc(s.konto ?? '')}</span></div>
        <div class="einst-zeile">Ordner<span class="rechts">Apps/Rundblick</span></div>
        <button class="einst-knopf gefahr ${abmeldenFragen ? 'fragen' : ''}" data-abmelden>${abmeldenFragen ? (s.wartend ? `Abmelden? ${s.wartend} Änderungen gehen verloren` : 'Wirklich abmelden?') : 'Abmelden'}</button>
      </div><div class="einst-hinweis">Abmelden löscht die Daten auf diesem Gerät; in der Dropbox bleibt alles.</div></div>
      <div class="feld"><label>Gerät</label><div class="einst-gruppe">
        <div class="einst-zeile">Name<span class="rechts">${I.schloss}${esc(s.geraet)}</span></div>
      </div><div class="einst-hinweis">Eigene Datei <code>events/${esc(s.geraet)}.jsonl</code>.</div></div>
      <div class="feld"><label>Abgleich</label><div class="einst-gruppe">
        <div class="einst-zeile">Zuletzt<span class="rechts">${vor === null ? '–' : vor < 1 ? 'gerade eben' : vor < 60 ? `vor ${vor} Min.` : zuletzt!.toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="einst-zeile">Wartende Änderungen<span class="rechts ${s.wartend ? 'warn' : ''}">${s.wartend || 'keine'}</span></div>
        <div class="einst-zeile">Speicher<span class="rechts ${s.speicherDauerhaft ? 'ok' : ''}">${I.speicher}${s.speicherDauerhaft === null ? 'unbekannt' : s.speicherDauerhaft ? 'dauerhaft' : 'vorläufig'}</span></div>
        ${s.fehler ? `<div class="einst-zeile" style="color:var(--over);font-size:13px">${esc(s.fehler)}</div>` : !s.online ? '<div class="einst-zeile" style="color:var(--over);font-size:13px">offline – alles wird lokal gespeichert</div>' : ''}
        <button class="einst-knopf" data-abgleichen>${I.abgleichen}Jetzt abgleichen</button>
      </div></div>
      <div class="feld"><label>Version</label><div class="einst-gruppe">
        <div class="einst-zeile">Rundblick Phone<span class="rechts">${esc(pwa.version)}</span></div>
        ${pwa.neueVersion() ? `<button class="einst-knopf" data-neu-laden>${I.update}Neue Version bereit – neu laden</button>` : `<div class="einst-zeile">Stand<span class="rechts ok">${I.haken}aktuell</span></div>`}
      </div></div>
    </div>`);
  }

  function verschiebenBlatt(id: string): void {
    const b = z.board; if (!b) return;
    const karte = b.kategorien.flatMap(k => k.spalten).flatMap(s => s.karten).find(c => c.id === id);
    if (!karte) return;
    blattAuf(`<div class="bt">„${esc(karte.titel)}“ verschieben nach</div>${b.kategorien.flatMap(k => k.spalten.map(s => `<button data-nach="${s.id}"><span class="sdot" style="background:${KAT_FARBE[k.id]}"></span>${esc(s.name)}${karte.status?.id === s.id ? ' <span style="color:var(--mute);font-size:13px">(jetzt)</span>' : ''}</button>`)).join('')}<button data-nach="nach-oben">${I.nachOben}Ganz nach oben in der Spalte</button>`, '');
    blattEl.dataset.id = id;
  }

  // ---------------- Großansicht Bild ----------------
  async function bildZeigen(a: AufgabeDetails, i: number): Promise<void> {
    const info = a.anhangliste[i]; if (!info) return;
    const b = await body.anhang({ anhangId: info.id });
    const v = document.createElement('div'); v.className = 'bildansicht';
    v.innerHTML = `<div class="ba-kopf"><button class="knopf" data-ba-zu>${I.x}</button><span>${i + 1} / ${a.anhangliste.length}</span><button class="knopf muell-ba" data-zweistufig="bild-loeschen:${a.id}|${info.id}">${I.muell}</button></div>
      <div class="ba-bild" style="${b ? `background-image:url(${b.url})` : ''}" data-ba-zu></div>`;
    bs.appendChild(v);
  }

  // Fotos vor dem Hochladen verkleinern: längste Seite 2000 px, JPEG 0,85 (HEIC liefert Safari bereits als JPEG)
  const verkleinern = (datei: File) => new Promise<{ name: string; daten: string } | null>(ok => {
    const img = new Image(), url = URL.createObjectURL(datei);
    img.onload = () => {
      const f = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok({ name: datei.name.replace(/\.\w+$/, '') + '.jpg', daten: c.toDataURL('image/jpeg', 0.85).split(',')[1]! });
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
    img.src = url;
  });

  // ---------------- Zweistufige Aktionen (Mülleimer → „?“ → ausführen) ----------------
  let fragen: { el: HTMLElement; html: string; uhr: ReturnType<typeof setTimeout> } | null = null;
  const fragenZurueck = () => { if (fragen) { clearTimeout(fragen.uhr); fragen.el.classList.remove('fragen'); fragen.el.innerHTML = fragen.html; fragen = null; } };
  async function zweistufig(el: HTMLElement): Promise<void> {
    if (fragen?.el !== el) {
      fragenZurueck();
      fragen = { el, html: el.innerHTML, uhr: setTimeout(fragenZurueck, 5000) };
      el.classList.add('fragen'); el.textContent = '?';
      return;
    }
    fragenZurueck();
    const [art, rest] = el.dataset.zweistufig!.split(/:(.*)/s) as [string, string];
    if (art === 'loeschen' || art === 'log-aufgabe') { pruefe(await body.aufgabeVerwerfen({ aufgabeId: rest }), 'Gelöscht'); }
    else if (art === 'detail-loeschen') { if (pruefe(await body.aufgabeVerwerfen({ aufgabeId: rest }), 'Gelöscht')) detailSchliessen(); }
    else if (art === 'log-notiz') pruefe(await body.notizVerwerfen({ notizId: rest }), 'Notiz gelöscht');
    else if (art === 'notiz-loeschen') { if (pruefe(await body.notizVerwerfen({ notizId: rest }), 'Notiz gelöscht')) detailSchliessen(); }
    else if (art === 'log-punkt') {
      // Punkt löschen = aus der Checkliste der Aufgabe entfernen
      const [aufgabeId, text] = rest.split(/\|(.*)/s) as [string, string];
      const a = await body.aufgabe({ aufgabeId });
      if (a) {
        const beschreibung = a.beschreibung.split('\n').filter(l => { const m = l.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/); return !m || m[2]!.trim() !== text.trim(); }).join('\n');
        pruefe(await body.aufgabeAendern({ aufgabeId, aenderungen: { beschreibung } }), 'Punkt gelöscht');
      }
    } else if (art === 'bild-loeschen') {
      const [aufgabeId, anhangId] = rest.split('|') as [string, string];
      bs.querySelector('.bildansicht')?.remove();
      pruefe(await body.anhangEntfernen({ aufgabeId, anhangId }), 'Bild entfernt');
    }
  }
  const detailSchliessen = () => { z.detail = null; z.notizBearbeiten = false; detailDaten = null; detail.classList.remove('offen'); void zeichnen(); };

  // ---------------- Wischen ----------------
  let zug: Zug | null = null;
  function wischenAnbinden(): void {
    haupt.querySelectorAll<HTMLElement>('.zeile, .eintrag').forEach(zl => {
      let x0: number | null = null, y0 = 0, dx = 0, waagerecht: boolean | null = null;
      const w = (zl.parentNode as HTMLElement).querySelector<HTMLElement>('.aktionen')?.offsetWidth || 144;
      zl.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; dx = 0; waagerecht = null; zl.style.transition = 'none'; });
      zl.addEventListener('pointermove', e => {
        if (x0 === null || zug) return;
        if (waagerecht === null && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) waagerecht = Math.abs(e.clientX - x0) > Math.abs(e.clientY - y0);
        if (!waagerecht) return;
        dx = Math.min(0, e.clientX - x0) + (zl.dataset.wisch === '1' ? -w : 0);
        zl.style.transform = `translateX(${Math.max(-w, Math.min(0, dx))}px)`;
      });
      const ende = () => {
        if (x0 === null) return;
        zl.style.transition = '';
        if (waagerecht) { const auf = dx < -50; zl.style.transform = auf ? `translateX(-${w}px)` : ''; zl.dataset.wisch = auf ? '1' : ''; zl.dataset.gewischt = '1'; }
        x0 = null;
      };
      zl.addEventListener('pointerup', ende); zl.addEventListener('pointercancel', ende); zl.addEventListener('pointerleave', ende);
    });
  }

  // ---------------- Herunterziehen → Suche ----------------
  function ziehenAnbinden(): void {
    const inh = haupt.querySelector<HTMLElement>('[data-ziehbar]');
    if (!inh) return;
    if (inh.dataset.logbuch !== undefined) inh.addEventListener('scroll', () => {
      if (inh.scrollTop + inh.clientHeight > inh.scrollHeight - 200 && haupt.querySelector('[data-mehr]')) { haupt.querySelector('[data-mehr]')!.removeAttribute('data-mehr'); z.logTage += 14; void zeichnen(); }
    }, { passive: true });
    if (z.suche) return;
    let y0: number | null = null;
    const oeffnen = () => { z.suche = true; void zeichnen().then(() => haupt.querySelector<HTMLInputElement>('[data-suche]')?.focus()); };
    inh.addEventListener('touchstart', e => { y0 = inh.scrollTop <= 0 ? e.touches[0]!.clientY : null; }, { passive: true });
    inh.addEventListener('touchmove', e => { if (y0 !== null && e.touches[0]!.clientY - y0 > 70) { y0 = null; oeffnen(); } }, { passive: true });
    inh.addEventListener('wheel', e => { if (inh.scrollTop <= 0 && e.deltaY < -40) oeffnen(); }, { passive: true });
  }

  function punkteAnbinden(): void {
    const sp = haupt.querySelector<HTMLElement>('.spalten'); if (!sp) return;
    const punkte = [...haupt.querySelectorAll<HTMLElement>('.punkte i')];
    const setzen = () => {
      const mitte = sp.getBoundingClientRect().left + sp.clientWidth / 2;
      let best = 0, abst = Infinity;
      sp.querySelectorAll<HTMLElement>('.spalte').forEach((s, i) => { const r = s.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mitte); if (d < abst) { abst = d; best = i; } });
      punkte.forEach((p, i) => p.classList.toggle('an', i === best));
    };
    sp.addEventListener('scroll', setzen, { passive: true }); setzen();
  }

  // ---------------- Lange drücken → ziehen (umsortieren, im Board auch über Spalten) ----------------
  type Zug = { el: HTMLElement; huelle: HTMLElement; geist: HTMLElement; brett: boolean; x: number; y: number; x0: number; y0: number; dx: number; dy: number; bewegt: boolean; uhr: ReturnType<typeof setInterval>; vorher: string | null };
  let druck: ReturnType<typeof setTimeout> | 'lang' | null = null;
  bs.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>('.karte, .zeile');
    if (!el || t.closest('.kreis, .aktionen, [data-neu-gruppe], .karte.fertig') || el.dataset.wisch === '1' || el.closest('.detail')) return;
    if (el.classList.contains('zeile') && !el.closest('[data-gruppe]')) return;
    const x0 = e.clientX, y0 = e.clientY;
    druck = setTimeout(() => { druck = 'lang'; zugStart(el, x0, y0); }, 450);
    const ab = (ev: PointerEvent) => { if (druck !== 'lang' && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) { clearTimeout(druck as ReturnType<typeof setTimeout>); druck = null; } };
    bs.addEventListener('pointermove', ab);
    bs.addEventListener('pointerup', () => bs.removeEventListener('pointermove', ab), { once: true });
  });
  bs.addEventListener('pointermove', e => {
    if (!zug) return;
    e.preventDefault();
    zug.x = e.clientX; zug.y = e.clientY;
    if (Math.hypot(zug.x - zug.x0, zug.y - zug.y0) > 10) zug.bewegt = true;
    const br = bs.getBoundingClientRect();
    zug.geist.style.left = `${zug.x - br.left - zug.dx}px`; zug.geist.style.top = `${zug.y - br.top - zug.dy}px`;
  });
  bs.addEventListener('pointerup', () => { if (druck && druck !== 'lang') { clearTimeout(druck); druck = null; } if (zug) void zugEnde(); });
  bs.addEventListener('touchmove', e => { if (zug) e.preventDefault(); }, { passive: false });
  bs.addEventListener('contextmenu', e => { if (zug || druck === 'lang') e.preventDefault(); });

  function zugStart(el: HTMLElement, x: number, y: number): void {
    const huelle = el.classList.contains('zeile') ? el.closest<HTMLElement>('.zeile-huelle')! : el;
    el.style.transform = '';
    const r = huelle.getBoundingClientRect(), br = bs.getBoundingClientRect();
    const geist = huelle.cloneNode(true) as HTMLElement; geist.classList.add('geist');
    geist.style.cssText = `left:${r.left - br.left}px;top:${r.top - br.top}px;width:${r.width}px`;
    bs.appendChild(geist); huelle.classList.add('platzhalter');
    const sp = haupt.querySelector<HTMLElement>('.spalten'); if (sp) sp.style.scrollSnapType = 'none';
    navigator.vibrate?.(10);
    zug = { el, huelle, geist, brett: !!sp, x, y, x0: x, y0: y, dx: x - r.left, dy: y - r.top, bewegt: false, uhr: setInterval(randRollen, 16), vorher: huelle.closest<HTMLElement>('[data-spalte]')?.dataset.spalte ?? null };
  }
  function randRollen(): void {
    if (!zug) return;
    const { x, y } = zug;
    if (zug.brett) {
      const sp = haupt.querySelector<HTMLElement>('.spalten')!, r = sp.getBoundingClientRect();
      if (x < r.left + 34) sp.scrollLeft -= 9; else if (x > r.right - 34) sp.scrollLeft += 9;
      const k = zug.huelle.closest<HTMLElement>('.karten'); if (k) { const kr = k.getBoundingClientRect(); if (y < kr.top + 30) k.scrollTop -= 6; else if (y > kr.bottom - 30) k.scrollTop += 6; }
    } else {
      const inh = haupt.querySelector<HTMLElement>('.inhalt')!, r = inh.getBoundingClientRect();
      if (y < r.top + 34) inh.scrollTop -= 6; else if (y > r.bottom - 34) inh.scrollTop += 6;
    }
    if (zug.bewegt) zugPlatzieren();
  }
  const einreihen = (huelle: HTMLElement, ziel: HTMLElement, y: number) => {
    const m = ziel.getBoundingClientRect(), vor = y < m.top + m.height / 2;
    if (vor && huelle.nextSibling !== ziel) ziel.parentNode!.insertBefore(huelle, ziel);
    if (!vor && ziel.nextSibling !== huelle) ziel.parentNode!.insertBefore(huelle, ziel.nextSibling);
  };
  function zugPlatzieren(): void {
    const { x, y, huelle, geist } = zug!;
    geist.style.display = 'none'; const unter = document.elementFromPoint(x, y) as HTMLElement | null; geist.style.display = '';
    if (!unter) return;
    if (zug!.brett) {
      const spalte = unter.closest<HTMLElement>('.spalte:not(.zu)'); if (!spalte) return;
      const karten = spalte.querySelector<HTMLElement>('.karten')!, ziel = unter.closest<HTMLElement>('.karte:not(.fertig)');
      if (ziel && ziel !== huelle) { einreihen(huelle, ziel, y); return; }
      if (!ziel && huelle.parentNode !== karten) {
        const offene = [...karten.querySelectorAll<HTMLElement>('.karte:not(.fertig)')];
        const nach = offene.at(-1);
        karten.insertBefore(huelle, nach ? nach.nextSibling : karten.firstChild);
      }
      karten.querySelector('.leer')?.remove();
    } else {
      const ziel = unter.closest<HTMLElement>('.zeile-huelle');
      if (ziel && ziel !== huelle && ziel.parentNode === huelle.parentNode) einreihen(huelle, ziel, y);
    }
  }
  async function zugEnde(): Promise<void> {
    const { huelle, geist, el, bewegt, brett, vorher } = zug!; clearInterval(zug!.uhr); zug = null;
    geist.remove(); huelle.classList.remove('platzhalter');
    const sp = haupt.querySelector<HTMLElement>('.spalten'); if (sp) sp.style.scrollSnapType = '';
    const id = el.dataset.id!;
    if (!bewegt) { if (brett) verschiebenBlatt(id); return; }
    if (brett) {
      const neu = huelle.closest<HTMLElement>('[data-spalte]')!.dataset.spalte!;
      if (neu !== vorher && !pruefe(await body.statusSetzen({ aufgabeId: id, status: neu }))) { void zeichnen(); return; }
    }
    const ids = [...(huelle.parentNode as HTMLElement).querySelectorAll<HTMLElement>(brett ? '.karte:not(.fertig)' : '.zeile')].map(x => x.dataset.id!);
    const i = ids.indexOf(id);
    pruefe(await body.aufgabeVerschieben({ aufgabeId: id, oben: ids[i - 1] ?? null, unten: ids[i + 1] ?? null }));
    void zeichnen();
  }

  // ---------------- Klicks ----------------
  bs.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    const q = <T extends HTMLElement = HTMLElement>(s: string) => t.closest<T>(s);
    if (druck === 'lang') { druck = null; if (!q('.blatt')) return; }
    const zw = q('[data-zweistufig]');
    if (zw) { await zweistufig(zw); return; }
    if (fragen) fragenZurueck();
    if (abmeldenFragen && !q('[data-abmelden]')) { abmeldenFragen = false; clearTimeout(abmeldenUhr); if (einstOffen && q('.blatt')) { void einstellungen(); return; } }

    if (q('[data-verbinden]')) { pruefe(await body.abgleichVerbinden()); return; }
    if (q('[data-sicht]')) { z.sicht = q('[data-sicht]')!.dataset.sicht as Sicht; z.suche = false; z.filter = ''; merken(); void zeichnen(); return; }
    if (q('[data-wolke]')) { const r = await body.abgleichen(); const s = await body.abgleich(); toast(!r.ok ? r.fehler.join(' ') : !s.online ? 'Offline – alles wird lokal gespeichert' : 'Abgeglichen mit der Dropbox', !r.ok); return; }
    if (q('[data-einst]')) { abmeldenFragen = false; void einstellungen(); return; }
    if (q('[data-abgleichen]')) { const r = await body.abgleichen(); pruefe(r, 'Abgeglichen'); z.stand = await body.abgleich(); void einstellungen(); return; }
    if (q('[data-neu-laden]')) { pwa.neuLaden(); return; }
    if (q('[data-abmelden]')) {
      if (!abmeldenFragen) { abmeldenFragen = true; void einstellungen(); clearTimeout(abmeldenUhr); abmeldenUhr = setTimeout(() => { abmeldenFragen = false; if (einstOffen) void einstellungen(); }, 5000); return; }
      abmeldenFragen = false; blattZu(); await body.abgleichTrennen(); return;
    }
    if (q('[data-blatt-zu]') || q('.blatt-hg')) { blattZu(); return; }
    if (q('[data-nach]')) {
      const id = blattEl.dataset.id!, nach = q('[data-nach]')!.dataset.nach!;
      blattZu();
      if (nach === 'nach-oben') {
        const spalte = z.board?.kategorien.flatMap(k => k.spalten).find(s => s.karten.some(c => c.id === id));
        const erste = spalte?.karten.find(c => !c.abgeschlossen && c.id !== id);
        if (erste) pruefe(await body.aufgabeVerschieben({ aufgabeId: id, oben: null, unten: erste.id }), 'Ganz nach oben');
      } else pruefe(await body.statusSetzen({ aufgabeId: id, status: nach }), 'Verschoben');
      return;
    }
    if (q('[data-status]')) {
      const a = detailDaten; if (!a) return;
      if (pruefe(await body.statusSetzen({ aufgabeId: a.id, status: q('[data-status]')!.dataset.status || null }))) { await detailZeigen(); void angabenBlatt(); }
      return;
    }
    if (q('[data-abschnitt]')) { const k = q('[data-abschnitt]')!.dataset.abschnitt!; z.offen.has(k) ? z.offen.delete(k) : z.offen.add(k); merken(); void zeichnen(); return; }
    if (q('[data-fertig-teil]')) { const k = q('[data-fertig-teil]')!.dataset.fertigTeil!; z.fertigOffen.has(k) ? z.fertigOffen.delete(k) : z.fertigOffen.add(k); merken(); void zeichnen(); return; }
    if (q('[data-spalte-zu]') || q('.spalte.zu')) { const el = q('.spalte.zu') ?? q('[data-spalte-zu]')!; const id = el.dataset.spalteZu ?? el.dataset.spalte!; z.spalteZu.has(id) ? z.spalteZu.delete(id) : z.spalteZu.add(id); merken(); void zeichnen(); return; }
    if (q('[data-kat]')) {
      const k = q('[data-kat]')!.dataset.kat!;
      const erste = z.board?.kategorien.find(x => x.id === k)?.spalten[0]?.id;
      const sp = haupt.querySelector<HTMLElement>('.spalten'), el = erste ? sp?.querySelector<HTMLElement>(`[data-spalte="${erste}"]`) : null;
      if (!sp || !el) return;
      // Lage aus dem DOM messen – stimmt egal, welche Spalten zugeklappt sind
      const links = el.getBoundingClientRect().left - sp.getBoundingClientRect().left + sp.scrollLeft;
      sp.scrollTo({ left: el.classList.contains('zu') ? links - 10 : links - (sp.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
      return;
    }
    if (q('[data-suche-zu]')) { z.suche = false; z.filter = ''; void zeichnen(); return; }
    if (q('[data-neu-laden]')) { location.reload(); return; }
    if (q('[data-gesehen]')) { await ausNeu(q('[data-gesehen]')!.dataset.gesehen!); void zeichnen(); return; }
    if (q('[data-kreis]')) {
      const k = q('[data-kreis]')!, id = k.dataset.kreis!;
      const r = k.dataset.fertig === '1' ? await body.aufgabeWiedereroeffnen({ aufgabeId: id }) : await body.aufgabeAbschliessen({ aufgabeId: id });
      pruefe(r, k.dataset.fertig === '1' ? 'Wieder offen' : 'Abgeschlossen');
      return;
    }
    if (q('[data-arch]')) { const id = q('[data-arch]')!.dataset.arch!; if (pruefe(await body.aufgabeArchivieren({ aufgabeId: id }), 'Archiviert') && z.detail?.id === id) detailSchliessen(); return; }
    // ---- in der Aufgabe
    if (q('[data-zurueck]')) { (document.activeElement as HTMLElement | null)?.blur(); setTimeout(detailSchliessen, 0); return; }
    if (q('[data-angaben]')) { void angabenBlatt(); return; }
    if (q('[data-notiz-ansicht] a')) return; // Link öffnet sich
    if (q('[data-notiz-ansicht] input[data-zeile]')) {
      e.preventDefault();
      const a = detailDaten; if (!a) return;
      pruefe(await body.aufgabeAendern({ aufgabeId: a.id, aenderungen: { beschreibung: checkboxUmschalten(a.beschreibung, Number(q('[data-zeile]')!.dataset.zeile)) } }));
      return;
    }
    if (q('[data-notiz-ansicht]')) { z.notizBearbeiten = true; void detailZeigen(); return; }
    if (q('[data-bild]')) { if (detailDaten) void bildZeigen(detailDaten, Number(q('[data-bild]')!.dataset.bild)); return; }
    if (q('[data-ba-zu]')) { bs.querySelector('.bildansicht')?.remove(); return; }
    // ---- Zeilen, Karten, Logbuch
    const zl = q('.zeile, .eintrag');
    if (zl) {
      if (zl.dataset.gewischt) { zl.dataset.gewischt = ''; return; }
      if (zl.dataset.wisch) { zl.style.transform = ''; zl.dataset.wisch = ''; return; }
      if (zl.dataset.oeffnen) { const [art, id] = zl.dataset.oeffnen.split(':') as ['aufgabe' | 'notiz', string]; z.detail = { art, id }; void detailZeigen(); return; }
      void ausNeu(zl.dataset.id!); z.detail = { art: 'aufgabe', id: zl.dataset.id! }; void detailZeigen(); void zeichnen(); return;
    }
    const k = q('.karte'); if (k) { void ausNeu(k.dataset.id!); z.detail = { art: 'aufgabe', id: k.dataset.id! }; void detailZeigen(); }
  });

  // Eingaben: Erfassen, Notiz, Suche, Angaben
  bs.addEventListener('keydown', async e => {
    const t = e.target as HTMLInputElement;
    if (e.key !== 'Enter' || !t.value?.trim()) return;
    if (t.matches('[data-erfassen]')) {
      const r = await body.schnellErfassen({ text: t.value.trim() });
      if (pruefe(r, 'Erfasst')) { t.value = ''; z.offen.add('neu'); merken(); void zeichnen(); }
    } else if (t.matches('[data-notizfeld]')) {
      if (pruefe(await body.notizErfassen({ text: t.value.trim() }), 'Notiz gespeichert')) { t.value = ''; void zeichnen(); }
    } else if (t.matches('[data-angabe]')) t.blur();
  });
  let sucheUhr: ReturnType<typeof setTimeout> | undefined;
  bs.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-suche]')) { z.filter = t.value; clearTimeout(sucheUhr); sucheUhr = setTimeout(() => void zeichnen(), 150); }
  });
  bs.addEventListener('change', async e => {
    const t = e.target as HTMLInputElement;
    const a = detailDaten;
    if (t.matches('[data-bild-neu]') && a) {
      const dateien = [...(t.files ?? [])];
      t.value = '';
      for (const d of dateien) {
        const b = await verkleinern(d);
        if (b) pruefe(await body.anhangHinzufuegen({ aufgabeId: a.id, name: b.name, typ: 'image/jpeg', daten: b.daten }));
      }
      if (dateien.length) toast(dateien.length === 1 ? 'Bild hinzugefügt' : `${dateien.length} Bilder hinzugefügt`);
      return;
    }
    if (t.matches('[data-wh]') && a) {
      if (pruefe(await body.aufgabeAendern({ aufgabeId: a.id, aenderungen: { wiederholung: wiederholungLesen(t.closest('[data-wh-feld]')!) } }))) { await detailZeigen(); void angabenBlatt(); }
      return;
    }
    if (t.matches('[data-angabe]') && a) {
      const feld = t.dataset.angabe!;
      const wert = t.value.trim();
      const aenderungen = feld === 'frist' || feld === 'wiedervorlage' ? { [feld]: wert || null }
        : feld === 'tags' ? { tags: [...new Set(wert.split(/[\s,]+/).map(x => x.replace(/^#/, '')).filter(Boolean))] }
          : { [feld]: wert };
      if (pruefe(await body.aufgabeAendern({ aufgabeId: a.id, aenderungen }))) {
        if (feld === 'frist') wiederholungFreigeben(t.closest('.angaben') ?? document, !!wert);
        await detailZeigen();
      }
    }
  });

  // ---------------- Änderungen von außen (anderes Gerät, Abgleich) ----------------
  // Meldungen kurz bündeln – dabei alle Bereiche sammeln (sonst ginge z. B. „aufgaben“ hinter „abgleich“ verloren)
  let neuUhr: ReturnType<typeof setTimeout> | undefined;
  const gesammelt = new Set<string>();
  body.beiAenderung(b => {
    b.forEach(x => gesammelt.add(x));
    clearTimeout(neuUhr);
    const verarbeiten = async (): Promise<void> => {
      if (zug) { neuUhr = setTimeout(() => void verarbeiten(), 400); return; } // nach dem Ziehen nachholen
      const bereiche = [...gesammelt]; gesammelt.clear();
      if (bereiche.every(b => b === 'abgleich')) {
        z.stand = await body.abgleich();
        if (z.stand.verfuegbar && !z.stand.verbunden) { void zeichnen(); return; }
        const w = haupt.querySelector('.wolke'); if (w) w.outerHTML = wolke();
        if (einstOffen && !abmeldenFragen) void einstellungen();
        return;
      }
      void zeichnen();
      // offene Aufgabe aktualisieren – aber nicht, während darin getippt wird
      const tippt = detail.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement!.tagName);
      if (z.detail && !tippt && !bs.querySelector('.bildansicht')) void detailZeigen();
    };
    neuUhr = setTimeout(() => void verarbeiten(), 60);
  });
  pwa.beiNeuerVersion(() => { void zeichnen(); if (einstOffen) void einstellungen(); });

  // Tageswechsel (App bleibt im Hintergrund offen)
  let tag = new Date().toDateString();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && new Date().toDateString() !== tag) { tag = new Date().toDateString(); void zeichnen(); } });

  void zeichnen();
}
