import type { SourceFile } from "@repo/parser";

// This repository's own sources and manifests, for `?code=self`. Reached only
// through `import()` (`example-files`), so the eager glob below becomes one
// chunk that no other world fetches.

// `base` resolves against this file's directory: three `../` reach the repo
// root, so keys come back as `./packages/parser/src/parser.ts`. Only
// `package.json` and `tsconfig*.json` are manifests: any other JSON (the
// shared tsconfig presets) would be parsed as a source.
const raw: Readonly<Record<string, string>> = import.meta.glob(
  [
    "./apps/*/src/**/*.{ts,tsx}",
    "./packages/*/src/**/*.{ts,tsx}",
    "./package.json",
    "./apps/*/package.json",
    "./packages/*/package.json",
    "./apps/*/tsconfig.json",
    "./packages/*/tsconfig.json",
    "!**/*.test.*",
    "!**/*.d.ts",
    "!**/node_modules/**",
  ],
  { base: "../../../", query: "?raw", import: "default", eager: true }
);

/** Every file by repo-relative path, sorted. */
const selfFiles: readonly SourceFile[] = Object.keys(raw)
  .toSorted()
  .map((key) => ({ path: key.replace(/^\.\//, ""), source: raw[key] ?? "" }));

export { selfFiles };
