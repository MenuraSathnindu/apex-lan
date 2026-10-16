/** Keys whose default browser action (scrolling) we suppress. */
const CAPTURED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export interface Keyboard {
  isDown(code: string): boolean;
  /** True once per physical key press (ignores auto-repeat), then cleared. */
  consumePress(code: string): boolean;
}

export function createKeyboard(target: Window = window): Keyboard {
  const down = new Set<string>();
  const pressed = new Set<string>();

  target.addEventListener('keydown', (e) => {
    if (CAPTURED.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  // Releasing keys while the window is unfocused would otherwise leave them stuck down.
  target.addEventListener('blur', () => {
    down.clear();
    pressed.clear();
  });

  return {
    isDown: (code) => down.has(code),
    consumePress: (code) => pressed.delete(code),
  };
}
