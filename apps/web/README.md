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

A bare URL opens the landing page. Paste a public GitHub repository URL, such
as `github.com/owner/repo`, or `github.com/owner/repo/tree/main/src` for one
folder, and press open once the Cloudflare Turnstile check passes. This
site's Worker downloads the repository's zip from GitHub in one request, and
the page reads it in the tab. Only JavaScript and TypeScript sources and
manifests are kept, and dependency, build and test directories are skipped.

A loaded repository's address is its share link: `?repo=owner/repo` fills the
field in and opens the repository as soon as the visitor's check passes,
usually with no click. Running this locally needs `pnpm --filter web
dev:worker` beside `dev`. See `AGENTS.md` for that.

For local or private code, "walk a local folder" picks a folder instead. It is
read in the browser tab and never uploaded.

| Limit               | Value  |
| ------------------- | ------ |
| GitHub zip size     | 64 MB  |
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

The app deploys as a Cloudflare Worker named `code-backrooms` (`wrangler.jsonc`).
It serves `dist/` as static assets and runs code only for `/api/*`, the GitHub
zip route (`src/api/`). `public/_headers` (copied into `dist/` by Vite) sets the
security and cache headers.

There is no CI deploy job. To connect the repo in the Cloudflare dashboard
(Workers & Pages → Create → Import a repository):

| Setting        | Value                 |
| -------------- | --------------------- |
| Root directory | `apps/web`            |
| Build command  | `pnpm run build`      |
| Deploy command | `npx wrangler deploy` |

Also set these build variables (Settings → Build → Variables). With `apps/web`
as the root, the repository's `.nvmrc` and `packageManager` sit outside it, so the
build image is not guaranteed to pick them up, and its defaults are older:

| Variable       | Value                   |
| -------------- | ----------------------- |
| `NODE_VERSION` | the version in `.nvmrc` |
| `PNPM_VERSION` | `12.11.2`               |

Keep them in step with `.nvmrc` and the root `packageManager` field.

### Turnstile

Loading from GitHub needs a Cloudflare Turnstile widget. Create one in the
dashboard (Turnstile → Add widget) with the production domain as a hostname,
then set its two keys in two different places:

| Key                       | Where                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `VITE_TURNSTILE_SITE_KEY` | Settings → Build → Variables: Vite inlines it into the page |
| `TURNSTILE_SECRET`        | Settings → Variables and Secrets, type Secret               |

The secret must be a runtime secret, not a build variable: build variables exist
only while the site builds, and without the secret the Worker answers every
GitHub load with "loading from GitHub is not set up on this server". It can also
be set with `pnpm --filter web exec wrangler secret put TURNSTILE_SECRET`.
Without the site key the GitHub field is hidden and the folder picker is the
page's only loader. The Worker verifies each token with Turnstile's `siteverify`
before it fetches, and rate-limits each IP to 5 loads a minute.

### Web Analytics

Cloudflare Web Analytics is optional. Add the site in the dashboard (Web
Analytics → Add a site) with manual JS snippet installation, not automatic
injection, which would load a second beacon. Copy the `token` from its snippet
into the build variable `VITE_CF_BEACON_TOKEN` (Settings → Build → Variables),
and set it for production builds only so previews don't report into the site.
The token is public: the build puts the beacon `<script>` into `index.html`.
Without the variable the page has no beacon.

To deploy from your machine instead, run `pnpm --filter web exec wrangler login` once, then
`pnpm --filter web deploy`.

The Content-Security-Policy in `public/_headers` allows only this origin,
Cloudflare Web Analytics and Turnstile (`challenges.cloudflare.com` as a script
and a frame). Loading scripts, fonts, images or APIs from any other origin needs a
matching entry there, or the browser blocks it in production (the Vite dev server
does not apply `_headers`). Cloudflare's Bot Fight Mode injects an inline script
this policy blocks, so keep it off for this domain.
