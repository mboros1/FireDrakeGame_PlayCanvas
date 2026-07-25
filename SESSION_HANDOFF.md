# Fire Drake PlayCanvas development handoff

Last updated: 2026-07-25

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

## Version control: void, not git

This repository is tracked with **void**, not git. A `.git` directory exists but
has zero commits and is not used.

```sh
void status --short
void log -n 5
void add <paths> && void commit -m "…"
```

Ignore rules live in **`.ignore`**, not `.gitignore` — void disables git ignore
sources entirely and uses the ripgrep/fd convention. `node_modules/`, `.git/`,
and `.DS_Store` are excluded by void itself.

Excluded from version control and present on disk only: `public/assets/` and
`assets-source/` (~155 MB), `dist/`, `test-results/`, `playwright-report/`.

The worktree contains substantial user work. Do not reset, delete, or regenerate
it as cleanup.

## Current playable prototype

```sh
npm install
npm run dev
```

Controls:

- WASD or arrow keys: camera-relative movement
- Shift: charge
- Click: pointer-lock mouse look
- Right-drag: mouse-look fallback
- Mouse wheel: zoom
- Space: fire breath
- Escape: release pointer lock

Scenes:

- `/` starts in the procedural lava cave.
- Reaching the cave gate transitions through a loading overlay to the
  procedural forest.
- `/?level=extracted` loads the archived Unreal forest extraction.

The loop includes the exported Fire Drake model and textures, third-person
follow camera and mouse look, fire-breath particles with cone hit testing,
forest-only dwarf spawning and wandering, run-plus-flail burning behavior,
attached fire effects, five-second burn/despawn, and hot module reload that
preserves scene and player transform.

## Architecture (as built today)

- `src/main.ts` — PlayCanvas application, scene construction, drake controller,
  camera, fire, dwarves, loading transition, extracted-sector loader, and the
  `window.__FIRE_DRAKE_DEBUG__` automation surface.
- `src/tuning.ts` — drake scale/orientation/offset, movement and camera feel.
- `src/style.css` — canvas, HUD, loading presentation.

Debug API: `getState()`, `teleport(x, z)`,
`loadScene('cave' | 'forest' | 'forestExtract')`, `resetCamera()`.

**`window.__FIRE_DRAKE_DEBUG__` must survive every refactor.** The Playwright
suite and the MCP workflow depend on it, and it is the mechanism for verifying
the forge port against current behavior.

`src/main.ts` is a 671-line monolith mixing rendering, input, gameplay, scene
construction, and asset loading. Splitting it is phase 1 of the architecture doc.

## Runtime assets

`public/assets/wyvern/` — `wyvern.glb`, base-color/normal/emissive textures, and
exported `idle`, `walk`, `take_off`, `flying`, `flapping` GLBs. The model is
connected; the animation clips are **not** yet wired to a PlayCanvas animation
state graph, so the drake renders in bind pose.

`public/assets/forest-sector/` — 20 sanitized GLBs plus `forest-sector.json`.

`assets-source/` — FBX/source artifacts retained for reproducibility.

## Tests and browser automation

- `tests/gameplay.spec.ts` — model readiness and facing alignment, mouse look,
  camera-relative movement, wheel zoom, fire breath, procedural forest and dwarf
  spawning, console/page-error gate.
- `tests/extracted-sector.spec.ts` — extracted object count, source-level
  identity, load-failure and console-error gate, visual screenshot.
- `.mcp.json` — headless isolated Playwright MCP at 1440×900.

```sh
npm run iterate    # tsc --noEmit && vite build && playwright test
```

Last verified 2026-07-25: build passed, 2 Playwright tests passed, 8.2 s total.

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

Still true and still relevant:

1. **No physics.** Movement is `translate` plus `clamp(-54, 54)`, ground is a
   hardcoded `y = 0.1`, and hits are distance-and-dot tests. Real collision
   arrives with forge.
2. **The drake is enormous** — roughly a 30 m wingspan against a 60 m sector,
   with the camera effectively inside it. One meter-based scale convention needs
   settling, then `src/tuning.ts` and camera framing re-tuned.
3. **The drake is in bind pose.** Animation clips are exported but unconnected.
4. **No terrain grounding, camera collision, or production physics.**
5. **`package.json` repeats the Playwright dependency keys.** Normalize during a
   dedicated dependency pass, not incidentally.
6. Production JS bundle is ~1.9 MB raw / 488 KiB gzipped before level assets.

Historical, tied to the retired pipeline — recorded so the screenshots make
sense, not as a work list: sideways and floating foliage, absent landscape,
category-tint placeholder materials, and one entity per foliage instance.

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
void log -n 3
npm run iterate
npm run dev
```

Then open `http://127.0.0.1:5173/` or navigate there with Playwright MCP.

Do not use `--dangerously-skip-permissions`.
