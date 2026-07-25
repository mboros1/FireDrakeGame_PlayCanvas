# CLAUDE.md

Read `SESSION_HANDOFF.md` before changing this project.

This is the PlayCanvas/Vite browser prototype for Fire Drake Simulator. The
linked Unreal Engine source project is:

`/Users/martinboros/SRC/FireDrakeGame_UE`

The worktree contains substantial uncommitted user work. Do not reset, delete,
or regenerate it as cleanup.

## Core commands

```sh
npm install
npm run dev
npm run iterate
```

Use `src/tuning.ts` for bounded camera/movement/model tuning. Preserve
`window.__FIRE_DRAKE_DEBUG__` because the Playwright tests and MCP workflow
depend on it.

The extracted Unreal sector is available at `/?level=extracted`. Before
expanding it, read `docs/forest-sector-iteration-1.md` and fix transform/terrain
fidelity in the order recorded in `SESSION_HANDOFF.md`.

