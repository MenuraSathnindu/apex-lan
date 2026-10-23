import { describe, expect, it } from 'vitest';
import { presetLivery, type PlayerInfo, type Standing } from '@apex/shared';
import { towerRows, type TowerInfo } from './timingTower.ts';

const player = (id: number, over: Partial<PlayerInfo> = {}): PlayerInfo => ({
  id,
  name: `P${id}`,
  color: id,
  slot: id,
  connected: true,
  livery: presetLivery(id),
  tyre: 'medium',
  profileId: null,
  tag: `P0${id}`,
  photo: null,
  gridSlot: id,
  entrant: true,
  ...over,
});

const row = (id: number, pos: number, over: Partial<Standing> = {}): Standing => ({
  id,
  pos,
  laps: 1,
  nextGate: 3,
  lapStart: 0,
  lastLap: null,
  bestLap: null,
  finishTime: null,
  dnf: false,
  penaltyMs: 0,
  gap: pos === 1 ? null : (pos - 1) * 1500,
  lapsDown: 0,
  ...over,
});

const info: TowerInfo = { teamColour: () => null, car: () => null, overtake: () => false, myId: 1, laps: 5 };

describe('towerRows', () => {
  const players = [player(1), player(2), player(3)];

  it('leader shows the lap, others the gap to the leader', () => {
    const rows = towerRows([row(1, 1), row(2, 2), row(3, 3)], players, info, 'leader', false);
    expect(rows.map((r) => r.gapText)).toEqual(['LAP 2/5', '+1.500', '+3.000']);
    expect(rows[0]).toMatchObject({ id: 1, pos: 1, tag: 'P01', me: true });
  });

  it('interval mode is the gap to the car ahead', () => {
    const rows = towerRows([row(1, 1), row(2, 2, { gap: 1200 }), row(3, 3, { gap: 4000 })], players, info, 'interval', false);
    expect(rows.map((r) => r.gapText)).toEqual(['LAP 2/5', '+1.200', '+2.800']);
  });

  it('lapped shows +1 LAP, no gap yet shows nothing', () => {
    const rows = towerRows([row(1, 1), row(2, 2, { lapsDown: 1, gap: 90_000 }), row(3, 3, { gap: null })], players, info, 'leader', false);
    expect(rows.map((r) => r.gapText)).toEqual(['LAP 2/5', '+1 LAP', '']);
  });

  it('badges: PIT, penalty, FIN, OUT; tyre wear and overtake from the car state', () => {
    const rows = towerRows(
      [row(1, 1, { finishTime: 60_000, laps: 5 }), row(2, 2, { penaltyMs: 5000 }), row(3, 3)],
      [player(1), player(2, { tyre: 'soft' }), player(3, { connected: false })],
      { ...info, car: (id) => (id === 2 ? { tw: 0.4, pl: 1 } : null), overtake: (id) => id === 2 },
      'leader',
      false,
    );
    expect(rows.map((r) => r.badges)).toEqual([['FIN'], ['PIT', '+5s'], ['OUT']]);
    expect(rows[1]).toMatchObject({ tyre: 'soft', wear: 0.4, overtake: true });
    expect(rows[0]!.wear).toBeNull();
  });

  it('qualifying shows the best lap and the gap to pole', () => {
    const rows = towerRows([row(2, 1, { bestLap: 80_000 }), row(1, 2, { bestLap: 80_250 }), row(3, 3, { bestLap: null })], players, info, 'leader', true);
    expect(rows.map((r) => r.gapText)).toEqual(['1:20.000', '+0.250', 'no time']);
  });

  it('team colour wins over the livery', () => {
    const rows = towerRows([row(1, 1)], players, { ...info, teamColour: () => 0x123456 }, 'leader', false);
    expect(rows[0]!.colour).toBe(0x123456);
  });
});
