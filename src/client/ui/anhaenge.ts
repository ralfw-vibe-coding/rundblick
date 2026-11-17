// Bildanhänge an der Notiz: Vorschau mit Nummer, × (zweistufig) zum Löschen, Klick → Großansicht.
// Hinzufügen per Drag & Drop auf die Schublade oder ⌘V (Bild in der Zwischenablage).
import type { AnhangInfo } from '../../body/interface';
import { body } from './body';
import { esc, pruefe, toast } from './dom';
import { I } from './icons';

const urls = new Map<string, string>();

export function anhaengeHtml(liste: AnhangInfo[], aufgabeId: string, gesperrt: boolean): string {
  const bilder = liste.map(a => `<div class="anh-bild" data-anhang="${esc(a.id)}" title="${esc(a.name)}">
      <img alt="${esc(a.name)}"${urls.has(a.id) ? ` src="${urls.get(a.id)}"` : ''}><span class="anh-nr">${a.nr}</span>
      ${gesperrt ? '' : `<button class="muell anh-x" data-zweistufig="anhangEntfernen" data-id="${esc(aufgabeId)}/${esc(a.id)}" title="Bild löschen">${I.x}</button>`}
    </div>`).join('');
  return `<div class="anhaenge">${bilder}${gesperrt ? '' : `<div class="anh-hinweis">${I.bildHinzu}<span>Bild hierher ziehen<br>oder ⌘V</span></div>`}</div>`;
}

/** lädt fehlende Vorschauen nach (Bilddaten kommen als data:-URL vom Body) */
export function vorschauenLaden(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.anh-bild[data-anhang]').forEach(async el => {
    const id = el.dataset.anhang!;
    const img = el.querySelector('img')!;
    if (urls.has(id)) { img.src = urls.get(id)!; return; }
    const a = await body.anhang({ anhangId: id });
    if (a) { urls.set(id, a.url); img.src = a.url; } else el.classList.add('fehlt');
  });
}

export function grossansicht(id: string): void {
  const url = urls.get(id);
  if (!url) return;
  const o = document.createElement('div');
  o.className = 'lightbox';
  o.innerHTML = `<img src="${url}" alt="">`;
  const zu = () => { o.remove(); removeEventListener('keydown', taste, true); };
  const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); zu(); } };
  o.addEventListener('click', zu);
  addEventListener('keydown', taste, true);
  document.body.appendChild(o);
}

const alsBase64 = (f: File) => new Promise<string>((ok, nein) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => nein(r.error);
  r.readAsDataURL(f);
});

export async function bilderHinzufuegen(aufgabeId: string, dateien: File[]): Promise<void> {
  const bilder = dateien.filter(f => f.type.startsWith('image/'));
  if (!bilder.length) { if (dateien.length) toast('Nur Bilder können angehängt werden.', true); return; }
  for (const f of bilder) {
    const name = f.name && f.name !== 'image.png' ? f.name : `Bild ${new Date().toLocaleString('de-DE')}`;
    pruefe(await body.anhangHinzufuegen({ aufgabeId, name, typ: f.type, daten: await alsBase64(f) }));
  }
}
