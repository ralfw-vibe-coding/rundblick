import { describe, expect, it } from 'vitest';
import { ohneKalender, speicherKalenderCache } from './ohne';

describe('ohne externe Kalender (Phone App)', () => {
  it('Quelle ist nicht verfügbar und liefert nichts; Spiegeln geht nicht', async () => {
    const k = ohneKalender();
    expect(await k.zugriff()).toBe('nichtVerfuegbar');
    expect(await k.kalender()).toEqual([]);
    expect(await k.termine('2026-11-01', '2026-11-30')).toEqual([]);
    k.beiAenderung(() => {})();
    await expect(k.terminAnlegen('x', {} as never)).rejects.toThrow('nicht');
    await expect(k.terminAendern('x', {} as never)).rejects.toThrow();
    await expect(k.terminLoeschen('x')).rejects.toThrow();
    await expect(k.terminLesen('x')).rejects.toThrow();
  });

  it('Zwischenspeicher im Arbeitsspeicher', () => {
    const c = speicherKalenderCache();
    expect(c.stand()).toEqual({ zuletzt: null, von: null, bis: null });
    const t = (datum: string) => ({ datum } as never);
    c.ersetzen('2026-11-10', '2026-11-20', [], [t('2026-11-12')]);
    c.ersetzen('2026-11-01', '2026-11-12', [], [t('2026-11-05')]);
    c.ersetzen('2026-11-15', '2026-11-30', [], []);
    expect(c.termine('2026-11-01', '2026-11-30')).toHaveLength(1);
    expect(c.kalender()).toEqual([]);
    expect(c.stand()).toMatchObject({ von: '2026-11-01', bis: '2026-11-30' });
  });
});
