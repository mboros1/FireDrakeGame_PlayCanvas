# Fire Drake PlayCanvas development handoff

Last updated: 2026-09-23

## Read this first

This repository is the browser client for:

> A slapstick third-person fantasy sandbox like Goat Simulator, but with a fire
> drake rampaging through the world.

The target is multiplayer, client/server, browser-native.

**Read `docs/ARCHITECTURE.md` before planning any work.** It records the
client/server design and the decisions behind it. This handoff covers current
state and how to run things; the architecture doc covers where it is going and
why.

Two linked projects:

- `/Users/martinboros/SRC/void_forge-ws/forge-trunk` — **forge**, the in-house
  deterministic fixed-point engine. It is now Fire Drake's simulation substrate,
  and Fire Drake is forge's first game.
- `/Users/martinboros/SRC/FireDrakeGame_UE` — the Unreal project. **Reference
  only.** See below.

## Version control: git

This repository is tracked with **git**. It was tracked with void until
2026-09-23; that history was replayed into git with original dates and
messages, and each commit carries a `void-commit: <cid>` trailer. The old
`.void/` directory remains on disk, ignored, for reference.

Excluded from version control and present on disk only: `public/assets/` and
`assets-source/` (~155 MB), `dist/`, `test-results/`, `playwright-report/`.

The worktree contains substantial user work. Do not reset, delete, or regenerate
it as cleanup.

## Current playable prototype: the storybook

As of 2026-09-23 the game has a committed art direction: **the drake has
escaped into a pop-up storybook.** Everything except the drake is cut paper,
drawn at startup with Canvas2D (no new art assets). The drake is the only
solid thing in a paper world.

```sh
npm install
npm run dev
```

Controls: WASD prowl (camera-relative) · Shift charge · Space breathe fire ·
click for mouse look (right-drag fallback) · wheel zoom · M mute · R restart
the chapter · Esc release the mouse.

Flow:

- A book-cover title card; any key opens it.
- **Chapter the First, the Hoard** (`/`): a lava cave with cut-paper rock
  arches, coin heaps and crystals. Walk into the giant open book at the end.
- A page turn to **Chapter the Second, Little Kindling** (the scene is still
  named `forest` internally and in the debug API): a paper village holding a
  cheese festival. It has cottages, a maypole with bunting, market stalls,
  haystacks, fences, autumn woods, a pond, and paper hills, clouds and a sun
  hung on strings.
- Mayhem: breath burns dwarves and props, and fire spreads. Charging launches
  dwarves (they cartwheel, bounce and land dizzy) and folds cottages,
  haystacks, stalls and fences flat. Chains multiply the score. A wax seal
  shows the score, with tiers from "A Perfectly Pleasant Afternoon" to "The
  End of the Book".
- **Deeds**: eleven Goat-Simulator-style goals, three shown at a time. Finish
  them all, or reach 2100 mayhem, and "The End" page appears with stats.
- A narrator comments on events in a typewriter strip. Comic lettering
  (THWACK!, CRUNCH!, FWOOSH!) pops up, dwarves shout in speech bubbles, and
  burnt-out dwarves float up as small paper ghosts.
- Procedural Web Audio: breath roar, yelps, boings, paper crumples, fire
  crackle, and a Dorian music box. There are no audio files.
- `/?level=extracted` still loads the archived Unreal forest extraction.

## Architecture (as built today)

- `src/main.ts`: wiring only. It owns the app, input, camera (follow, shake,
  charge FOV kick, hit-stop), scene loading, the frame loop and
  `window.__FIRE_DRAKE_DEBUG__`.
- `src/sim/`: PlayCanvas-free and deterministic (seeded `Rng`, no
  `Math.random`).
  - `drake.ts`, `dwarf.ts`: locomotion. Dwarves flee, get launched, bounce
    and are stunned.
  - `props.ts`: burnable and flattenable scenery with fire spread.
  - `village.ts`: seeded level layout. It is sim data because the server
    needs the colliders.
  - `rampage.ts`: every multi-entity rule (breath cone, charge, collisions,
    spread, scoring and combos). It emits a `RampageEvent` queue; the view
    drains it and never diffs state.
- `src/view/`: presentation only.
  - `paper.ts`: canvas-to-texture upload, shared meshes, materials. **Burnable
    cutouts encode a bottom-up burn order in texture alpha (0.5..1); raising
    `alphaTest` eats the paper away with no custom shader.** Cached meshes
    must be `retain()`ed, or PlayCanvas frees them when a scene is torn down.
  - `art.ts`: all the drawing (dwarves, trees, cottages, hills, flames...).
  - `stage.ts`: builds both chapters and animates props (burn, char, squash,
    and fold down like a pop-up flap when blocking the camera).
  - `puppet.ts`: split-pin paper dwarves, camera-facing with a Paper-Mario
    flip.
  - `drake.ts`: model, anim graph, mouth glow.
  - `fx.ts`: pooled billboard particles plus flickering fire lights.
  - `post.ts`: CameraFrame (bloom, grading, vignette; SSAO and tilt-shift DOF
    on high quality).
  - `hud.ts`, `deeds.ts`, `audio.ts`: HUD, goals, sound.
- `src/tuning.ts`: drake scale and offsets, movement, and camera feel.

Debug API: `getState()` (now also `mayhem`, `nearestDwarf`, `model.bounds`,
`effects.burningProps` and `effects.particles`), `teleport(x, z)`,
`loadScene('cave' | 'forest' | 'forestExtract')`, `resetCamera()`.

**`window.__FIRE_DRAKE_DEBUG__` must survive every refactor.**

Quality: automated runs (`navigator.webdriver`) default to a cheap pipeline
without SSAO or DOF. Use `?quality=high` or `?quality=low` to override. It
holds 60 fps in headless Chrome on Metal with a village on fire.

## Runtime assets

`public/assets/wyvern/` holds the wyvern model and textures, plus `idle`,
`walk`, `take_off`, `flying` and `flapping` GLBs. **Idle and walk are now
wired** to an anim graph (Walk and Run share the walk clip, speed-scaled). The
exported clips drive the root bone `spine_004_04` to y ≈ −47,893, an Unreal
root-motion offset baked into the wrong space; `DrakeView` zeroes that bone's
translation after the anim system runs. The idle clip has the drake glance
back over its shoulder, and that is kept on purpose.

**Grounding:** the model offset in `tuning.ts` is measured from the bind pose,
where the wing tips hang lowest. The animated drake stands on its feet and
wing-knuckles more than a metre higher, so it used to float. `DrakeView`
now plants the lowest contact bone (feet or wing-finger knuckles, each with
a sole thickness from `DRAKE_SOLE` in `tuning.ts`) on the ground every frame
after the anim system runs.

**Procedural layer** (`src/view/rig.ts`), applied over the clips each frame:
- the neck and head aim along the heading while breathing or charging (the
  idle clip looks back over its shoulder; fire must not);
- the jaw gapes and chomps while breathing;
- the wings flare on a charge;
- a gallop bound and spine pitch while charging, and slow idle breathing;
- the tail lags on a spring through turns;
- head recoil on impacts;
- the head tracks the nearest dwarf within 14 m.

Bone-local axes are inconsistent in this rig, so the layer uses two
pose-independent operations only: bend a bone toward or away from up
relative to its child, and turn about world up. The debug API gains
`poseBone`, `boneLocal` and `setCamera` for this work.

`public/assets/forest-sector/` holds the archived extraction (20 GLBs plus
manifest).

## Publishing

- **itch.io:** `npm run publish:itch` packages the build (only the six
  runtime drake files) and pushes it with butler to
  `thedudemanguyfriend/firedrake`, channel `html5`. Butler is installed at
  `~/.local/bin/butler` (the Homebrew `butler` cask is an unrelated app) and
  is logged in. Its key only covers uploads.
- **Room server:** `fly deploy --ha=false` (see Multiplayer).

## Multiplayer

Branch `multiplayer`. Up to four drakes per room, co-op, server-authoritative.

- **Server** (`server/`): Node plus `ws`, bundled by Vite into
  `dist-server/index.js`. Each room runs the same `Rampage` simulation at a
  fixed 30 Hz, applies each player's inputs one per tick in order, and sends
  JSON snapshots at 15 Hz (~780 bytes each, ~12 KB/s per player). Rooms open
  on first join and close when empty.
- **Deployed** at `wss://firedrakegame-playcanvas.fly.dev/ws` (Fly app
  `firedrakegame-playcanvas`, one shared-cpu machine in `ord`,
  `auto_stop_machines`, so it costs nothing idle and takes a second or two
  to wake). Deploy with `fly deploy --ha=false`. `.dockerignore` keeps
  `public/` (the licensed drake) out of the build.
- **Client** (`src/net/`, `src/party.ts`): the cover has a "read it
  together" room-code form; `?room=` in the URL also joins directly
  (`?server=` overrides the server). Together, the cave is skipped. The
  local drake is predicted in fixed 30 Hz steps with the same movement and
  collision code, and reconciled using input sequence acknowledgements;
  measured corrections against Fly are 3–11 mm. Other drakes, dwarves and
  props are replicas drawn by the ordinary view code, interpolated 110 ms
  behind. Events arrive in snapshots and drive narration, sound and Deeds
  unchanged. R restarts the room for everyone.
- **Local dev:** `npm run server:dev` serves on **:8787** (8080 is taken by
  the local IPFS gateway), then open
  `/?room=test&server=ws://127.0.0.1:8787/ws` in two tabs.
- `tests/multiplayer.spec.ts` runs two browsers against a local server
  (Playwright starts it).

This is a deliberate detour from `docs/ARCHITECTURE.md`, which plans a Rust
server on forge: the TypeScript simulation runs on the server now, behind a
message contract (inputs in, snapshots out) that forge could slot in behind
later.

## Tests and browser automation

42 tests: the original browser suite, sim unit tests, and
`tests/sim-rampage.spec.ts`. The rampage tests cover breath, fire spread,
launch, landing, flattening, combos, a deterministic 12-second village replay,
and layout constraints.

```sh
npm run iterate    # both typechecks, vite build, playwright
```

Last verified 2026-09-23: 43 passed (including two-browser multiplayer).

For screenshots, the Playwright MCP server can hang if the page spams console
errors (Vite forwards them). A plain `playwright-core` script with
`--use-angle=metal` was more reliable.

## Unreal: reference only

The FBX → GLB → manifest extraction pipeline is **retired**. Do not continue it.

`docs/forest-sector-iteration-1.md` records what it produced and where it fell
short: 487 transforms with incorrect Euler conversion, absent landscape, absent
authored materials, and 16 MiB for a 30 m radius. Its "Recommended iteration 2"
list — quaternion basis conversion, cropped heightmap export, explicit PBR
material mapping, GPU instancing — is **superseded and should not be worked**.

The extracted sector remains loadable at `/?level=extracted` as a historical
artifact and a rendering-load test. It is no longer the level the game is being
built around.

Unreal remains useful as the design reference and as the source of the character
assets already exported. `docs/ARCHITECTURE.md` records the full reasoning.

## Known problems

1. **No real physics yet.** Collisions are circles in `rampage.ts`, the
   ground is flat, and launched dwarves are ballistic arcs rather than
   ragdolls. See the Rapier discussion in the conversation log. The
   architecture still says forge.
2. **Only idle and walk clips exist.** The procedural layer covers breath,
   charge, recoil and looking. A real run cycle, pounce or hurt reaction
   would still need clips; headless Blender scripts
   (`/Applications/Blender.app/Contents/MacOS/Blender -b -P ...`) are the
   route.
3. Dwarves are small at a distance (1.3 m against a 116 m field). The
   greeters near the drake's start help.
4. Google Fonts (IM Fell English) load from the network; offline falls back
   to Georgia.
5. The production JS bundle is ~1.9 MB raw before level assets.

## Next work

Per `docs/ARCHITECTURE.md`, in order:

1. **Renderer/state seam.** Split `src/main.ts` into a `WorldState` producer and
   a PlayCanvas consumer. No Rust yet. This defines the WASM ABI. Both tests
   stay green.
2. **forge physics to a playable floor** — tracked in forge's
   `docs/designs/in_progress/10_CONTACTS_AND_COLLIDERS.md`. This is the long
   pole and the accepted cost of choosing forge over Rapier.
3. **forge to wasm32** — the `WorkerPool` platform seam, per forge's
   `11_BROWSER_TARGET.md`.
4. **Server** — same crate native, authoritative, one room, WebTransport.
5. **Gameplay** — flight, ragdolls, props, multiplayer.

Step 1 is the only one that can start in this repository alone. Steps 2 and 3
are forge work.

## Suggested new-session startup

```sh
cd /Users/martinboros/SRC/FireDrakeGame_PlayCanvas
git log --oneline -3
npm run iterate
npm run dev
```

Then open `http://127.0.0.1:5173/` or navigate there with Playwright MCP.

Do not use `--dangerously-skip-permissions`.
