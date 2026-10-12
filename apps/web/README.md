# Code Backrooms (web)

The web app: a first-person, Backrooms-style 3D world generated from a
JavaScript or TypeScript codebase. Parsing, generation and rendering live in
`packages/`; this app loads the code, runs the HUD and wires them together.
See `AGENTS.md` for the source layout and how each feature works.

## Stack

- Vite 8 + React 19
- three.js via React Three Fiber and drei
- Tailwind CSS 4 (HUD only)
- Vitest for unit tests

## Controls

Click the scene to lock the mouse. WASD or arrow keys move, the mouse looks,
Shift sprints, Esc releases the mouse. E shows the current room's source, Tab
the whole world's map and M the rooms walked so far. Backspace returns to
where the current function was entered, and R to the entrance.

## Loading a repository

A bare URL opens the landing page. Drop or pick a `.zip` (GitHub's
"Download ZIP" works as is) or pick a folder. Files are read in the browser
tab and never uploaded. Only JavaScript and TypeScript sources and manifests
are kept, and dependency, build and test directories are skipped.

| Limit               | Value  |
| ------------------- | ------ |
| Zip size            | 64 MB  |
| Kept source files   | 400    |
| Kept bytes in total | 8 MB   |
| One file            | 256 KB |

A file over the per-file limit is skipped, and a file that does not parse is
left out. The HUD names both. Parsing runs in a worker. Demo opens
`?code=self`, and `?code=demo`, `loops`, `switches` or `repo` open bundled
examples.

Add `&view=map` to a world's URL (for example `/?code=repo&view=map`) for the
whole world as a 2D map instead: it loads no WebGL, generates every area one
at a time and marks its `<svg>` `data-state="done"` once all are generated, for
headless screenshots. When no world can be generated at all (a parse error),
the error is shown with `data-state="failed"` instead, so wait for
`[data-state="done"], [data-state="failed"]`. On the map the wheel zooms, a
drag pans and a double-click shows the whole world again; Download SVG always
saves the whole world.

`?code=self` turns this repository itself into the world: its workspace
packages become zones. Its sources and manifests are bundled into a chunk of
their own (`src/self-files.ts`) that only `?code=self` fetches. Under the dev
server, editing an included source or manifest file rebuilds that chunk and
changes the source seed, so the reloaded world differs unless the URL names a
`?seed`. Not every seed lays out every module yet; an area that cannot be laid
out is shown as failed.

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
at startup (`packages/renderer/src/textures.ts`), so there are no image assets.

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
