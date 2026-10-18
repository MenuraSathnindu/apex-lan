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
    /**
     * Half-size of the chassis collision box. Full size ≈ 1.9 × 0.6 × 4.5 m
     * (matches the Ferrari 458 model's footprint).
     */
    halfExtents: { x: 0.95, y: 0.3, z: 2.25 },
    mass: 1200,
    /**
     * Centre of mass relative to the chassis box centre. Lower = harder to flip;
     * z behind the axle midpoint = mid-engine weight balance (~42/58 front/rear).
     * Note: Rapier's raycast vehicle produces almost no body roll whatever this is;
     * visible roll will be faked in the renderer later.
     */
    centerOfMass: { x: 0, y: -0.3, z: -0.3 },
    /** Moment-of-inertia scale vs. a solid box. >1 = lazier rotation, more stable. */
    inertiaScale: { x: 1.4, y: 1.0, z: 1.4 },
    linearDamping: 0,
    angularDamping: 0.4,
  },

  wheels: {
    /** Matches the car model's tyres; the model is scaled to fit the wheelbase below. */
    radius: 0.35,
    /** Wheel half-width (placeholder visuals only). */
    halfWidth: 0.13,
    /**
     * Connection points (chassis space). Order everywhere: FL, FR, RL, RR.
     * These match the Ferrari model (wheelbase 2.65 m) so its wheels sit in the arches.
     */
    halfTrack: 0.83,
    frontZ: 1.16,
    rearZ: -1.49,
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

  /**
   * Per-surface tyre behaviour, looked up from the collider each wheel is touching.
   * grip multiplies frictionSlip; drag is extra rolling resistance per wheel (N per m/s).
   */
  surfaces: {
    asphalt: { grip: 1.0, drag: 0 },
    curb: { grip: 0.92, drag: 0 },
    grass: { grip: 0.55, drag: 45 },
  },

  safety: {
    /** Auto-reset after being upside-down / on its side this long (s). */
    autoResetAfter: 3,
    /** Height above current position when resetting. */
    resetLift: 1.2,
  },
};

export type CarSpec = typeof CAR;
export type SurfaceKind = keyof CarSpec['surfaces'];

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
    offset: { x: 0, y: 0.52, z: 1.05 },
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

// ---------------------------------------------------------------------------
// Graphics (client only, but kept here so every knob lives in one file)
// ---------------------------------------------------------------------------

/**
 * Asset files, relative to client/public/. Every one is optional: if a file is missing
 * the game falls back to a procedural version and logs a hint. `npm run assets`
 * downloads them all; see docs/ASSETS.md for the manual list.
 */
export const ASSETS = {
  hdri: 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
  car: 'models/car.glb',
  asphalt: {
    map: 'textures/asphalt_02_diff_2k.jpg',
    normalMap: 'textures/asphalt_02_nor_gl_2k.jpg',
    roughnessMap: 'textures/asphalt_02_rough_2k.jpg',
    /** Metres of road covered by one texture repeat. */
    tileSize: 5,
  },
  grass: {
    map: 'textures/leafy_grass_diff_2k.jpg',
    normalMap: 'textures/leafy_grass_nor_gl_2k.jpg',
    roughnessMap: 'textures/leafy_grass_rough_2k.jpg',
    tileSize: 6,
    /** Multiplies the texture colour — Poly Haven grass is quite brown. */
    tint: 0x9fcf7a,
  },
};

export const ENVIRONMENT = {
  /** Sky/reflection brightness from the HDRI. */
  envIntensity: 1.0,
  sunIntensity: 3.2,
  sunColor: 0xfff1de,
  /**
   * Sun direction (pointing toward the sun). null = find the brightest spot in the HDRI
   * so shadows match the sky. Also used for the procedural sky when there's no HDRI.
   */
  sunDirection: null as { x: number; y: number; z: number } | null,
  fallbackSunElevationDeg: 38,
  fallbackSunAzimuthDeg: 135,
  /** Brightness of the procedural sky used when the HDRI file is missing. */
  fallbackSkyIntensity: 0.45,
  fogColor: 0xc9d6e2,
  fogDensity: 0.0016,
};

/**
 * How to fit an arbitrary car GLB to the physics car. Defaults match the Ferrari 458
 * from the three.js examples (see docs/ASSETS.md).
 */
export const CAR_MODEL = {
  /** Node names for FL, FR, RL, RR wheels (each includes tyre + rim). */
  wheelNodes: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const,
  /** Extra yaw so the model faces +Z. The Ferrari faces -Z, hence π. */
  yawOffset: Math.PI,
  /** Material names (lower-case substrings) → which replacement material to use. Checked in order. */
  materials: {
    brakeLights: ['taillight'],
    headlights: ['projector', 'headlight'],
    glass: ['glass'],
    paint: ['body_color', 'carpaint', 'paint'],
  },
  paint: { color: 0xc8102e, metalness: 1.0, roughness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.03 },
  brakeLightIdle: 0.6,
  brakeLightOn: 4.0,
  headlightIntensity: 2.0,
};

export type QualityLevel = 'low' | 'medium' | 'high';

/** Graphics presets. Auto mode starts at high and steps down if FPS is too low. */
export const QUALITY: Record<
  QualityLevel,
  {
    /** Upper bound for devicePixelRatio. */
    pixelRatio: number;
    shadows: boolean;
    shadowMapSize: number;
    /** PCF blur radius — higher = softer shadow edges. */
    shadowRadius: number;
    /** Half-size (m) of the shadow box that follows the player. */
    shadowRange: number;
    ao: boolean;
    bloom: boolean;
    /** Real refraction on car glass (expensive); otherwise simple transparency. */
    glassTransmission: boolean;
    /** Fraction of trees/props drawn. */
    sceneryDensity: number;
    anisotropy: number;
    /** Scales particle budgets (tyre smoke, sparks). */
    particles: number;
  }
> = {
  low: {
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowRadius: 1,
    shadowRange: 25,
    ao: false,
    bloom: false,
    glassTransmission: false,
    sceneryDensity: 0.3,
    anisotropy: 2,
    particles: 0.35,
  },
  medium: {
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 3,
    shadowRange: 35,
    ao: false,
    bloom: true,
    glassTransmission: false,
    sceneryDensity: 0.65,
    anisotropy: 4,
    particles: 0.7,
  },
  high: {
    pixelRatio: 2,
    shadows: true,
    // 4096 measured ~15% slower than 2048 with AO on; 2048 over ±40 m is ~4 cm/texel.
    shadowMapSize: 2048,
    shadowRadius: 4,
    shadowRange: 40,
    ao: true,
    bloom: true,
    glassTransmission: true,
    sceneryDensity: 1,
    anisotropy: 8,
    particles: 1,
  },
};

export const AUTO_QUALITY = {
  /** Ignore the first frames (shader compilation, asset upload). */
  warmupSeconds: 1.5,
  sampleSeconds: 2.5,
  /** Step down a level if average FPS is below this. */
  minFps: 50,
};

export const POST = {
  bloomIntensity: 0.35,
  bloomThreshold: 0.92,
  vignetteDarkness: 0.45,
  aoRadius: 2.0,
  aoIntensity: 2.0,
};

// ---------------------------------------------------------------------------
// Race rules
// ---------------------------------------------------------------------------

export const RACE = {
  defaultLaps: 3,
  minLaps: 1,
  maxLaps: 10,
  /** Distance between invisible checkpoint gates along the track (m). Gate 0 = start/finish. */
  checkpointSpacing: 100,
  /** After the first car finishes, everyone else has this long before results (ms). */
  finishGraceMs: 30_000,
  /** Anything faster than this between two reported positions is a teleport, not driving (m/s). */
  maxPlausibleSpeed: 110,
  /** Respawn at the last checkpoint after being stuck on grass this long (s)… */
  stuckOnGrassSeconds: 3,
  /** …meaning slower than this (m/s). */
  stuckSpeed: 6,
  /** Respawn after being upside-down / on the side this long (s). */
  flippedSeconds: 2,
  /** Show the wrong-way warning after driving backwards this long (s). */
  wrongWaySeconds: 1.2,
  /** Respawned cars are placed this far past the checkpoint gate (m). */
  respawnAhead: 3,
};

// ---------------------------------------------------------------------------
// Drivetrain (sound + HUD only — it does not change handling, which uses CAR.engine)
// ---------------------------------------------------------------------------

export const DRIVETRAIN = {
  idleRpm: 950,
  redlineRpm: 8500,
  /** Rev limiter: rpm bounces off this. */
  limiterRpm: 8700,
  /** Gear ratios 1st..6th, times finalDrive. Tuned so 6th tops out near CAR's top speed. */
  ratios: [3.2, 2.2, 1.65, 1.3, 1.07, 0.9],
  reverseRatio: 3.0,
  finalDrive: 4.9,
  /** Upshift at this rpm at full throttle; at light throttle it shifts earlier (see below). */
  upshiftRpm: 7900,
  /** Upshift rpm at zero throttle (cruising). */
  lazyUpshiftRpm: 3800,
  /** Downshift when rpm falls below this (higher while braking, for blips into corners). */
  downshiftRpm: 3200,
  brakingDownshiftRpm: 4300,
  /** Throttle cut during a shift (s). */
  shiftTime: 0.14,
  /** Clutch slip at launch: rpm can't fall below idle + throttle × this while slow. */
  launchRpm: 3600,
  /** …fading out by this speed (m/s). */
  clutchSpeed: 7,
  /** How fast rpm follows the target (1/s). */
  rpmResponse: 14,
  /** Free-revving rate in neutral (rpm/s up, down). */
  freeRevUp: 14_000,
  freeRevDown: 7000,
};

// ---------------------------------------------------------------------------
// Effects: tyre slip, skid marks, smoke, sparks, impacts (client)
// ---------------------------------------------------------------------------

export const FX = {
  /** Fake wheelspin at launch (m/s of slip at full throttle from standstill), fades out by launchSlipSpeed. */
  launchSlip: 6,
  launchSlipSpeed: 7,
  /** Locked rear wheels on the handbrake slide at this fraction of forward speed. */
  handbrakeSlipFactor: 0.6,
  /** Tyre slip (m/s) where skid marks start, and where they're fully dark. */
  skidMinSlip: 2.2,
  skidFullSlip: 7,
  /** Skid mark width (m) and darkest shade (multiplies the road colour, 0 = black). */
  skidWidth: 0.24,
  skidDarkness: 0.35,
  /** Ring buffer size; old marks get overwritten. */
  skidSegments: 4000,
  /** New segment every this many metres of travel. */
  skidStep: 0.3,
  /** Slip where tyre smoke starts; puffs per second per wheel at skidFullSlip. */
  smokeMinSlip: 3.5,
  smokeRate: 28,
  smokeLife: 2.2,
  smokeStartSize: 0.7,
  smokeEndSize: 4.2,
  smokeOpacity: 0.32,
  /** Linear-space grey (pre tone mapping). */
  smokeBrightness: 0.85,
  /** Max particles at quality 1 (scaled by QUALITY.particles). */
  smokeMax: 700,
  sparksMax: 500,
  /** Sparks per second while scraping a wall at 20 m/s (scales with speed). */
  sparkRate: 260,
  sparkLife: 0.45,
  /** HDR colour so bloom picks them up. */
  sparkColor: { r: 6, g: 3.2, b: 1.0 },
  /** Minimum sideways speed along a wall (m/s) to throw sparks / scrape. */
  scrapeMinSpeed: 2.5,
  /** Impact strength = Δv (m/s) the collision applied in one tick. Below this: no thud. */
  impactMinDv: 0.8,
  /** Δv for a full-volume thud. */
  impactFullDv: 8,
  /** Burst of sparks per m/s of Δv on a wall hit. */
  impactSparks: 14,
};

// ---------------------------------------------------------------------------
// Audio (client). Every sound file is optional — procedural placeholders are used otherwise.
// ---------------------------------------------------------------------------

export const AUDIO = {
  /** Optional recordings in client/public/sounds/. */
  files: {
    /** Engine loop recorded at engineFileRpm (on load). */
    engine: 'sounds/engine.ogg',
    engineFileRpm: 3000,
    skid: 'sounds/skid.ogg',
    impact: 'sounds/impact.ogg',
    scrape: 'sounds/scrape.ogg',
  },
  /** Default volumes 0..1 (players change them in the menu). */
  defaults: { master: 0.8, engine: 0.8, effects: 0.8, ui: 0.6 },
  engine: {
    /** Gain at idle with no throttle → at redline with full throttle. */
    minGain: 0.28,
    maxGain: 0.9,
    /** Low-pass cutoff (Hz): closed throttle → open throttle, plus per-rpm brightening. */
    cutoffClosed: 900,
    cutoffOpen: 3800,
    cutoffPerRpm: 0.35,
  },
  skid: { maxGain: 0.55, minRate: 0.85, maxRate: 1.2 },
  scrape: { maxGain: 0.6 },
  wind: { gainAt60ms: 0.25 },
  impact: { maxGain: 1.0 },
  /** Remote cars: positional (PannerNode) and a bit quieter. */
  remote: { gain: 0.7, refDistance: 7, rolloff: 1.4, maxDistance: 400 },
  /** Seconds for volume/pitch changes to settle (avoids zipper noise). */
  smoothing: 0.04,
};

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export const HUD = {
  /** Tachometer scale (rpm) and where the red zone starts. */
  tachoMaxRpm: 9000,
  /** Minimap size (CSS px) and redraw rate (Hz). */
  minimapSize: 190,
  minimapHz: 30,
};
