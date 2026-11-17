import { describe, expect, it } from 'vitest';
import { checkboxUmschalten, inline, markdownHtml } from './markdown';

describe('Markdown für Notizen', () => {
  it('Auszeichnungen inline', () => {
    expect(inline('**fett** und *kursiv* und _auch_ und ~~weg~~ und `code *nicht*`'))
      .toBe('<strong>fett</strong> und <em>kursiv</em> und <em>auch</em> und <del>weg</del> und <code>code *nicht*</code>');
  });
  it('Links: Markdown-Link, nackte URL, mailto; andere Schemata nicht', () => {
    expect(inline('[Seite](https://a.de/x?y=1&z=2)')).toBe('<a href="https://a.de/x?y=1&amp;z=2" target="_blank" rel="noopener">Seite</a>');
    expect(inline('siehe https://b.de/pfad_mit_strich.')).toBe('siehe <a href="https://b.de/pfad_mit_strich" target="_blank" rel="noopener">https://b.de/pfad_mit_strich</a>.');
    expect(inline('[Mail](mailto:x@y.de)')).toContain('href="mailto:x@y.de"');
    expect(inline('[böse](javascript:alert(1))')).not.toContain('<a');
  });
  it('maskiert HTML', () => {
    expect(markdownHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
  it('Absätze, Listen, Checklisten, Überschriften', () => {
    expect(markdownHtml('Zeile 1\nZeile 2\n\n# Titel\n- a\n* b\n1. eins\n2) zwei\n- [ ] offen\n- [x] erledigt'))
      .toBe('<p>Zeile 1<br>Zeile 2</p><h4>Titel</h4><ul><li>a</li><li>b</li></ul><ol><li>eins</li><li>zwei</li></ol>'
        + '<ul class="checks"><li class=""><input type="checkbox" data-zeile="8"><span>offen</span></li><li class="an"><input type="checkbox" data-zeile="9" checked><span>erledigt</span></li></ul>');
  });
  it('Checkbox umschalten ändert genau die Zeile', () => {
    const q = 'Einkauf\n- [ ] Milch\n- [X] Brot';
    expect(checkboxUmschalten(q, 1)).toBe('Einkauf\n- [x] Milch\n- [X] Brot');
    expect(checkboxUmschalten(q, 2)).toBe('Einkauf\n- [ ] Milch\n- [ ] Brot');
    expect(checkboxUmschalten(q, 0)).toBe(q);
    expect(checkboxUmschalten(q, 9)).toBe(q);
  });
});
