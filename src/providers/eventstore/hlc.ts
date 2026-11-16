// Hybrid Logical Clock: Zeitstempel nahe der Wanduhr, aber streng monoton und geräteübergreifend
// kausal sortierbar. Format: 15-stellige Millisekunden + ':' + 5-stelliger Zähler (lexikografisch sortierbar).

export function hlcFormat(ms: number, zaehler: number): string {
  return String(ms).padStart(15, '0') + ':' + String(zaehler).padStart(5, '0');
}

export function hlcParse(h: string): { ms: number; zaehler: number } {
  const [ms, z] = h.split(':');
  return { ms: Number(ms), zaehler: Number(z) };
}

export class Hlc {
  private ms = 0;
  private zaehler = 0;
  constructor(private readonly wanduhr: () => number) {}

  /** Zeitstempel für ein neues, lokal geschriebenes Event */
  neu(): string {
    const t = this.wanduhr();
    if (t > this.ms) { this.ms = t; this.zaehler = 0; }
    else this.zaehler++;
    return hlcFormat(this.ms, this.zaehler);
  }

  /** Einen fremden (oder gelesenen) Zeitstempel zur Kenntnis nehmen: danach geschriebene Events liegen dahinter */
  sehen(h: string): void {
    const { ms, zaehler } = hlcParse(h);
    if (ms > this.ms || (ms === this.ms && zaehler > this.zaehler)) { this.ms = ms; this.zaehler = zaehler; }
  }
}

/** Sortierreihenfolge des Event-Stroms: (hlc, geraet, id) */
export function stromVergleich(a: { id: string; meta: { hlc: string; geraet: string } }, b: { id: string; meta: { hlc: string; geraet: string } }): number {
  return a.meta.hlc < b.meta.hlc ? -1 : a.meta.hlc > b.meta.hlc ? 1
    : a.meta.geraet < b.meta.geraet ? -1 : a.meta.geraet > b.meta.geraet ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
