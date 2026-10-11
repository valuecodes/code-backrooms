// Where an import specifier leads among the modules of a graph: a relative
// path, a tsconfig `paths` alias of the importer's package (`~/hud`), or a
// workspace package by name (`@repo/x`, `@repo/x/sub`) through its
// `exports`. Out of scope: `package.json#imports` (`#internal/*`), patterns
// with more than one `*`, and tsconfig `extends` chains.

import type { PackageNode } from "./code-graph";
import { candidatePaths, isRelativeSpecifier, resolveSpecifier } from "./ids";
import { owningPackage } from "./packages";

type Resolver = (fromModuleId: string, specifier: string) => string | null;

type Mapping = {
  readonly key: string;
  readonly targets: readonly string[];
};

/**
 * The targets `key` maps to: an exact key first, else the single-`*` key
 * with the longest literal prefix that matches (on a tie the longer key, as
 * Node orders patterns), its match put in place of each target's `*`. Null
 * when nothing matches; an exact key with no targets (blocked) yields `[]`,
 * so a pattern never overrides it.
 */
const match = (
  mappings: readonly Mapping[],
  key: string
): readonly string[] | null => {
  const exact = mappings.find((mapping) => mapping.key === key);
  if (exact !== undefined) {
    return exact.targets;
  }
  let best: {
    readonly prefix: string;
    readonly length: number;
    readonly targets: string[];
  } | null = null;
  for (const mapping of mappings) {
    const star = mapping.key.indexOf("*");
    if (star === -1 || mapping.key.includes("*", star + 1)) {
      continue;
    }
    const prefix = mapping.key.slice(0, star);
    const suffix = mapping.key.slice(star + 1);
    if (
      key.length < prefix.length + suffix.length ||
      !key.startsWith(prefix) ||
      !key.endsWith(suffix) ||
      (best !== null &&
        (prefix.length < best.prefix.length ||
          (prefix.length === best.prefix.length &&
            mapping.key.length <= best.length)))
    ) {
      continue;
    }
    const matched = key.slice(prefix.length, key.length - suffix.length);
    best = {
      prefix,
      length: mapping.key.length,
      targets: mapping.targets.map((target) => target.replace("*", matched)),
    };
  }
  return best?.targets ?? null;
};

/** The first module any target names, trying each target's candidate paths. */
const firstModule = (
  targets: readonly string[],
  moduleIds: ReadonlySet<string>
): string | null => {
  for (const target of targets) {
    const found = candidatePaths(target).find((id) => moduleIds.has(id));
    if (found !== undefined) {
      return found;
    }
  }
  return null;
};

/**
 * The package a bare specifier names, longest name first; when several
 * packages share a name, the first by `dir` (the one `deps` points at too).
 */
const packageNamed = (
  packages: readonly PackageNode[],
  specifier: string
): PackageNode | null => {
  let best: PackageNode | null = null;
  for (const pkg of packages) {
    if (
      (specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)) &&
      (best === null || pkg.name.length > best.name.length)
    ) {
      best = pkg;
    }
  }
  return best;
};

/**
 * A resolver over `moduleIds`. Relative specifiers resolve as they always
 * have; then the importer's package's `paths` aliases (falling through when
 * no target exists, as TypeScript does); then a workspace package by name.
 * Everything else (npm packages, `node:` builtins, missing files) is null.
 */
const createResolver = (
  moduleIds: ReadonlySet<string>,
  packages: readonly PackageNode[]
): Resolver => {
  const exportsOf = new Map(
    packages.map((pkg): [PackageNode, readonly Mapping[]] => [
      pkg,
      pkg.exports.map(({ subpath, targets }) => ({ key: subpath, targets })),
    ])
  );
  const pathsOf = new Map(
    packages.map((pkg): [PackageNode, readonly Mapping[]] => [
      pkg,
      pkg.paths.map(({ pattern, targets }) => ({ key: pattern, targets })),
    ])
  );
  return (fromModuleId, specifier) => {
    if (isRelativeSpecifier(specifier)) {
      return resolveSpecifier(fromModuleId, specifier, moduleIds);
    }
    const owner = owningPackage(packages, fromModuleId);
    const aliased =
      owner === null ? null : match(pathsOf.get(owner) ?? [], specifier);
    const viaAlias = aliased === null ? null : firstModule(aliased, moduleIds);
    if (viaAlias !== null) {
      return viaAlias;
    }
    const pkg = packageNamed(packages, specifier);
    if (pkg === null) {
      return null;
    }
    const subpath =
      specifier === pkg.name ? "." : `.${specifier.slice(pkg.name.length)}`;
    const targets = match(exportsOf.get(pkg) ?? [], subpath);
    return targets === null ? null : firstModule(targets, moduleIds);
  };
};

export { createResolver };
export type { Resolver };
