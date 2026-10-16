/** Collision group bits. */
export const GROUP = {
  TRACK: 1 << 0,
  CAR: 1 << 1,
  /** Client-only kinematic stand-ins for remote cars (phase 4). */
  REMOTE_PROXY: 1 << 2,
} as const;

const ALL = 0xffff;

/** Rapier interaction groups: upper 16 bits = membership, lower 16 = filter. */
export function interactionGroups(membership: number, filter: number = ALL): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const TRACK_GROUPS = interactionGroups(GROUP.TRACK);
export const CAR_GROUPS = interactionGroups(GROUP.CAR, GROUP.TRACK | GROUP.CAR | GROUP.REMOTE_PROXY);
/** Wheel ray-casts only hit the track, never other cars. */
export const WHEEL_RAY_GROUPS = interactionGroups(GROUP.CAR, GROUP.TRACK);
