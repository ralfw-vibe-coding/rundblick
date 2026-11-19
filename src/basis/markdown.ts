// Kleiner, sicherer Markdown-Renderer für Notizen (pure). Unterstützt:
//   **fett**, *kursiv* / _kursiv_, ~~durchgestrichen~~, `Code`, [Link](https://…), nackte URLs (Erkennungszeichen „://“,
//   jedes Schema außer javascript/data/vbscript – z. B. obsidian://, things://),
//   - Listen / * Listen, 1. nummerierte Listen, - [ ] / - [x] Checklisten (abhakbar), # Überschriften.
// HTML im Text wird immer maskiert. Checklisten-Einträge tragen data-zeile = Zeilennummer im Quelltext.

// Schema mit „://“; gefährliche Schemata ausgeschlossen
const SCHEMA = String.raw`(?!(?:javascript|data|vbscript):)[a-zA-Z][a-zA-Z0-9+.-]*:\/\/`;
const MD_LINK = new RegExp(String.raw`\[([^\]]+)\]\(((?:${SCHEMA}|mailto:)[^\s)]+)\)`, 'gi');
const NACKT = new RegExp(String.raw`(^|[\s(])(${SCHEMA}[^\s<)]*[^\s<).,;:!?])`, 'gi');

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function inline(text: string): string {
  const codes: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_m, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  const links: string[] = [];
  const merke = (html: string) => `\u0001${links.push(html) - 1}\u0001`;
  s = s.replace(MD_LINK, (_m, t: string, u: string) => merke(`<a href="${u}" target="_blank" rel="noopener">${t}</a>`));
  s = s.replace(NACKT, (_m, v: string, u: string) => v + merke(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(?!\s)(.+?)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)]!).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`);
}

type Block = { art: 'p' | 'ul' | 'ol' | 'check'; zeilen: { text: string; nr: number; an?: boolean }[] };

export function markdownHtml(quelle: string): string {
  const zeilen = quelle.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let block: Block | null = null;
  const schliessen = () => {
    if (!block) return;
    const b = block;
    if (b.art === 'p') html.push(`<p>${b.zeilen.map(z => inline(z.text)).join('<br>')}</p>`);
    if (b.art === 'ul') html.push(`<ul>${b.zeilen.map(z => `<li>${inline(z.text)}</li>`).join('')}</ul>`);
    if (b.art === 'ol') html.push(`<ol>${b.zeilen.map(z => `<li>${inline(z.text)}</li>`).join('')}</ol>`);
    if (b.art === 'check') html.push(`<ul class="checks">${b.zeilen.map(z => `<li class="${z.an ? 'an' : ''}"><input type="checkbox" data-zeile="${z.nr}"${z.an ? ' checked' : ''}><span>${inline(z.text)}</span></li>`).join('')}</ul>`);
    block = null;
  };
  const hinzu = (art: Block['art'], z: Block['zeilen'][number]) => {
    if (block?.art !== art) { schliessen(); block = { art, zeilen: [] }; }
    block!.zeilen.push(z);
  };
  zeilen.forEach((zeile, nr) => {
    let m: RegExpMatchArray | null;
    if (!zeile.trim()) schliessen();
    else if ((m = zeile.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/))) hinzu('check', { text: m[2]!, nr, an: m[1] !== ' ' });
    else if ((m = zeile.match(/^\s*[-*]\s+(.*)$/))) hinzu('ul', { text: m[1]!, nr });
    else if ((m = zeile.match(/^\s*\d+[.)]\s+(.*)$/))) hinzu('ol', { text: m[1]!, nr });
    else if ((m = zeile.match(/^(#{1,3})\s+(.*)$/))) { schliessen(); html.push(`<h${m[1]!.length + 3}>${inline(m[2]!)}</h${m[1]!.length + 3}>`); }
    else hinzu('p', { text: zeile, nr });
  });
  schliessen();
  return html.join('');
}

/** Hakt den Checklisten-Eintrag in Zeile `nr` ab bzw. wieder auf */
export function checkboxUmschalten(quelle: string, nr: number): string {
  const zeilen = quelle.split('\n');
  const z = zeilen[nr];
  if (z === undefined) return quelle;
  zeilen[nr] = z.replace(/^(\s*[-*]\s+\[)( |x|X)(\])/, (_m, a: string, x: string, b: string) => a + (x === ' ' ? 'x' : ' ') + b);
  return zeilen.join('\n');
}

/** Alle Checklisten-Punkte („- [ ] …“ / „- [x] …“) eines Textes */
export function checklistenpunkte(quelle: string): { text: string; erledigt: boolean }[] {
  const r: { text: string; erledigt: boolean }[] = [];
  for (const z of quelle.split('\n')) {
    const m = z.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*\S)\s*$/);
    if (m) r.push({ text: m[2]!, erledigt: m[1] !== ' ' });
  }
  return r;
}
