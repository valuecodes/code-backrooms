# AGENTS.md - apps/web

This directory inherits `/AGENTS.md`. This file lists only additions and overrides specific to the web app.

---

## What This Workspace Is

- Code Backrooms: a first-person, Backrooms-style 3D space generated from a
  JavaScript or TypeScript codebase: modules become areas, functions columns
  of rooms, branches forks, loops rings and calls doors or portals. The
  milestones below record how it got there.
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
- Milestone 14: cross-file calls. An example may hold several
  files (`?code=repo`, a seven-file repository); the parser links calls
  through relative imports, barrels and re-exports, so a call into another
  file is a portal into that file's function and Backspace returns across
  files. A call into a package stays a marker that names it
  (`closed · format(…) package "node:util"`). Modules are sorted by path.
- Milestone 15: module areas. Every file is laid out on its own,
  as an area 32 m from the next (out of sight past the fog), and areas are
  joined by portals only: a call portal into another file's function, and a
  green module portal on a hub to every file it imports or re-exports from
  (`→ src/server.ts`), which empties the breadcrumb like walking into a hub.
  The HUD counts the modules. Areas are still built all at once and merged
  for the renderer; generating them on approach comes later.
- Milestone 16: repository entrance. Every code world starts in
  an entrance hall named after the repository's directory (`src`), facing
  a module portal to its first entry module: every file nobody imports,
  ranked by name (`index`, `main`, `server`, `app`, `cli`), unused exports
  and depth, plus one way into any import cycle nothing else reaches, so
  every file can be walked to. `repo` has one, `→ src/index.ts`; a
  single-file example has its file. R returns to the entrance; the source
  panel shows nothing there.
- Milestone 17: class lobbies. The methods of a top-level class
  that hang off the hub open off a lobby of their own instead (`class
UserService`), one door of the module hub; methods reached by a call door
  keep it. The HUD reads `service.ts · class UserService` and the source
  panel shows the whole class.
- Milestone 18: lazy areas. A code world generates its entrance
  only; a module's area is generated when the player faces a portal into
  it (or steps into one first), placed after the areas so far, so nothing
  already there moves, and the player, the breadcrumb and the map carry on.
  A portal into a file not generated yet is dark until it is; one whose
  file could not be laid out stays dark and reads `closed · <file> could
not be laid out`. The HUD reads `2/7 modules · last 14 ms` on the way;
  `?eager=1` generates every module up front, as before.
- Milestone 19: per-area rendering, which completes Phase 4
  (multi-file repositories). The scene draws each area on its own, so an
  area that joins mounts alone and nothing already on screen is rebuilt;
  the player collides with, stands in and steps through only the area
  they are in, and the map draws that area. Only the navigator still
  sees every area as one world, to land portals across them.
- The world map. Tab while walking draws the whole world over the
  scene, north up and scaled to fit: each package's zone as a named band
  with its modules generated so far, every generated area with its rooms,
  every area not generated yet as a dashed ghost on a shelf above its zone
  (failed ones red, the error on hover), the module and call links between
  areas, and the player's marker. M keeps the local map; clicks on the
  world map do not lock the mouse. Once the mouse is free (Esc), the wheel
  zooms about the cursor, a drag pans and a double-click goes back to the
  whole world, on `?view=map` too; wider than 600 m the map hides rooms and
  area labels and draws zone names larger, each within its band.
- Milestone 20: repository loading (Phase 7). A bare URL opens a
  landing page: drop or pick a `.zip` (GitHub's "Download ZIP" works as
  is), pick a folder, or follow Demo (`?code=self`, this repository's own
  sources) or a bundled example. Files are read in the tab and never leave
  it, and a reload returns to the landing page. `source-filter.ts` keeps
  sources (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`) and manifests
  (`package.json`, `tsconfig*.json`) and drops dot-directories,
  `node_modules dist build out coverage generated vendor __tests__ …`,
  tests, specs, declarations and minified files. It strips a shared
  top-level folder. Files over 256 KB are skipped and counted. More than 400
  kept files, 8 MB kept or a 64 MB zip is refused with a message on the
  landing page. A repository the user brought parses tolerantly: files that
  do not parse are left out and named in the HUD, while bundled examples
  stay strict. Parsing runs in a worker (`analyse.worker.ts`). A world from
  local files never writes `?seed=`, since no URL can name those files. The
  filter keeps a superset of the `?code=self` glob (config modules such as
  `vite.config.ts`), so a zip of this repository has a few more modules
  than Demo. A public GitHub repository loads by URL (Milestone 22).
- Milestone 21: a moving landing page. Behind the panel the
  bundled `demo` example's entrance is drawn with a camera that drifts
  toward its first doorway and back while its gaze sways
  (`landing-backdrop.tsx`, `driftPose` in `backdrop.ts`). It is skipped
  without WebGL2 (it runs under `prefers-reduced-motion` too), swallowed by an error
  boundary if the canvas fails, and dropped as soon as a read starts. The
  world view (`world-app.tsx`) and the backdrop are lazy chunks, so the
  landing page paints before three.js loads.
- Milestone 22 (current): a public GitHub repository by URL. The landing
  page takes `github.com/owner/repo`, `owner/repo` or a
  `/tree/<ref>/<folder>` URL (`github-url.ts`; refs with `/` are not
  supported). One load is one request to GitHub: the page calls this site's
  Worker (`worker.ts`, `GET /api/github/zip`), which fetches the repository's
  zip from codeload.github.com, since codeload sends no CORS headers, and
  streams it back. The page then reads it with `filesFromZip`, keeping only
  the folder's files when one is named. The Worker builds the codeload URL
  from checked names and is not an open proxy. Before it fetches, the
  visitor must pass a Cloudflare Turnstile check (`turnstile.tsx`, loaded
  only once a URL is typed). Each IP is rate-limited to 5 loads a minute.
  Answers are edge-cached for 10 minutes, and zips over 64 MB are refused or
  cut off. A loaded repository writes `?repo=` so a reload or a shared link
  fills the field in again. The visitor still presses open, because each
  Turnstile token is single-use. Without a site key at build time the field
  is hidden, so production never falls back to the test key.

---

## Workspace Commands

| Task       | Command                        |
| ---------- | ------------------------------ |
| Task       | Command                        |
| ---------- | ------------------------------ |
| Dev        | `pnpm --filter web dev`        |
| Dev Worker | `pnpm --filter web dev:worker` |
| Build      | `pnpm --filter web build`      |
| Preview    | `pnpm --filter web preview`    |
| Typecheck  | `pnpm --filter web typecheck`  |
| Test       | `pnpm --filter web test`       |
| Clean      | `pnpm --filter web clean`      |
| Deploy     | `pnpm --filter web deploy`     |

Or run repo-wide via root `pnpm typecheck` / `pnpm test` / `pnpm build`.

### GitHub loading in development

- `dev` alone serves everything except `/api/*`. To load from GitHub, also run
  `dev:worker` (`wrangler dev` on port 8787), which Vite proxies `/api` to.
- Dev builds use Turnstile's public always-pass test site key. `wrangler dev`
  needs the matching test secret in `apps/web/.dev.vars`, which is gitignored:
  `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`.

### Deploying (Cloudflare Workers Builds, repository connected in the dashboard)

- **Build settings:** set the root directory to the repository root. The build
  command is `pnpm --filter web build`, and the deploy command is
  `pnpm --filter web exec wrangler deploy`.
- **Build variables:** `PNPM_VERSION=12.4.2` and `NODE_VERSION=24.21.0`, since the
  build image's pnpm default is older. Also set `VITE_TURNSTILE_SITE_KEY` to the
  widget's site key. Vite inlines it at build time, so it is a _build_ variable.
- **Runtime secret:** `TURNSTILE_SECRET` under the Worker's Variables and Secrets.
  `wrangler.jsonc` declares no value for it, so deploys keep it.
- **Turnstile widget:** create it in the Cloudflare dashboard. Its hostnames must
  include the production domain, plus the `workers.dev` domain if preview builds
  are on. A preview without its hostname refuses GitHub loads and everything else
  still works.
- **Committed values:** the site key, the rate-limit `namespace_id` and the Worker
  code are public by design. The secret never goes in the repository.

There are no per-workspace `lint` or `format` scripts: root `pnpm lint` (oxlint) and
`pnpm format` (Prettier) each cover the whole repo.

---

## Layout

```text
src/
  main.tsx            mounts <App/>
  app.tsx             landing page, loading screen, or the world as a lazy chunk
  world-app.tsx       the world: full-screen <Canvas>, seed and current-room
                      state, pointer lock, HUD
  landing.tsx         the bare URL's page: zip drop and pickers, GitHub URL, Demo, examples
  github-url.ts       a GitHub URL -> owner, repo, ref, folder; checks shared with the Worker, pure
  github-files.ts     a GitHub repository -> sources: one call to the Worker, then zip-files
  github-form.tsx     the landing page's GitHub URL field, check and open button, markup only
  turnstile.tsx       the Turnstile check before a GitHub load, script loaded on demand
  worker.ts           the Cloudflare Worker: /api/github/zip, else the static assets
  landing-backdrop.tsx  the demo world drifting behind the landing page, lazy
  backdrop.ts         when the backdrop runs and where its camera is, pure
  backdrop-world.ts   the demo world for the backdrop, every area built
  local-reads.ts      one read at a time, zip and folder labels, read errors, pure
  source-request.ts   what to build: nothing, a URL example, or local files, pure
  source-filter.ts    which zip or folder entries become sources, and the caps, pure
  zip-files.ts        a zip -> sources (fflate's sync API, two passes)
  folder-files.ts     a folder pick -> sources, reading only the kept files
  use-source-files.ts a request's files: bundled at once, `self` as its own chunk
  world-setup.ts      a request -> everything a page needs to generate its world
  analyse.ts          files -> parsed code, area links and seed, cloneable, pure
  analyse-client.ts   starts and cancels the analysis worker, pure of React
  analyse.worker.ts   parses a repository the user brought off the main thread
  world-loading.tsx   "loading demo…" / "analysing my-repo…"
  hud.tsx             "Click to start walking" overlay / crosshair, seed + place readout,
                      breadcrumb and the prompt for the door or portal ahead
  source-panel.tsx    the E overlay: the current room's code, its own lines marked
  source-view.ts      room id -> the lines the source panel shows, pure
  overview-map.tsx    the M overlay: an SVG map of the rooms walked so far
  map-model.ts        visited rooms -> the rooms, doors and portals the map draws, pure
  map-keys.ts         which map M, Tab and Esc open or close, pure
  world-map-overlay.tsx  the Tab overlay: the whole world, the player's marker on it
  world-map.tsx       the whole-world SVG: zone bands, areas, ghosts, links, player
  world-map-model.ts  areas, ghosts, zone bands and links the world map draws, pure
  view-box.ts         the world map's view: fit, wheel zoom, pan, level of detail, pure
  use-view-box.ts     wheel, drag and double-click on the world map's svg -> its view
  pose-feed.ts        the player's position from the render loop to the map, no app render
  params.ts           URL query -> { seed, rooms, preset, code }, with clamping
  examples.ts         bundled example programs for ?code=<name>
  use-navigation.ts   the exploration stack as React state, fed by the Player
  world-from-code.ts  source -> CodeGraph -> WorldGraph -> world, plus the HUD's words
```

### Query parameters

- None of `seed rooms graph code eager view` (a bare URL) shows the landing
  page; any of them, valid or not, opens a world directly as before.
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
M shows or hides the overview map; Tab shows the world map, and Tab or (once
the mouse is released) Esc closes it.

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
  of each column. Each file is an area of its own (`./module-areas`), joined
  to the others by call and module portals. `./subjects` maps room and
  portal ids back to the code.
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
regenerates while the player moves. A code world's areas are merged into one
`GeneratedWorld` (`mergeAreas`) for the renderer, the navigator and the map.

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
5. **No fflate async API** - `unzip` and friends spawn blob-URL workers, which
   `script-src 'self'` blocks once deployed. Use `unzipSync` only: it takes
   about 25 ms for an archive at the 8 MB cap.
6. **Parsing is slow, so it runs in a worker** - measured in Node 24
   (Chrome's V8): this repository (159 files, 0.7 MB) parses in 0.5 s, 300
   dense files (3.7 MB) in 3.6 s and 390 (4.9 MB) in 6.2 s. Local requests
   therefore go through `analyse.worker.ts`, a same-origin module chunk that
   the CSP allows through `script-src 'self'` (there is no `worker-src`).
   Bundled examples, `self` included, still parse on the main thread.
