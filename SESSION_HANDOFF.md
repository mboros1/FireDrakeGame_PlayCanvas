# Fire Drake PlayCanvas development handoff

Last updated: 2026-07-24

## Read this first

This repository is the code-first browser prototype for:

> A slapstick third-person fantasy sandbox like Goat Simulator, but with a fire
> drake rampaging through the world.

The Unreal Engine 5.6 source project is:

`/Users/martinboros/SRC/FireDrakeGame_UE`

The PlayCanvas worktree is currently almost entirely uncommitted. Do not reset,
delete, regenerate, or replace it as cleanup. It contains exported source assets,
converted runtime assets, tests, screenshots, and the first forest-sector
migration.

## Current playable prototype

Run:

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
- `/?level=extracted` directly loads the first Unreal forest extraction.

The cave/forest gameplay loop includes:

- the actual exported Fire Drake skeletal model and textures;
- third-person follow camera and mouse look;
- fire-breath particles and cone hit testing;
- forest-only dwarf spawning and wandering;
- run plus upper-body flailing behavior while burning;
- attached dwarf fire effects;
- five-second burn/despawn;
- hot module reload with scene/player transform preservation.

## Architecture

### Runtime

- `src/main.ts`
  - PlayCanvas application and scene construction.
  - Drake controller, camera, fire, dwarves, loading transition.
  - Extracted-sector manifest loader.
  - `window.__FIRE_DRAKE_DEBUG__` automation surface.
- `src/tuning.ts`
  - Drake scale/orientation/offset.
  - Movement and camera feel.
- `src/style.css`
  - Canvas/HUD/loading presentation.

The debug API exposes:

- `getState()`
- `teleport(x, z)`
- `loadScene('cave' | 'forest' | 'forestExtract')`
- `resetCamera()`

### Runtime assets

`public/assets/wyvern/` contains:

- `wyvern.glb`
- base-color, normal, and emissive textures
- exported `idle`, `walk`, `take_off`, `flying`, and `flapping` GLBs

The real wyvern model is connected, but the animation GLBs are not yet connected
to a PlayCanvas animation state graph. The visible drake remains in its bind
pose.

`public/assets/forest-sector/` contains:

- 20 sanitized GLBs
- `forest-sector.json`

`assets-source/` retains FBX/source artifacts from Unreal for reproducibility.

### Tests and browser automation

- `tests/gameplay.spec.ts`
  - model readiness and facing alignment;
  - mouse look;
  - camera-relative movement;
  - wheel zoom;
  - fire breath;
  - procedural forest and dwarf spawning;
  - console/page-error gate.
- `tests/extracted-sector.spec.ts`
  - exact extracted object count;
  - source-level identity;
  - load failure and console-error gate;
  - visual screenshot.
- `.mcp.json`
  - headless isolated Playwright MCP at 1440×900.

Run the full loop:

```sh
npm run iterate
```

Latest successful result:

- TypeScript and Vite build passed.
- 2 Playwright tests passed.
- Complete build and browser suite: 8.3 seconds locally.
- Extracted-sector browser load: about 3 seconds locally.

The last direct MCP control pass loaded 487 extracted objects, moved the drake
5.75 m, changed yaw/pitch, zoomed by 2 units, emitted 3 fire particles, and
reported zero browser errors.

Screenshots:

- `test-results/visual/04-extracted-forest-sector.png`
- `test-results/visual/forest-sector-iteration-1-mcp.png`

Detailed extraction findings:

- `docs/forest-sector-iteration-1.md`

## Unreal forest extraction: iteration 1

Source level:

`/Game/sA_StylizedForest_Environment/Demo/Levels/Lvl_Color_Alternative`

The Unreal exporter selected a 30 m radius around Player Start:

- 20 unique static meshes;
- 487 transforms;
- 30 placed actors;
- 457 foliage instances;
- 37,590 nearby grass instances measured and excluded;
- no FBX export failures.

Pipeline:

1. Run `Scripts/export_forest_sector.py` inside the Unreal editor through MCP.
2. Convert the emitted FBXs to GLB with Assimp.
3. Copy GLBs and the manifest into `public/assets/forest-sector/`.
4. Run `npm run sanitize:forest`.
5. Run `npm run iterate`.

Why sanitation exists:

Eleven Assimp-converted GLBs retained stale absolute texture paths from the
marketplace asset author's computer, such as `/Users/anilk/Desktop/...`.
PlayCanvas rejected those containers. `scripts/sanitize-gltf.mjs` strips the
unusable texture bindings. The runtime then uses category-colored placeholder
materials.

Assimp also preserves centimeter-sized vertices and exports `UCX_*` collision
meshes. The importer currently scales instances by `0.01` and disables collision
nodes by name.

## Known visual and technical problems

These are expected in the current screenshot:

1. Many foliage meshes are sideways or floating.
   - Euler transform conversion is only reliable for yaw-only actors.
   - Replace it with a tested quaternion basis conversion.
2. The Unreal Landscape is absent.
   - The extraction uses a flat 60 m ground box.
   - Export a cropped heightmap/weightmap and ground instances against it.
3. Authored materials are absent.
   - Unreal material graphs do not translate to GLB.
   - Category tints lose bark/leaves, alpha cutouts, normals, and PBR detail.
4. The drake is enormous relative to the extracted sector.
   - Reconcile one meter-based scale convention after terrain import.
   - Re-tune `src/tuning.ts` and camera framing.
5. The drake is in a bind pose.
   - Connect the exported animation clips.
6. No terrain grounding, camera collision, or production physics exists.
7. The importer creates one entity per foliage transform.
   - The full forest requires GPU instancing, batching, LODs, culling, and a
     density policy, especially for grass.
8. The production JavaScript bundle is about 488 KiB compressed before level
   assets, and the extracted sector is about 16.1 MiB.
9. `package.json` currently repeats the Playwright dependency keys; normalize
   this during a dedicated dependency cleanup, not incidentally.

## Recommended next iteration

Keep the same 30 m extracted sector and work in this order:

1. Implement and unit-test quaternion basis conversion.
2. Export/import a cropped Unreal Landscape heightmap.
3. Ground the drake and foliage against the terrain.
4. Export the small referenced texture set and map explicit PBR materials.
5. Instance repeated mushrooms, stones, flowers, and trees.
6. Re-tune drake scale/camera.
7. Connect idle/walk animation only after world scale and grounding are stable.

The narrow sector should remain the test fixture until placement and terrain are
visually coherent. Do not expand to the whole forest yet.

## Suggested new-session startup

```sh
cd /Users/martinboros/SRC/FireDrakeGame_PlayCanvas
npm run iterate
npm run dev
```

Then open `http://127.0.0.1:5173/?level=extracted` or navigate there with
Playwright MCP.

For a conservative headless Claude Code pass:

```sh
claude -p \
  --permission-mode acceptEdits \
  --output-format json \
  "Read CLAUDE.md and SESSION_HANDOFF.md. Run npm run iterate, inspect the extracted-sector screenshot, and propose one bounded next change without deleting existing work."
```

Do not use `--dangerously-skip-permissions`.

