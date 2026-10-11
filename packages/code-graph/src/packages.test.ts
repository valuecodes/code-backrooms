import { describe, expect, it } from "vitest";

import type { PackageNode } from "./code-graph";
import { owningPackage, relativeToPackage } from "./packages";

const pkg = (id: string, dir: string): PackageNode => ({
  id,
  name: id,
  dir,
  exports: [],
  paths: [],
  deps: [],
});

const root = pkg("root", "");
const a = pkg("a", "packages/a");
const ab = pkg("ab", "packages/ab");
const nested = pkg("nested", "packages/a/examples");

describe("owningPackage", () => {
  it("picks the nearest enclosing dir", () => {
    const packages = [root, a, ab, nested];
    expect(owningPackage(packages, "packages/a/src/x.ts")).toBe(a);
    expect(owningPackage(packages, "packages/ab/src/x.ts")).toBe(ab);
    expect(owningPackage(packages, "packages/a/examples/x.ts")).toBe(nested);
    expect(owningPackage(packages, "scripts/x.ts")).toBe(root);
  });

  it("is null when no package encloses the module", () => {
    expect(owningPackage([a, ab], "packages/abc/x.ts")).toBeNull();
    expect(owningPackage([a], "packages/a")).toBeNull();
    expect(owningPackage([], "x.ts")).toBeNull();
  });
});

describe("relativeToPackage", () => {
  it("strips the package dir", () => {
    expect(relativeToPackage(a, "packages/a/src/x.ts")).toBe("src/x.ts");
    expect(relativeToPackage(root, "src/x.ts")).toBe("src/x.ts");
    expect(relativeToPackage(a, "packages/ab/x.ts")).toBe("packages/ab/x.ts");
  });
});
