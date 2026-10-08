# AGENTS.md

Guidelines for AI agents and contributors working in this Turborepo monorepo.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

### Apps (`apps/`)

| Name | Filter | Description                                                                                      |
| ---- | ------ | ------------------------------------------------------------------------------------------------ |
| web  | `web`  | Code Backrooms: Vite 8 + React 19 + React Three Fiber first-person app, deployable to Cloudflare |

### Packages (`packages/`)

| Name            | Filter                  | Description                                                                   |
| --------------- | ----------------------- | ----------------------------------------------------------------------------- |
| logger          | `@repo/logger`          | pino logger emitting Cloud Logging shaped JSON                                |
| types           | `@repo/types`           | Shared world types: graph, layout and built geometry, no three.js             |
| world-generator | `@repo/world-generator` | Graph → layout → walls, doors, corridors and colliders, seeded and three-free |
| renderer        | `@repo/renderer`        | React Three Fiber components, player and lights for a built world             |

### Tooling (`tooling/`)

| Name       | Filter             | Description                                                      |
| ---------- | ------------------ | ---------------------------------------------------------------- |
| prettier   | `@repo/prettier`   | Shared Prettier config                                           |
| typescript | `@repo/typescript` | Shared tsconfig presets (`base.json`, `node.json`, `react.json`) |
| github     | `@repo/github`     | GitHub Actions composite setup action, gitleaks `secrets-scan`   |

Apps may import packages; packages must never import apps. oxlint bans `../`
imports and deep `@repo/*/src` imports: import other workspaces by package name,
and inside an app use the `~/` alias (`src/*`) to go up the tree.

---

## Commands

**Prerequisites:** Node.js 24.21.0 (`.nvmrc`), pnpm 12.4.2 (`packageManager` in root `package.json`).

```bash
pnpm install                     # Install all dependencies
pnpm --filter web dev     # Vite dev server (port 3000)

pnpm lint                        # oxlint, one process over the whole repo
pnpm knip                        # unused files, exports and dependencies
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test
pnpm build                       # turbo run build
pnpm format                      # prettier --write .
pnpm format:check                # prettier --check . (no writes)
pnpm secrets:scan                # gitleaks over the full git history
pnpm clean                       # turbo run clean
pnpm gen:package                 # scaffold a new package in packages/
```

`lint` and `knip` do not go through Turbo — each is a single process over the whole
repo. oxlint is configured by the root `.oxlintrc.json` (including `import/no-cycle`)
and prints nothing when there are no findings, so silent output means clean. Knip is
configured by the root `knip.jsonc` and exits 0 when clean.

Create new packages with the generator rather than by copying one:
`pnpm gen:package --args <name> "<one-line description>"` (non-interactive), then
`pnpm install`. It writes `packages/<name>` as `@repo/<name>` with the shared tsconfig,
prettier and vitest setup, exposes `src/<name>.ts` directly through `exports` (no
barrel `index.ts`) and adds the row to the Packages table above. Templates live in
`turbo/generators/templates/package/`. The script runs the lockfile-pinned
`@turbo/gen` binary (`gen run`) rather than `turbo gen`, which downloads `@turbo/gen`
with `pnpm dlx`, outside the lockfile and the supply-chain checks.

There is no post-edit formatting hook: run `pnpm format` yourself before committing.

`secrets:scan` runs gitleaks (`tooling/github/scripts/secrets-scan.sh`, version pinned
there) using a local `gitleaks` v8.19+ if one is on PATH, otherwise the pinned Docker image.
It exits 0 when clean and 1 when it finds a leak.

CI (`.github/workflows/`) runs typecheck, lint, knip, format-check, test, build,
secrets-scan and CodeQL code scanning (`javascript-typescript` and `actions`) on push
to `main` and on PRs.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets, credentials, or `.env` files. All code must be public-safe.
- Add dependencies to the correct workspace with `pnpm --filter <package> add <dep>`.
  Versions shared by more than one package go in the `catalog:` block of
  `pnpm-workspace.yaml`; single-consumer deps are pinned inline.
- Every install enforces the supply-chain settings in `pnpm-workspace.yaml`
  (`minimumReleaseAge`, `trustPolicy: no-downgrade`) plus pnpm 12's default
  `blockExoticSubdeps`. When one fails, investigate: never disable it, and never
  exclude a whole package to get past it.
