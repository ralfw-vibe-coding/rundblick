// IdGenerator: ULIDs (zeitlich sortierbar, 26 Zeichen Crockford-Base32).
import type { IdGenerator } from './interface';

const ZEICHEN = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Zufall über Web Crypto – gibt es in Node (ab 19) und im Browser gleichermaßen
const zufallsbytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function ulid(ms = Date.now(), zufall: Uint8Array = zufallsbytes(16)): string {
  let zeit = '';
  let t = ms;
  for (let i = 0; i < 10; i++) { zeit = ZEICHEN[t % 32] + zeit; t = Math.floor(t / 32); }
  let rest = '';
  for (let i = 0; i < 16; i++) rest += ZEICHEN[zufall[i]! % 32];
  return zeit + rest;
}

export const ulidGenerator: IdGenerator = { neu: () => ulid() };

/** Deterministische IDs für Tests: p1, p2, … */
export function zaehlerIds(praefix = 'id'): IdGenerator {
  let n = 0;
  return { neu: () => `${praefix}${++n}` };
}
