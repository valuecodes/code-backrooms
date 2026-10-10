# AGENTS.md - apps/web

This directory inherits `/AGENTS.md`. This file lists only additions and overrides specific to the web app.

---

## What This Workspace Is

- Code Backrooms: a first-person, Backrooms-style 3D space that will eventually
  be generated from source code (functions as rooms, branches as doors, and so on).
- Vite 8 + React 19, three.js through React Three Fiber and drei, Tailwind CSS 4
  for the HUD.
- Milestone 2: a seeded, procedurally generated world of 10-20 rooms joined by
  doorways and straight corridors, WASD + mouse-look movement with wall
  collisions.
- Milestone 3: rooms generated from source code. Bundled example programs are
  parsed into a `CodeGraph` (`@repo/parser`), turned into a room graph
  (`@repo/code-graph`) and laid out by the same generator; the HUD names the
  file and function the player is standing in. The app itself is thin:
  parsing, generation and rendering all live in `packages/`.
- Milestone 4: call navigation. Each function has one call door (from the
  caller that first reaches it in a breadth-first walk from the file's
  roots); every other call is a teleport portal (extra callers, recursion),
  every function has a return portal, and an exploration stack remembers
  where each function was entered. The HUD shows the stack as a breadcrumb
  and names whatever door or portal the player faces.
- Milestone 5: control flow. A function is no longer one room but a column
  of rooms, one per top-level statement of its body: folded plain
  statements, a call, an `await` checkpoint, a `return`. Calls hang off the
  side walls of the room that makes them (a door for the first call to a
  function, a portal otherwise), the return portal sits at the end of the
  column, and the HUD line names the room: `demo.ts · main() · getUser(…)`.
- Milestone 6: forks. An `if` is a fork room that opens into a
  true lane on the left and a false lane on the right, each a column of its
  own, rejoining in an `end if` room; a `switch` is a head room with a door
  per case (plus a default) and an `end switch`. Lanes are tinted (sage for
  true, dusty red for false, slate for cases, grey for default) on their
  walls and the frames of the doors into them, the door prompt names the
  lane (`→ true`, `→ case "active"`), an early `return` ends its lane with
  its own return portal, and the HUD names forks and merges (`… · if
(user)`, `… · end if`, `… · false · empty`). Loops and `try` stay one
  collapsed room; a switch with a nested `break`, a case that falls through or more than
  six cases does too. A call inside a lane offers one wall for its door, so when the
  layout cannot place that door the call becomes a portal and the world is
  laid out again (`generateCodeWorld`).
- Milestone 7: loops. A loop is one rectangular ring: the header
  room across the top, the body down the west side (ochre walls) beside a
  corridor back (deeper ochre), and at the bottom an `again?` room (a
  do-while's `while (…)`) with two doors, `→ repeat` up the corridor into
  the header again and `→ exit` into `end for` / `end while`. Until
  Milestone 8, a `break` or `continue` inside the body was a dead-end room
  and a loop whose body ended in a jump stayed collapsed. Lane prompts only
  show walking with the flow; the way back names the room (`→ again?`).
  See `?code=loops`.
- Milestone 8: jumps. A `break` or `continue` room has a jump
  portal on its far wall: `continue` leads to the loop's `again?` room,
  `break` to `end for` / `end while`, or to `end switch` from a `break`
  nested in a case. The prompt reads like a door (`→ again?`) and the stack
  is left alone. A loop whose body ends in a jump now opens, as does a
  switch with a nested `break`; a switch with a case that falls through or
  more than six cases, a loop whose body only returns, and `try` stay one
  collapsed room. See `?code=loops` and `?code=switches`.
- Milestone 9: switch fallthrough. A case that falls through
  has a side door from its last room into the next case's first room,
  tinted and prompted like a lane door (`→ case "banned"`), instead of a
  door into `end switch`; its call portals move to the other walls. Only a
  switch with more than six cases still stays one collapsed room. See
  `?code=switches` (`case "suspended"`).
- Every function of every example is checked against its derived
  control-flow graph (`@repo/code-graph/cfg-checks`,
  `world-from-code-cfg.test.ts`): each door and portal stands for a flow
  edge and each reachable flow edge can be walked. Nothing visible changes.
- Milestone 10: the source panel. E while walking a code world
  shows the code of the room the player stands in, docked right: the whole
  file for a hub, the whole function for a function, and the function with
  the room's own code marked for a flow room (a merge, test or end room
  marks its whole `if`, loop or switch; a room the budget folded marks
  everything folded into it). The mouse wheel scrolls it.
- Milestone 11: the overview map. M or Tab while walking shows a
  map in the top-left corner, north up and centred on the player: the rooms
  stood in, filled with their lane's colour, the rooms seen through their
  doors drawn hollow, their doors, and their portals coloured by kind (call
  amber, return pale, jump grey, marker dark). It belongs to one world: N
  starts it over, R does not.
- Milestone 12: aesthetic variation. A code world is seeded from
  a hash of its source, so the same program always gives the same world
  and `?seed` / N are a dev override. The seed varies proportions only,
  never what is connected (a test compares every example with variation on
  and off): each function's column is 0, 0.5 or 1 m wider, each hub starts
  up to 1.5 times wider than deep, and a tree corridor is 2 or 3 m wide.
  Rooms that follow each other without a choice open onto each other
  through wide passages (up to 4 m); doors into a lane stay 1.2 m doors so
  the choice reads. Each room's wallpaper is a shade lighter or darker,
  and the ceiling lights buzz out of step.
- Milestone 13: resolution kinds. A call is resolved, ambiguous
  (the name may mean several functions: two branches declaring it, two
  classes with that method on an unknown receiver), dynamic (a callback or
  parameter, `obj[k]()`, `f()()`), external or unresolved. Only resolved calls
  become doors or portals. Each room holding any other kind gets one closed
  marker: a boarded frame whose prompt names the calls (`closed · fetch(…)
external, x.render(…) ambiguous: A.render() | B.render()`). Choosing
  between an ambiguous call's candidates is left for Phase 6.
- Milestone 14 (current): cross-file calls. An example may hold several
  files (`?code=repo`, a seven-file repository); the parser links calls
  through relative imports, barrels and re-exports, so a call into another
  file is a portal into that file's function and Backspace returns across
  files. A call into a package stays a marker that names it
  (`closed · format(…) package "node:util"`). Modules are sorted by path; the
  world still starts at the first one's hub until the repository entrance.

---

## Workspace Commands

| Task      | Command                       |
| --------- | ----------------------------- |
| Dev       | `pnpm --filter web dev`       |
| Build     | `pnpm --filter web build`     |
| Preview   | `pnpm --filter web preview`   |
| Typecheck | `pnpm --filter web typecheck` |
| Test      | `pnpm --filter web test`      |
| Clean     | `pnpm --filter web clean`     |
| Deploy    | `pnpm --filter web deploy`    |

Or run repo-wide via root `pnpm typecheck` / `pnpm test` / `pnpm build`.

There are no per-workspace `lint` or `format` scripts: root `pnpm lint` (oxlint) and
`pnpm format` (Prettier) each cover the whole repo.

---

## Layout

```text
src/
  main.tsx            mounts <App/>
  app.tsx             full-screen <Canvas>, seed and current-room state, pointer lock, HUD
  hud.tsx             "Click to start walking" overlay / crosshair, seed + place readout,
                      breadcrumb and the prompt for the door or portal ahead
  source-panel.tsx    the E overlay: the current room's code, its own lines marked
  source-view.ts      room id -> the lines the source panel shows, pure
  overview-map.tsx    the M / Tab overlay: an SVG map of the rooms walked so far
  map-model.ts        visited rooms -> the rooms, doors and portals the map draws, pure
  pose-feed.ts        the player's position from the render loop to the map, no app render
  params.ts           URL query -> { seed, rooms, preset, code }, with clamping
  examples.ts         bundled example programs for ?code=<name>
  use-navigation.ts   the exploration stack as React state, fed by the Player
  world-from-code.ts  source -> CodeGraph -> WorldGraph -> world, plus the HUD's words
```

### Query parameters

- `?seed=12345` picks the world; `N` while playing bumps it (and rewrites the URL).
  Without it a random or preset world uses seed 1 and a code world the hash
  of its source (`hashSource` from `@repo/parser`), so a shared `?code=` link
  reloads into the same world; for code worlds `?seed` is a dev override.
- `?rooms=15` sets the random graph size (clamped to 1-40).
- `?graph=<preset>` lays out a hand-written graph from
  `@repo/world-generator/presets` instead: `lobby`, `linear`, `branching`,
  `hub`, `cycle`.
- `?code=<example>` generates the rooms from a bundled program in
  `src/examples.ts` (`demo`, `chain`, `pair`, `service`, `external`,
  `portals`, `branches`, `switches`, `loops`, `resolution`) and wins over
  `graph`. Edit a source string there to change the
  world.

### Keys while walking

WASD and the mouse move and look, Shift sprints. Walking into a call door or
a call portal enters that function; Backspace (or the room's return portal)
goes back to where it was entered, or to the file hub when nothing was; R
returns to the world start with an empty stack; N takes the next seed; E
shows or hides the source panel in a code world, and the wheel scrolls it;
M or Tab shows or hides the overview map.

### The pipeline

Code → graph → layout → rendering, each in its own package:

- `@repo/parser` parses one file with `@babel/parser` into functions (each
  with its body as a control-flow tree) and call sites (resolved, ambiguous,
  dynamic, external or unresolved).
- `@repo/code-graph` holds the language-independent `CodeGraph` types and the
  spatial grammar: one cluster per function (a column of flow rooms with
  ports on its side walls, `./flow-layout`), one hub room per file, one call
  door per function (a breadth-first tree over the calls through those
  ports) and a portal for every other call, plus a return portal at the end
  of each column. `./subjects` maps room and portal ids back to the code.
- `@repo/types` holds the world data shapes for the three layers below.
- `@repo/world-generator` turns a `WorldGraph` (rooms, some with a `cluster`
  of pre-placed rooms, connections, portals) into a `WorldLayout` (rooms and
  corridor-rooms with positions, doors and portals on their walls; a cluster
  is rotated to face its parent and placed as one unit) and then a
  `BuiltWorld` (wall boxes, lintels, door frames, portal frames and
  triggers, colliders). It is three-free and fully seeded. Connections and
  portals it cannot realise are listed in `layout.unresolved` and
  `layout.unplacedPortals`; the app shows them in the HUD. Its `navigation`
  subpath is the exploration stack the app drives, which treats a cluster's
  rooms as one unit.
- `@repo/renderer` draws a `BuiltWorld` and runs the player, which reports the
  room it is in through `onRoomChange`, portal entries through `onPortal`, and
  the door or portal ahead through `onNearTarget`; `placement` teleports it.

The example is parsed once at startup (a syntax error is shown in the HUD),
and the world is built in a `useMemo` keyed on the seed, so it never
regenerates while the player moves.

---

## Local Conventions (Deltas from Root)

### Nothing three.js-specific lives here

- Generation stays in `@repo/world-generator` (three-free, tested in the `node`
  environment) and scene code in `@repo/renderer`. This app only composes them.

### Lint

- The root `.oxlintrc.json` turns `react/no-unknown-property` off for
  `packages/renderer/src/**/*.tsx` and `src/app.tsx` only, because React Three
  Fiber props are not DOM attributes. Keep JSX for three.js objects there.

### Styling

- `src/globals.css` imports Tailwind and declares its `@source` scanning.
- PostCSS config is `.postcssrc.json`. Keep that name: Vite does not look for
  `postcss.config.json`, and a missing config makes Tailwind emit no utilities.
- Plain Tailwind utilities — there is no shared theme package.

### TypeScript

- `tsconfig.json` sets `"types": ["vite/client"]`. This is load-bearing:
  without it, TypeScript 7 rejects `import "./globals.css"` with TS2882.

### Vite Notes

- `~/*` maps to `src/*` (tsconfig `paths`, read by Vite and Vitest through
  `resolve.tsconfigPaths`). Use it instead of `../`, which oxlint bans.
- The production bundle is over 1 MB because of `three`; Vite prints a chunk
  size warning. It is a warning, not a failure.

### Deploy

- Cloudflare static assets: `wrangler.jsonc` serves `dist/`; `public/_headers`
  sets the CSP and cache headers. Deploys are connected in the Cloudflare
  dashboard, not CI (settings in `README.md`).
- `compatibility_date` cannot be newer than the pinned workerd's date
  (`1.YYYYMMDD.x`); bump the two together.

---

## Footguns / Gotchas

1. **`build` does not typecheck** - Vite strips types without checking them. Run
   `pnpm --filter web typecheck` (CI runs it as its own job).
2. **Tailwind scanning** - `@source` in `src/globals.css` covers `src/` only; add an entry
   for any class-bearing files outside it.
3. **CSP is production-only** - `public/_headers` allows only `'self'` plus
   Cloudflare Web Analytics. Anything from another origin works under `vite dev`
   and breaks once deployed, until `_headers` allows it. Textures are drawn on a
   canvas, so nothing is fetched.
4. **Pointer lock needs a user gesture** - the browser refuses `requestPointerLock`
   outside a click, and briefly after an Esc release. Clicking again works.
