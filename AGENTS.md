# AGENTS.md

Guidelines for AI agents and contributors working in this Turborepo monorepo.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

### Apps (`apps/`)

| Name | Filter | Description                                                                                                                |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| web  | `web`  | Code Backrooms: Vite 8 + React 19 + React Three Fiber first-person app, and its Cloudflare Worker that fetches GitHub zips |

### Packages (`packages/`)

| Name            | Filter                  | Description                                                                          |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| logger          | `@repo/logger`          | pino logger emitting Cloud Logging shaped JSON                                       |
| types           | `@repo/types`           | Shared world types: graph, layout and built geometry, no three.js                    |
| world-generator | `@repo/world-generator` | Graph → layout → walls, doors, corridors and colliders, seeded and three-free        |
| renderer        | `@repo/renderer`        | React Three Fiber components, player, lights and post-processing for a built world   |
| code-graph      | `@repo/code-graph`      | Language-independent CodeGraph types and the CodeGraph to WorldGraph spatial grammar |
| parser          | `@repo/parser`          | TypeScript and JavaScript source to CodeGraph via @babel/parser, browser-safe        |
| typescript      | `@repo/typescript`      | Shared tsconfig presets (`base.json`, `node.json`, `react.json`)                     |

CI helpers are not workspaces: the composite setup action lives in
`.github/actions/setup/`.

Apps may import packages; packages must never import apps. oxlint bans `../`
imports and deep `@repo/*/src` imports: import other workspaces by package name,
and inside an app use the `~/` alias (`src/*`) to go up the tree.

---

## Commands

**Prerequisites:** Node.js 24 (exact version in `.nvmrc`), pnpm 12 (exact version in `packageManager` in root `package.json`).

```bash
pnpm install                     # Install all dependencies
pnpm --filter web dev     # Vite dev server (port 3000)

pnpm lint                        # oxlint, one process over the whole repo
pnpm knip                        # unused files, exports and dependencies
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test
pnpm build                       # turbo run build
pnpm format                      # oxfmt, writes in place
pnpm format:check                # oxfmt --check (no writes)
pnpm clean                       # turbo run clean
```

`lint` and `knip` do not go through Turbo — each is a single process over the whole
repo. oxlint is configured by the root `.oxlintrc.json` (including `import/no-cycle`)
and prints nothing when there are no findings, so silent output means clean. Knip is
configured by the root `knip.jsonc` and exits 0 when clean. Formatting is oxfmt
(Prettier-compatible), configured by the root `.oxfmtrc.jsonc`, which also sorts
imports and Tailwind classes.

To add a package, copy an existing one's `package.json`, `tsconfig.json` and
`vitest.config.ts` into `packages/<name>`, name it `@repo/<name>`, expose
`src/<name>.ts` directly through `exports` (no barrel `index.ts`), run
`pnpm install` and add its row to the Packages table above.

Nothing formats on edit, and the pre-commit hook only checks formatting: run
`pnpm format` yourself before committing.

Git hooks live in `.githooks/` and are plain shell scripts, with no hook manager.
`pnpm install` enables them through the root `prepare` script. The setting goes in
the clone's shared git config, so it covers every worktree, and a branch without
`.githooks/` simply runs no hooks. If you cloned before the hooks existed and have
not run `pnpm install` since, run `git config core.hooksPath .githooks` once. `pre-commit` runs `format:check`, `lint` and `gitleaks git --staged` with the local
gitleaks (v8.19+). The secrets scan fails closed, so the commit is refused when
gitleaks is not installed. `pre-push` runs `typecheck`, `test` and `knip`. CI still
runs every check. `format:check` and `lint` read the working tree, not the staged
snapshot, so stage everything you mean to commit.

The hook runs whatever gitleaks is installed; CI scans the full git history with the
version pinned in `secret-scan.yml` from `valuecodes/maintain-kit`, so this repo holds
no gitleaks pin.

CI checks are defined once in the reusable `.github/workflows/checks.yml`: typecheck,
lint, knip, format:check, test, build, CodeQL code scanning
(`javascript-typescript`), secret-scan and workflow-lint. `feature.yml` calls it on PRs and
`main.yml` on push to `main` (deploy jobs go there). secret-scan and workflow-lint call the
reusable workflows from `valuecodes/maintain-kit`: gitleaks over the full git history,
and actionlint (with shellcheck) and zizmor over the workflow and action files. Each tool reads `.github/actionlint.yaml` / `zizmor.yml` if
added. `all-passed` in `feature.yml` fans the checks in and is the one check to require
in branch protection. The typecheck, test and build
jobs restore Turbo's `.turbo` cache from the previous run of the same task, so
unchanged packages replay instead of rerunning.

Dependabot (`.github/dependabot.yml`) bumps the SHA-pinned actions and reusable workflows
monthly in one grouped PR; npm dependencies are updated by hand.

`maintain-kit-dashboard.yml` calls the dashboard workflow from
`valuecodes/maintain-kit` daily.
It keeps one issue, **Maintenance dashboard** (label `maintain-kit-dashboard`), listing
what is due: `catalog:` updates, pnpm (`packageManager`), Node.js (`.nvmrc`) and
`pnpm audit` findings. Like
`minimumReleaseAge`, a release shows up only once it is 14 days old; a Node.js security
release shows up right away and is flagged. It never opens PRs or commits.

`maintain-kit-updates.yml` calls the updates workflow from
`valuecodes/maintain-kit` weekly. It keeps one PR per kind open (Node.js, pnpm,
`catalog:`) on a `maintain-kit/<kind>` branch, for updates on the
current major only; majors stay manual. Those PRs are opened with `GITHUB_TOKEN`, so
their `pull_request` checks wait until someone with write access clicks **Approve
workflows to run** in the PR. It needs **Allow GitHub Actions to create and approve
pull requests** turned on under Settings → Actions → General. Nothing auto-merges.
Before merging a Node.js or pnpm update, set the Cloudflare `NODE_VERSION` or
`PNPM_VERSION` build variable of the `apps/web` deploy to the new version, so the
build of the merge commit already uses it (a newer patch or minor on the old
lockfile is harmless). The dashboard, updates, secret-scan and workflow-lint callers
pin the same `valuecodes/maintain-kit` commit, so bump them together.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets, credentials, or `.env` files. All code must be public-safe.
- Never bypass the git hooks with `--no-verify`; fix the failure instead.
- Add dependencies to the correct workspace with `pnpm --filter <package> add <dep>`.
  Every external version lives in the `catalog:` block of `pnpm-workspace.yaml`
  and manifests reference it as `catalog:`; `@repo/*` deps stay `workspace:*`.
  Update with `pnpm up --latest -r`; `updateConfig.ignoreDependencies` holds
  `@types/node` to the `.nvmrc` major, so bump it by hand.
- Every install enforces the supply-chain settings in `pnpm-workspace.yaml`
  (`minimumReleaseAge`, `trustPolicy: no-downgrade`, `engineStrict`) plus pnpm
  12's default `blockExoticSubdeps`. When one fails, investigate: never disable
  it, and never exclude a whole package to get past it.
