# Fire Drake PlayCanvas development handoff

Last updated: 2026-09-24

## Read this first

This repository is the browser client for:

> A slapstick third-person fantasy sandbox like Goat Simulator, but with a fire
> drake rampaging through the world.

The target is multiplayer and browser-native, and **self-contained: there is
no server.** Rooms are hosted in one player's browser and found over public
Nostr relays; chapters travel as codes that contain the whole chapter.

**Read `docs/ARCHITECTURE.md` before planning any work.** It records the
design and the decisions behind it, including why rooms became
player-hosted (2026-09-24). This handoff covers current
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

## Levels are data

Levels are JSON files in `src/levels/` (format 1: props with named kinds,
paths, optional pond, one spawn per seat), validated by `validateLevel` in
`src/sim/level.ts`, which treats every level as untrusted input and names
every problem. `src/sim/levels.ts` is the registry, bundled and validated at
startup; a room's host names its level in `welcome`. `generateVillage` (`src/sim/village.ts`) is now only a tool:
`npm run levels:export` rewrites `little-kindling.json` from it. This is the
foundation for the level editor and for chapter codes.

## Writing chapters: the author's desk

`src/editor/desk.ts` and `src/editor/drafts.ts`. Open it from the cover's
"write a chapter of your own" link, with `?desk=1`, or with
`loadScene('desk')`. Desktop only (hidden on touch).

- The draft is drawn exactly as it plays, seen from above. The paper tray
  has tools for select (1), the seven cutouts (2–8), path (P), pond (O),
  bookmark (K) and erase (X). Selected cutouts: drag to move, Q/E turn (with
  Shift, 5°), −/+ size, V design, Del remove; Shift+wheel turns, Alt+wheel
  resizes. WASD pans, right-drag orbits, wheel zooms. ⌘Z / ⇧⌘Z undo and redo.
- Every edit goes through `commit()`: snapshot for undo, validate (problems
  become margin notes in the narrator's voice), autosave to localStorage
  (`fire-drake:chapter-drafts`, up to 24 drafts), redraw. Drags move the
  cutout live and commit on release.
- "Read this page" plays the draft (R restarts the draft); **B** or the gold
  banner returns to the desk with the same view and undo history.
- Export and import `.chapter.json`: the level file format, one prop per
  line.
- **Chapter details** (the desk's "Chapter details" card, all optional
  level fields): `heading` ("In Which…", shown on the chapter card),
  `mood` (`afternoon`, `moonlit` or `snow`; `src/view/moods.ts` holds one
  palette per mood for sky, hills, ground paper, light, grade, sun or moon,
  paper stars, and paper snowfall), `narration.opening` (read at the start)
  and `narration.ending` (on The End page), and `deeds`: up to 12
  `{ template, count, title?, flavour? }` from the templates in
  `DEED_TEMPLATES`. Absent deeds means the usual eleven (`DEFAULT_DEEDS`,
  worded exactly as before).
- **Binding:** the desk's "Bind the chapter" turns the draft into a
  **chapter code** and puts it on the reader's shelf. The bookplate shows
  its nickname (`pudding-606`, from its id, for people) and the code, with
  "Copy the code" and, outside an iframe, "Copy a link". Readers paste a
  code on the cover ("or read a bound chapter"), into the table of
  contents, or open `?chapter=CODE`. For a room, the chapter code goes in
  "read it together" (or `?room=…&chapter=…`); it counts only if this
  player ends up opening the room, otherwise the room's chapter wins, and
  everyone gets it in `welcome`.
- **The table of contents** (`src/view/contents.ts`; the cover's "the
  table of contents ☰", or `?contents`): the book's own chapters, then the
  shelf, newest first, each with Read, Read together, Copy the code, Copy a
  link and Remove (asks twice). A paste box reads codes and links. There is
  no public shelf of everyone's chapters: that would need a server.
- Next: chaining chapters into books.

## Chapter codes and the shelf

`src/chapters/code.ts`: a code is `fd1.` + base64url(deflate-raw(level
JSON)), with positions rounded to centimetres and the author's draft id
removed. All of Little Kindling is ~3.4 KB. The code *is* the chapter:
binding is instant and offline, codes never go missing, and a bound chapter
never changes. A chapter's id is `chapter-` + a hash of its code, so the
same chapter from two people is one shelf entry. Decoding treats the code
as untrusted: 64 KB cap on the code, 128 KB cap while inflating (a
compression bomb stops early), then `validateLevel`. `findCode` pulls a
code out of a link or a pasted message. Uses `CompressionStream`, so Safari
16.4+.

`src/chapters/shelf.ts`: localStorage `fire-drake:shelf`, up to 80 entries
(code, title, heading, mood, cutout count, `bound` or `read`). Only this
browser has it. The desk's margin notes remember the nicknames a draft was
bound as (`fire-drake:chapter-bindings-2`; the old key held server codes,
which no longer open anything).

The Fly server's chapter store is gone. The few chapters bound there (test
chapters such as `stable-940`) went with it.

The painted ground used to be mirrored front to back (the paths and pond
were drawn at −z's mirror image); the desk exposed it, and it is fixed.

## Architecture (as built today)

- `src/main.ts`: composition, chapter switching and the frame loop (~440
  lines).
- `src/game/`: `camera.ts` (CameraRig: orbit, zoom, FOV kick, shake,
  automation aim), `input.ts` (Controls: keyboard, mouse and touch into one
  Input), `lighting.ts`, `presenter.ts` (events into sound, fx, shake,
  hit-stop), `extracted.ts`, and `debug.ts` (`window.__FIRE_DRAKE_DEBUG__`).
- `src/net/` (mesh, lobby, room, client) and `src/party.ts`: multiplayer;
  `src/chapters/`: chapter codes and the shelf; `src/view/contents.ts`: the
  table of contents.
- `src/sim/`: PlayCanvas-free and deterministic (seeded `Rng`, no
  `Math.random`).
  - `drake.ts`, `dwarf.ts`: locomotion. Dwarves flee, get launched, bounce
    and are stunned.
  - `props.ts`: burnable and flattenable scenery with fire spread.
  - `village.ts`: seeded level layout. It is sim data because the host
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

## Phones

Touch devices (`src/view/touch.ts`, created only when the primary pointer is
coarse) get a floating left-thumb joystick (analog; pushing to the rim
charges), right-thumb drag to look, pinch to zoom, hold-to-breathe and
hold-to-charge buttons, plus mute and restart. Everything feeds the same
`Input` the keyboard does, so phones and laptops share multiplayer rooms.
Phones default to the low pipeline at 1.5x pixel ratio, with 3 fire
lights. Portrait shows a "turn the book sideways" page: landscape is
required. The HUD compacts below 520 px tall. `tests/touch.spec.ts`
drives an emulated landscape phone with real DevTools touch events.

## Publishing

- **itch.io:** `npm run publish:itch` packages the build (only the six
  runtime drake files) and pushes it with butler to
  `thedudemanguyfriend/firedrake`, channel `html5`. Butler is installed at
  `~/.local/bin/butler` (the Homebrew `butler` cask is an unrelated app) and
  is logged in. Its key only covers uploads.

## Multiplayer

Up to four drakes per room, co-op, **player-hosted**. No server of ours.

- **Finding each other** (`src/net/mesh.ts`): Trystero over public Nostr
  relays opens WebRTC data channels between every pair of players; the
  relays carry only the handshake. Public STUN, no TURN, so some strict
  networks cannot connect. `?signal=local` swaps in a BroadcastChannel mesh
  between tabs of one browser: tests and development, no network. Trystero
  is loaded on demand (a 22 KB gzipped chunk), so single player never pays
  for it. One default relay refuses ephemeral events and logs a warning;
  it is harmless.
- **Who hosts** (`src/net/lobby.ts`): arrive and listen for a host (5 s over
  Nostr, 0.9 s locally); nobody answers, host. Two hosts: the one with guests
  wins, then the lower peer id; the loser sends its guests along. The host
  leaves (tab closed, `pagehide`) or falls silent for 5 s: the lowest
  remaining id hosts a **fresh page of the same chapter**. The village
  restarts; state is not migrated. Measured over real relays on one
  machine: join in ~3.5 s, takeover in ~60 ms after a clean close.
- **The room** (`src/net/room.ts`, formerly `server/room.ts`, unchanged in
  substance): the same `Rampage` at a fixed 30 Hz, inputs applied one per
  tick in order, JSON snapshots at 15 Hz (~780 bytes each, ~12 KB/s per
  guest of the host's upload). Its clock runs in a tiny worker
  (`src/net/ticker.ts`), because hidden tabs throttle main-thread timers;
  a host who switches tabs keeps the room running. The host plays over a
  loopback link, through the same client code as everyone.
- **Client** (`src/net/client.ts`, `src/party.ts`): unchanged prediction
  and reconciliation against whoever hosts; other drakes, dwarves and props
  are replicas interpolated 110 ms behind. Events arrive in snapshots and
  drive narration, sound and Deeds unchanged. R restarts the room for
  everyone. The roster says "you hold the book" on the host.
- **Protocol 4.** Hosts announce their version; a mismatch reports
  `outdated` ("everyone should refresh"). A fifth player is told `full`.
  Guests' inputs are validated and rate-limited by the host as the server
  did; guests trust their host, which is acceptable for co-op with no
  stakes.
- **Local dev:** `npm run dev`, then open
  `/?room=test&signal=local` in two tabs, or without `signal` to go over
  the real relays (two browser profiles, or two machines).
- Tests: `tests/lobby.spec.ts` (Node, local mesh: hosting, joining,
  handover, simultaneous opening, chapter choice across a handover, full,
  outdated) and `tests/multiplayer.spec.ts` (two pages: shared rampage,
  dropped player, host leaving). The Nostr path is verified by hand, not
  in CI, so the suite never depends on strangers' relays.

The Fly app `firedrakegame-playcanvas` is no longer used by any build. It
still exists (with its volume) until someone runs
`fly apps destroy firedrakegame-playcanvas`.

## Tests and browser automation

42 tests: the original browser suite, sim unit tests, and
`tests/sim-rampage.spec.ts`. The rampage tests cover breath, fire spread,
launch, landing, flattening, combos, a deterministic 12-second village replay,
and layout constraints.

```sh
npm run iterate    # both typechecks, vite build, playwright
```

Last verified 2026-09-24: 73 passed locally. CI (`.github/workflows/ci.yml`)
runs the typechecks, the build and `npm run test:headless` (59 tests
needing no drake asset, including the lobby and chapter codes) on every
push.

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
4. **Hosting** — same crate in the host's browser, authoritative for its
   room (was: a native server; see the architecture doc).
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
