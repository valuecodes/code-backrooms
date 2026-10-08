# AGENTS.md - apps/web

This directory inherits `/AGENTS.md`. This file lists only additions and overrides specific to the web app.

---

## What This Workspace Is

- Code Backrooms: a first-person, Backrooms-style 3D space that will eventually
  be generated from source code (functions as rooms, branches as doors, and so on).
- Vite 8 + React 19, three.js through React Three Fiber and drei, Tailwind CSS 4
  for the HUD.
- Milestone 1 (current): two hand-written rooms, a real doorway between them,
  WASD + mouse-look movement with wall collisions. No code parsing or generation yet.

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
  app.tsx             full-screen <Canvas>, pointer-lock state, HUD
  hud.tsx             "Click to start walking" overlay / crosshair
  game/
    types.ts          RoomData, DoorData, WorldData and the derived BuiltWorld types
    config.ts         dimensions, speeds and timing constants (metres, seconds)
    world-data.ts     the rooms, as data only
    geometry.ts       PURE: door openings and wall segments derived from room data
    collision.ts      PURE: square-vs-AABB movement resolution with substepping
    textures.ts       procedural canvas textures (wallpaper, carpet, ceiling tiles)
    surfaces.ts       shared materials + React context
    tiled-geometry.ts planes/boxes whose UVs repeat in world metres
    world.tsx         background, fog, ambient light, rooms
    controls.tsx      useMovementKeys (keyboard) and PointerLook (drei pointer lock)
    player.tsx        first-person movement in useFrame
    components/       room, wall, floor, ceiling, door
```

### The room model

- A room is `{ id, position, width, depth, doors }`; a door is only
  `{ wall, targetRoomId }`. Rooms that connect must share an edge (`north` is
  -Z, `south` +Z, `east` +X, `west` -X), and both must declare the door.
- `buildWorld()` derives everything else: the opening is centred on the overlap
  of the shared edge, so both sides line up with no extra data; walls become
  inset box segments with real gaps plus a lintel; the floor-level segments are
  the colliders. Invalid data (edges that do not touch, overlap narrower than
  the door, a door with no door back) throws at startup.

---

## Local Conventions (Deltas from Root)

### Pure modules stay three-free

- `geometry.ts` and `collision.ts` must not import `three`; their Vitest tests
  run in the `node` environment with no DOM or WebGL.

### Shared materials

- Materials and textures are created once in `world.tsx` and shared through
  `useSurfaces()`. Any mesh using them must set `dispose={null}`: React Three
  Fiber otherwise disposes props-assigned materials when the mesh unmounts.

### Lint

- The root `.oxlintrc.json` turns `react/no-unknown-property` off for
  `src/game/**/*.tsx` only, because React Three Fiber props are not DOM
  attributes. Keep JSX for three.js objects inside `src/game/`.

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
