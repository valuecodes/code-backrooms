import { describe, expect, it } from "vitest";

import { selfFiles } from "./self-files";

const paths = selfFiles.map((file) => file.path);
const MANIFEST = /(^|\/)(package|tsconfig(\.[\w-]+)?)\.json$/;

describe("selfFiles", () => {
  it("bundles the repository's sources and manifests", () => {
    expect(selfFiles.length).toBeGreaterThanOrEqual(100);
    // Repo-relative keys: a wrong glob `base` would prefix or drop a level.
    expect(paths).toContain("packages/parser/src/parser.ts");
    expect(paths).toContain("apps/web/src/app.tsx");
    expect(paths).toContain("tooling/prettier/prettier.config.ts");
    expect(paths).toContain("package.json");
    expect(paths).toContain("packages/code-graph/package.json");
    expect(paths).toContain("apps/web/tsconfig.json");
  });

  it("leaves out tests, dependencies and anything the parser cannot read", () => {
    expect(paths.filter((path) => path.includes(".test."))).toEqual([]);
    expect(paths.filter((path) => path.includes("node_modules"))).toEqual([]);
    expect(
      paths.filter((path) => !MANIFEST.test(path) && !/\.tsx?$/.test(path))
    ).toEqual([]);
  });

  it("lists each file once, sorted, with its source", () => {
    expect(paths).toEqual([...new Set(paths)].toSorted());
    const parser = selfFiles.find(
      (file) => file.path === "packages/parser/src/parser.ts"
    );
    expect(parser?.source).toContain("buildCodeGraph");
  });
});
