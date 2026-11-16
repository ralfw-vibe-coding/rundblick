import type { Uhr } from './interface';

export function datumLokal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const systemUhr: Uhr = {
  jetzt: () => new Date(),
  heute: () => datumLokal(new Date()),
  minuteDesTages: () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); },
};

/** Feste Uhr für Tests und Demos */
export function festeUhr(iso: string): Uhr {
  const d = new Date(iso);
  return { jetzt: () => new Date(d), heute: () => datumLokal(d), minuteDesTages: () => d.getHours() * 60 + d.getMinutes() };
}
