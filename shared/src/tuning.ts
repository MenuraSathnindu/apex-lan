/**
 * ALL gameplay tuning lives here — car handling, camera, input feel.
 * Units: metres, seconds, kilograms, newtons, radians (unless noted).
 * Car local axes: +Z forward, +Y up, +X left (so right = -X).
 *
 * After changing car values, run `npm run handling` to see the effect in numbers
 * (0–100, braking distance, cornering g, drift angle, rollover checks).
 *
 * Quick handling guide:
 *  - More grip / less sliding        → raise wheels.frictionSlip
 *  - Bigger handbrake drifts          → lower handbrake.rearSideFrictionStiffness / rearFrictionSlip
 *  - Slides too hard to catch         → raise assist.yawStability (0 = raw physics)
 *  - Flips over too easily            → lower chassis.centerOfMass.y, raise aero.downforce
 *  - Bouncy / floaty                  → raise wheels.suspensionRelaxation (rebound damping)
 *  - Harsh over bumps                 → lower wheels.suspensionStiffness / suspensionCompression
 *  - Twitchy steering at speed        → lower steering.highSpeedAngle
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const CAR = {
  chassis: {
    /** Half-size of the chassis collision box. Full size ≈ 1.8 × 0.6 × 4.3 m. */
    halfExtents: { x: 0.9, y: 0.3, z: 2.15 },
    mass: 1200,
    /**
     * Centre of mass relative to the chassis box centre. Lower = harder to flip.
     * Note: Rapier's raycast vehicle produces almost no body roll whatever this is;
     * visible roll will be faked in the renderer (phase 6).
     */
    centerOfMass: { x: 0, y: -0.3, z: 0.1 },
    /** Moment-of-inertia scale vs. a solid box. >1 = lazier rotation, more stable. */
    inertiaScale: { x: 1.4, y: 1.0, z: 1.4 },
    linearDamping: 0,
    angularDamping: 0.4,
  },

  wheels: {
    radius: 0.34,
    /** Wheel half-width (visual only). */
    halfWidth: 0.13,
    /** Connection points (chassis space). Order everywhere: FL, FR, RL, RR. */
    halfTrack: 0.78,
    frontZ: 1.32,
    rearZ: -1.28,
    connectionY: -0.1,
    suspensionRestLength: 0.32,
    maxSuspensionTravel: 0.2,
    /** Per unit of chassis mass (Rapier/Bullet convention): sag ≈ 9.81 / (4·k) m. */
    suspensionStiffness: 32,
    /** Bump damping. */
    suspensionCompression: 2.6,
    /** Rebound damping. Raise if the car bounces after landing. */
    suspensionRelaxation: 3.8,
    maxSuspensionForce: 100_000,
    /**
     * Tyre grip limit (combined longitudinal + lateral). Behaves roughly like the
     * friction coefficient μ: 1.5 ≈ 1.3–1.5 g of cornering. Road tyres ≈ 1.0.
     */
    frictionSlip: { front: 1.5, rear: 1.4 },
    /** Lateral grip multiplier. */
    sideFrictionStiffness: { front: 1.0, rear: 1.0 },
  },

  engine: {
    /** Peak drive force at low speed, split across driven wheels. */
    maxForce: 8000,
    /** Engine power in watts: force falls off as power / speed. ~180 kW ≈ 240 hp. */
    power: 180_000,
    /** Which wheels are driven. */
    drive: 'rear' as 'rear' | 'front' | 'all',
    reverseForce: 4000,
    reverseMaxSpeed: 9,
    /** Below this forward speed (m/s), holding brake engages reverse instead. */
    reverseEngageSpeed: 0.8,
  },

  brakes: {
    /** Brake impulse per wheel per tick at full pedal. */
    strength: 46,
    /** Share of braking on the front axle (0..1). */
    frontBias: 0.62,
    /** Small brake applied with no pedal input, so the car coasts down. */
    engineBraking: 1.2,
  },

  handbrake: {
    /** Rear-wheel brake impulse while the handbrake is held. */
    rearBrake: 8,
    /** Rear lateral grip multiplier while held — this is what lets the tail slide. */
    rearSideFrictionStiffness: 0.4,
    /** Rear grip limit while held. */
    rearFrictionSlip: 0.8,
    /** Seconds for rear grip to come back after releasing (smooth exit from drifts). */
    gripRecoveryTime: 0.35,
  },

  steering: {
    /** Max front-wheel angle when slow. */
    maxAngle: 0.6,
    /** Max front-wheel angle at highSpeedRef and above. */
    highSpeedAngle: 0.14,
    highSpeedRef: 45,
    /** How fast the wheels turn toward the target / back to centre (rad/s). */
    turnRate: 3.2,
    returnRate: 5.5,
  },

  /**
   * Stability assist (ESC-like). While the handbrake is NOT held, removes yaw beyond what
   * the front wheels ask for, so slides are catchable. 0 = raw physics.
   */
  assist: {
    /** Correction rate (1/s). Roughly 1/value = seconds to settle a slide. */
    yawStability: 2.0,
    /** Assist fades in above this speed (m/s) so low-speed manoeuvres stay untouched. */
    minSpeed: 4,
  },

  aero: {
    /** Drag force = drag · v². With power 180 kW, top speed ≈ (power/drag)^(1/3). */
    drag: 0.48,
    /** Rolling resistance force = rolling · v. */
    rolling: 14,
    /** Downforce = downforce · v² (applied at centre of mass). */
    downforce: 1.6,
  },

  safety: {
    /** Auto-reset after being upside-down / on its side this long (s). */
    autoResetAfter: 3,
    /** Height above current position when resetting. */
    resetLift: 1.2,
  },
};

export type CarSpec = typeof CAR;

export const CAMERA = {
  chase: {
    distance: 6.2,
    height: 2.1,
    /** Point the camera aims at: above the car origin, and this far ahead of it. */
    lookHeight: 1.0,
    lookAhead: 3.0,
    /** Follow stiffness (1/s). Higher = tighter, lower = more lag. */
    positionLag: 7,
    /** How quickly the camera swings round behind the car (1/s). */
    yawLag: 5,
    baseFov: 60,
    maxFov: 76,
    /** Speed (m/s) at which FOV reaches maxFov. */
    fovSpeedRef: 55,
    fovLag: 3,
    /** Snap instead of smoothing if the car jumps further than this (reset/teleport). */
    snapDistance: 15,
  },
  hood: {
    /** Camera position in chassis space. */
    offset: { x: 0, y: 0.68, z: 0.95 },
    fov: 72,
    /** Rotation smoothing (1/s) — removes suspension jitter without feeling laggy. */
    rotationLag: 25,
  },
};

export const INPUT = {
  gamepadDeadzone: 0.12,
  /** Gamepad steering response curve exponent (1 = linear, >1 = finer near centre). */
  gamepadSteerExponent: 1.5,
  triggerDeadzone: 0.05,
};
