# Code Backrooms (web)

A first-person, Backrooms-style 3D space that will eventually be generated from
source code. This milestone renders two hand-written rooms joined by a doorway,
with WASD + mouse-look movement and wall collisions. See `AGENTS.md` for the
room model and the layout of `src/game/`.

## Stack

- Vite 8 + React 19
- three.js via React Three Fiber and drei
- Tailwind CSS 4 (HUD only)
- Vitest for unit tests

## Controls

Click the scene to lock the mouse. WASD or arrow keys move, the mouse looks,
Shift sprints, Esc releases the mouse.

## Getting started

From the repo root:

```bash
pnpm install
pnpm --filter web dev
```

Open http://localhost:3000 to view the app.

## Common commands

| Task      | Command                       |
| --------- | ----------------------------- |
| Dev       | `pnpm --filter web dev`       |
| Build     | `pnpm --filter web build`     |
| Preview   | `pnpm --filter web preview`   |
| Typecheck | `pnpm --filter web typecheck` |
| Test      | `pnpm --filter web test`      |
| Clean     | `pnpm --filter web clean`     |
| Deploy    | `pnpm --filter web deploy`    |

Linting and formatting are repo-wide: run `pnpm lint` / `pnpm format` from the root.

## Styling

`src/globals.css` imports Tailwind and sets `@source` scanning. There is no shared
theme package, so use plain Tailwind utilities. Scene textures are drawn on a canvas
at startup (`src/game/textures.ts`), so there are no image assets.

## Deploy (Cloudflare)

The app deploys as static assets on a Cloudflare Worker. `wrangler.jsonc` serves
`dist/`, and `public/_headers` (copied into `dist/` by Vite) sets the security and
cache headers. `wrangler` is a pinned devDependency, so the deploy uses the lockfile
version rather than `npx`.

There is no CI deploy job. To connect the repo in the Cloudflare dashboard
(Workers & Pages → Create → Import a repository):

| Setting        | Value                       |
| -------------- | --------------------------- |
| Root directory | `apps/web`                  |
| Build command  | `pnpm build`                |
| Deploy command | `pnpm exec wrangler deploy` |

Also set these build variables (Settings → Build → Variables), so Cloudflare installs
dependencies with the repo's toolchain. The install runs before the build command,
so pinning versions there would be too late:

| Variable       | Value     |
| -------------- | --------- |
| `NODE_VERSION` | `24.21.0` |
| `PNPM_VERSION` | `12.4.2`  |

Keep them in step with `.nvmrc` and the root `packageManager` field.

To deploy from your machine instead, run `pnpm --filter web exec wrangler login` once, then
`pnpm --filter web deploy`.

The Content-Security-Policy in `public/_headers` allows only this origin plus
Cloudflare Web Analytics. Loading scripts, fonts, images or APIs from any other
origin needs a matching entry there, or the browser blocks it in production (the
Vite dev server does not apply `_headers`).
