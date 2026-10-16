import type { C2S, S2C } from './messages.ts';

// JSON for now; swapped for a binary layout in phase 8 without changing this API.

export function encode(msg: C2S | S2C): string {
  return JSON.stringify(msg);
}

function decode(text: string): unknown {
  const msg: unknown = JSON.parse(text);
  if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string') {
    throw new Error('malformed message');
  }
  return msg;
}

export function decodeC2S(text: string): C2S {
  return decode(text) as C2S;
}

export function decodeS2C(text: string): S2C {
  return decode(text) as S2C;
}
