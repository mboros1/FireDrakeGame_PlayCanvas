# Fire Drake — client/server architecture

Date: 2026-07-25

## What this is

The target architecture for Fire Drake as a multiplayer browser game: a
slapstick third-person sandbox in the spirit of Goat Simulator, starring a fire
drake in a medieval fantasy world.

This supersedes the "Recommended next iteration" section of the July 24
`SESSION_HANDOFF.md`, which described continued fidelity work on the extracted
Unreal forest sector. That work is retired — see *Decisions* below.

## Decisions

These are settled. Where a decision closed off a plausible alternative, the
reason is recorded so it doesn't get relitigated by default.

### Unreal is reference-only

The UE project at `/Users/martinboros/SRC/FireDrakeGame_UE` remains the design
reference and the source of the character assets already exported (wyvern,
dwarf). The FBX → GLB → manifest extraction pipeline is **not** continued.

Iteration 1 produced a recognizable but broken diorama: 487 transforms with
incorrect Euler conversion, no landscape, no authored materials, and 16 MiB for
a 30 m radius. The remaining work — quaternion basis conversion, cropped
heightmap export, explicit PBR material mapping, GPU instancing — is a
multi-session project whose output is static scenery. The gameplay logic worth
keeping is roughly a thousand lines of straightforward C++ that is faster to
rewrite than to port.

Levels are authored browser-native from here.

### forge is the simulation substrate

`~/SRC/void_forge-ws/forge-trunk` — the in-house engine — owns the simulation.
Fire Drake is forge's first game and its forcing function.

The alternative was Rapier, which is faster to a playable prototype because its
colliders, terrain, and contact resolution all exist today. It was rejected on
one property: **Rapier's `enhanced-determinism` feature cannot be enabled
alongside `parallel` or `simd`**, forcing a permanent choice between
deterministic simulation and multi-threaded physics.

forge has no such conflict. Its `Fx` type is `i32`-backed Q16.16 fixed point,
and integer arithmetic is bit-exact on x86, ARM, and wasm32 alike — there is no
IEEE-754 divergence to trade away. forge can be deterministic *and* parallel
simultaneously. `forge/docs/designs/in_progress/02_PHYSICS.md` makes the same
argument from first principles.

The cost is real and is accepted: forge currently has sphere colliders only, no
contact resolution, and no terrain. See
`forge/docs/designs/in_progress/10_CONTACTS_AND_COLLIDERS.md` for the roadmap
and `11_BROWSER_TARGET.md` for the wasm32 work.

### The server is a native remote binary

A dedicated Rust server process, running remotely, authoritative over
simulation. Not WASM, not peer-hosted.

Player-hosted sessions (the Warframe model) were considered seriously. They fit
the genre — co-op chaos has no competitive integrity requirement — and WASM
threads mean a browser host is not compute-limited. They were rejected on
residential upload bandwidth, host hardware variance, background-tab throttling,
and host migration, which remains the most-complained-about part of Warframe
after a decade of work by a much larger team.

forge's own `08_DISTRIBUTED_WORLD.md` reaches the same v1 conclusion
independently: *"each region is owned by exactly one server process at any
moment."*

This is revisitable. Because the simulation is one Rust crate compiled to both
native and wasm32, "who hosts a session" is a deployment decision, not an
architectural one. Opt-in peer-hosted private games can be added later without a
second implementation.

### Transport is WebTransport

WebTransport reached Baseline in March 2026 when Safari 26.4 shipped it, so it
now works in every current browser without a polyfill. It provides unreliable,
unordered datagrams — the correct primitive for state sync, and what WebSocket's
TCP head-of-line blocking cannot give.

The earlier plan of "start on WebSocket, migrate later" is unnecessary. Server
side: `wtransport`.

### Discovery splits by rate of change

- **Game server directory → the void board.** Servers are few, long-lived, and
  slow-changing. A server publishing its region, capacity, and address on a
  refresh interval is exactly the durability profile Nostr relays handle well.
  Clients find servers with no central index.
- **Room and session state → the game server.** Fast, ephemeral, high-churn, and
  needs consistency for slot allocation. The client is already connected; the
  server hands it the room list over that connection.

Putting live session listings on relays was rejected: replaceable events
propagate on a seconds-to-minutes horizon, sessions churn every few minutes, and
latency-sorted matchmaking needs RTT probing a relay cannot do.

This is the same authority-split-by-stakes principle Warframe uses — Digital
Extremes' servers own matchmaking and the account economy; the distributed part
owns the session.

### Repository layout

The game's Rust lives in **this** repository as `crates/firedrake-sim`,
depending on forge through a path dependency.

This keeps forge general-purpose rather than accreting Fire Drake specifics,
keeps game churn out of forge's 253-test suite, and lets the game iterate
without touching the engine. Engine changes the game needs get made in forge
deliberately, as engine work, rather than leaking in as game commits.

### World convention

**Y-up, right-handed, 1 unit = 1 metre.** The drake is roughly 6 m nose to tail.

This matches glTF and PlayCanvas natively, so Blender's glTF exporter performs
the Z-up conversion and nothing hand-rolls a basis change. Mismatched transform
conversion is exactly what broke the Unreal extraction, and that mistake is not
worth repeating in a new pipeline.

The current prototype violates this — roughly a 30 m wingspan, `modelScale:
0.01`, and a 9.65 m recentring offset in `src/tuning.ts`. Reconciling it is part
of phase 1, and it must happen before any level is authored, because every asset
and transform authored against the wrong convention has to be redone.

Numeric budget: forge's Q16.16 `Fx` gives roughly ±26 km safe per-axis range at
about 0.015 mm precision. Comfortable for a sector-scale world; a hard ceiling
if the design ever wants continents, which would need origin rebasing.

### Tick rate: 30 Hz

Simulation runs at a fixed 30 Hz; rendering interpolates between ticks at
display rate. Halves snapshot bandwidth against 60 Hz, and forge's semi-implicit
Euler integrator is stable there. Revisit only if the game feel demands it —
this is a tuning-visible parameter, so it should be settled before physics
tuning rather than during.

### The drake is a kinematic character controller

Axis-locked capsule with scripted movement, slide, and step-up. Not a dynamic
rigid body driven by forces.

This keeps the player predictable and responsive, and it is what lets
`10_CONTACTS_AND_COLLIDERS.md` defer `QuatFx`, angular velocity, inertia
tensors, and torque entirely.

**The tension is acknowledged rather than resolved.** The slapstick identity of
a Goat Simulator–like comes largely from dynamic ragdoll physics — flailing
bodies, tumbling props, momentum going wrong in funny ways. That is precisely
the deferred second physics pass. So the deferral is on the critical path to the
game being *good*, even though it is not on the path to the game being
*playable*. Sequencing a controllable drake ahead of a funny one is deliberate,
not an assessment that ragdolls are optional.

Controller state is a plain enum (`Grounded | Airborne | Flying | Stunned`),
replicated and consumed by the client's animation graph. One implementation
note: **data-carrying enum variants sit awkwardly in slab-major SoA**, since a
column must be sized for the largest variant. Prefer a bare discriminant column
with payloads in their own columns (`fall_velocity`, `stunned_until`), accepting
that some rows leave them unused. Worth choosing deliberately rather than
discovering it when the column layout looks strange.

## The shape

```
┌─────────────────── browser ───────────────────┐
│  PlayCanvas (renderer + input + HUD)          │
│         ▲ reads transforms                    │
│  forge (wasm32) — local prediction            │
│         ▲ WebTransport datagrams              │
└─────────┼─────────────────────────────────────┘
          │ inputs up / snapshots down
┌─────────▼─────────── server ──────────────────┐
│  forge (native) — authoritative simulation    │
│  rooms sharded across cores                   │
└───────────────────────────────────────────────┘

  assets: void gateway (/ipfs/<cid>/…), content-addressed
  discovery: void board (NIP-34 30617/30618)
```

One simulation crate. Two compilation targets. PlayCanvas never owns gameplay
state.

## Simulation

forge provides the substrate:

- `forge-storage` — slab-major SoA (`Slab`, `World`, `SoaStore`, `AnyPool`).
- `forge-bus` — task scheduler with a dependency graph, worker pool, priority
  and cadence, panic isolation, and cascade propagation. Phases 1–4 shipped.
- `forge-physics` — fixed-point integrator and colliders.

Game code adds Fire Drake's rules — drake locomotion and flight, dwarf AI, fire
breath, burn state — as registered bus tasks declaring their column reads and
writes.

**Determinism is load-bearing, not incidental.** It buys three things:

1. Client prediction that matches the server bit-for-bit, so corrections are
   rare rather than constant.
2. Rollback netcode as an available option.
3. **Replays as input logs.** A whole session is an initial-state CID plus a
   list of inputs — kilobytes, content-addressable, and replayable to identical
   results by anyone. This falls out nearly free and is worth protecting.

Anything that breaks determinism — wall-clock reads, uncontrolled iteration
order, floats leaking into simulation state — is a bug, not a tradeoff.

## Rendering

PlayCanvas is demoted to a view layer. It owns cameras, materials, meshes,
particles, HUD, and input capture. It owns no gameplay state.

forge's `07_RENDERING_AND_SCENES.md` already models this as "renderer as an
outbound flume subscriber on its own thread." In the browser the same seam is a
read of simulation state after each step.

**The WASM boundary must not be crossed per entity.** One call per frame;
transforms come back as a pointer into linear memory that JS reads as a typed
array with no copying:

```rust
#[wasm_bindgen]
impl Sim {
    pub fn set_local_input(&mut self, bits: u32, yaw: f32, pitch: f32);
    pub fn step(&mut self, dt: f32);
    pub fn ingest_snapshot(&mut self, ptr: *const u8, len: usize);
    pub fn transforms_ptr(&self) -> *const f32;  // SoA: [x,y,z,qx,qy,qz,qw] × n
    pub fn entity_count(&self) -> usize;
}
```

Two gotchas to hold onto:

- **`wasm.memory.buffer` detaches whenever WASM memory grows.** The
  `Float32Array` view must be rebuilt after growth, never cached indefinitely.
- The same buffer can feed PlayCanvas GPU instancing directly, which is also the
  answer to rendering dense foliage.

`src/tuning.ts` stays on the JS side and stays live-tunable. A Rust rebuild is
seconds where Vite HMR is sub-second, and the fast feel-iteration loop is the
main advantage this prototype has over the Unreal build. Only structural
simulation changes should pay the compile.

### Animation

**Animation is presentation and lives entirely on the client.** The simulation
replicates a movement state and a few scalars; the client derives every pose
from them as a pure projection.

Replicated:

```rust
enum MoveState { Grounded, Airborne, Flying, Stunned }
// plus: horizontal speed, grounded flag, burning flag
```

Not replicated: which clip is playing, blend weights, or animation time. The
client computes all of it.

This holds because nothing here feeds gameplay outcomes — the server owns hit
detection through an explicit cone test, not animation-driven hitboxes. Keeping
animation client-side means no animation state on the wire, and no pointless
determinism constraint on a presentation concern.

**The rule that keeps this true: no root motion.** Root motion is precisely the
mechanism that couples animation into simulation — once movement comes out of a
clip, the server needs the animation system and determinism follows it in.
Movement stays code-driven, which the kinematic controller implies anyway.

#### Use PlayCanvas's anim state graph

Verified against the installed 2.21.0 `playcanvas.d.ts`:

- `AnimStateGraph` takes a **plain JS object**, so the graph lives in this repo
  as a TypeScript literal — versioned, diffable, agent-editable, and requiring
  no PlayCanvas Editor. That matters given the Editor was deliberately rejected
  as an authoring path.
- `setFloat` / `setBoolean` / `setTrigger` drive transitions by named parameter.
  The parameters simply *are* the replicated state, so the client-side mapping
  is a handful of lines per frame rather than an animation system.
- `assignAnimation(nodePath, animTrack, layerName?, …)` binds tracks to states,
  and creates a single-state default graph if none is loaded — so one clip can
  be wired and seen moving before any graph is designed.

#### Compose with layers, not with more states

`ANIM_LAYER_ADDITIVE` and per-layer `mask` are first-class
(`addLayer({ name, states, transitions, weight, mask, blendType })`).

Use them. A flat state machine cannot express "running **and** on fire **and**
flailing" without `RunFlail` / `WalkFlail` / `IdleFlail` and onward into
combinatorial explosion. Base layer drives locomotion from speed; an additive
masked layer drives upper-body flail from the burning flag.

This is the failure already recorded in the Unreal handoff — *"only the arm/flail
layer was observed at one point instead of a clean run-plus-flail blend"* — and
it was not a bug in the state machine so much as the state machine being the
wrong tool for a combination. PlayCanvas has the layering natively rather than
through slots and additive montages.

#### Current mapping

The exported drake clips — `idle`, `walk`, `take_off`, `flying`, `flapping` —
form a plain ground↔air FSM needing no layering:

```
Idle ⇄ Walk                        (blend on speed)
Idle/Walk → TakeOff → Flying ⇄ Flapping
```

Layering is the *dwarf's* problem, and the dwarves are still primitives with no
model imported, so it arrives later with the solution already known.

Connecting this is self-contained — no Rust, no server, no physics — and takes
the drake out of bind pose, which is the single largest visible improvement
available at present.

## Networking

Client sends **inputs** — button bits, look angles, a sequence number. Never
positions. Server simulates on its own fixed tick and returns authoritative
state tagged with the last input sequence consumed. The client compares against
its own prediction for that sequence, and on mismatch discards its version,
snaps to the server's, and replays newer inputs.

### Serialization: CBOR

**CBOR everywhere, encoded and decoded in Rust on both ends. JS never parses the
wire format.**

An earlier draft of this doc specified `postcard` for the hot path on size
grounds — it is non-self-describing, so a snapshot costs roughly a third of the
equivalent CBOR with string keys. That was the wrong trade and is recorded here
so it doesn't get re-proposed.

The argument for it was that schema drift is impossible because client and
server are one crate compiled twice. That holds only for the live client/server
pair inside a single build. It protects nothing that is *stored*:

- **Replays.** "Initial-state CID plus an input log" is a headline benefit of
  determinism. Under a schema-rigid format, every added field invalidates the
  entire recorded archive.
- **World snapshots and level files**, for the same reason.
- **Rolling deploys and stale browser tabs**, where two builds are briefly live.

Schema-rigid formats are worst precisely during early development, when state
layout changes weekly — which is the phase this project is in. This is a lesson
already paid for on another project with `rkyv`; the same failure mode should not
be bought twice.

CBOR also earns its place on grounds beyond evolvability:

- **void already speaks it.** `ciborium` is a daemon dependency, published
  bundles are `content.cbor`. Levels, snapshots, and replays are
  content-addressed artifacts headed into that pipeline; a second encoder for
  data landing in the same store is pure cost.
- **Deterministic encoding profile.** The same logical data must produce
  identical bytes or content addressing churns CIDs on semantically unchanged
  content. CBOR specifies this; `postcard` does not.
- **Self-describing.** A captured packet can be dumped without the schema, which
  matters more than it sounds like at 3am.

Closing the size gap without giving up any of that: use short or integer keys on
hot-path structs. Most of CBOR's overhead is repeated string field names, and
that is a `#[serde(rename)]` away.

**When the hot path eventually needs to be smaller, the answer is not another
serde format.** It is a purpose-built encoder — quantized positions,
delta-encoded against the last acknowledged snapshot, bitpacked — which beats
both CBOR and postcard by a margin that makes their difference rounding error.
That encoder carries an explicit version byte because it is hand-written, so it
does not reintroduce the rigidity problem. It is also work to defer until
profiling demands it.

Evolvability discipline, since self-description alone is not a versioning
strategy:

- An explicit `version` field on every persisted artifact.
- `#[serde(default)]` on added fields so old data still loads.
- Never reuse or renumber a key.
- Content-addressed artifacts are immutable, so old CIDs stay readable as long
  as the matching decoder is kept; the version field says which one.

One structural help: replays serialize *inputs* (button bits, yaw, pitch,
sequence), not world state. That schema is far smaller and far more stable than
the simulation's, so replays are naturally more durable than snapshot-based
recording would be.

### Compression: by channel, not by size

| Channel | Compression |
|---|---|
| Per-tick state deltas (datagrams) | **none** |
| Initial state sync, level load, bulk (reliable stream) | **zstd** |
| Stored artifacts (levels, replays, assets) | **zstd(CBOR)** — void's existing pipeline |

void already standardizes on zstd(CBOR) → AES-GCM at level 3
(`core/src/index/io.rs`, `core/src/shard/mod.rs`), so stored artifacts inherit
that pipeline unchanged rather than introducing a second one.

**The hot path is deliberately uncompressed.** On a datagram channel the unit
that matters is packets, not bytes: datagrams are MTU-bound at roughly 1200
bytes, so halving a snapshot that already fits in one packet changes no latency
and no loss behaviour. The decision rule is "does this reduce packet count," and
for a room-sized entity count it does not.

The data also resists compression by construction. What actually shrinks game
state is semantic — quantizing positions to render precision, delta-encoding
against the last acknowledged snapshot, and interest management dropping
entities the client cannot see. Generic LZ can do none of those, and after they
are applied the remainder is high-entropy. Short or integer CBOR keys remove the
repeated field names, which was the only real redundancy worth squeezing.

This also avoids two hazards. A trained zstd dictionary would be an artifact to
generate, version, ship, cache, and keep synchronized across client and server,
with decompression failure as the drift mode. And **streaming zstd context is
incompatible with unreliable datagrams** — a single dropped datagram desyncs the
decompressor unrecoverably, so shared compression history is only available on a
reliable ordered stream, which forfeits the reason for choosing datagrams. With
no hot-path compression, neither problem exists.

If a size threshold is ever introduced within one channel, signal it with a
header bit. Never infer compression from content.

Prediction scope: predict the local drake, interpolate everything else. Nobody
notices 100 ms of latency on a dwarf they aren't controlling.

## Security model

Client-side prediction is **not** a source of truth. It is a rendering
optimization, overwritten the moment authoritative state arrives. A player who
patches their local simulation sees the effect for one round trip and then
rubber-bands; no other player ever sees it.

A thin client is not more secure — it still sends forgeable inputs, and the trust
boundary is identical. Security is not a reason to choose a prediction model.

The real surface, and the rules:

- **Never integrate using a client-supplied `dt` or timestamp.** The server owns
  the tick; client timing is advisory only.
- **Clamp input consumption to the server's tick budget.** Unbounded input
  ingestion is a speed hack.
- **The server owns hit detection.** The current `hitDwarves()` cone test in
  `src/main.ts` moves server-side and never comes back. Never accept "I hit X"
  from a client.
- **Bound any lag-compensation rewind window**, or inflated reported latency buys
  a larger one.
- **Interest management.** Only send state for what a client should see. This is
  the one cheat class prediction cannot address, and it is also a bandwidth win.

Authority is a per-mechanic decision. Fire breath must be server-authoritative;
wing-flap animation state or a cosmetic roar can be client-authoritative at no
real risk.

Stakes are low — a chaos sandbox has no ladder or economy to protect — so this
does not warrant anti-cheat investment. But the discipline is free if built in
from the start and expensive to retrofit once gameplay has grown around client
assertions.

## Assets and delivery

**Content-address assets from day one**, even while serving from a plain static
host. This is the single decision that keeps every later option open: the origin
can move, and peer-assisted distribution can slot in beneath the loader, without
touching game code. Retrofitting content addressing through every asset path is
the expensive alternative.

The void gateway (`crates/gateway`) is the intended origin. `/ipfs/:cid/*path`
already serves directory trees with `Cache-Control: public, max-age=31536000,
immutable`, ETags, range requests, permissive CORS, compression, and HTTPS with
HTTP/2 and HTTP/3.

Constraints to respect:

- **Keep the origin swappable behind one config value.** At the time of writing
  `eu.voidtrunk.net` and `us.voidtrunk.net` both return 502. Self-hosted
  infrastructure under active development should not be a single point of
  failure for the game loading at all.
- **Two PoPs is not a CDN.** Fine for a prototype; players outside NA/EU will
  feel a 155 MB first load.
- **Verify `.wasm` is served as `application/wasm`**, or
  `WebAssembly.instantiateStreaming` fails.
- **Cross-origin isolation vs. cross-origin assets.** WASM threads require
  `SharedArrayBuffer`, which requires `COOP: same-origin` + `COEP: require-corp`.
  A cross-origin-isolated page refuses cross-origin subresources that lack
  `Cross-Origin-Resource-Policy`. Permissive CORS does not imply CORP — they are
  separate headers. The gateway change is tracked in void.
- **Serve games from a distinct hostname** from any void board UI. Same-origin
  means shared `localStorage` and cookies, and void deliberately keeps keys out
  of the browser via the native-messaging signer. One DNS record now; painful to
  retrofit once links circulate.

The mutable-pointer problem is already solved upstream: `REPO_STATE_KIND`
(30618) is a signed, replaceable pointer whose `published-root` tag names
exactly the CID `/ipfs/<root>/` serves. A game build is another published root.
`REPO_KIND` (30617) announcements plus a topic tag give a game registry for
free, in a NIP-34-standard shape other Nostr clients can read.

## Peer-assisted asset distribution — deferred, deliberately

Browsers can do UDP peer-to-peer via WebRTC DataChannels, and content-addressed
distribution is *safer* than Warframe-style peer hosting: a peer's bytes either
hash to the CID or they don't, so no trust is required and no cheating is
possible. The game server already knows the room roster, so it can act as the
signaling broker with no DHT, no libp2p, and no bootstrap infrastructure.

It is deferred because the economics do not justify it: peer assist helps only
first load, residential upload is roughly a tenth of downstream, a swarm is 8–16
players joining at different times, and 155 GB of egress is free on R2.

The stronger argument for building it is that a browser implementation would be
a clean-room second implementation of void's block exchange and would likely
surface the protocol ambiguities behind the current laptop-to-laptop flakiness.
That is void infrastructure work with independent value, and should be justified
on those terms rather than on game bandwidth.

## Levels

The level format lives in Rust, because the server needs collision geometry,
spawn points, and triggers, and the server is a native binary with no browser
and no PlayCanvas.

**Split in two halves**, on the same seam as everything else:

- **Simulation half** — collision primitives, spawns, triggers, physics
  materials, region bounds. Loaded by server *and* client. Small: a few thousand
  `{ shape, transform, tags }` entries. Keeps server level-load to milliseconds
  and lets the sim start before art finishes streaming.
- **Presentation half** — meshes, materials, lights, particles, LODs,
  referenced by CID. Client only. **The server never parses a mesh**; it needs a
  capsule at a position, not a tree model.

A level is *not* a scene tree. `07_RENDERING_AND_SCENES.md` names
scene-graph-as-data-model an explicit non-goal — entities live in slab storage
and scenes organize only how they get drawn.

### Authoring

```
.blend  →  .glb  →  forge CLI compile  →  level artifact (CID)
(source)   (interchange)                  ├─ sim half   → server + client
                                          └─ presentation → client only
```

Blender owns geometry, terrain, and art placement. This follows
`06_OBSERVABILITY_AND_INTERFACE.md`, which rules out building an editor as a
deliberate strategic choice — "editor maturity is the gap that killed many indie
engines." It also happens to suit agent workflows far better than Unreal did:
`blender -b level.blend -P export.py` is headless, scripted, deterministic, and
needs no running editor, no plugin bridge, and no open port.

Conventions carry gameplay data: empties named `spawn_drake` / `trigger_*` with
Blender custom properties exported into glTF `extras`, and collision proxies
named `COL_capsule_*` / `COL_sphere_*` alongside the art mesh. That lines up
with doc 10 — trees are vertical capsules, rocks are spheres, so a stylized
forest needs no mesh colliders at all.

**Source format is RON**, chosen over TOML because collider and entity types are
Rust enums and RON round-trips variants and tuples natively where TOML needs a
hand-rolled discriminator string and cannot express a fixed-arity vector.
Compiled artifacts are CBOR per the serialization section.

### Gameplay editing

The RON file is canonical. Agents edit it directly — precise, diffable,
reviewable in a commit, with no GUI state to desync from disk, and verified
through the existing Playwright MCP loop and `__FIRE_DRAKE_DEBUG__`.

A browser-side placement tool may be added for humans, but under one hard
constraint: **it writes back to that same file and holds no project state of its
own.** No database, no editor-internal scene. One representation, two
interfaces, no sync layer. Scope is placement and live tuning only — the moment
it grows a mesh or material editor, it has become the thing doc 06 decided not
to build.

Off-the-shelf browser editors were considered and rejected on a common
disqualifier: each makes its own scene graph the source of truth, requiring a
lossy converter into forge's model — structurally the same mistake as the Unreal
extraction pipeline.

## Phasing

Playable at every step.

1. **Renderer/state seam.** Split `src/main.ts` into a `WorldState` producer and
   a PlayCanvas consumer. No Rust yet. This defines the ABI. Both Playwright
   tests stay green. Also reconcile world scale to the metre convention above,
   before any level is authored against the wrong one.
2. **forge physics to a playable floor.** `Fx::sqrt`, contact manifolds, impulse
   resolution, segment-segment closest point, capsule colliders, terrain.
   Tracked in forge doc 10.
3. **forge to wasm32.** `WorkerPool` platform seam, then swap TS movement for
   forge calls. Still single-player. The existing test suite is the gate.
4. **Server.** Same crate, native, authoritative, one room, WebTransport,
   prediction and reconciliation.
5. **Gameplay.** Flight, ragdoll dwarves, knockable props, multiplayer.

Step 2 is the long pole and the accepted cost of choosing forge.

### Exit condition for phase 2

Engine work attached to a game expands indefinitely without one. Phase 2 is done
when:

> The drake walks over uneven terrain under forge's simulation, collides with
> trees and cannot pass through them, falls and lands correctly, is driven by
> the kinematic controller, runs single-player, and both existing Playwright
> tests are green.

Not: ragdolls, flight, props, multiplayer, or materials. Those are later phases
and pulling them into phase 2 is how it stops terminating.

## Open questions

- **Room size and topology.** Assumed 8–16 players per room, rooms sharded
  across cores, which keeps forge's parallelism at the room level. A single
  large persistent world would change slab partitioning and interest management
  substantially.
- **Rotational dynamics timing.** `02_PHYSICS.md` specifies `QuatFx` and full
  inertia tensors. The kinematic controller defers all of it. This reopens with
  ragdolls, and per the controller decision above, that is sooner than "when
  convenient" — it gates the game being funny.
- **Terrain representation.** Heightfield versus authored collision geometry,
  and whether the drake's flight needs a different broadphase than ground
  movement. Blocks phase 2; needs its own scoping pass, likely forge doc 12.
- **Character controller mechanics.** The decision is *kinematic*; the mechanics
  are unspecified. Step height, slope limit, ground snapping, air control,
  and how flight transitions in and out. Not designed anywhere yet.
- **Snapshot structure and interest-management criteria.** Deferred until a
  working single-player sim exists to measure against.
- **Whether the gateway is the only origin** or one of several behind the
  swappable config value.

## Preserved constraints

- `window.__FIRE_DRAKE_DEBUG__` must survive every refactor. The Playwright
  suite and the MCP workflow both depend on it, and it is how the forge port
  gets verified against the current behavior.
- The worktree holds substantial uncommitted user work and ~155 MB of assets
  excluded via `.ignore`. Do not reset, delete, or regenerate as cleanup.
