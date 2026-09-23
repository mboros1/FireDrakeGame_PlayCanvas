# Fire Drake: a storybook rampage

> New session: read [`SESSION_HANDOFF.md`](SESSION_HANDOFF.md) and
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.

A slapstick fire drake loose in a pop-up storybook. Everything except the
drake is cut paper, drawn in code. Burn the village of Little Kindling during
its cheese festival: toast dwarves, launch them with a charge, fold cottages
flat, and chase eleven Deeds to reach The End.

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite and press any key to open the book. WASD
prowls, Shift charges (and flattens things), Space breathes fire, M mutes, and
R restarts the chapter. Walk into the giant open book at the end of the cave to
turn to Chapter the Second.

## Code-first iteration

Keep `npm run dev` running and edit `src/tuning.ts`. Saving the file hot reloads
the game while preserving the current level and player transform.

The tuning file owns the visible feel parameters:

- Fire Drake FBX scale, orientation, and recentering offset
- Walk/charge speed, acceleration, and turn response
- Camera FOV, distance, pitch, target height, sensitivity, and zoom limits

Click the game to capture the mouse, move it to orbit the third-person camera,
and press Escape to release it. Right-drag is available as a non-captured
fallback. WASD movement is camera-relative.

Make one category of changes per iteration (model alignment, camera framing,
movement, animation, then physics), test it in the running browser, and commit
the accepted values before moving to the next category.

### Automated browser loop

Run the complete compile-and-browser loop with:

```sh
npm run iterate
```

It starts an isolated browser, waits for the actual Fire Drake model, and tests:

- browser console and page errors
- exported-model scale, orientation, and ground offset
- click-to-capture mouse look
- camera-relative keyboard movement
- wheel zoom
- fire breath
- forest loading and dwarf spawning

Review its deterministic screenshots in `test-results/visual/`. Use
`npm run test:browser:headed` when tuning feel interactively.

The project `.mcp.json` also registers the official Playwright MCP server. Reload
the agent session after changing MCP configuration so the browser tools are
available for exploratory agent-driven passes.

## Build

```sh
npm run build
```

The production build is written to `dist/`.

## Asset migration

The current Unreal project primarily contains packaged `.uasset` files. Those
cannot be consumed directly by a web engine. Export skeletal/static meshes and
animations as FBX or glTF, convert to optimized GLB, and place them under
`public/assets/`. Unreal Blueprints, materials, Niagara effects, and animation
graphs need equivalent PlayCanvas/TypeScript implementations.

Portable source files copied from the Unreal workspace are kept under
`assets-source/` for later conversion and cleanup.
