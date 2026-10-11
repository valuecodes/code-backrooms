// Which package a file belongs to. Ownership is never stored on a module: it
// is the package whose directory encloses the file most closely, so the
// manifests stay the one source of truth.

import type { PackageNode } from "./code-graph";

/** Whether `path` lies inside `dir` (`""` is the repository root). */
const isInside = (dir: string, path: string): boolean =>
  dir === "" || path.startsWith(`${dir}/`);

/**
 * The package with the longest directory enclosing `moduleId`, or null when
 * none does. `packages/a` never owns `packages/ab/x.ts`.
 */
const owningPackage = (
  packages: readonly PackageNode[],
  moduleId: string
): PackageNode | null => {
  let owner: PackageNode | null = null;
  for (const pkg of packages) {
    if (
      isInside(pkg.dir, moduleId) &&
      (owner === null || pkg.dir.length > owner.dir.length)
    ) {
      owner = pkg;
    }
  }
  return owner;
};

/** `path` as seen from the package's directory: `packages/x/src/a.ts` → `src/a.ts`. */
const relativeToPackage = (pkg: PackageNode, path: string): string =>
  pkg.dir !== "" && path.startsWith(`${pkg.dir}/`)
    ? path.slice(pkg.dir.length + 1)
    : path;

export { owningPackage, relativeToPackage };
