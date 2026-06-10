import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix: string): string {
  const bytes = randomBytes(12);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

export const now = () => Date.now();
