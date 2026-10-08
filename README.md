# Agentic Monorepo Starter

A Turborepo template for agentic development: strict repo guardrails, consistent tooling,
and clear package boundaries — so agents move fast without turning the codebase into spaghetti.

## What's inside

- Code Backrooms web app in `apps/web` (Vite 8, React 19, React Three Fiber, Tailwind CSS 4)
- Shared tooling: oxlint, Knip, Prettier, TypeScript 7, Turbo
- `@repo/parser`, `@repo/code-graph`, `@repo/types`, `@repo/world-generator`,
  `@repo/renderer` — the Code Backrooms pipeline (code → graph → layout → rendering)
- `@repo/logger` — structured JSON logging for Cloud Run / Cloud Logging
- pnpm catalog for versions, with supply-chain guards: a 14-day release-age wait,
  a trust-downgrade check, and no git/tarball subdependencies
- Claude Code settings in `.claude/`

```text
apps/web               Code Backrooms: Vite 8 + React 19 + React Three Fiber
packages/parser        TypeScript/JavaScript source -> CodeGraph (@babel/parser)
packages/code-graph    CodeGraph types and the CodeGraph -> WorldGraph grammar
packages/types         world data shapes: graph, layout, built geometry
packages/world-generator  graph -> layout -> walls, doors, corridors, colliders (seeded)
packages/renderer      React Three Fiber components, player, light pool
packages/logger        pino logger, Cloud Logging shaped JSON
tooling/prettier       shared Prettier config
tooling/typescript     shared tsconfig presets (base, node, react)
tooling/github         composite action: pnpm + Node + install; secrets-scan script
.oxlintrc.json         single root lint config for the whole repo
```

## Getting started

Requires Node.js 24.21.0 (`.nvmrc`) and pnpm 12.4.2 (`packageManager` in `package.json`).

```bash
pnpm install
pnpm dev          # web app at http://localhost:3000
```

## Commands

```bash
pnpm lint           # type-aware linting, whole repo in one oxlint process
pnpm knip           # unused files, exports and dependencies
pnpm typecheck      # TypeScript 7 (tsc) across the repo
pnpm test           # test suite
pnpm build          # production builds
pnpm format         # Prettier write
pnpm format:check   # Prettier check (CI gate)
pnpm secrets:scan   # gitleaks secret scan over git history
pnpm gen:package    # scaffold a new package in packages/ (@turbo/gen)
```

oxlint prints nothing when there are no findings, so silent output means clean.

CI runs typecheck, lint, knip, format-check, test, build and a gitleaks secret scan on
push to `main` and on PRs, plus CodeQL code scanning. `secrets:scan` needs either
`gitleaks` v8.19+ on PATH or a running Docker daemon.

## Use this template

Use GitHub's **Use this template** button, then:

- Optionally rename the `@repo/*` scope to your own (e.g. `@acme/*`)
- Update `name` and `description` in `package.json`
- Verify everything is green: `pnpm lint && pnpm knip && pnpm typecheck && pnpm test && pnpm build`
- CodeQL (the `codeql` CI job) is free on public repos; private repos need GitHub Code
  Security. If "default setup" is enabled under Settings → Code security, turn it off —
  GitHub rejects the workflow's uploads while it is on.
- Under Settings → Code security, turn on **Dependabot alerts** and leave **Dependabot
  security updates** off: you get notified about vulnerable dependencies without
  automatic PRs. There is deliberately no `.github/dependabot.yml`, so no version-update
  PRs either.
