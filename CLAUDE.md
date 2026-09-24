# CLAUDE.md

Read `SESSION_HANDOFF.md` and `docs/ARCHITECTURE.md` before changing this
project. The handoff covers current state; the architecture doc covers the
target and the decisions behind it.

This is Fire Drake Simulator, a self-contained browser game: multiplayer
rooms are hosted in one player's browser (WebRTC, found over public Nostr
relays) and there is no server. Linked projects:

- `/Users/martinboros/SRC/void_forge-ws/forge-trunk` — **forge**, the in-house
  deterministic fixed-point engine. It is Fire Drake's simulation substrate.
- `/Users/martinboros/SRC/FireDrakeGame_UE` — the Unreal project, **reference
  only**.

Version control is **git** (switched from void on 2026-09-23; history was
replayed, and each commit carries a `void-commit:` trailer). The old `.void/`
directory is kept on disk, ignored, for reference.

The worktree contains substantial user work and ~155 MB of assets excluded from
version control. Do not reset, delete, or regenerate it as cleanup.

## Core commands

```sh
npm install
npm run dev
npm run iterate
```

Use `src/tuning.ts` for bounded camera/movement/model tuning. Preserve
`window.__FIRE_DRAKE_DEBUG__` because the Playwright tests and MCP workflow
depend on it.

The Unreal FBX-to-GLB extraction pipeline is **retired**. The extracted sector
at `/?level=extracted` remains loadable as a historical artifact and rendering
load test, but the "Recommended iteration 2" list in
`docs/forest-sector-iteration-1.md` is superseded and should not be worked.
Levels are authored browser-native. See `docs/ARCHITECTURE.md`.

