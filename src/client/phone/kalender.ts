// Kalender der Phone App: Tag · Woche · Monat. Kennt nur das Body interface – wie der Desktop-Client.
// Eigene Buchungen (Termine, Reservierungen) und externe Termine (aus dem Kalender-Stand eines Macs).
// Lange drücken = ziehen (Tag/Woche: Tag + Uhrzeit im 15-Minuten-Raster; Monat: nur der Tag), Tippen = Details.
// Spiegeln, Verschieben und Löschen externer Termine gehen am Phone als Aufträge an einen Mac (macht der Body).
import { dauerText, kurz, minuten, MON_LANG, montag, plusTage, uhrzeit, WT, WT_LANG, wochentag } from '../../basis/datum';
import type { Body, BuchungDto, CommandStatus, ExternDto, Tag } from '../../body/interface';
import { I } from './icons';

export type KalenderAnsicht = 'tag' | 'woche' | 'monat';

export type KalenderKontext = {
  body: Body;
  esc(s: unknown): string;
  pruefe(r: CommandStatus, ok?: string): boolean;
  toast(t: string, fehler?: boolean): void;
  /** Kopfzeile der Sichten (Logo, Titel, Wolke, Zahnrad) */
  kopf(titel: string): string;
  detail: HTMLElement;
  blattAuf(html: string): void;
  blattZu(): void;
  neuZeichnen(): void;
  aufgabeOeffnen(id: string): void;
};

const SCHLUESSEL = 'rundblick.phone.kalender';
const STD_H = { tag: 52, woche: 44 } as const;
const VIERTEL = Array.from({ length: 96 }, (_, i) => i * 15);
const DAUERN = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];

type Eintrag = { art: 'buchung' | 'extern'; id: string; titel: string; datum: string; s: number; e: number; farbe: string; ziehbar: boolean; klasse: string; lane: number; n: number };

export function phoneKalender(k: KalenderKontext) {
  const { body, esc, pruefe } = k;
  const gespeichert = ((): { ansicht?: KalenderAnsicht; anker?: string | null } => { try { return JSON.parse(localStorage.getItem(SCHLUESSEL) ?? '{}'); } catch { return {}; } })();
  const z = { ansicht: gespeichert.ansicht ?? 'woche' as KalenderAnsicht, anker: gespeichert.anker ?? null as string | null, heute: '', scrollTop: null as number | null, detail: null as null | { art: 'buchung' | 'extern'; id: string; datum: string } };
  const merken = () => localStorage.setItem(SCHLUESSEL, JSON.stringify({ ansicht: z.ansicht, anker: z.anker }));
  const anker = () => z.anker ?? z.heute;

  function bereich(): [string, string] {
    const a = anker();
    if (z.ansicht === 'tag') return [a, a];
    if (z.ansicht === 'woche') { const m = montag(a); return [m, plusTage(m, 6)]; }
    const s = montag(a.slice(0, 8) + '01');
    return [s, plusTage(s, 41)];
  }
  function titel(): string {
    const a = anker();
    if (z.ansicht === 'tag') return `${WT_LANG[wochentag(a)]}, ${kurz(a)}`;
    if (z.ansicht === 'woche') { const m = montag(a); return `${kurz(m)}–${kurz(plusTage(m, 6))}`; }
    return `${MON_LANG[Number(a.slice(5, 7)) - 1]} ${a.slice(0, 4)}`;
  }
  function blaettern(n: number): void {
    const a = anker();
    z.anker = z.ansicht === 'tag' ? plusTage(a, n) : z.ansicht === 'woche' ? plusTage(a, 7 * n) : (() => {
      const d = new Date(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1 + n, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();
    merken(); k.neuZeichnen();
  }

  // ---------------- Einträge eines Tages (Termine mit Uhrzeit), nebeneinander bei Überschneidung ----------------
  function eintraege(t: Tag): Eintrag[] {
    const l: Eintrag[] = [
      ...t.termine.map(b => ({ art: 'buchung' as const, id: b.id, titel: b.titel, datum: t.datum, s: b.s, e: Math.max(b.e, b.s + 15), farbe: b.spiegel?.farbe ?? (b.aufgabeId ? 'var(--own)' : '#475569'), ziehbar: true, klasse: `eigen ${b.aufgabeId ? '' : 'frei'} ${b.abgeschlossen ? 'fertig' : ''}`, lane: 0, n: 1 })),
      ...t.extern.filter(x => x.start !== null).map(x => ({ art: 'extern' as const, id: x.id, titel: x.titel, datum: t.datum, s: x.start!, e: Math.max(x.ende!, x.start! + 15), farbe: x.farbe, ziehbar: x.loeschbar, klasse: `extern ${x.wartet ? 'wartet' : ''}`, lane: 0, n: 1 })),
    ].sort((a, b) => a.s - b.s || b.e - a.e);
    // Gruppen überlappender Einträge, darin Spuren
    let gruppe: Eintrag[] = [], ende = -1;
    const abschliessen = () => { const n = Math.max(1, ...gruppe.map(x => x.lane + 1)); gruppe.forEach(x => { x.n = n; }); gruppe = []; };
    for (const x of l) {
      if (x.s >= ende) { abschliessen(); ende = -1; }
      const belegt = new Set(gruppe.filter(g => g.e > x.s).map(g => g.lane));
      let lane = 0; while (belegt.has(lane)) lane++;
      x.lane = lane; gruppe.push(x); ende = Math.max(ende, x.e);
    }
    abschliessen();
    return l;
  }

  const ganztags = (t: Tag, eng = false): string => [
    ...t.reservierungen.map(r => `<div class="k-chip res" data-kal="buchung:${r.id}" data-datum="${t.datum}"${zug('buchung', r.id, t.datum, null, r.dauer, true)}>${esc(dauerText(r.dauer))} ${esc(r.titel)}</div>`),
    ...t.extern.filter(x => x.start === null).map(x => `<div class="k-chip ganz" data-kal="extern:${esc(x.id)}" data-datum="${t.datum}" style="--kf:${x.farbe}">${esc(x.titel)}</div>`),
    // in der Woche eng: Fristen als eine Marke „◆ n“ (Tippen öffnet den Tag)
    ...(eng && t.fristen.length ? [`<div class="k-chip frist ${t.fristen.some(f => f.dringlichkeit === 'ueberfaellig') ? 'ueberfaellig' : t.fristen.some(f => f.dringlichkeit === 'heute') ? 'heute' : ''}" data-zum-tag="${t.datum}">${I.frist}${t.fristen.length}</div>`]
      : t.fristen.map(f => `<div class="k-chip frist ${f.dringlichkeit}" data-aufgabe="${f.aufgabeId}">${I.frist}${esc(f.titel)}</div>`)),
  ].join('');

  const zug = (art: 'buchung' | 'extern', id: string, datum: string, s: number | null, dauer: number, ok: boolean) =>
    ok ? ` data-zieh="${art}:${esc(id)}" data-zdatum="${datum}" data-zstart="${s ?? ''}" data-zdauer="${dauer}"` : '';

  function zeitraster(tage: Tag[], h: number, tageszeit: { von: number; bis: number }): string {
    const stunden = Array.from({ length: 24 }, (_, i) => `<div class="k-std" style="top:${i * h}px"><span>${i}</span></div>`).join('');
    const spalten = tage.map(t => {
      const ev = eintraege(t).map(x => {
        const top = (x.s / 60) * h, hoehe = Math.max(18, ((x.e - x.s) / 60) * h - 2);
        const breite = 100 / x.n;
        return `<div class="k-ev ${x.klasse}" data-kal="${x.art}:${esc(x.id)}" data-datum="${x.datum}"${zug(x.art, x.id, x.datum, x.s, x.e - x.s, x.ziehbar)}
          style="top:${top}px;height:${hoehe}px;left:calc(${x.lane * breite}% + 1px);width:calc(${breite}% - 2px);--kf:${x.farbe}">
          <b>${esc(x.titel)}</b>${hoehe > 30 ? `<span>${uhrzeit(x.s)}–${uhrzeit(x.e)}</span>` : ''}${x.klasse.includes('wartet') ? `<i class="k-wartet">${I.wolkeHoch}</i>` : ''}</div>`;
      }).join('');
      const jetzt = t.datum === z.heute ? `<div class="k-jetzt" style="top:${(new Date().getHours() * 60 + new Date().getMinutes()) / 60 * h}px"></div>` : '';
      return `<div class="k-spalte ${t.datum === z.heute ? 'heute' : ''} ${wochentag(t.datum) > 4 ? 'we' : ''}" data-tag="${t.datum}">${ev}${jetzt}</div>`;
    }).join('');
    const kopf = tage.length > 1 ? `<div class="k-tage"><div class="k-ecke"></div>${tage.map(t => `<div class="k-tk ${t.datum === z.heute ? 'heute' : ''}" data-zum-tag="${t.datum}"><span>${WT[wochentag(t.datum)]}</span><b>${Number(t.datum.slice(8))}</b></div>`).join('')}</div>` : '';
    const band = tage.some(t => t.reservierungen.length || t.fristen.length || t.extern.some(x => x.start === null))
      ? `<div class="k-band"><div class="k-ecke"></div>${tage.map(t => `<div class="k-bandtag" data-tag="${t.datum}" data-band="1">${ganztags(t, tage.length > 1)}</div>`).join('')}</div>` : '';
    const nacht = `<div class="k-nacht" style="top:0;height:${tageszeit.von * h}px"></div><div class="k-nacht" style="top:${tageszeit.bis * h}px;height:${(24 - tageszeit.bis) * h}px"></div>`;
    return `${kopf}${band}<div class="k-raster" data-std="${h}"><div class="k-innen" style="height:${24 * h}px">${nacht}<div class="k-stunden">${stunden}</div><div class="k-spalten">${spalten}</div></div></div>`;
  }

  function monat(tage: Tag[]): string {
    const m = anker().slice(0, 7);
    const zellen = tage.map(t => {
      const ev = [
        ...t.extern.filter(x => x.start === null).map(x => ({ s: -1, html: `<div class="k-m ganz" style="--kf:${x.farbe}" data-kal="extern:${esc(x.id)}" data-datum="${t.datum}">${esc(x.titel)}</div>` })),
        ...t.reservierungen.map(r => ({ s: -1, html: `<div class="k-m res" data-kal="buchung:${r.id}" data-datum="${t.datum}"${zug('buchung', r.id, t.datum, null, r.dauer, true)}>${esc(r.titel)}</div>` })),
        ...eintraege(t).map(x => ({ s: x.s, html: `<div class="k-m ${x.klasse}" style="--kf:${x.farbe}" data-kal="${x.art}:${esc(x.id)}" data-datum="${t.datum}"${zug(x.art, x.id, t.datum, null, x.e - x.s, x.ziehbar)}>${esc(x.titel)}</div>` })),
      ];
      const sichtbar = ev.slice(0, 3).map(x => x.html).join('');
      return `<div class="k-zelle ${t.datum.slice(0, 7) !== m ? 'anders' : ''} ${t.datum === z.heute ? 'heute' : ''}" data-tag="${t.datum}" data-zum-tag="${t.datum}">
        <div class="k-zk"><b>${Number(t.datum.slice(8))}</b>${t.fristen.length ? `<span class="k-fr">${I.frist}${t.fristen.length}</span>` : ''}</div>${sichtbar}${ev.length > 3 ? `<div class="k-mehr">+${ev.length - 3}</div>` : ''}</div>`;
    }).join('');
    return `<div class="k-monat"><div class="k-mk">${WT.map(w => `<div>${w}</div>`).join('')}</div><div class="k-mg">${zellen}</div></div>`;
  }

  async function html(): Promise<string> {
    if (!z.heute) z.heute = (await body.heute()).datum;
    const [von, bis] = bereich();
    const [zr, e] = await Promise.all([body.zeitraum({ von, bis }), body.einstellungen()]);
    z.heute = zr.heute;
    const q = e.kalenderquelle;
    const stand = q.herkunft ? (() => { const min = Math.round((Date.now() - Date.parse(q.herkunft.zeit)) / 60000); return `Kalender von ${esc(q.herkunft.geraet)} · ${min < 1 ? 'gerade eben' : min < 60 ? `vor ${min} Min.` : new Date(q.herkunft.zeit).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`; })()
      : q.art === 'ablage' ? 'Noch kein Kalender-Stand – Rundblick am Mac starten' : '';
    const inhalt = z.ansicht === 'monat' ? monat(zr.tage) : zeitraster(zr.tage, STD_H[z.ansicht], e.tageszeit);
    return k.kopf('Kalender') + `<div class="k-leiste">
        <div class="k-seg">${(['tag', 'woche', 'monat'] as const).map(a => `<button data-k-ansicht="${a}" class="${z.ansicht === a ? 'an' : ''}">${{ tag: 'Tag', woche: 'Woche', monat: 'Monat' }[a]}</button>`).join('')}</div>
        <button class="k-nav" data-k-nav="-1">${I.zurueck}</button><button class="k-heute" data-k-nav="0">Heute</button><button class="k-nav" data-k-nav="1">${I.rechts}</button>
        <button class="k-neu" data-k-neu title="Neuer Termin">${I.plus}</button></div>
      <div class="k-titel">${titel()}${stand || q.offeneAuftraege ? `<span class="k-stand">${stand}${q.offeneAuftraege ? ` · ${q.offeneAuftraege} Auftrag${q.offeneAuftraege > 1 ? 'e' : ''} wartet${q.offeneAuftraege > 1 ? 'en' : ''}` : ''}</span>` : ''}</div>
      <div class="k-inhalt ${z.ansicht}">${inhalt}</div>`;
  }

  /** nach dem Zeichnen: Scrollposition (erst Tageszeit-Beginn, dann wie zuletzt), Wischen zum Blättern, Ziehen */
  function nachZeichnen(haupt: HTMLElement): void {
    const r = haupt.querySelector<HTMLElement>('.k-raster');
    if (r) {
      const h = Number(r.dataset.std);
      void body.einstellungen().then(e => { if (z.scrollTop === null) z.scrollTop = Math.max(0, e.tageszeit.von * h - 8); r.scrollTop = z.scrollTop; });
      r.addEventListener('scroll', () => { z.scrollTop = r.scrollTop; }, { passive: true });
    }
    const inh = haupt.querySelector<HTMLElement>('.k-inhalt');
    if (inh) wischen(inh);
  }

  // waagerecht wischen = blättern
  function wischen(el: HTMLElement): void {
    let x0 = 0, y0 = 0, t0 = 0, aktiv = false;
    el.addEventListener('touchstart', e => { if (gezogen) return; const p = e.touches[0]!; x0 = p.clientX; y0 = p.clientY; t0 = Date.now(); aktiv = true; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (!aktiv || gezogen) return; aktiv = false;
      const p = e.changedTouches[0]!, dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && Date.now() - t0 < 600) blaettern(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  // ---------------- Lange drücken → ziehen ----------------
  let druck: ReturnType<typeof setTimeout> | null = null, gezogen: null | {
    el: HTMLElement; geist: HTMLElement; art: 'buchung' | 'extern'; id: string; datum: string; start: number | null; dauer: number; dy: number; ziel: { datum: string; start: number | null } | null;
  } = null, klickSperre = false;
  function ziehenAnbinden(bs: HTMLElement): void {
    bs.addEventListener('pointerdown', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-zieh]');
      if (!el || !el.closest('.k-inhalt')) return;
      const x0 = e.clientX, y0 = e.clientY;
      druck = setTimeout(() => { druck = null; ziehStart(el, x0, y0, bs); }, 450);
      const ab = (ev: PointerEvent) => { if (druck && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) { clearTimeout(druck); druck = null; } };
      bs.addEventListener('pointermove', ab);
      bs.addEventListener('pointerup', () => { bs.removeEventListener('pointermove', ab); if (druck) { clearTimeout(druck); druck = null; } }, { once: true });
    });
    bs.addEventListener('pointermove', e => { if (gezogen) { e.preventDefault(); ziehBewegen(e.clientX, e.clientY, bs); } });
    bs.addEventListener('pointerup', () => { if (gezogen) void ziehEnde(); });
    bs.addEventListener('pointercancel', () => { if (gezogen) { gezogen.geist.remove(); gezogen.el.classList.remove('k-platz'); gezogen = null; } });
    bs.addEventListener('touchmove', e => { if (gezogen) e.preventDefault(); }, { passive: false });
    bs.addEventListener('contextmenu', e => { if (gezogen) e.preventDefault(); });
  }
  function ziehStart(el: HTMLElement, x: number, y: number, bs: HTMLElement): void {
    const [art, id] = el.dataset.zieh!.split(/:(.*)/s) as ['buchung' | 'extern', string];
    const r = el.getBoundingClientRect(), br = bs.getBoundingClientRect();
    const geist = el.cloneNode(true) as HTMLElement;
    geist.classList.add('k-geist');
    geist.style.cssText += `;position:absolute;left:${r.left - br.left}px;top:${r.top - br.top}px;width:${r.width}px;height:${r.height}px`;
    geist.insertAdjacentHTML('beforeend', '<em class="k-zeit"></em>');
    bs.appendChild(geist); el.classList.add('k-platz');
    navigator.vibrate?.(10);
    gezogen = { el, geist, art, id, datum: el.dataset.zdatum!, start: el.dataset.zstart ? Number(el.dataset.zstart) : null, dauer: Number(el.dataset.zdauer) || 60, dy: y - r.top, ziel: null };
    ziehBewegen(x, y, bs);
  }
  function ziehBewegen(x: number, y: number, bs: HTMLElement): void {
    const g = gezogen!, br = bs.getBoundingClientRect();
    g.geist.style.display = 'none';
    const unter = document.elementFromPoint(x, y) as HTMLElement | null;
    g.geist.style.display = '';
    const spalte = unter?.closest<HTMLElement>('.k-spalte[data-tag]'), zelle = unter?.closest<HTMLElement>('.k-zelle[data-tag], .k-bandtag[data-tag]');
    const zeit = g.geist.querySelector<HTMLElement>('.k-zeit')!;
    if (spalte) {
      const h = Number(spalte.closest<HTMLElement>('.k-raster')!.dataset.std), sr = spalte.getBoundingClientRect();
      const min = Math.max(0, Math.min(24 * 60 - 15, Math.round(((y - g.dy - sr.top) / h) * 60 / 15) * 15));
      g.ziel = { datum: spalte.dataset.tag!, start: min };
      g.geist.style.left = `${sr.left - br.left + 1}px`; g.geist.style.width = `${sr.width - 2}px`;
      g.geist.style.top = `${sr.top - br.top + (min / 60) * h}px`;
      zeit.textContent = `${WT[wochentag(g.ziel.datum)]} ${uhrzeit(min)}–${uhrzeit(Math.min(24 * 60, min + g.dauer))}`;
      // am Rand des Rasters weiterrollen
      const raster = spalte.closest<HTMLElement>('.k-raster')!, rr = raster.getBoundingClientRect();
      if (y < rr.top + 30) raster.scrollTop -= 8; else if (y > rr.bottom - 30) raster.scrollTop += 8;
    } else if (zelle) {
      // Monat/Band: nur der Tag – Uhrzeit bleibt
      g.ziel = { datum: zelle.dataset.tag!, start: null };
      g.geist.style.left = `${x - br.left - 40}px`; g.geist.style.top = `${y - br.top - g.dy}px`;
      zeit.textContent = `${WT[wochentag(g.ziel.datum)]} ${kurz(g.ziel.datum)}`;
    } else { g.ziel = null; zeit.textContent = ''; g.geist.style.top = `${y - br.top - g.dy}px`; }
  }
  async function ziehEnde(): Promise<void> {
    const g = gezogen!; gezogen = null; klickSperre = true; setTimeout(() => { klickSperre = false; }, 300);
    g.geist.remove(); g.el.classList.remove('k-platz');
    const ziel = g.ziel;
    if (!ziel || (ziel.datum === g.datum && (ziel.start === null || ziel.start === g.start))) return;
    const start = ziel.start === null ? (g.start === null ? null : uhrzeit(g.start)) : uhrzeit(ziel.start);
    const wann = `${WT[wochentag(ziel.datum)]} ${kurz(ziel.datum)}${start ? ' ' + start : ''}`;
    if (g.art === 'buchung') pruefe(await body.buchungAendern({ buchungId: g.id, datum: ziel.datum, start }), `Verschoben: ${wann}`);
    else pruefe(await body.externVerschieben({ externId: g.id, datum: ziel.datum, start }), `Verschoben: ${wann}`);
  }

  // ---------------- Details (Vollbild) ----------------
  const uhrzeitAuswahl = (attr: string, wert: string | null, leer: string | null) => {
    const w = wert ? minuten(wert) : null;
    const werte = w !== null && !VIERTEL.includes(w) ? [...VIERTEL, w].sort((a, b) => a - b) : VIERTEL;
    return `<select ${attr}>${leer !== null ? `<option value="" ${w === null ? 'selected' : ''}>${leer}</option>` : ''}${werte.map(m => `<option value="${uhrzeit(m)}" ${m === w ? 'selected' : ''}>${uhrzeit(m)}</option>`).join('')}</select>`;
  };
  const dauerAuswahl = (attr: string, wert: number) =>
    `<select ${attr}>${[...new Set([...DAUERN, wert])].sort((a, b) => a - b).map(m => `<option value="${m}" ${m === wert ? 'selected' : ''}>${dauerText(m)}</option>`).join('')}</select>`;

  async function detailZeigen(): Promise<void> {
    const d = z.detail;
    if (!d) { k.detail.classList.remove('offen'); return; }
    if (d.art === 'buchung') return buchungZeigen(d.id);
    return externZeigen(d.id, d.datum);
  }
  function detailZu(): void { z.detail = null; k.detail.classList.remove('offen'); k.neuZeichnen(); }

  async function buchungZeigen(id: string): Promise<void> {
    const b = await body.buchung({ buchungId: id });
    if (!b) { detailZu(); return; }
    const e = await body.einstellungen();
    const ziele = e.kalender.filter(x => x.schreibbar && x.sichtbar).sort((a, b2) => (a.konto === 'Google' ? 0 : 1) - (b2.konto === 'Google' ? 0 : 1) || a.konto.localeCompare(b2.konto) || a.name.localeCompare(b2.name));
    const zuletzt = localStorage.getItem('rundblick.phone.spiegelziel');
    const spiegel = b.spiegel
      ? `<div class="wert">${b.spiegel.wartet ? I.wolkeHoch : I.haken}<span class="k-punkt" style="background:${b.spiegel.farbe}"></span>${b.spiegel.wartet ? 'Wird gespiegelt nach' : b.spiegel.ursprung === 'extern' ? 'Übernommen aus' : 'Gespiegelt in'} ${esc(b.spiegel.kalender)} · ${esc(b.spiegel.konto)}</div>
         ${b.spiegel.wartet ? '<div class="einst-hinweis">Ein Mac mit Rundblick legt den Termin an, sobald er läuft.</div>' : `<button class="k-knopf" data-k-loesen>Verknüpfung lösen</button>`}`
      : !b.start ? '<div class="einst-hinweis">Nur Termine mit Uhrzeit lassen sich in Google/iCloud spiegeln.</div>'
        : ziele.length ? `<div class="k-reihe"><select data-k-spiegelziel>${ziele.map(x => `<option value="${esc(x.id)}" ${x.id === zuletzt ? 'selected' : ''}>${esc(x.name)} · ${esc(x.konto)}</option>`).join('')}</select><button class="k-knopf voll" data-k-spiegeln>Spiegeln</button></div>`
          : '<div class="einst-hinweis">Kein beschreibbarer Kalender bekannt – Rundblick am Mac starten.</div>';
    k.detail.innerHTML = `<div class="kopf"><button class="knopf" data-k-zurueck>${I.zurueck}</button><span style="flex:1"></span><button class="knopf muell2" data-zweistufig="k-buchung:${b.id}">${I.muell}</button></div>
      <div class="koerper">
        <textarea class="titel-feld" rows="1" data-k-titel>${esc(b.titel)}</textarea>
        ${b.hinweis ? `<div class="k-hinweis">${esc(b.hinweis)}</div>` : ''}
        <div class="zwei"><div class="feld"><label>Datum</label><div class="wert"><input type="date" data-kb="datum" data-wert="${b.datum}"></div></div>
          <div class="feld"><label>Uhrzeit</label><div class="wert">${uhrzeitAuswahl('data-kb="start"', b.start, 'Reservierung')}</div></div></div>
        <div class="zwei"><div class="feld"><label>Dauer</label><div class="wert">${dauerAuswahl('data-kb="dauer"', b.dauer)}</div></div>
          <div class="feld"><label>Kapazität</label><label class="wert k-check"><input type="checkbox" data-kb="belegt" ${b.belegt ? 'checked' : ''}>belegt</label></div></div>
        ${b.aufgabeId ? `<div class="feld"><label>Aufgabe</label><button class="wert k-link" data-aufgabe="${b.aufgabeId}">${I.liste}${esc(b.aufgabentitel ?? '')}</button></div>` : ''}
        <div class="feld"><label>Google / iCloud</label>${spiegel}</div>
        <div class="feld"><label>Notiz</label><textarea class="k-notiz" data-k-notiz placeholder="Notiz …">${esc(b.beschreibung)}</textarea></div>
      </div>`;
    k.detail.classList.add('offen');
    k.detail.querySelectorAll<HTMLInputElement>('input[type=date][data-wert]').forEach(f => { f.value = f.dataset.wert!; });
    const tf = k.detail.querySelector<HTMLTextAreaElement>('[data-k-titel]')!;
    tf.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); tf.blur(); } });
    tf.addEventListener('blur', async () => { const t = tf.value.trim(); if (t && t !== b.titel) pruefe(await body.buchungAendern({ buchungId: b.id, titel: t })); });
    const nt = k.detail.querySelector<HTMLTextAreaElement>('[data-k-notiz]')!;
    nt.addEventListener('blur', async () => { if (nt.value !== b.beschreibung) pruefe(await body.buchungAendern({ buchungId: b.id, beschreibung: nt.value })); });
  }

  async function externZeigen(id: string, datum: string): Promise<void> {
    const t = (await body.zeitraum({ von: datum, bis: datum })).tage[0]?.extern.find(x => x.id === id);
    if (!t) { detailZu(); return; }
    const verschiebbar = t.loeschbar && t.start !== null, dauer = t.start === null ? 0 : t.ende! - t.start;
    k.detail.innerHTML = `<div class="kopf"><button class="knopf" data-k-zurueck>${I.zurueck}</button><span style="flex:1"></span>${t.loeschbar ? `<button class="knopf muell2" data-zweistufig="k-extern:${esc(t.id)}">${I.muell}</button>` : ''}</div>
      <div class="koerper">
        <div class="titel-feld">${esc(t.titel)}</div>
        <div class="wert k-kal"><span class="k-punkt" style="background:${t.farbe}"></span>${esc(t.kalender)}${t.konto ? ` · ${esc(t.konto)}` : ''}${t.wartet ? `<span class="k-wartet-text">${I.wolkeHoch}wartet auf Mac</span>` : ''}</div>
        ${verschiebbar ? `<div class="zwei"><div class="feld"><label>Datum</label><div class="wert"><input type="date" data-kx="datum" data-wert="${t.datum}"></div></div>
            <div class="feld"><label>Uhrzeit</label><div class="wert">${uhrzeitAuswahl('data-kx="start"', uhrzeit(t.start!), null)}</div></div></div>
          <div class="feld"><label>Dauer</label><div class="wert">${dauerAuswahl('data-kx="dauer"', dauer)}</div></div>`
          : `<div class="feld"><label>Wann</label><div class="wert">${WT[wochentag(t.datum)]} ${kurz(t.datum)} · ${t.start === null ? 'ganztägig' : `${uhrzeit(t.start)}–${uhrzeit(t.ende!)}`}</div></div>`}
        ${t.ort ? `<div class="feld"><label>Ort</label><div class="wert">${esc(t.ort)}</div></div>` : ''}
        ${t.notiz ? `<div class="feld"><label>Notiz</label><div class="wert" style="white-space:pre-wrap">${esc(t.notiz)}</div></div>` : ''}
        ${t.start !== null ? `<button class="k-knopf voll" data-k-ausextern>${I.liste}Aufgabe daraus machen</button>` : ''}
        <div class="einst-hinweis">Externer Termin${verschiebbar ? ` – Datum, Uhrzeit und Dauer ändern ihn im Kalender${t.serie ? ' (bei einer Serie nur diesen Termin)' : ''}; das erledigt ein Mac mit Rundblick` : ''}${t.loeschbar ? '' : ' – Kalender ist schreibgeschützt'}. Titel und Notiz bearbeitest du in der Kalender-App.</div>
      </div>`;
    k.detail.classList.add('offen');
    k.detail.querySelectorAll<HTMLInputElement>('input[type=date][data-wert]').forEach(f => { f.value = f.dataset.wert!; });
  }

  // ---------------- Neuer Termin (Blatt) ----------------
  function neuBlatt(datum: string, start: string | null): void {
    k.blattAuf(`<div class="griff"></div><div class="bk">Neuer Termin<button data-blatt-zu>Abbrechen</button></div><div class="angaben">
      <div class="feld"><label>Titel</label><div class="wert"><input data-kn="titel" placeholder="Was?" autocomplete="off"></div></div>
      <div class="zwei"><div class="feld"><label>Datum</label><div class="wert"><input type="date" data-kn="datum" data-wert="${datum}"></div></div>
        <div class="feld"><label>Uhrzeit</label><div class="wert">${uhrzeitAuswahl('data-kn="start"', start, 'Reservierung')}</div></div></div>
      <div class="feld"><label>Dauer</label><div class="wert">${dauerAuswahl('data-kn="dauer"', 60)}</div></div>
      <button class="einst-knopf" data-k-anlegen>${I.plus}Eintragen</button>
    </div>`);
    document.querySelectorAll<HTMLInputElement>('.blatt input[type=date][data-wert]').forEach(f => { f.value = f.dataset.wert!; });
    setTimeout(() => document.querySelector<HTMLInputElement>('.blatt [data-kn="titel"]')?.focus(), 250);
  }

  // ---------------- Ereignisse (von app.ts weitergereicht) ----------------
  async function klick(t: HTMLElement, y: number): Promise<boolean> {
    const q = <T extends HTMLElement = HTMLElement>(s: string) => t.closest<T>(s);
    // nur eigene Klicks: Leiste/Inhalt des Kalenders, das Kalender-Detail, das Blatt „Neuer Termin“
    if (!q('.k-leiste, .k-inhalt, [data-k-anlegen]') && !(z.detail && q('.detail'))) return false;
    if (klickSperre) return true;
    if (q('[data-k-ansicht]')) { z.ansicht = q('[data-k-ansicht]')!.dataset.kAnsicht as KalenderAnsicht; z.scrollTop = null; merken(); k.neuZeichnen(); return true; }
    if (q('[data-k-nav]')) { const n = Number(q('[data-k-nav]')!.dataset.kNav); if (n === 0) { z.anker = null; merken(); k.neuZeichnen(); } else blaettern(n); return true; }
    if (q('[data-k-neu]')) { neuBlatt(anker(), uhrzeit(Math.min(23, new Date().getHours() + 1) * 60)); return true; }
    if (q('[data-k-anlegen]')) {
      const w = (s: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`.blatt [data-kn="${s}"]`)!.value;
      const titel = w('titel').trim();
      if (!titel) { k.toast('Titel fehlt', true); return true; }
      if (pruefe(await body.buchungEintragen({ titel, datum: w('datum'), start: w('start') || null, dauer: Number(w('dauer')) }), 'Eingetragen')) k.blattZu();
      return true;
    }
    if (q('[data-k-zurueck]')) { detailZu(); return true; }
    if (q('[data-aufgabe]')) { z.detail = null; k.aufgabeOeffnen(q('[data-aufgabe]')!.dataset.aufgabe!); return true; }
    if (q('[data-k-spiegeln]') && z.detail) {
      const ziel = k.detail.querySelector<HTMLSelectElement>('[data-k-spiegelziel]')!.value;
      localStorage.setItem('rundblick.phone.spiegelziel', ziel);
      if (pruefe(await body.buchungSpiegeln({ buchungId: z.detail.id, kalenderId: ziel }), 'Spiegeln beauftragt')) void detailZeigen();
      return true;
    }
    if (q('[data-k-loesen]') && z.detail) { if (pruefe(await body.verknuepfungLoesen({ buchungId: z.detail.id }), 'Verknüpfung gelöst')) void detailZeigen(); return true; }
    if (q('[data-k-ausextern]') && z.detail) {
      const r = await body.aufgabeAusExtern({ externId: z.detail.id });
      if (pruefe(r, 'Aufgabe erstellt') && r.ok) { z.detail = null; k.aufgabeOeffnen(r.ids!.aufgabeId!); }
      return true;
    }
    const ev = q('[data-kal]');
    if (ev && ev.closest('.k-inhalt')) {
      const [art, id] = ev.dataset.kal!.split(/:(.*)/s) as ['buchung' | 'extern', string];
      z.detail = { art, id, datum: ev.dataset.datum! };
      void detailZeigen();
      return true;
    }
    const tagKopf = q('[data-zum-tag]');
    if (tagKopf && (z.ansicht === 'monat' || tagKopf.classList.contains('k-tk') || tagKopf.classList.contains('k-chip'))) { z.ansicht = 'tag'; z.anker = tagKopf.dataset.zumTag!; z.scrollTop = null; merken(); k.neuZeichnen(); return true; }
    // Tippen in eine freie Stelle des Rasters: neuer Termin dort
    const sp = q('.k-spalte[data-tag]');
    if (sp) {
      const h = Number(sp.closest<HTMLElement>('.k-raster')!.dataset.std), r = sp.getBoundingClientRect();
      const min = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((y - r.top) / h) * 60 / 30) * 30));
      neuBlatt(sp.dataset.tag!, uhrzeit(min));
      return true;
    }
    if (q('.k-bandtag[data-tag]')) { neuBlatt(q('.k-bandtag[data-tag]')!.dataset.tag!, null); return true; }
    return false;
  }

  async function aendern(t: HTMLInputElement): Promise<boolean> {
    const d = z.detail;
    if (t.dataset.kb && d?.art === 'buchung') {
      const f = t.dataset.kb;
      const wert = f === 'belegt' ? t.checked : f === 'dauer' ? Number(t.value) : f === 'start' ? (t.value || null) : t.value;
      if (f === 'datum' && !t.value) return true;
      if (pruefe(await body.buchungAendern({ buchungId: d.id, [f]: wert }))) void detailZeigen();
      return true;
    }
    if (t.dataset.kx && d?.art === 'extern') {
      const w = (s: string) => k.detail.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-kx="${s}"]`)!.value;
      if (!w('datum')) return true;
      const r = await body.externVerschieben({ externId: d.id, datum: w('datum'), start: w('start'), dauer: Number(w('dauer')) });
      // die Kennung kann sich mit dem Beginn ändern – mit der neuen weiter anzeigen
      if (pruefe(r, 'Termin verschoben') && r.ok) { z.detail = { art: 'extern', id: r.ids!.externId!, datum: w('datum') }; void detailZeigen(); }
      return true;
    }
    return false;
  }

  /** zweistufiges Löschen aus dem Detail; true = war ein Kalender-Fall */
  async function zweistufig(art: string, rest: string): Promise<boolean> {
    if (art === 'k-buchung') { if (pruefe(await body.buchungStornieren({ buchungId: rest }), 'Gelöscht')) detailZu(); return true; }
    if (art === 'k-extern') { if (pruefe(await body.externLoeschen({ externId: rest }), 'Termin gelöscht')) detailZu(); return true; }
    return false;
  }

  return { html, nachZeichnen, ziehenAnbinden, klick, aendern, zweistufig, detailOffen: () => z.detail !== null, detailNeu: () => { if (z.detail) void detailZeigen(); } };
}

export type PhoneKalender = ReturnType<typeof phoneKalender>;
export type { BuchungDto, ExternDto };
