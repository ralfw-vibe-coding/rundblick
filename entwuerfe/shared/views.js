// Rundblick – Entwürfe: gemeinsame Ansichten (Liste, Board, Kalender: Tag/Woche/Monat/Timeline, Heute)
// Jede Ansicht rendert in einen Container und kennt drei Dichten: 'full' | 'compact' | 'mini'.
(function () {
  'use strict';
  const S = window.Store, D = window.D;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const H0 = D.H0, SPAN = D.SPAN, SPANMIN = SPAN * 60;
  const pct = min => ((min - H0 * 60) / SPANMIN * 100);

  // ---------- kleine Bausteine ----------
  function dueCls(t) {
    if (!t.frist) return '';
    const n = D.diff(S.HEUTE, t.frist);
    return n < 0 ? 'over' : n === 0 ? 'today' : n <= 2 ? 'soon' : '';
  }
  const due = t => t.frist ? `<span class="due ${dueCls(t)}" title="Frist">◆ ${D.rel(t.frist)}</span>` : '';
  function bk(t) {
    const bs = S.bookingsOf(t.id);
    if (!bs.length) return '';
    const r = bs.filter(b => !b.start).length, m = bs.length - r;
    const tip = bs.map(b => D.rel(b.datum) + (b.start ? ' ' + b.start : '') + ' · ' + D.dauer(b.dauer)).join('\n');
    return `<span class="bk" title="${esc(tip)}">${r ? `<i class="ic-res"></i><b>${r}</b>` : ''}${m ? `<i class="ic-term"></i><b>${m}</b>` : ''}</span>`;
  }
  const tags = t => t.tags.map(g => `<span class="chip tag">#${esc(g)}</span>`).join('');
  const person = t => t.verantwortlich ? `<span class="chip person">@${esc(t.verantwortlich)}</span>` : '';
  const ort = t => t.ort ? `<span class="chip ort">⌖ ${esc(t.ort)}</span>` : '';
  const avatar = t => t.verantwortlich ? `<span class="avatar" title="${esc(t.verantwortlich)}">${esc(t.verantwortlich[0])}</span>` : '';
  const stChip = t => t.status ? `<span class="chip"><span class="sdot st-${t.status}"></span>${esc(S.statusName(t.status))}</span>` : '';

  // ---------- Liste ----------
  const listUI = { filter: '', open: { deferred: false, done: false } };
  function matches(t, f) {
    if (!f) return true;
    f = f.toLowerCase();
    return [t.titel, t.ort, t.verantwortlich, ...t.tags.map(x => '#' + x)].join(' ').toLowerCase().includes(f);
  }
  function groups(ts) {
    const sun = D.add(D.mondayOf(S.HEUTE), 6);
    const g = { over: [], today: [], week: [], later: [], none: [] };
    ts.forEach(t => {
      if (!t.frist) g.none.push(t);
      else {
        const n = D.diff(S.HEUTE, t.frist);
        (n < 0 ? g.over : n === 0 ? g.today : t.frist <= sun ? g.week : g.later).push(t);
      }
    });
    Object.values(g).forEach(a => a.sort((x, y) => (x.frist || '').localeCompare(y.frist || '')));
    return [['over', 'Überfällig', g.over], ['today', 'Heute fällig', g.today], ['week', 'Diese Woche', g.week], ['later', 'Später', g.later], ['none', 'Ohne Frist', g.none]];
  }
  function row(t, mode) {
    const cls = ['row', t.done ? 'done' : '', S.isDeferred(t) ? 'deferred' : ''].join(' ');
    const right = mode === 'full'
      ? `${bk(t)}${stChip(t)}${t.wv && S.isDeferred(t) ? `<span class="chip wv">↩ ${D.kurz(t.wv)}</span>` : ''}${due(t)}`
      : `${bk(t)}${t.status ? `<span class="sdot st-${t.status}" title="${esc(S.statusName(t.status))}"></span>` : ''}${due(t)}`;
    return `<div class="${cls}" draggable="true" data-task="${t.id}">
      <button class="chk" data-act="${t.done ? 'reopen' : 'complete'}" title="${t.done ? 'Wieder öffnen' : 'Abschließen'}"></button>
      <div class="main"><div class="t">${esc(t.titel)}</div>${mode === 'full' ? `<div class="meta">${tags(t)}${person(t)}${ort(t)}</div>` : ''}</div>
      <div class="right">${right}</div></div>`;
  }
  function list(el, o = {}) {
    const mode = o.mode || 'full';
    if (mode === 'mini') return listMini(el);
    if (!el.querySelector(':scope > .list')) {
      el.innerHTML = `<div class="list" data-drop-list="1"><div class="list-h"><input placeholder="Filtern: Titel, #tag, @person …" /><span class="muted cnt"></span></div><div class="list-b"></div></div>`;
      const inp = el.querySelector('input');
      inp.value = listUI.filter;
      inp.addEventListener('input', () => { listUI.filter = inp.value; list(el, el._o); });
    }
    if (!el._listBound) {
      el._listBound = true;
      el.addEventListener('click', e => {
        const g = e.target.closest('[data-grp]');
        if (g) { listUI.open[g.dataset.grp] = !listUI.open[g.dataset.grp]; list(el, el._o); }
      });
    }
    el._o = o;
    el.querySelector('.list').className = 'list ' + mode;
    const ts = S.visibleTasks().filter(t => matches(t, listUI.filter));
    let h = '';
    groups(ts).forEach(([k, name, arr]) => {
      if (!arr.length) return;
      h += `<div class="grp-h ${k}">${name} <span class="n">${arr.length}</span></div>` + arr.map(t => row(t, mode)).join('');
    });
    const def = S.tasks.filter(t => !t.done && S.isDeferred(t) && matches(t, listUI.filter)).sort((a, b) => a.wv.localeCompare(b.wv));
    if (def.length) {
      h += `<div class="grp-h toggle ${listUI.open.deferred ? 'open' : ''}" data-grp="deferred">Zurückgestellt <span class="n">${def.length}</span></div>`;
      if (listUI.open.deferred) h += def.map(t => row(t, mode)).join('');
    }
    const done = S.tasks.filter(t => t.done && matches(t, listUI.filter));
    if (done.length) {
      h += `<div class="grp-h toggle ${listUI.open.done ? 'open' : ''}" data-grp="done">Abgeschlossen <span class="n">${done.length}</span></div>`;
      if (listUI.open.done) h += done.map(t => row(t, mode)).join('');
    }
    el.querySelector('.list-b').innerHTML = h || '<div class="muted" style="padding:20px">Nichts gefunden.</div>';
    el.querySelector('.cnt').textContent = ts.length + ' offen';
  }
  function listMini(el) {
    const ts = S.visibleTasks();
    const g = groups(ts);
    const n = k => g.find(x => x[0] === k)[2].length;
    const top = [...g[0][2], ...g[1][2], ...g[2][2]].slice(0, 6);
    el.innerHTML = `<div class="mini">
      <div class="kpis">
        <div class="kpi over"><b>${n('over')}</b> überfällig</div>
        <div class="kpi today"><b>${n('today')}</b> heute</div>
        <div class="kpi"><b>${n('week')}</b> diese Woche</div>
        <div class="kpi"><b>${ts.length}</b> offen gesamt</div>
      </div>
      <div class="peek">${top.map(t => `<div data-task="${t.id}"><span class="due ${dueCls(t)}">◆</span> ${esc(t.titel)}</div>`).join('')}</div>
    </div>`;
  }

  // ---------- Kanban ----------
  function card(t, mode, withStatus) {
    const kat = S.kat(t.status);
    return `<div class="card ${kat === 'beendet' ? 'ended' : ''}" draggable="true" data-task="${t.id}">
      <div class="t">${esc(t.titel)}</div>
      <div class="meta">${withStatus ? `<span class="chip"><span class="sdot st-${t.status}"></span>${esc(S.statusName(t.status))}</span>` : ''}${due(t)}${bk(t)}${mode === 'full' ? tags(t) : ''}${kat === 'beendet' ? `<button class="done-btn" data-act="complete" title="Aufgabe abschließen – eigener Zustand, unabhängig von der Spalte">✓ abschließen</button>` : ''}${avatar(t)}</div>
    </div>`;
  }
  // Board: beliebig viele Spalten, gruppiert in drei Kategorien.
  // full = alle Spalten; compact = eine Spalte je Kategorie; mini = Balken
  function board(el, o = {}) {
    const mode = o.mode || 'full';
    const ts = S.visibleTasks().filter(t => t.status);
    const inKat = k => ts.filter(t => S.kat(t.status) === k);
    if (mode === 'mini') {
      const max = Math.max(1, ...S.KATEGORIEN.map(k => inKat(k.id).length));
      const ia = inKat('begonnen');
      el.innerHTML = `<div class="mini">
        ${S.KATEGORIEN.map(k => { const n = inKat(k.id).length; return `<div data-drop-status="${k.standard}"><div class="mlabel"><span>${k.name}</span><b>${n}</b></div><div class="bar"><i class="kat-${k.id}" style="width:${n / max * 100}%"></i></div>
          <div class="muted" style="font-size:11px;margin-top:2px">${S.STATUS.filter(s => s.kat === k.id).map(s => `${s.name} ${ts.filter(t => t.status === s.id).length}`).join(' · ')}</div></div>`; }).join('')}
        <div class="peek"><div class="muted">Begonnen:</div>${ia.map(t => `<div data-task="${t.id}"><span class="sdot st-${t.status}"></span> ${esc(t.titel)}</div>`).join('')}</div>
      </div>`;
      return;
    }
    if (mode === 'compact') {
      el.innerHTML = `<div class="board compact">${S.KATEGORIEN.map(k => {
        const cs = inKat(k.id).sort((a, b) => S.STATUS.findIndex(x => x.id === a.status) - S.STATUS.findIndex(x => x.id === b.status));
        return `<div class="col kcol kat-b-${k.id}" data-drop-status="${k.standard}"><div class="col-h">${k.name}<span class="n">${cs.length}</span></div><div class="cards">${cs.map(t => card(t, mode, true)).join('')}</div></div>`;
      }).join('')}</div>`;
      return;
    }
    el.innerHTML = `<div class="board2">${S.KATEGORIEN.map(k => {
      const cols = S.STATUS.filter(s => s.kat === k.id);
      return `<div class="kat" style="flex:${cols.length} 1 0"><div class="kat-h kat-b-${k.id}">${k.name} <span class="n">${inKat(k.id).length}</span></div><div class="kat-cols">${cols.map(s => {
        const cs = ts.filter(t => t.status === s.id);
        return `<div class="col" data-drop-status="${s.id}"><div class="col-h"><span class="sdot st-${s.id}"></span>${s.name}<span class="n">${cs.length}</span></div><div class="cards">${cs.map(t => card(t, mode)).join('')}</div></div>`;
      }).join('')}</div></div>`;
    }).join('')}</div>`;
  }

  // ---------- Kalender ----------
  function layoutDay(evs) {
    evs.sort((a, b) => a.s - b.s || b.e - a.e);
    const clusters = []; let cur = [], end = -1;
    evs.forEach(e => { if (cur.length && e.s >= end) { clusters.push(cur); cur = []; } cur.push(e); end = Math.max(end, e.e); });
    if (cur.length) clusters.push(cur);
    clusters.forEach(c => {
      const lanes = [];
      c.forEach(e => { let i = lanes.findIndex(x => x <= e.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = e.e; e.lane = i; });
      c.forEach(e => e.n = lanes.length);
    });
    return evs;
  }
  function evHtml(e, mode) {
    const top = Math.max(0, pct(e.s)), h = Math.max(2.2, pct(e.e) - pct(e.s));
    const w = 100 / e.n, own = e.kind === 'own';
    const attrs = own ? `draggable="true" data-booking="${e.id}"${e.taskId ? ` data-task="${e.taskId}"` : ''}` : '';
    const showTime = mode === 'full' && (e.e - e.s) >= 45;
    return `<div class="ev ${e.kind} ${e.done ? 'done' : ''} ${e.frei ? 'frei' : ''}" ${attrs} style="top:${top}%;height:${h}%;left:calc(${e.lane * w}% + 1px);width:calc(${w}% - 3px)" title="${esc(e.titel)} · ${D.hm(e.s)}–${D.hm(e.e)}${own ? '' : ' · ' + (e.kind === 'gcal' ? 'Google Calendar' : 'iCloud')}">${esc(e.titel)}${showTime ? `<small>${D.hm(e.s)}–${D.hm(e.e)}</small>` : ''}</div>`;
  }
  const resHtml = r => `<div class="resv ${r.done ? 'done' : ''} ${r.frei ? 'frei' : ''}" draggable="true" data-booking="${r.id}"${r.taskId ? ` data-task="${r.taskId}"` : ''} title="${r.frei ? 'Freie ' : ''}Reservierung: ${esc(r.titel)} · ${D.dauer(r.dauer)}"><b>${D.dauer(r.dauer).replace(' ', '')}</b><span>${esc(r.titel)}</span></div>`;
  function capHtml(datum) {
    const used = S.load(datum), cap = 8 * 60, p = used / cap;
    return `<div class="cap ${p > 1 ? 'overbooked' : p > .8 ? 'full' : ''}" title="${D.dauer(used)} von 8 h gebucht"><i style="width:${Math.min(100, p * 100)}%"></i></div>`;
  }
  const frHtml = fs => fs.length ? `<span class="fr" style="color:var(--${(n => n < 0 ? 'over' : n === 0 ? 'today' : n <= 2 ? 'soon' : 'mute')(D.diff(S.HEUTE, fs[0].frist))})" title="Fällig:\n${esc(fs.map(t => t.titel).join('\n'))}">◆${fs.length}</span>` : '';

  function weekView(st, mode, days) {
    const n = days.length;
    const head = days.map(dt => `<div class="dh ${dt === S.HEUTE ? 'today' : ''} ${D.wd(dt) > 4 ? 'we' : ''}"><span class="wd">${n === 1 ? D.WT_LANG[D.wd(dt)] : D.WT[D.wd(dt)]}</span><span class="dn">${D.parse(dt).getDate()}</span>${frHtml(S.entriesOn(dt).fristen)}</div>`).join('');
    const res = days.map(dt => `<div class="rb" data-drop-res="${dt}">${S.entriesOn(dt).reservierungen.map(resHtml).join('')}${capHtml(dt)}</div>`).join('');
    let hours = '';
    for (let h = H0 + 1; h < D.H1; h++) hours += `<span style="top:${(h - H0) / SPAN * 100}%">${h}</span>`;
    const cols = days.map(dt => {
      const e = S.entriesOn(dt);
      const evs = layoutDay([...e.termine, ...e.extern]);
      const now = dt === S.HEUTE ? `<div class="nowline" style="top:${pct(S.JETZT_MIN)}%"></div>` : '';
      return `<div class="dcol ${D.wd(dt) > 4 ? 'we' : ''}" data-drop-day="${dt}">${evs.map(x => evHtml(x, mode)).join('')}${now}</div>`;
    }).join('');
    return `<div class="wk ${mode}" style="--n:${n}">
      <div class="wk-row wk-h"><div></div>${head}</div>
      <div class="wk-row wk-res"><div class="lbl">Reser&shy;vie&shy;rung</div>${res}</div>
      <div class="wk-scroll"><div class="wk-grid"><div class="wk-row"><div class="hours">${hours}</div>${cols}</div></div></div>
    </div>`;
  }
  function daySide(dt) {
    const e = S.entriesOn(dt);
    const termine = layoutDay([...e.termine, ...e.extern]);
    return `<div class="day-side">
      <div><h4>Fällig</h4>${e.fristen.length ? e.fristen.map(t => `<div class="row" data-task="${t.id}"><div class="main"><div class="t">◆ ${esc(t.titel)}</div></div></div>`).join('') : '<div class="muted">nichts</div>'}</div>
      <div><h4>Reservierungen</h4>${e.reservierungen.length ? `<div style="display:flex;flex-direction:column;gap:4px">${e.reservierungen.map(resHtml).join('')}</div>` : '<div class="muted">keine</div>'}</div>
      <div><h4>Termine</h4>${termine.map(x => `<div style="font-size:12px;padding:2px 0"><span class="muted">${D.hm(x.s)}</span> ${esc(x.titel)} ${x.kind !== 'own' ? `<span class="legend"><i style="background:var(--${x.kind})"></i></span>` : ''}</div>`).join('') || '<div class="muted">keine</div>'}</div>
      ${e.wiedervorlagen.length ? `<div><h4>Taucht wieder auf</h4>${e.wiedervorlagen.map(t => `<div data-task="${t.id}" style="font-size:12px">↩ ${esc(t.titel)}</div>`).join('')}</div>` : ''}
    </div>`;
  }

  function monthView(st, mode) {
    const a = D.parse(st.anchor);
    const first = D.fmt(new Date(a.getFullYear(), a.getMonth(), 1));
    const start = D.mondayOf(first);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const dt = D.add(start, i), e = S.entriesOn(dt);
      const other = D.parse(dt).getMonth() !== a.getMonth();
      const bars = [...e.termine, ...e.extern].map(x => `<i class="${x.kind} ${x.frei ? 'frei' : ''}" style="top:${Math.max(0, pct(x.s))}%;height:${Math.max(3, pct(x.e) - pct(x.s))}%" title="${D.hm(x.s)} ${esc(x.titel)}" ${x.kind === 'own' && x.taskId ? `data-task="${x.taskId}"` : ''}${x.frei ? ` data-booking="${x.id}"` : ''}>${mode === 'full' ? esc(x.titel) : ''}</i>`).join('');
      const maxR = mode === 'full' ? 3 : 2;
      const rs = e.reservierungen.slice(0, maxR).map(resHtml).join('') + (e.reservierungen.length > maxR ? `<div class="more">+${e.reservierungen.length - maxR}</div>` : '');
      cells += `<div class="mc ${other ? 'other' : ''} ${dt === S.HEUTE ? 'today' : ''} ${D.wd(dt) > 4 ? 'we' : ''}" data-drop-res="${dt}" data-day="${dt}">
        <div class="mh"><span class="dn">${D.parse(dt).getDate()}</span>${frHtml(e.fristen)}</div>
        <div class="mb"><div class="mstrip">${bars}</div><div class="mres">${rs}</div></div></div>`;
    }
    return `<div class="mo ${mode}"><div class="mo-h">${D.WT.map(w => `<div>${w}</div>`).join('')}</div><div class="mo-g">${cells}</div></div>`;
  }

  // Timeline: horizontal, zoombar (st.pph = Pixel pro Stunde im Tagesfenster 7–21 Uhr)
  function timelineView(st, mode) {
    const pph = st.pph, dayW = SPAN * pph;
    const start = D.add(D.mondayOf(st.anchor), -7), N = 56;
    const W = N * dayW;
    const x = (dt, min) => D.diff(start, dt) * dayW + (min - H0 * 60) / 60 * pph;
    let top = '', days = '', hrs = '', bg = '';
    for (let i = 0; i < N; i++) {
      const dt = D.add(start, i), wd = D.wd(dt), left = i * dayW;
      if (wd === 0) top += `<span style="left:${left}px">KW ${D.kw(dt)} · ${D.kurz(dt)}</span>`;
      if (wd > 4) bg += `<div class="we" style="left:${left}px;width:${dayW}px"></div>`;
      bg += `<div class="dl" style="left:${left}px"></div>`;
      if (dayW >= 34) days += `<span class="${dt === S.HEUTE ? 'today' : ''}" style="left:${left}px;width:${dayW}px">${dayW >= 80 ? D.WT[wd] + ' ' : ''}${D.parse(dt).getDate()}${dayW >= 80 ? '.' + (D.parse(dt).getMonth() + 1) + '.' : ''}</span>`;
      if (pph >= 22) for (let h = H0 + 1; h < D.H1; h += (pph >= 40 ? 1 : 2)) hrs += `<span style="left:${left + (h - H0) * pph}px">${h}</span>`;
    }
    const lanes = { fristen: '', termine: '', res: '', ext: '', wv: '', last: '' };
    for (let i = 0; i < N; i++) {
      const dt = D.add(start, i), e = S.entriesOn(dt);
      e.termine.forEach(t => { lanes.termine += `<div class="tl-it own ${t.done ? 'done' : ''} ${t.frei ? 'frei' : ''}" draggable="true" data-booking="${t.id}"${t.taskId ? ` data-task="${t.taskId}"` : ''} style="left:${x(dt, t.s)}px;width:${Math.max(6, (t.e - t.s) / 60 * pph - 2)}px;top:6px" title="${esc(t.titel)} · ${D.hm(t.s)}">${esc(t.titel)}</div>`; });
      { const u = S.load(dt), p = u / 480; lanes.last += `<div title="${D.dauer(u)} von 8 h gebucht" style="position:absolute;left:${i * dayW + 3}px;width:${dayW - 6}px;bottom:3px;height:${Math.min(1.15, p) / 1.15 * 30}px;border-radius:3px 3px 0 0;background:${p > 1 ? 'var(--over)' : p > .8 ? 'var(--soon)' : '#c9c5bd'};opacity:.75"></div>${dayW >= 60 && u ? `<span style="position:absolute;left:${i * dayW + 6}px;top:3px;font-size:10px;color:var(--mute)">${D.dauer(u)}</span>` : ''}`; }
      let off = H0 * 60;
      e.reservierungen.forEach(r => { lanes.res += `<div class="tl-it resv ${r.frei ? 'frei' : ''}" draggable="true" data-booking="${r.id}"${r.taskId ? ` data-task="${r.taskId}"` : ''} style="left:${x(dt, off)}px;width:${Math.max(6, r.dauer / 60 * pph - 2)}px;top:6px" title="Reservierung ${D.dauer(r.dauer)}: ${esc(r.titel)}"><b>${D.dauer(r.dauer).replace(' ', '')}</b> ${esc(r.titel)}</div>`; off += r.dauer; });
      layoutDay(e.extern).forEach(t => { lanes.ext += `<div class="tl-it ${t.kind}" style="left:${x(dt, t.s)}px;width:${Math.max(6, (t.e - t.s) / 60 * pph - 2)}px;top:${4 + t.lane * 24}px" title="${esc(t.titel)} · ${D.hm(t.s)}">${esc(t.titel)}</div>`; });
      e.fristen.forEach((t, k) => { const n = D.diff(S.HEUTE, dt); lanes.fristen += `<div class="tl-mark ${n < 0 ? '' : n <= 2 ? 'soon' : 'later'}" data-task="${t.id}" style="left:${x(dt, D.H1 * 60) - 4}px;top:${4 + k * 18}px;flex-direction:row-reverse" title="Frist: ${esc(t.titel)}"><span class="dia"></span>${dayW >= 60 ? `<span style="max-width:${dayW - 22}px">${esc(t.titel)}</span>` : ''}</div>`; });
      e.wiedervorlagen.forEach((t, k) => { lanes.wv += `<div class="tl-mark wv" data-task="${t.id}" style="left:${x(dt, H0 * 60) + 6}px;top:${5 + k * 18}px" title="Wiedervorlage: ${esc(t.titel)}"><span class="dia"></span>${dayW >= 60 ? `<span>${esc(t.titel)}</span>` : ''}</div>`; });
    }
    const maxF = Math.max(1, ...Array.from({ length: N }, (_, i) => S.entriesOn(D.add(start, i)).fristen.length));
    const nowX = x(S.HEUTE, S.JETZT_MIN);
    const lane = (k, label, h, drop) => `<div class="tl-lane" style="height:${h}px" ${drop ? `data-drop-tl="${drop}"` : ''}><span class="ll">${label}</span>${lanes[k]}</div>`;
    return `<div class="tl ${mode}"><div class="tl-scroll"><div class="tl-inner" style="width:${W}px">
      <div class="tl-head"><div class="r top">${top}</div>${days ? `<div class="r">${days}</div>` : ''}${hrs ? `<div class="r hrs">${hrs}</div>` : ''}</div>
      <div style="position:relative"><div class="tl-bg">${bg}</div>
        ${lane('fristen', 'Fristen', 8 + maxF * 18)}
        ${lane('termine', 'Termine', 34, 'termin')}
        ${lane('res', 'Reservierungen', 34, 'res')}
        ${lane('ext', 'Extern · Google / iCloud', 56)}
        ${lane('wv', 'Wiedervorlage', 26)}
        ${lane('last', 'Auslastung', 50)}
        <div class="tl-now" style="left:${nowX}px"></div>
      </div>
    </div></div></div>`;
  }
  function tlMeta(st) { return { start: D.add(D.mondayOf(st.anchor), -7), dayW: SPAN * st.pph }; }

  function calTitle(st) {
    const a = D.parse(st.anchor);
    if (st.view === 'tag') return `${D.WT_LANG[D.wd(st.anchor)]}, ${a.getDate()}. ${D.MON_LANG[a.getMonth()]}`;
    if (st.view === 'woche') { const m = D.mondayOf(st.anchor), s = D.add(m, 6); return `KW ${D.kw(m)} · ${D.kurz(m)}–${D.kurz(s)}`; }
    if (st.view === 'tage3') return `${D.WT[D.wd(st.anchor)]} ${D.kurz(st.anchor)} – ${D.WT[D.wd(D.add(st.anchor, 2))]} ${D.kurz(D.add(st.anchor, 2))}`;
    if (st.view === 'monate3') { const b = new Date(a.getFullYear(), a.getMonth() + 2, 1); return `${D.MON[a.getMonth()]} – ${D.MON[b.getMonth()]} ${b.getFullYear()}`; }
    return `${D.MON_LANG[a.getMonth()]} ${a.getFullYear()}`;
  }
  function nDays(st, n) { return Array.from({ length: n }, (_, i) => D.add(st.anchor, i)); }
  function monthsView(st, mode, n) {
    const a = D.parse(st.anchor);
    let h = '';
    for (let i = 0; i < n; i++) {
      const m = D.fmt(new Date(a.getFullYear(), a.getMonth() + i, 1));
      h += `<div class="mm"><div class="mm-h">${D.MON_LANG[D.parse(m).getMonth()]} ${D.parse(m).getFullYear()}</div>${monthView({ anchor: m }, 'compact')}</div>`;
    }
    return `<div class="months">${h}</div>`;
  }
  function weekDays(st) { const m = D.mondayOf(st.anchor); return Array.from({ length: 7 }, (_, i) => D.add(m, i)); }

  function calendar(el, st, o = {}) {
    const mode = o.mode || 'full';
    el._cal = { st, o };
    if (mode === 'mini') return agendaMini(el, st);
    const views = o.views || ['tag', 'woche', 'monat', 'timeline'];
    const names = { tag: 'Tag', tage3: '3 Tage', woche: 'Woche', monat: 'Monat', monate3: '3 Monate', timeline: 'Timeline' };
    const keys = { tag: 'T', tage3: '', woche: 'W', monat: 'M', monate3: '', timeline: 'Z' };
    let body = '';
    if (st.view === 'tag') body = `<div style="display:flex;flex:1;min-height:0">${`<div style="flex:1;min-width:0;display:flex;flex-direction:column">${weekView(st, mode, [st.anchor])}</div>`}${mode === 'full' ? daySide(st.anchor) : ''}</div>`;
    else if (st.view === 'woche') body = weekView(st, mode, weekDays(st));
    else if (st.view === 'monat') body = monthView(st, mode);
    else if (st.view === 'tage3') body = weekView(st, mode, nDays(st, 3));
    else if (st.view === 'monate3') body = monthsView(st, mode, 3);
    else body = timelineView(st, mode);
    el.innerHTML = `<div class="cal ${mode}">
      <div class="cal-tb">
        ${views.length > 1 ? `<div class="seg">${views.map(v => `<button data-cal-view="${v}" class="${st.view === v ? 'on' : ''}" title="Taste ${keys[v]}">${names[v]}</button>`).join('')}</div>` : ''}
        <div class="nav"><button data-cal-nav="-1">‹</button><button data-cal-nav="0">Heute</button><button data-cal-nav="1">›</button></div>
        ${st.view !== 'timeline' ? `<span class="title">${calTitle(st)}</span>` : `<span class="zoom">Zoom <input type="range" min="2" max="48" value="${st.pph}" data-cal-zoom /> <span>${st.pph < 6 ? 'Wochen' : st.pph < 20 ? 'Tage' : 'Stunden'}</span></span><span class="muted" style="font-size:11px">⌘ + Scrollen / Pinch</span>`}
        <span class="spacer"></span>
        ${mode === 'full' ? `<span class="legend"><span><i style="background:var(--own)"></i>Termin</span><span><i style="border:1.5px dashed var(--own)"></i>Reservierung</span><span><i style="background:var(--free)"></i>ohne Aufgabe</span><span><i style="background:var(--gcal)"></i>Google</span><span><i style="background:var(--icloud)"></i>iCloud</span></span>` : ''}
      </div>
      <div class="cal-b">${body}</div></div>`;
    // Ereignisse
    el.onclick = e => {
      const v = e.target.closest('[data-cal-view]'), n = e.target.closest('[data-cal-nav]');
      if (v) { st.view = v.dataset.calView; calendar(el, st, o); }
      if (n) {
        const k = Number(n.dataset.calNav);
        if (k === 0) { st.anchor = S.HEUTE; st.scrollX = null; }
        else st.anchor = st.view === 'tag' ? D.add(st.anchor, k) : st.view === 'tage3' ? D.add(st.anchor, 3 * k) : st.view === 'woche' ? D.add(st.anchor, 7 * k) : st.view === 'timeline' ? D.add(st.anchor, 14 * k) : D.fmt(new Date(D.parse(st.anchor).getFullYear(), D.parse(st.anchor).getMonth() + k, 1));
        if (st.view === 'timeline' && k !== 0) st.scrollX = null;
        calendar(el, st, o);
      }
    };
    el.ondblclick = e => {
      const c = e.target.closest('[data-day]');
      if (c) { st.view = 'tag'; st.anchor = c.dataset.day; calendar(el, st, o); }
    };
    if (st.view === 'woche' || st.view === 'tag' || st.view === 'tage3') {
      const sc = el.querySelector('.wk-scroll');
      if (mode === 'full' && sc) sc.scrollTop = st.view === 'tag' ? 0 : (8 - H0) / SPAN * sc.scrollHeight - 10;
    }
    if (st.view === 'timeline') {
      const sc = el.querySelector('.tl-scroll'), m = tlMeta(st);
      const z = el.querySelector('[data-cal-zoom]');
      sc.scrollLeft = st.scrollX != null ? st.scrollX : Math.max(0, (D.diff(m.start, S.HEUTE) - 1) * m.dayW);
      sc.onscroll = () => { st.scrollX = sc.scrollLeft; };
      const zoomTo = (pph, cx) => {
        pph = Math.max(2, Math.min(48, Math.round(pph)));
        if (pph === st.pph) return;
        const t = (sc.scrollLeft + cx) / (SPAN * st.pph);
        st.pph = pph;
        st.scrollX = t * SPAN * pph - cx;
        calendar(el, st, o);
      };
      z.oninput = () => zoomTo(Number(z.value), sc.clientWidth / 2);
      sc.onwheel = ev => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        const r = sc.getBoundingClientRect();
        zoomTo(st.pph * Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left);
      };
    }
  }
  function agendaMini(el, st) {
    const e = S.entriesOn(S.HEUTE);
    const termine = layoutDay([...e.termine, ...e.extern]);
    const next = termine.find(x => x.e > S.JETZT_MIN);
    el.innerHTML = `<div class="mini">
      <div class="kpi"><b>${D.WT[D.wd(S.HEUTE)]} ${D.parse(S.HEUTE).getDate()}.</b> <span class="muted">KW ${D.kw(S.HEUTE)}</span></div>
      ${next ? `<div class="muted" style="font-size:12px">Als Nächstes · ${D.hm(next.s)}<br><b style="color:var(--ink)">${esc(next.titel)}</b></div>` : ''}
      <div class="peek">${termine.map(x => `<div style="${x.e <= S.JETZT_MIN ? 'opacity:.45' : ''}"><span class="legend"><i style="background:var(--${x.kind === 'own' ? 'own' : x.kind})"></i></span>${D.hm(x.s)} ${esc(x.titel)}</div>`).join('')}</div>
      <div class="peek">${e.reservierungen.map(resHtml).join('')}</div>
      ${capHtml(S.HEUTE)}
    </div>`;
  }

  // ---------- Heute (Startkachel) ----------
  function today(el) {
    const e = S.entriesOn(S.HEUTE);
    const termine = layoutDay([...e.termine, ...e.extern]);
    const ts = S.visibleTasks();
    const over = ts.filter(t => t.frist && t.frist < S.HEUTE), now = ts.filter(t => t.frist === S.HEUTE);
    const ia = ts.filter(t => S.kat(t.status) === 'begonnen');
    const wv = S.tasks.filter(t => !t.done && t.wv === S.HEUTE);
    const block = (title, arr, f) => arr.length ? `<div><div class="grp-h">${title} <span class="n">${arr.length}</span></div>${arr.map(f).join('')}</div>` : '';
    el.innerHTML = `<div style="display:grid;grid-template-columns:1.1fr 1fr;gap:6px;height:100%;min-height:0;overflow:hidden">
      <div style="overflow:auto;padding:4px 0">
        ${block('Überfällig', over, t => row(t, 'compact'))}
        ${block('Heute fällig', now, t => row(t, 'compact'))}
        ${block('Begonnen', ia, t => row(t, 'compact'))}
        ${block('Reservierungen heute', e.reservierungen, r => `<div style="padding:2px 12px">${resHtml(r)}</div>`)}
        ${block('Taucht heute wieder auf', wv, t => row(t, 'compact'))}
      </div>
      <div style="overflow:auto;padding:4px 10px 4px 0">
        <div class="grp-h">Termine heute</div>
        ${termine.map(x => `<div style="display:flex;gap:8px;padding:4px 2px;border-bottom:1px solid var(--line);${x.e <= S.JETZT_MIN ? 'opacity:.45' : ''}" ${x.kind === 'own' ? `data-task="${x.taskId}"` : ''}><span class="muted" style="width:38px;font-variant-numeric:tabular-nums">${D.hm(x.s)}</span><span class="legend"><i style="background:var(--${x.kind})"></i></span><span style="flex:1">${esc(x.titel)}</span><span class="muted">${D.dauer(x.e - x.s)}</span></div>`).join('')}
        <div style="margin-top:10px" class="muted">Auslastung heute</div>${capHtml(S.HEUTE).replace('class="cap', 'style="height:6px;margin-top:4px" class="cap')}
      </div>
    </div>`;
  }

  // ---------- Detail-Schublade ----------
  let drawer;
  function openDetail(id) {
    const t = id ? S.task(id) : null;
    if (id && !t) return;
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.className = 'drawer';
      document.body.appendChild(drawer);
      drawer.addEventListener('click', e => {
        const a = e.target.closest('[data-dact]');
        if (!a) return;
        const tid = drawer.dataset.id;
        if (a.dataset.dact === 'close') closeDetail();
        if (a.dataset.dact === 'complete') { S.complete(tid); closeDetail(); toast('Aufgabe abgeschlossen'); }
        if (a.dataset.dact === 'res') { const b = S.addBooking(tid, D.add(S.HEUTE, 1), null, 60); toast('Reservierung angelegt: ' + D.rel(b.datum) + ' · 1 h'); openDetail(tid); }
        if (a.dataset.dact === 'rm') { S.removeBooking(a.dataset.b); openDetail(tid); }
        if (a.dataset.dact === 'totask') { const t = S.bookingToTask(drawer.dataset.b); toast('Aufgabe erstellt: ' + t.titel); openDetail(t.id); }
        if (a.dataset.dact === 'rmfree') { S.removeBooking(drawer.dataset.b); closeDetail(); }
      });
    }
    if (!t) { requestAnimationFrame(() => drawer.classList.add('open')); return; }
    const f = (l, v, raw) => `<div class="fld"><label>${l}</label><div class="v ${v ? '' : 'empty'}">${v ? (raw ? v : esc(v)) : '—'}</div></div>`;
    const bs = S.bookingsOf(id);
    drawer.dataset.id = id;
    drawer.innerHTML = `<div class="dh"><h3>${esc(t.titel)}</h3><button data-dact="close" title="Schließen (Esc)">×</button></div>
      <div class="db">
        ${f('Zustand', t.done ? '✓ abgeschlossen' : 'offen')}
        ${f('Beschreibung', t.beschreibung)}
        <div class="fld-grid">
          ${f('Status', t.status ? stChip(t) + ` <span class="muted">· ${S.katName(S.kat(t.status))}</span>` : '', true)}
          ${f('Verantwortlich', t.verantwortlich)}
          ${f('Frist', t.frist ? `<span class="due ${dueCls(t)}">◆ ${D.WT[D.wd(t.frist)]} ${D.kurz(t.frist)}</span>` : '', true)}
          ${f('Wiedervorlage', t.wv ? `↩ ${D.WT[D.wd(t.wv)]} ${D.kurz(t.wv)}${S.isDeferred(t) ? ' <span class="muted">(bis dahin unsichtbar)</span>' : ''}` : '', true)}
          ${f('Ort', t.ort)}
          ${f('Tags', t.tags.length ? tags(t) : '', true)}
        </div>
        <div class="fld"><label>Buchungen</label><div class="bk-list">
          ${bs.map(b => `<div class="bk-item" data-booking="${b.id}" data-task="${id}"><span class="k ${b.start ? 'term' : 'res'}">${b.start ? 'Termin' : 'Reservierung'}</span><span>${D.WT[D.wd(b.datum)]} ${D.kurz(b.datum)}${b.start ? ' · ' + b.start : ''}</span><span class="muted">${D.dauer(b.dauer)}</span><button class="x" data-dact="rm" data-b="${b.id}" title="Buchung entfernen">×</button></div>`).join('') || '<div class="muted">Noch keine Buchung. Aufgabe in den Kalender ziehen oder:</div>'}
          <button class="btn" data-dact="res" style="align-self:flex-start">+ Reservierung morgen · 1 h</button>
        </div></div>
        <div class="muted" style="font-size:11px;line-height:1.5">Entwurf: Felder sind hier nur Anzeige. In der App inline editierbar; jede Änderung = ein Command → ein Event (z. B. <code>FristGesetzt</code>).</div>
      </div>
      <div class="df"><button class="btn ok" data-dact="complete">✓ Abschließen</button><span class="spacer"></span><button class="btn" data-dact="close">Schließen</button></div>`;
    requestAnimationFrame(() => drawer.classList.add('open'));
  }
  function closeDetail() { if (drawer) drawer.classList.remove('open'); closePop(); }
  function openBooking(bid) {
    const b = S.booking(bid);
    if (!b) return;
    if (b.taskId) return openDetail(b.taskId);
    openDetail(null);
    drawer.dataset.id = '';
    drawer.dataset.b = bid;
    drawer.innerHTML = `<div class="dh"><h3>${esc(b.titel)}</h3><button data-dact="close" title="Schließen (Esc)">×</button></div>
      <div class="db">
        <div class="fld-grid">
          <div class="fld"><label>Art</label><div class="v">${b.start ? 'Termin' : 'Reservierung'} <span class="muted">· ohne Aufgabe</span></div></div>
          <div class="fld"><label>Wann</label><div class="v">${D.WT[D.wd(b.datum)]} ${D.kurz(b.datum)}${b.start ? ' · ' + b.start : ''}</div></div>
          <div class="fld"><label>Dauer</label><div class="v">${D.dauer(b.dauer)}</div></div>
        </div>
        <div class="muted" style="line-height:1.5">Eine freie Buchung ist nur ein Kalendereintrag. Wird mehr daraus, macht man eine Aufgabe draus. Die Buchung bleibt erhalten und gehört dann zur Aufgabe. Alternativ die Buchung auf die Liste oder eine Board-Spalte ziehen.</div>
      </div>
      <div class="df"><button class="btn primary" data-dact="totask">→ Aufgabe daraus machen</button><span class="spacer"></span><button class="btn" data-dact="rmfree">Löschen</button></div>`;
  }
  let pop;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function newFree(x, y, datum, start) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'pop';
    pop.style.left = Math.min(x, innerWidth - 300) + 'px';
    pop.style.top = Math.min(y, innerHeight - 110) + 'px';
    pop.innerHTML = `<div class="muted" style="font-size:11px;margin-bottom:4px">${start ? 'Termin' : 'Reservierung'} ${D.WT[D.wd(datum)]} ${D.kurz(datum)}${start ? ' ' + start : ''} · ohne Aufgabe</div>
      <input placeholder="Titel … (Dauer z. B. 90m am Ende)" /><div class="muted" style="font-size:11px;margin-top:4px"><kbd>↵</kbd> eintragen · <kbd>Esc</kbd> abbrechen</div>`;
    document.body.appendChild(pop);
    const inp = pop.querySelector('input');
    inp.focus();
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') closePop();
      if (e.key === 'Enter' && inp.value.trim()) {
        let txt = inp.value.trim(), dauer = 60;
        const m = txt.match(/\s(\d+(?:[.,]\d+)?)(h|m|min)$/);
        if (m) { dauer = Math.round(Number(m[1].replace(',', '.')) * (m[2] === 'h' ? 60 : 1)); txt = txt.slice(0, m.index); }
        S.addFree(datum, start, dauer, txt);
        toast('Freie Buchung eingetragen: ' + txt);
        closePop();
      }
    });
  }
  document.addEventListener('mousedown', e => { if (pop && !e.target.closest('.pop')) closePop(); });

  // ---------- Toast ----------
  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ---------- Schnellerfassung ----------
  function chipsFor(p) {
    const c = [];
    p.tags.forEach(t => c.push(`<span class="chip tag">#${esc(t)}</span>`));
    if (p.verantwortlich) c.push(`<span class="chip person">@${esc(p.verantwortlich)}</span>`);
    if (p.ort) c.push(`<span class="chip ort">⌖ ${esc(p.ort)}</span>`);
    if (p.frist) c.push(`<span class="chip frist">◆ Frist ${D.WT[D.wd(p.frist)]} ${D.kurz(p.frist)}</span>`);
    if (p.wv) c.push(`<span class="chip wv">↩ unsichtbar bis ${D.WT[D.wd(p.wv)]} ${D.kurz(p.wv)}</span>`);
    if (p.status) c.push(`<span class="chip status"><span class="sdot st-${p.status}"></span>${esc(S.statusName(p.status))} → Board</span>`);
    if (p.nurBuchung) c.push(`<span class="chip" style="background:#e5e7eb">nur Buchung · keine Aufgabe</span>`);
    if (p.booking) c.push(`<span class="chip res">${p.booking.start ? '■ Termin' : '▭ Reservierung'} ${D.WT[D.wd(p.booking.datum)]} ${D.kurz(p.booking.datum)}${p.booking.start ? ' ' + p.booking.start : ''} · ${D.dauer(p.booking.dauer)}</span>`);
    p.fehler.forEach(f => c.push(`<span class="chip err" title="nicht verstanden">${esc(f)}</span>`));
    return c.join('');
  }
  const SYNTAX = `<code>#tag</code> <code>@person</code> <code>/ort</code> <code>!fr</code> Frist · <code>^1.12.</code> Wiedervorlage · <code>=inarbeit</code> Status · <code>&gt;do 2h</code> Reservierung · <code>&gt;morgen 14:00 1h</code> Termin<br>Zeile beginnt mit <code>&gt;</code> → nur Buchung ohne Aufgabe, z. B. <code>&gt;fr 17:00 45m Friseur</code><br>Datum: <code>heute</code> <code>morgen</code> <code>mo…so</code> <code>+3</code> <code>+2w</code> <code>24.12.</code>`;
  function quickCapture(root, o = {}) {
    root.classList.add('qc');
    root.innerHTML = `<span class="plus">+</span><input placeholder="${o.placeholder || 'Neue Aufgabe … z. B. „Angebot Müller #kunde !fr >mi 2h“'}" /><span class="hint"><kbd>N</kbd></span>
      <div class="qc-preview"><div class="pt"></div><div class="chips"></div><div class="syntax">${SYNTAX}</div></div>`;
    const inp = root.querySelector('input');
    const upd = () => {
      const p = parseQuick(inp.value);
      root.querySelector('.pt').textContent = p.titel || 'Titel fehlt noch …';
      root.querySelector('.chips').innerHTML = chipsFor(p) || '<span class="muted">→ landet in der Liste' + (p.status ? '' : ' (ohne Status: nicht auf dem Board)') + '</span>';
    };
    inp.addEventListener('focus', () => { root.classList.add('open'); upd(); });
    inp.addEventListener('blur', () => setTimeout(() => root.classList.remove('open'), 120));
    inp.addEventListener('input', upd);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
      if (e.key === 'Enter') {
        const p = parseQuick(inp.value);
        if (!p.titel) { toast('Titel fehlt'); return; }
        if (p.nurBuchung && !p.booking) { toast('Datum der Buchung fehlt'); return; }
        S.addTask(p);
        toast((p.nurBuchung ? 'Buchung: ' : 'Erfasst: ') + p.titel + (p.booking ? ' · ' + (p.booking.start ? 'Termin' : 'Reservierung') + ' ' + D.rel(p.booking.datum) : ''));
        inp.value = '';
        upd();
        if (o.onDone) o.onDone();
      }
    });
    return inp;
  }

  // ---------- globale Interaktion: Klick, Drag & Drop, Hervorhebung ----------
  document.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const tid = act.closest('[data-task]').dataset.task;
      if (act.dataset.act === 'complete') { S.complete(tid); toast('Abgeschlossen: ' + S.task(tid).titel); }
      if (act.dataset.act === 'reopen') S.reopen(tid);
      e.stopPropagation();
      return;
    }
    if (e.target.closest('.drawer, .pop')) return;
    const t = e.target.closest('[data-task]');
    if (t) { openDetail(t.dataset.task); return; }
    const b = e.target.closest('[data-booking]');
    if (b) openBooking(b.dataset.booking);
  });
  // Doppelklick ins Reservierungsband oder Zeitraster: freie Buchung eintragen
  document.addEventListener('dblclick', e => {
    if (e.target.closest('[data-booking], .ev')) return;
    const rb = e.target.closest('.rb[data-drop-res]'), dc = e.target.closest('.dcol[data-drop-day]');
    if (rb) newFree(e.clientX, e.clientY, rb.dataset.dropRes, null);
    else if (dc) {
      const r = dc.getBoundingClientRect();
      const min = Math.floor((H0 * 60 + (e.clientY - r.top) / r.height * SPANMIN) / 30) * 30;
      newFree(e.clientX, e.clientY, dc.dataset.dropDay, D.hm(Math.max(H0 * 60, Math.min(D.H1 * 60 - 30, min))));
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  let drag = null;
  document.addEventListener('dragstart', e => {
    const b = e.target.closest('[data-booking]'), t = e.target.closest('[data-task]');
    if (!t && !b) return;
    drag = { booking: b ? b.dataset.booking : null, task: t ? t.dataset.task : null };
    e.dataTransfer.setData('text/plain', JSON.stringify(drag));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
  const DROP = '[data-drop-status],[data-drop-res],[data-drop-day],[data-drop-tl],[data-drop-list]';
  document.addEventListener('dragover', e => {
    const z = e.target.closest(DROP);
    if (!z || !drag) return;
    if ((z.dataset.dropStatus || z.dataset.dropList) && !drag.task && !(drag.booking && !S.booking(drag.booking).taskId)) return;
    e.preventDefault();
    document.querySelectorAll('.over').forEach(x => x !== z && x.classList.remove('over'));
    z.classList.add('over');
  });
  document.addEventListener('drop', e => {
    const z = e.target.closest(DROP);
    if (!z || !drag) return;
    e.preventDefault();
    z.classList.remove('over');
    const { booking, task } = drag;
    const old = booking ? S.booking(booking) : null;
    const place = (datum, start) => {
      if (old) { S.moveBooking(booking, datum, start); toast((start ? 'Termin' : 'Reservierung') + ' verschoben: ' + D.rel(datum) + (start ? ' ' + start : '')); }
      else if (task) { S.addBooking(task, datum, start, 60); toast((start ? 'Termin' : 'Reservierung') + ' angelegt: ' + D.rel(datum) + (start ? ' ' + start : '') + ' · 1 h'); }
    };
    if (z.dataset.dropStatus || z.dataset.dropList) {
      // freie Buchung auf Board oder Liste gezogen → daraus wird eine Aufgabe
      if (!task && old && !old.taskId) { const t = S.bookingToTask(booking, z.dataset.dropStatus || null); toast('Aufgabe aus Buchung erstellt: ' + t.titel); }
      else if (z.dataset.dropStatus && task) { S.setStatus(task, z.dataset.dropStatus); toast('Status: ' + S.statusName(z.dataset.dropStatus) + ' · ' + S.katName(S.kat(z.dataset.dropStatus))); }
    }
    else if (z.dataset.dropRes) place(z.dataset.dropRes, null);
    else if (z.dataset.dropDay) {
      const r = z.getBoundingClientRect();
      const min = Math.round((H0 * 60 + (e.clientY - r.top) / r.height * SPANMIN) / 15) * 15;
      place(z.dataset.dropDay, D.hm(Math.max(H0 * 60, Math.min(D.H1 * 60 - 15, min))));
    } else if (z.dataset.dropTl) {
      const host = z.closest('[data-cal-host]') || z.closest('.cal').parentElement;
      const st = host._cal.st, m = tlMeta(st);
      const xx = e.clientX - z.getBoundingClientRect().left;
      const di = Math.floor(xx / m.dayW), datum = D.add(m.start, di);
      const min = Math.round((H0 * 60 + (xx - di * m.dayW) / st.pph * 60) / 15) * 15;
      place(datum, z.dataset.dropTl === 'termin' ? D.hm(Math.min(D.H1 * 60 - 15, min)) : null);
    }
  });
  let hlId = null;
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-task]');
    const id = t ? t.dataset.task : null;
    if (id === hlId) return;
    document.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
    hlId = id;
    if (id) document.querySelectorAll(`[data-task="${id}"]`).forEach(x => x.classList.add('hl'));
  });

  // Tastatur-Helfer: true, wenn gerade getippt wird
  const typing = e => /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '') || e.metaKey || e.ctrlKey || e.altKey;

  window.V = { openBooking, list, board, calendar, today, openDetail, closeDetail, toast, quickCapture, chipsFor, SYNTAX, typing, esc };
})();
