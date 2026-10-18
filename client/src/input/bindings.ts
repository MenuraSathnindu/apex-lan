/** Rebindable keyboard actions. Each has up to two keys (KeyboardEvent.code values). */
export const ACTIONS = [
  { id: 'throttle', label: 'Throttle' },
  { id: 'brake', label: 'Brake / reverse' },
  { id: 'left', label: 'Steer left' },
  { id: 'right', label: 'Steer right' },
  { id: 'handbrake', label: 'Handbrake' },
  { id: 'reset', label: 'Reset / respawn' },
  { id: 'camera', label: 'Change camera' },
] as const;

export type Action = (typeof ACTIONS)[number]['id'];
export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR'],
  camera: ['KeyC'],
};

/** Keys that can't be bound: Esc opens the menu, Tab/F-keys belong to the browser. */
export const RESERVED_KEYS = new Set(['Escape', 'Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);

export const MAX_KEYS_PER_ACTION = 2;

/** Validates bindings loaded from storage; anything odd falls back to the defaults. */
export function sanitizeBindings(raw: unknown): Bindings {
  const out = structuredClone(DEFAULT_BINDINGS);
  if (typeof raw !== 'object' || raw === null) return out;
  for (const { id } of ACTIONS) {
    const keys = (raw as Record<string, unknown>)[id];
    if (Array.isArray(keys) && keys.every((k) => typeof k === 'string' && k.length < 32 && !RESERVED_KEYS.has(k))) {
      out[id] = keys.slice(0, MAX_KEYS_PER_ACTION);
    }
  }
  return out;
}

/**
 * Binds `code` to `action` in slot `slot`, removing it from any other action first
 * (one key, one action). Returns a new object.
 */
export function bindKey(b: Bindings, action: Action, slot: number, code: string): Bindings {
  const next = structuredClone(b);
  for (const { id } of ACTIONS) next[id] = next[id].filter((k) => k !== code);
  const keys = next[action];
  if (slot < keys.length) keys[slot] = code;
  else keys.push(code);
  next[action] = keys.slice(0, MAX_KEYS_PER_ACTION);
  return next;
}

export function unbindKey(b: Bindings, action: Action, slot: number): Bindings {
  const next = structuredClone(b);
  next[action].splice(slot, 1);
  return next;
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  Enter: 'Enter',
  Backspace: 'Backspace',
};

/** "KeyW" → "W", "Digit1" → "1", "ArrowUp" → "↑", "Numpad8" → "Num 8". */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
