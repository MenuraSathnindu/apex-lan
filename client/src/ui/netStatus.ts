export type ConnState = 'connecting' | 'connected' | 'disconnected';

export function createNetStatus(el: HTMLElement) {
  return {
    update(state: ConnState, playerCount: number, rttMs: number | null) {
      el.dataset.state = state;
      if (state !== 'connected') {
        el.textContent = state === 'connecting' ? 'connecting…' : 'disconnected — retrying…';
        return;
      }
      const players = `${playerCount} player${playerCount === 1 ? '' : 's'} online`;
      el.textContent = `connected / ${players}${rttMs === null ? '' : ` · ${rttMs.toFixed(0)} ms`}`;
    },
  };
}
