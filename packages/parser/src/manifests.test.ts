import { describe, expect, it } from "vitest";

import { isManifest, packagesOf, splitFiles } from "./manifests";

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const manifest = (path: string, value: unknown) => ({
  path,
  source: json(value),
});

describe("isManifest and splitFiles", () => {
  it("knows package.json and tsconfig files, nothing else", () => {
    expect(isManifest("package.json")).toBe(true);
    expect(isManifest("packages/a/package.json")).toBe(true);
    expect(isManifest("apps/web/tsconfig.json")).toBe(true);
    expect(isManifest("tsconfig.build.json")).toBe(true);
    expect(isManifest("src/package.json.ts")).toBe(false);
    expect(isManifest("src/tsconfig.ts")).toBe(false);
    expect(isManifest("data.json")).toBe(false);
  });

  it("keeps the order of each half", () => {
    const files = [
      { path: "b.ts", source: "" },
      { path: "package.json", source: "{}" },
      { path: "a.ts", source: "" },
      { path: "tsconfig.json", source: "{}" },
    ];
    const { manifests, sources } = splitFiles(files);
    expect(manifests.map((file) => file.path)).toEqual([
      "package.json",
      "tsconfig.json",
    ]);
    expect(sources.map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("packagesOf", () => {
  it("reads this repository's shapes, by dir", () => {
    const packages = packagesOf([
      manifest("packages/code-graph/package.json", {
        name: "@repo/code-graph",
        exports: { ".": "./src/code-graph.ts", "./ids": "./src/ids.ts" },
        dependencies: { "@repo/types": "workspace:*" },
        devDependencies: { typescript: "catalog:", vitest: "catalog:" },
      }),
      manifest("package.json", { name: "root", private: true }),
      manifest("packages/types/package.json", {
        name: "@repo/types",
        exports: { ".": "./src/types.ts" },
      }),
      manifest("tooling/typescript/package.json", {
        name: "@repo/typescript",
        files: ["*.json"],
      }),
    ]);
    expect(packages.map((pkg) => [pkg.id, pkg.dir])).toEqual([
      ["root", ""],
      ["@repo/code-graph", "packages/code-graph"],
      ["@repo/types", "packages/types"],
      ["@repo/typescript", "tooling/typescript"],
    ]);
    expect(packages[1]).toEqual({
      id: "@repo/code-graph",
      name: "@repo/code-graph",
      dir: "packages/code-graph",
      exports: [
        { subpath: ".", targets: ["packages/code-graph/src/code-graph.ts"] },
        { subpath: "./ids", targets: ["packages/code-graph/src/ids.ts"] },
      ],
      paths: [],
      deps: ["@repo/types"],
    });
    expect(packages[3]?.exports).toEqual([
      { subpath: ".", targets: ["tooling/typescript/index"] },
      { subpath: "./*", targets: ["tooling/typescript/*"] },
    ]);
  });

  it("falls back to module, then main, without exports", () => {
    const [pkg] = packagesOf([
      manifest("lib/package.json", {
        name: "lib",
        main: "./dist/index.js",
        module: "./src/index.ts",
      }),
    ]);
    expect(pkg?.exports).toEqual([
      {
        subpath: ".",
        targets: ["lib/src/index.ts", "lib/dist/index.js", "lib/index"],
      },
      { subpath: "./*", targets: ["lib/*"] },
    ]);
  });

  it("flattens conditions in priority order, nested and in arrays", () => {
    const [pkg] = packagesOf([
      manifest("lib/package.json", {
        name: "lib",
        exports: {
          ".": {
            types: "./src/index.ts",
            require: "./dist/index.cjs",
            node: { import: "./dist/node.js", default: "./dist/node.cjs" },
            import: "./dist/index.js",
          },
          "./a": ["./src/a.ts", { default: "./dist/a.js" }],
          "./b": { import: null, default: "./src/b.ts" },
          "./*": "./src/*.ts",
          "./internal": null,
          "./outside": "../elsewhere.ts",
        },
      }),
    ]);
    expect(pkg?.exports).toEqual([
      {
        subpath: ".",
        targets: [
          "lib/dist/index.js",
          "lib/dist/index.cjs",
          "lib/src/index.ts",
          "lib/dist/node.js",
          "lib/dist/node.cjs",
        ],
      },
      { subpath: "./a", targets: ["lib/src/a.ts", "lib/dist/a.js"] },
      { subpath: "./b", targets: ["lib/src/b.ts"] },
      { subpath: "./*", targets: ["lib/src/*.ts"] },
      { subpath: "./internal", targets: [] },
      { subpath: "./outside", targets: [] },
    ]);
  });

  it("reads a string or a conditions object as the root export", () => {
    const [plain, conditional] = packagesOf([
      manifest("a/package.json", { name: "a", exports: "./main.ts" }),
      manifest("b/package.json", {
        name: "b",
        exports: { import: "./main.ts" },
      }),
    ]);
    expect(plain?.exports).toEqual([{ subpath: ".", targets: ["a/main.ts"] }]);
    expect(conditional?.exports).toEqual([
      { subpath: ".", targets: ["b/main.ts"] },
    ]);
  });

  it("ignores a manifest without a name and suffixes a repeated one", () => {
    const packages = packagesOf([
      manifest("a/package.json", { private: true }),
      manifest("b/package.json", { name: "" }),
      manifest("c/package.json", { name: "dup" }),
      manifest("d/package.json", { name: "dup" }),
      manifest("e/package.json", {
        name: "user",
        dependencies: { dup: "1.0.0" },
      }),
    ]);
    expect(packages.map((pkg) => pkg.id)).toEqual(["dup", "dup~2", "user"]);
    expect(packages[2]?.deps).toEqual(["dup"]);
  });

  it("never gives a generated suffix to a package literally named so", () => {
    const packages = packagesOf([
      manifest("a/package.json", { name: "a" }),
      manifest("b/package.json", { name: "a" }),
      manifest("c/package.json", { name: "a~2" }),
    ]);
    expect(packages.map((pkg) => pkg.id)).toEqual(["a", "a~2", "a~2~2"]);
  });

  it("reads paths from the JSONC tsconfig beside the manifest", () => {
    const packages = packagesOf([
      manifest("apps/web/package.json", { name: "web" }),
      {
        path: "apps/web/tsconfig.json",
        source: [
          "{",
          '  "extends": "@repo/typescript/react.json",',
          "  // `~/` is the only way up the tree",
          '  "compilerOptions": { "paths": { "~/*": ["./src/*"], }, },',
          "}",
        ].join("\n"),
      },
      manifest("apps/api/package.json", { name: "api" }),
      manifest("apps/api/tsconfig.json", {
        compilerOptions: { baseUrl: "./src", paths: { "@/*": ["lib/*"] } },
      }),
      manifest("apps/api/tsconfig.build.json", {
        compilerOptions: { paths: { "x/*": ["./ignored/*"] } },
      }),
      manifest("orphan/tsconfig.json", {
        compilerOptions: { paths: { "o/*": ["./o/*"] } },
      }),
    ]);
    expect(packages.map((pkg) => [pkg.id, pkg.paths])).toEqual([
      ["api", [{ pattern: "@/*", targets: ["apps/api/src/lib/*"] }]],
      ["web", [{ pattern: "~/*", targets: ["apps/web/src/*"] }]],
    ]);
  });

  it("links workspace dependencies and same-named ones, never itself", () => {
    const packages = packagesOf([
      manifest("a/package.json", {
        name: "a",
        dependencies: { b: "workspace:^", lodash: "4.0.0", a: "workspace:*" },
        peerDependencies: { c: "^1.0.0" },
        devDependencies: { b: "workspace:*", missing: "workspace:*" },
      }),
      manifest("b/package.json", { name: "b" }),
      manifest("c/package.json", { name: "c" }),
    ]);
    expect(packages[0]?.deps).toEqual(["b", "c"]);
  });

  it("names the file of a broken manifest", () => {
    expect(() =>
      packagesOf([{ path: "a/package.json", source: "{ nope" }])
    ).toThrow(/^a\/package\.json: /);
  });
});
