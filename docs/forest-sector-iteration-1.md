# Unreal forest sector migration — iteration 1

Date: 2026-07-24

> **Status: superseded (2026-07-25).** This records a completed experiment and
> its findings, which remain accurate. The extraction pipeline is **retired** and
> the "Recommended iteration 2" section below should **not** be worked — Unreal
> is now reference-only and levels are authored browser-native. See
> `ARCHITECTURE.md` for the decision and its reasoning.

## Goal

Test one code-first loop for extracting recognizable level content from Unreal,
loading it in the PlayCanvas prototype, and validating it through browser MCP.
This iteration intentionally targets a 30 m radius around the Player Start in:

`/Game/sA_StylizedForest_Environment/Demo/Levels/Lvl_Color_Alternative`

This is an extraction experiment, not a fidelity-complete level port.

## Result

The browser now loads the slice at `/?level=extracted`.

- 20 unique Unreal static meshes exported to FBX and converted to GLB.
- 487 transforms imported: 30 placed actors and 457 foliage instances.
- Instance mix: 351 mushrooms, 45 stones, 29 flowers, 24 trees, 24 rocks,
  7 bushes, 6 cliffs, and 1 monument.
- 37,590 nearby grass instances were measured and intentionally excluded.
- Browser sector payload: 16,872,081 bytes (about 16.1 MiB).
- Automated extracted-sector load: about 3 seconds locally.
- Full `npm run iterate`: build plus 2 browser tests passed in 8.3 seconds.
- Direct browser-MCP pass: 487 objects loaded, 5.75 m movement, mouse look,
  zoom, and fire breath all worked; zero browser errors.

Visual evidence:

- `test-results/visual/04-extracted-forest-sector.png`
- `test-results/visual/forest-sector-iteration-1-mcp.png`

## What worked well

### Unreal inspection and extraction

The editor MCP was effective for discovering the loaded level, Player Start,
landscape bounds, placed meshes, foliage component counts, and nearby instance
density. A bounded sector made the task measurable and kept the experiment from
turning into a whole-level migration.

The Python exporter deduplicated mesh assets while preserving every selected
placement in a JSON manifest. All 20 mesh exports succeeded. The extraction did
not mutate the Unreal level.

### Code-first browser import

The manifest is a useful engine-neutral seam: mesh path, placement source,
position, rotation, scale, material-slot metadata, and migration notes are all
inspectable without opening either engine.

PlayCanvas shared each loaded mesh resource across its instances, so 487
entities did not require 487 network downloads. The level is selectable through
the URL and debug API, which made it straightforward to automate.

Hot iteration remained fast: TypeScript/Vite builds in well under a second, and
the complete build plus browser suite finishes in seconds rather than requiring
an Unreal editor restart.

### Automated validation

The browser test catches asset-load failures and console errors, asserts the
source level and exact object count, and saves a screenshot. The direct MCP pass
could then exercise the same debug surface for movement, mouse look, zoom, and
fire without adding bespoke test-only gameplay code.

## Rough edges

### Transform conversion is visibly incorrect

Many trees are sideways or floating. The current Euler mapping is only reliable
for yaw-only actors. Foliage transforms need a proper quaternion basis change
from Unreal coordinates to glTF/PlayCanvas coordinates. This is the most obvious
next correctness fix.

### Landscape did not migrate

Iteration 1 uses a flat 60 m ground box. Unreal Landscape height data, layer
weights, materials, and collision are absent, so vegetation that belongs on
slopes or elevated terrain has no supporting surface. A heightmap/weightmap
export path is required before placement can look coherent.

### Materials and textures are not portable yet

Unreal material graphs do not translate to GLB. Worse, 11 of the converted GLBs
contained stale absolute texture paths from the marketplace asset author's
machine, such as `/Users/anilk/Desktop/...`. PlayCanvas initially rejected those
containers.

The new `scripts/sanitize-gltf.mjs` step removes external texture bindings, and
the importer applies simple category colors. This makes geometry deterministic
but loses bark/leaves, alpha-cutout foliage, normals, and authored shading.
Texture export and a small explicit PBR material mapping layer are needed.

### Exported collision geometry leaks into render assets

The FBXs include `UCX_*` collision meshes as renderable nodes. The importer
disables those nodes by name. A better conversion pipeline should strip collision
meshes into a separate physics representation rather than shipping and hiding
them.

### Units need an importer workaround

Assimp preserved Unreal centimeter-sized vertices, so each browser instance is
scaled by `0.01`. This works, but unit normalization belongs in the conversion
step so browser transforms remain unsurprising.

### Foliage needs GPU instancing and density policy

Creating one PlayCanvas entity per instance is acceptable for this 487-object
test but not for a complete forest. Even this small sector contains 37,590 grass
instances. The real path needs batching/GPU instancing, distance culling, LODs,
and a deliberate density reduction or clustered grass representation.

### Composition and gameplay scale are not reconciled

The current drake model/camera is enormous relative to this 60 m slice and
dominates the view. The drake also remains in its bind pose. Terrain grounding,
camera collision, animation, and a single agreed world-scale convention must be
resolved before this feels like a third-person open-world scene.

### MCP file execution has a path quirk

Passing an absolute Python file path to Unreal MCP caused the project directory
to be prepended twice. The project-relative path `Scripts/export_forest_sector.py`
worked. The workaround is simple but should be standardized in the extraction
command.

## Reproducible pieces added

- Unreal exporter: `FireDrakeGame_UE/Scripts/export_forest_sector.py`
- Engine-neutral manifest:
  `public/assets/forest-sector/forest-sector.json`
- Converted geometry: `public/assets/forest-sector/*.glb`
- GLB cleanup: `scripts/sanitize-gltf.mjs`
- PlayCanvas importer: `src/main.ts`
- Browser gate: `tests/extracted-sector.spec.ts`

After reconverting the GLBs, run:

```sh
npm run sanitize:forest
npm run iterate
```

## Recommended iteration 2

Keep the same 30 m sector and fix fidelity in this order:

1. Replace Euler conversion with a tested quaternion basis conversion.
2. Export a cropped Landscape heightmap and ground the drake/objects against it.
3. Export the small texture set actually referenced by these 20 meshes and map
   it to explicit PlayCanvas PBR materials.
4. Batch repeated mushrooms, stones, flowers, and trees with GPU instancing.
5. Re-tune drake scale and camera against the resulting meter-based terrain.

That sequence keeps the browser loop fast while turning the current recognizable
but broken diorama into a useful gameplay test sector.
