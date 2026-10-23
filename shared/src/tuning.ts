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
     * Half-size of the chassis collision box. Full size ≈ 2.0 × 0.5 × 5.2 m: the width includes
     * the exposed wheels, so cars cannot interpenetrate wheel-to-wheel.
     */
    halfExtents: { x: 1.0, y: 0.25, z: 2.6 },
    /** Minimum mass with driver (kg). */
    mass: 800,
    /**
     * Centre of mass relative to the chassis box centre. Very low = hard to flip; z behind the
     * midpoint of the axles gives ~46/54 front/rear weight distribution.
     */
    centerOfMass: { x: 0, y: -0.1, z: -0.3 },
    /** Moment-of-inertia scale vs. a solid box. <1 = light and twitchy, >1 = lazy. */
    inertiaScale: { x: 1.2, y: 0.8, z: 1.2 },
    linearDamping: 0,
    angularDamping: 0.3,
  },

  wheels: {
    /** Tyre radius (m). The model's wheels are scaled to match. */
    radius: 0.36,
    /** Wheel half-width (placeholder visuals only). */
    halfWidth: 0.19,
    /** Connection points (chassis space). Order everywhere: FL, FR, RL, RR. Wheelbase 3.4 m. */
    halfTrack: 0.8,
    frontZ: 1.55,
    rearZ: -1.85,
    /** Above the box centre: open-wheel cars sit with the axles higher than the floor. */
    connectionY: 0.21,
    suspensionRestLength: 0.2,
    maxSuspensionTravel: 0.12,
    /** Per unit of chassis mass (Rapier/Bullet convention): sag ≈ 9.81 / (4·k) m. Stiff: aero loads are high. */
    suspensionStiffness: 120,
    /** Bump damping (~0.25 of critical). */
    suspensionCompression: 5.5,
    /** Rebound damping (~0.4 of critical). */
    suspensionRelaxation: 8.8,
    maxSuspensionForce: 100_000,
    /**
     * Tyre grip limit (combined longitudinal + lateral), × the compound's grip (see TYRES).
     * Behaves like μ against the wheel load, which includes downforce, so grip grows with speed².
     */
    frictionSlip: { front: 1.4, rear: 1.45 },
    /** Lateral grip multiplier. */
    sideFrictionStiffness: { front: 1.0, rear: 1.0 },
  },

  engine: {
    /** Peak drive force at low speed, split across driven wheels (traction-limited well below this). */
    maxForce: 8800,
    /** Combustion engine power in watts. ERS deployment adds to this (see ERS). */
    power: 520_000,
    /** Which wheels are driven. */
    drive: 'rear' as 'rear' | 'front' | 'all',
    reverseForce: 3000,
    reverseMaxSpeed: 8,
    /** Below this forward speed (m/s), holding brake engages reverse instead. */
    reverseEngageSpeed: 0.8,
  },

  brakes: {
    /** Brake impulse per wheel per tick at full pedal. Grip-limited, so this only needs to be high. */
    strength: 90,
    /** Share of braking on the front axle (0..1). */
    frontBias: 0.58,
    /** Small brake applied with no pedal input, so the car coasts down. */
    engineBraking: 1.0,
  },

  handbrake: {
    /** Rear-wheel brake impulse while the handbrake is held. */
    rearBrake: 10,
    /** Rear lateral grip multiplier while held — this is what lets the tail slide. */
    rearSideFrictionStiffness: 0.4,
    /** Rear grip limit while held. */
    rearFrictionSlip: 0.9,
    /** Seconds for rear grip to come back after releasing (smooth exit from drifts). */
    gripRecoveryTime: 0.35,
  },

  steering: {
    /** Max front-wheel angle when slow: quick, twitchy turn-in. */
    maxAngle: 0.5,
    /** Max front-wheel angle at highSpeedRef and above. */
    highSpeedAngle: 0.05,
    highSpeedRef: 75,
    /** How fast the wheels turn toward the target / back to centre (rad/s). */
    turnRate: 4.5,
    returnRate: 7,
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

  /**
   * Aerodynamics. Both force terms scale with speed²; the wing mode picks the coefficients.
   * Downforce adds to the wheel load, so grip rises with speed² too (fast corners grip most).
   * Top speed ≈ (power / drag)^(1/3): ~250 km/h in corner mode, ~300 km/h in straight mode on
   * the combustion engine alone, ~330 km/h with ERS deployed.
   */
  aero: {
    /** Rolling resistance force = rolling · v. */
    rolling: 8,
    modes: {
      /** "Z-mode": wings closed — high downforce, high drag. */
      corner: { drag: 1.45, downforce: 4.3 },
      /** "X-mode": wings open — low drag, ~40 % of the downforce. */
      straight: { drag: 0.85, downforce: 1.7 },
    },
    /** Seconds for the wings to open (straight) and to snap shut (corner). */
    openTime: 0.35,
    closeTime: 0.12,
    /** Wings only open above this speed (m/s). */
    minOpenSpeed: 25,
    /** Brake pedal above this, or steering beyond it (|steer|), snaps the wings shut. */
    brakeClose: 0.05,
    steerClose: 0.3,
  },

  /**
   * Energy recovery system: a battery that harvests under braking and lift-off and deploys as
   * extra engine power while the boost key is held. Energy in joules, power in watts.
   */
  ers: {
    capacity: 4_000_000,
    /** Battery level at the start of a race (fraction of capacity). */
    startCharge: 0.6,
    /** Extra engine power while deploying at full throttle. */
    deployPower: 300_000,
    /** Extra low-speed drive force at full deployment (N): the ERS motor also helps launch. */
    deployLowSpeedForce: 2500,
    /** Deployment fades out between these speeds (m/s) — the motor runs out of range. */
    taperFromSpeed: 88,
    taperToSpeed: 100,
    /** Harvest power at full brake pedal (scaled down below brakeFullSpeed), and when lifting off. */
    harvestBrakePower: 300_000,
    brakeFullSpeed: 35,
    harvestLiftPower: 60_000,
    /** No harvesting below this speed (m/s). */
    harvestMinSpeed: 12,
    /** Fraction of the harvested energy that reaches the battery. */
    harvestEfficiency: 0.9,
    /** Energy that may be deployed per lap (J). Less than the capacity: you have to manage it. */
    lapDeployLimit: 2_800_000,
    /** Overtake mode (granted by the server at the detection point, lasts one lap). */
    overtake: {
      /** Extra deploy power on top of deployPower, and extra energy allowed that lap. */
      extraPower: 150_000,
      extraLapEnergy: 1_200_000,
    },
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
  car: 'models/openwheel.glb',
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
 * How to fit the open-wheel car GLB (client/public/models/openwheel.glb) to the physics car.
 * The file contract is documented in docs/OPENWHEEL_MODEL.md.
 */
export const CAR_MODEL = {
  /** Node names for FL, FR, RL, RR wheels (each includes tyre + rim, nothing else). */
  wheelNodes: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const,
  /** Extra yaw so the model faces +Z. glTF's own forward is +Z, so 0. */
  yawOffset: 0,
  /**
   * Movable wing flaps. The node origin is the hinge line (along X) and the flap extends
   * backwards (-Z); the flap turns about its local X by `wing.*Angle × blend` from its rest pose.
   */
  wingNodes: { rear: ['wing_rear_flap'], front: ['wing_front_flap'] } as { rear: string[]; front: string[] },
  /** Rotation (rad, + = trailing edge up) added at full straight mode. */
  wing: { rearOpenAngle: 0.55, frontOpenAngle: -0.3 },
  /** Material names (lower-case substrings) → which replacement material to use. Checked in order. */
  materials: {
    brakeLights: ['rainlight', 'light_rear', 'taillight'],
    glass: ['visor', 'glass'],
    /** Painted bodywork: gets the livery canvas texture. */
    livery: ['livery'],
    /** Parts that take the accent colour (endplates, helmet…). */
    accent: ['accent'],
    /** Sidewall marking: shows the tyre compound colour. */
    tyreMarking: ['tyre_marking', 'tyremark'],
  },
  /** Give the livery meshes top-down UVs (keeps the model's own UVs if false). */
  generateLiveryUv: true,
  /**
   * Small / hidden parts (mesh names, regex). They never cast shadows, and remote cars
   * further than detailDistance hide them.
   */
  detailMeshes: /bolt|rivet|screw|cable|wire|detail|mirror|steering|brake_disc|disc/i,
  /** Parts that stay visible but don't cast shadows (see-through or tiny). */
  noShadowMeshes: /glass|visor|light/i,
  detailDistance: 30,
  brakeLightIdle: 0.6,
  brakeLightOn: 4.0,
};

/**
 * Livery canvas layout. The body's UVs are a top-down projection of the car: u runs along the
 * car (0 = tail, 1 = nose), v across it (1 = left, 0 = right). Rects are in that UV space, so
 * they work for any model — the GLB loader generates the projection itself when needed.
 * Colours: primary = base, secondary = stripes/roundels, accent = pinstripes and the number.
 */
export const LIVERY = {
  texture: { width: 1024, height: 512 },
  numberMax: 99,
  /** Stripes painted in the secondary colour. u0..u1 along the car, v0..v1 across. */
  stripes: [
    { u0: 0.3, u1: 1.0, v0: 0.44, v1: 0.56 },
    { u0: 0.56, u1: 0.66, v0: 0.0, v1: 1.0 },
  ],
  /** Thin lines in the accent colour. */
  pinstripes: [
    { u0: 0.3, u1: 1.0, v0: 0.39, v1: 0.42 },
    { u0: 0.3, u1: 1.0, v0: 0.58, v1: 0.61 },
    { u0: 0.68, u1: 0.7, v0: 0.0, v1: 1.0 },
  ],
  /** Number roundels: centre (u, v) and diameter as a fraction of the texture height. */
  numbers: [
    { u: 0.34, v: 0.5, size: 0.3 },
    { u: 0.9, v: 0.5, size: 0.14 },
    { u: 0.42, v: 0.26, size: 0.15 },
    { u: 0.42, v: 0.74, size: 0.15 },
  ],
  /** Material finish of the painted body. */
  finish: { metalness: 0.15, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.04 },
  /** Carbon-fibre trim (wings, floor, halo). */
  carbon: 0x14151a,
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
    /**
     * Anti-aliasing. SMAA looks best but is 3 extra full-screen passes (~2.5 ms on an Intel
     * UHD iGPU at 1600×900); FXAA is a single cheap pass.
     */
    antialias: 'smaa' | 'fxaa';
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
    antialias: 'fxaa',
  },
  medium: {
    // Profiled on an Intel UHD iGPU at 1920×1080 with 8 cars: 2048 shadows cost ~3 ms more
    // than 1024 (±30 m → ~6 cm/texel, softened by radius 2), and pixelRatio > 1 is pure fill cost.
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 1024,
    shadowRadius: 2,
    shadowRange: 30,
    ao: false,
    bloom: true,
    glassTransmission: false,
    sceneryDensity: 0.65,
    anisotropy: 4,
    particles: 0.7,
    antialias: 'fxaa',
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
    antialias: 'smaa',
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
  /** Overtake mode unlocks if the car ahead crossed the detection point within this many seconds. */
  overtakeMaxGap: 1.0,
};

// ---------------------------------------------------------------------------
// Drivetrain (sound + HUD only — it does not change handling, which uses CAR.engine)
// ---------------------------------------------------------------------------

export const DRIVETRAIN = {
  idleRpm: 4200,
  redlineRpm: 12_000,
  /** Rev limiter: rpm bounces off this. */
  limiterRpm: 12_300,
  /** Gear ratios 1st..8th (geometric steps), times finalDrive. 8th reaches ~340 km/h at the redline. */
  ratios: [5.0, 4.08, 3.33, 2.72, 2.22, 1.81, 1.48, 1.21],
  reverseRatio: 4.5,
  finalDrive: 4.0,
  /** Upshift at this rpm at full throttle; at light throttle it shifts earlier (see below). */
  upshiftRpm: 11_500,
  /** Upshift rpm at zero throttle (cruising). */
  lazyUpshiftRpm: 7000,
  /** Downshift when rpm falls below this (higher while braking, for blips into corners). */
  downshiftRpm: 6800,
  brakingDownshiftRpm: 8800,
  /** Throttle cut during a shift (s). */
  shiftTime: 0.05,
  /** Clutch slip at launch: rpm can't fall below idle + throttle × this while slow. */
  launchRpm: 6000,
  /** …fading out by this speed (m/s). */
  clutchSpeed: 12,
  /** How fast rpm follows the target (1/s). */
  rpmResponse: 22,
  /** Free-revving rate in neutral (rpm/s up, down). */
  freeRevUp: 40_000,
  freeRevDown: 18_000,
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
  smokeRate: 22,
  smokeLife: 2.2,
  smokeStartSize: 0.7,
  smokeEndSize: 3.4,
  smokeOpacity: 0.36,
  /** Linear-space grey (pre tone mapping). */
  smokeBrightness: 0.85,
  /** Max particles at quality 1 (scaled by QUALITY.particles). */
  smokeMax: 700,
  sparksMax: 500,
  /** Sparks per second while scraping a wall at 20 m/s (scales with speed). */
  sparkRate: 260,
  sparkLife: 0.45,
  /** HDR colour so bloom picks them up. */
  sparkColor: { r: 9, g: 4.6, b: 1.4 },
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
  tachoMaxRpm: 13_000,
  /** Minimap size (CSS px) and redraw rate (Hz). */
  minimapSize: 190,
  minimapHz: 30,
};
