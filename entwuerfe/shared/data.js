// Rundblick – Entwürfe
// Gemeinsame Beispieldaten, ein In-Memory-Store (nur Attrappe!) und der Parser der Schnellerfassung.
// In der echten App liegt all das hinter dem Body interface (Commands/Queries) – hier reicht ein Objekt.
(function () {
  'use strict';

  const HEUTE = '2026-11-16';          // Montag
  const JETZT_MIN = 10 * 60 + 40;       // 10:40 Uhr
  const H0 = 7, H1 = 21, SPAN = H1 - H0; // sichtbarer Tagesausschnitt

  // ---------- Datumshelfer (Datumswerte als 'YYYY-MM-DD') ----------
  const D = {
    H0, H1, SPAN,
    WT: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    WT_LANG: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
    MON: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
    MON_LANG: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
    fmt(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); },
    add(s, n) { const d = D.parse(s); d.setDate(d.getDate() + n); return D.fmt(d); },
    diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 864e5); },
    wd(s) { return (D.parse(s).getDay() + 6) % 7; },
    mondayOf(s) { return D.add(s, -D.wd(s)); },
    kurz(s) { const d = D.parse(s); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; },
    rel(s) {
      const n = D.diff(HEUTE, s);
      if (n === 0) return 'Heute';
      if (n === 1) return 'Morgen';
      if (n === -1) return 'Gestern';
      if (n > 1 && n < 7) return D.WT[D.wd(s)] + ' ' + D.kurz(s);
      return D.kurz(s);
    },
    kw(s) { // ISO-Kalenderwoche
      const d = D.parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
      const w1 = new Date(d.getFullYear(), 0, 4);
      return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
    },
    min(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; },
    hm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); },
    dauer(min) {
      if (min < 60) return min + ' min';
      const h = min / 60;
      return (Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')) + ' h';
    },
  };

  // Board-Spalten: beliebig viele, jede gehört zu genau einer von drei Kategorien.
  // Die Kategorie ist NICHT „abgeschlossen“ – Abschließen ist ein eigener Zustand der Aufgabe.
  const KATEGORIEN = [
    { id: 'offen', name: 'Nicht begonnen', standard: 'bereit' },
    { id: 'begonnen', name: 'Begonnen', standard: 'inarbeit' },
    { id: 'beendet', name: 'Beendet', standard: 'erledigt' },
  ];
  const STATUS = [
    { id: 'idee', name: 'Idee', kat: 'offen' },
    { id: 'backlog', name: 'Backlog', kat: 'offen' },
    { id: 'bereit', name: 'Bereit', kat: 'offen' },
    { id: 'inarbeit', name: 'In Arbeit', kat: 'begonnen' },
    { id: 'blockiert', name: 'Blockiert', kat: 'begonnen' },
    { id: 'erledigt', name: 'Erledigt', kat: 'beendet' },
    { id: 'abgebrochen', name: 'Abgebrochen', kat: 'beendet' },
  ];

  // ---------- Beispieldaten ----------
  const d = n => D.add(HEUTE, n);
  const T = (id, titel, o = {}) => Object.assign({
    id, titel, beschreibung: '', ort: '', verantwortlich: '', tags: [],
    frist: null, wv: null, status: null, done: false,
  }, o);

  const tasks = [
    T('a1', 'Angebot Möbeltischlerei Hüttner schreiben', { tags: ['kunde'], verantwortlich: 'Ralf', frist: d(2), status: 'inarbeit', beschreibung: 'Relaunch-Angebot in drei Paketen. Referenzen aus dem Entwurf übernehmen.' }),
    T('a2', 'Folien „Prompting 2026“ überarbeiten', { tags: ['workshop'], frist: d(4), status: 'bereit' }),
    T('a3', 'Steuerunterlagen Q3 ans Steuerbüro', { tags: ['büro'], frist: d(-2) }),
    T('a4', 'Stromzähler Chalet ablesen lassen', { tags: ['chalet'], verantwortlich: 'Ivan', ort: 'Dobrinishte', wv: d(9) }),
    T('a5', 'Blogartikel Vibe-Coding-Ampel', { tags: ['blog'], status: 'blockiert', beschreibung: 'Wartet auf Review von Markus.' }),
    T('a6', 'Bewerbungsfilm: Rohschnitt sichten', { tags: ['vorgestellt'], verantwortlich: 'Markus', frist: d(5), status: 'bereit' }),
    T('a8', 'Kontakte-App: vCard-Import testen', { tags: ['dev'], status: 'inarbeit' }),
    T('a9', 'Rechnung Office Day an Merck', { tags: ['büro'], frist: d(0), status: 'bereit' }),
    T('a10', 'Spieleabend vorbereiten', { tags: ['privat'], frist: d(6) }),
    T('a11', 'Workshop-Feedback auswerten', { tags: ['workshop'], status: 'erledigt' }),
    T('a12', 'Winterreifen wechseln', { tags: ['auto'], wv: d(4) }),
    T('a13', 'Spike: Event Store für Rundblick', { tags: ['dev'], status: 'bereit' }),
    T('a14', 'Geschenk für Lena', { tags: ['privat'], frist: d(12) }),
    T('a15', 'Call Codelution: Relaunch-Abstimmung', { tags: ['kunde'], status: 'blockiert', ort: 'Zoom' }),
    T('a16', 'Newsletter Dezember entwerfen', { tags: ['blog'], frist: d(15), status: 'backlog' }),
    T('a17', 'Coaching-Session Vibe Coach', { tags: ['coaching'], ort: 'Zoom' }),
    T('a18', 'Reisekosten Oktober einreichen', { tags: ['büro'], status: 'backlog' }),
    T('a19', 'Website-Texte Villa Kunterbunt prüfen', { tags: ['kunde'], verantwortlich: 'Ralf', frist: d(8), status: 'bereit' }),
    T('a20', 'Fahrradkette ölen', { tags: ['privat'] }),
    T('a21', 'HTML Presenter: Export-Bug', { tags: ['dev'], frist: d(1), status: 'inarbeit' }),
    T('a22', 'Jahresrückblick schreiben', { tags: ['blog'], wv: d(30) }),
    T('a23', 'Podcast über Vibe Coding', { tags: ['blog'], status: 'idee' }),
    T('a24', 'Rundblick: iPhone-Version?', { tags: ['dev'], status: 'idee' }),
    T('a25', 'Gastbeitrag t3n', { tags: ['blog'], status: 'abgebrochen', beschreibung: 'Redaktion hat abgesagt.' }),
  ];

  // Buchungen: ohne start = Reservierung, mit start = Termin.
  // taskId = null → freie Buchung (ohne Aufgabe) mit eigenem Titel; kann später zur Aufgabe werden.
  const B = (id, taskId, datum, dauer, start = null, titel = null) => ({ id, taskId, datum, dauer, start, titel });
  const bookings = [
    B('b1', 'a1', d(1), 120),
    B('b2', 'a2', d(3), 180),
    B('b3', 'a2', d(4), 60),
    B('b4', 'a8', d(0), 90),
    B('b5', null, d(2), 45, '08:30', 'Zahnarzt'),
    B('b16', null, d(2), 60, null, 'Belege sortieren'),
    B('b17', null, d(4), 45, '17:00', 'Friseur'),
    B('b6', 'a15', d(1), 60, '14:00'),
    B('b7', 'a13', d(4), 240),
    B('b8', 'a17', d(3), 90, '10:00'),
    B('b9', 'a6', d(2), 60),
    B('b10', 'a21', d(0), 60),
    B('b11', 'a9', d(0), 30),
    B('b12', 'a19', d(7), 120),
    B('b13', 'a14', d(11), 60),
    B('b14', 'a1', d(3), 30, '16:00'),
    B('b15', 'a3', d(0), 90),
  ];

  // Externe Termine (in der App: Cache aus Google Calendar / iCloud – read-only Overlay)
  const external = [];
  let eid = 1;
  const X = (quelle, titel, datum, start, dauer) => external.push({ id: 'x' + (eid++), quelle, titel, datum, start, dauer });
  for (let i = -21; i <= 60; i++) {
    const dt = d(i), w = D.wd(dt);
    if (w === 0) X('gcal', 'Jour fixe', dt, '09:30', 30);
    if (w === 2) X('gcal', 'Weekly Codelution', dt, '11:00', 60);
    if (w === 1) X('icloud', 'Yoga', dt, '18:30', 75);
    if (w === 3) X('icloud', 'Lauftreff', dt, '07:00', 60);
  }
  X('gcal', 'Mittag mit Jan', d(3), '12:30', 60);
  X('icloud', 'Abendessen Familie', d(5), '18:00', 120);
  X('gcal', 'Merck Nachbesprechung', d(8), '13:00', 60);
  X('icloud', 'Konzert Elbphilharmonie', d(11), '19:30', 150);
  X('gcal', 'Steuerbüro Telefonat', d(0), '15:30', 30);
  X('gcal', 'Angebotsrunde intern', d(1), '10:00', 60);

  // ---------- Store (Attrappe) ----------
  let nid = 100;
  const subs = [];
  const Store = {
    HEUTE, JETZT_MIN, STATUS, tasks, bookings, external,
    on(f) { subs.push(f); },
    emit() { subs.forEach(f => f()); },
    task(id) { return tasks.find(t => t.id === id); },
    booking(id) { return bookings.find(b => b.id === id); },
    bookingsOf(tid) { return bookings.filter(b => b.taskId === tid).sort((a, b) => (a.datum + (a.start || '')).localeCompare(b.datum + (b.start || ''))); },
    isDeferred(t) { return !!t.wv && t.wv > HEUTE; },
    visibleTasks() { return tasks.filter(t => !t.done && !Store.isDeferred(t)); },
    KATEGORIEN,
    statusName(id) { return (STATUS.find(s => s.id === id) || {}).name || ''; },
    kat(statusId) { return (STATUS.find(s => s.id === statusId) || {}).kat || null; },
    katName(k) { return (KATEGORIEN.find(x => x.id === k) || {}).name || ''; },

    addTask(p) {
      if (p.nurBuchung) return Store.addFree(p.booking.datum, p.booking.start, p.booking.dauer, p.titel);
      const t = T('a' + (nid++), p.titel, {
        beschreibung: p.beschreibung || '', ort: p.ort || '', verantwortlich: p.verantwortlich || '',
        tags: p.tags || [], frist: p.frist || null, wv: p.wv || null, status: p.status || null,
      });
      tasks.unshift(t);
      if (p.booking) bookings.push(B('b' + (nid++), t.id, p.booking.datum, p.booking.dauer || 60, p.booking.start || null));
      Store.emit();
      return t;
    },
    setStatus(id, s) { const t = Store.task(id); if (t && t.status !== s) { t.status = s; Store.emit(); } },
    complete(id) { const t = Store.task(id); if (t) { t.done = true; Store.emit(); } },
    reopen(id) { const t = Store.task(id); if (t) { t.done = false; Store.emit(); } },
    addBooking(taskId, datum, start, dauer) { const b = B('b' + (nid++), taskId, datum, dauer || 60, start || null); bookings.push(b); Store.emit(); return b; },
    moveBooking(id, datum, start) { const b = Store.booking(id); if (b) { b.datum = datum; b.start = start; Store.emit(); } return b; },
    addFree(datum, start, dauer, titel) { const b = B('b' + (nid++), null, datum, dauer || 60, start || null, titel); bookings.push(b); Store.emit(); return b; },
    // „Aus einer Buchung eine Aufgabe machen“: Buchung bleibt, bekommt eine neue Aufgabe
    bookingToTask(id, status) {
      const b = Store.booking(id);
      if (!b || b.taskId) return null;
      const t = T('a' + (nid++), b.titel, { status: status || null });
      tasks.unshift(t);
      b.taskId = t.id; b.titel = null;
      Store.emit();
      return t;
    },
    removeBooking(id) { const i = bookings.findIndex(b => b.id === id); if (i >= 0) { bookings.splice(i, 1); Store.emit(); } },

    // Alles, was an einem Tag im Kalender erscheint
    entriesOn(datum) {
      const own = bookings.filter(b => b.datum === datum).map(b => ({ b, t: b.taskId ? Store.task(b.taskId) : null })).filter(x => x.t || !x.b.taskId);
      const info = x => x.t ? { taskId: x.t.id, titel: x.t.titel, done: x.t.done, frei: false } : { taskId: null, titel: x.b.titel, done: false, frei: true };
      return {
        termine: own.filter(x => x.b.start).map(x => Object.assign({ kind: 'own', id: x.b.id, s: D.min(x.b.start), e: D.min(x.b.start) + x.b.dauer }, info(x))),
        reservierungen: own.filter(x => !x.b.start).map(x => Object.assign({ id: x.b.id, dauer: x.b.dauer }, info(x))),
        extern: external.filter(x => x.datum === datum).map(x => ({ kind: x.quelle, id: x.id, titel: x.titel, s: D.min(x.start), e: D.min(x.start) + x.dauer })),
        fristen: tasks.filter(t => t.frist === datum && !t.done),
        wiedervorlagen: tasks.filter(t => t.wv === datum && !t.done),
      };
    },
    // gebuchte Minuten im Tagesfenster (für die Kapazitätsanzeige)
    load(datum) {
      const e = Store.entriesOn(datum);
      return [...e.termine, ...e.extern].reduce((s, x) => s + (x.e - x.s), 0) + e.reservierungen.reduce((s, r) => s + r.dauer, 0);
    },
  };

  // ---------- Schnellerfassung ----------
  // Syntax:  Titel  #tag  @person  /ort  !frist  ^wiedervorlage  =status  >datum [hh:mm] [dauer]
  const WDK = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
  function parseDate(s) {
    s = s.toLowerCase();
    if (s === 'heute' || s === 'h') return HEUTE;
    if (s === 'morgen' || s === 'mrg') return d(1);
    if (s === 'übermorgen' || s === 'üm') return d(2);
    let m = s.match(/^\+(\d+)([tw])?$/);
    if (m) return d(Number(m[1]) * (m[2] === 'w' ? 7 : 1));
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/);
    if (m) {
      let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : D.parse(HEUTE).getFullYear();
      let r = D.fmt(new Date(y, Number(m[2]) - 1, Number(m[1])));
      if (!m[3] && r < D.add(HEUTE, -60)) r = D.fmt(new Date(y + 1, Number(m[2]) - 1, Number(m[1])));
      return r;
    }
    const w = WDK.indexOf(s.slice(0, 2));
    if (w >= 0 && (s.length === 2 || D.WT_LANG[w].toLowerCase().startsWith(s))) {
      return d((w - D.wd(HEUTE) + 7) % 7);
    }
    return null;
  }
  function parseDauer(s) {
    const m = s.toLowerCase().match(/^(\d+(?:[.,]\d+)?)(h|std|m|min)$/);
    if (!m) return null;
    const v = Number(m[1].replace(',', '.'));
    return Math.round(m[2] === 'h' || m[2] === 'std' ? v * 60 : v);
  }
  function parseStatus(s) {
    const n = s.toLowerCase().replace(/[^a-zäöü]/g, '');
    const st = STATUS.find(x => x.id.startsWith(n) || x.name.toLowerCase().replace(/\s/g, '').startsWith(n));
    return st ? st.id : null;
  }

  function parseQuick(text) {
    const r = { titel: '', tags: [], verantwortlich: '', ort: '', frist: null, wv: null, status: null, booking: null, nurBuchung: false, fehler: [] };
    const toks = text.trim().split(/\s+/).filter(Boolean);
    // Beginnt die Zeile mit >, entsteht nur eine (freie) Buchung, keine Aufgabe
    r.nurBuchung = !!toks[0] && toks[0][0] === '>';
    const words = [];
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i], c = tk[0], rest = tk.slice(1);
      if (tk.length > 1 && c === '#') r.tags.push(rest.toLowerCase());
      else if (tk.length > 1 && c === '@') r.verantwortlich = rest;
      else if (tk.length > 1 && c === '/') r.ort = rest.replace(/_/g, ' ');
      else if (tk.length > 1 && c === '!') { r.frist = parseDate(rest); if (!r.frist) r.fehler.push(tk); }
      else if (tk.length > 1 && c === '^') { r.wv = parseDate(rest); if (!r.wv) r.fehler.push(tk); }
      else if (tk.length > 1 && c === '=') { r.status = parseStatus(rest); if (!r.status) r.fehler.push(tk); }
      else if (tk.length > 1 && c === '>') {
        const datum = parseDate(rest);
        if (!datum) { r.fehler.push(tk); continue; }
        const bk = { datum, start: null, dauer: 60 };
        if (toks[i + 1] && /^\d{1,2}:\d{2}$/.test(toks[i + 1])) { bk.start = D.hm(D.min(toks[++i])); }
        if (toks[i + 1] && parseDauer(toks[i + 1])) { bk.dauer = parseDauer(toks[++i]); }
        r.booking = bk;
      } else words.push(tk);
    }
    r.titel = words.join(' ');
    return r;
  }

  window.D = D;
  window.Store = Store;
  window.parseQuick = parseQuick;
})();
