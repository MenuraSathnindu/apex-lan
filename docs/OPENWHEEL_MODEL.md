# Open-wheel car model (`client/public/models/openwheel.glb`)

The game runs without this file: it builds a procedural open-wheel car in code
(`client/src/render/openWheelCarModel.ts`) and logs an `[assets]` hint. Drop a GLB at
`client/public/models/openwheel.glb` to replace it. The procedural car follows the same
contract, so it's a working reference for everything below.

**Trademark rule:** the model must be original or CC0/CC-BY, must not depict a real team's
car, and must carry no real logos, sponsor decals, liveries or numbers. Paint comes from the
in-game livery system, so the bodywork should be plain. Record the author, source and licence
in `client/public/CREDITS.md` and in the table at the end of this file.

## File

| | Requirement |
|---|---|
| Format | glTF 2.0 binary (`.glb`). Draco compression is fine (the decoder ships with the game). |
| Up axis | **+Y**. |
| Forward | **+Z** (glTF's convention). Car's left = +X. If your file faces −Z, set `CAR_MODEL.yawOffset = Math.PI` in `shared/src/tuning.ts`. |
| Units | Metres, real size: about 5.5 m long, 2.0 m wide (over the tyres), 0.95 m tall. The loader **scales the model so its wheelbase matches the physics (3.4 m)** and moves it so the wheels sit where the physics wheels are, so the origin can be anywhere and small size errors are fixed for you. Keep the proportions right. |
| Size | Aim for ≤ 150k triangles and ≤ 8 MB. 8 copies are drawn in a full room, and the host laptop is an iGPU. Mark fine parts as detail (below) so far cars skip them. |
| Transforms | Apply/freeze scale and rotation on meshes (no negative scale). |

## Wheels (must spin and steer)

Four **separate nodes** with exactly these names:

| Node | Wheel |
|---|---|
| `wheel_fl` | front left (+X side) |
| `wheel_fr` | front right |
| `wheel_rl` | rear left |
| `wheel_rr` | rear right |

- Each node contains **only** that wheel: tyre + rim (+ wheel cover/nut if you like). The game
  centres each wheel on its bounding box and spins it around X, so anything else inside the
  node (brake ducts, suspension arms, uprights) would wobble.
- The axle runs along **X**; the wheel must be round about its bounding-box centre.
- Suspension arms, pushrods and brake ducts go in the **body**. Note that they stay put while the
  wheels steer and move up and down a few cm.
- A visible pattern on the rim (spokes, a logo-free wheel cover with a stripe) makes the
  spin readable.

## Wings (rear wing visibly changes angle)

| Node | What it is |
|---|---|
| `wing_rear_flap` | The **upper flap of the rear wing**, the part that opens in straight mode (X-mode). Required for the animation (a warning is logged if missing). |
| `wing_front_flap` | Optional: the front wing's top flap(s). |

- **The node origin is the hinge line**, which runs along X at the flap's leading edge. The flap
  geometry extends backwards (−Z) from it.
- Rest pose = **corner mode (closed, high downforce)**. The game turns the flap about its local
  X by `CAR_MODEL.wing.rearOpenAngle` (default +0.55 rad, trailing edge up) at full straight
  mode, and `frontOpenAngle` (default −0.3 rad) for the front flap. Keep the node's own
  rotation identity (or at least X aligned with the car's X).
- Several flap nodes? List them all in `CAR_MODEL.wingNodes`.

## Materials (matched by name, lower-case substring)

The loader replaces these materials. All other materials are kept as authored (PBR metallic-
roughness, so carbon fibre, metal and rubber look as you made them).

| Name contains | Becomes | Use it for |
|---|---|---|
| `livery` | Painted clear-coat with the **livery canvas** (primary / secondary / accent colours + race number) | All painted bodywork: nose, monocoque, sidepods, engine cover |
| `accent` | Flat paint in the livery's accent colour | Wing endplates, mirror housings, small trim |
| `visor` / `glass` | Glass (refraction on High quality) | Helmet visor, any screen |
| `rainlight` / `light_rear` / `taillight` | Red emissive, brightens when braking | Rear rain light |
| `tyre_marking` | Coloured by the **tyre compound** (soft red, medium yellow, hard white) | A ring on each tyre sidewall: a separate thin mesh or a material slot on the tyre |

You can change these names in `CAR_MODEL.materials`.

### Livery UVs

You don't need to unwrap the bodywork for the livery. By default
(`CAR_MODEL.generateLiveryUv = true`) the loader projects UVs **from above** over all `livery`
meshes: u runs along the car (tail → nose), v across it. The canvas layout (stripes,
pinstripes, number roundels on the engine cover, nose and sidepods) is in `LIVERY` in
`shared/src/tuning.ts`, in that same UV space. Tweak the rects there if a roundel lands on
a gap of your model. Vertical faces take the colour of their edge in that projection, which
reads as clean blocks of colour from the side.

If you'd rather unwrap it yourself, set `generateLiveryUv: false` and lay out UV0 in that
same top-down arrangement (or adjust `LIVERY` to your layout).

## Detail and shadows (performance)

Mesh **names** matching `CAR_MODEL.detailMeshes`
(`bolt|rivet|screw|cable|wire|detail|mirror|steering|brake_disc|disc`) cast no shadow and are
hidden on cars further than 30 m. Names matching `glass|visor|light` cast no shadow.

## Checklist

- [ ] `.glb`, Y up, +Z forward, metres
- [ ] `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`: wheel only, round about the centre, axle along X
- [ ] `wing_rear_flap` with its origin on the hinge (and optionally `wing_front_flap`)
- [ ] Bodywork material named `livery…`; endplates `accent…`; rain light `rainlight`; sidewall `tyre_marking`
- [ ] No real logos, sponsors, team liveries or numbers; licence recorded in `CREDITS.md`
- [ ] ≤ 150k triangles, small parts named for LOD

## Credits

| Model | Author | Source | Licence |
|---|---|---|---|
| (none yet, the built-in procedural car is used) | | | |
