import { isManifest } from "@repo/parser";
import { describe, expect, it } from "vitest";

import { selfFiles } from "./self-files";
import { selectSources } from "./source-filter";

// The filter over this repository's own files keeps a superset of what
// `?code=self` bundles: also config modules such as `apps/web/vite.config.ts`,
// which is right for a user's repository.

// Not eager: only the keys are used, nothing is read. Keys look like
// `./apps/web/src/app.tsx`, as a zip without a root folder would list them.
const repoPaths = Object.keys(
  import.meta.glob(["./**/*", "!**/node_modules/**", "!./.git/**"], {
    base: "../../../",
  })
);

const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

describe("selectSources over this repository", () => {
  const selection = selectSources(repoPaths.map((path) => ({ path, size: 0 })));
  const kept = new Set(selection.kept.map((entry) => entry.path));

  it("loads without a fatal reason", () => {
    expect(repoPaths.length).toBeGreaterThan(selfFiles.length);
    expect(selection.fatal).toBeNull();
  });

  it("keeps every file ?code=self bundles", () => {
    expect(selfFiles.filter((file) => !kept.has(file.path))).toEqual([]);
  });

  it("keeps only sources and manifests outside dependencies and tests", () => {
    const paths = [...kept];
    expect(
      paths.filter((path) => /node_modules\/|\.test\./.test(path))
    ).toEqual([]);
    expect(
      paths.filter((path) => !SOURCE.test(path) && !isManifest(path))
    ).toEqual([]);
  });
});
