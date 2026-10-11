// Packages from the manifests among the files: every `package.json` with a
// name is one package, whatever the workspace tool (pnpm, npm and yarn
// workspaces all look alike from here), and the `tsconfig.json` beside it
// contributes its `paths` aliases. Nothing is hardcoded about this
// repository. tsconfig `extends` chains are not followed.

import type { ExportEntry, PackageNode, PathAlias } from "@repo/code-graph";
import { normalisePath } from "@repo/code-graph/ids";

import { parseJsonc } from "./jsonc";

type Manifest = {
  readonly path: string;
  readonly source: string;
};

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const TSCONFIG = /^tsconfig(?:\.[^/]+)?\.json$/;

const split = (
  path: string
): { readonly dir: string; readonly base: string } => {
  const id = normalisePath(path);
  const slash = id.lastIndexOf("/");
  return slash === -1
    ? { dir: "", base: id }
    : { dir: id.slice(0, slash), base: id.slice(slash + 1) };
};

/** `package.json`, `tsconfig.json` and `tsconfig.<x>.json`: files that are not source. */
const isManifest = (path: string): boolean => {
  const { base } = split(path);
  return base === "package.json" || TSCONFIG.test(base);
};

/** Manifests apart from sources, each in the order given. */
const splitFiles = <T extends Manifest>(
  files: readonly T[]
): { readonly manifests: readonly T[]; readonly sources: readonly T[] } => ({
  manifests: files.filter((file) => isManifest(file.path)),
  sources: files.filter((file) => !isManifest(file.path)),
});

/**
 * `target` (relative to `dir`) as a repo-relative path, or null when it is
 * not a string or climbs out of the repository, or with `inside` out of
 * `dir` (Node never lets an export leave its package; tsconfig `paths` may).
 */
const rebase = (
  dir: string,
  target: unknown,
  inside = false
): string | null => {
  if (typeof target !== "string" || target.startsWith("/")) {
    return null;
  }
  const path = normalisePath(dir === "" ? target : `${dir}/${target}`);
  if (path === ".." || path.startsWith("../")) {
    return null;
  }
  return !inside || dir === "" || path === dir || path.startsWith(`${dir}/`)
    ? path
    : null;
};

const rebaseAll = (
  dir: string,
  targets: readonly unknown[],
  inside = false
): string[] => [
  ...new Set(
    targets.flatMap((target) => {
      const path = rebase(dir, target, inside);
      return path === null ? [] : [path];
    })
  ),
];

/** Conditions tried first, in this order; any others follow in source order. */
const CONDITION_ORDER: readonly string[] = [
  "import",
  "default",
  "module",
  "require",
  "types",
];

/**
 * Every target string under an exports value, in priority order. The graph
 * links sources rather than choosing Node's runtime branch, so all branches
 * are kept as fallbacks; a `null` inside conditions is a branch skipped.
 */
const leaves = (value: unknown): readonly unknown[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(leaves);
  }
  if (!isObject(value)) {
    return [];
  }
  const keys = Object.keys(value);
  return [
    ...CONDITION_ORDER.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !CONDITION_ORDER.includes(key)),
  ].flatMap((key) => leaves(value[key]));
};

/**
 * `exports` flattened to subpaths. A string, array or conditions object is
 * the `"."` subpath; an object of `.` keys is a subpath map, where a value
 * with no targets (`null`) is kept as a blocked entry. Without `exports`,
 * `"."` is `module`, then `main`, then `index`, and `"./*"` reaches any
 * file by its path, as Node does for a package without an export map.
 */
const exportsOf = (dir: string, json: JsonObject): readonly ExportEntry[] => {
  const { exports } = json;
  if (exports === undefined || exports === null) {
    return [
      {
        subpath: ".",
        targets: rebaseAll(dir, [json.module, json.main, "./index"], true),
      },
      { subpath: "./*", targets: rebaseAll(dir, ["./*"], true) },
    ];
  }
  const keys = isObject(exports) ? Object.keys(exports) : [];
  if (!isObject(exports) || !keys.every((key) => key.startsWith("."))) {
    return [{ subpath: ".", targets: rebaseAll(dir, leaves(exports), true) }];
  }
  return keys.map((subpath) => ({
    subpath,
    targets: rebaseAll(dir, leaves(exports[subpath]), true),
  }));
};

/** tsconfig `paths`, rebased onto `baseUrl` (or the tsconfig's directory). */
const pathsOf = (dir: string, tsconfig: unknown): readonly PathAlias[] => {
  const options = isObject(tsconfig) ? tsconfig.compilerOptions : undefined;
  const paths = isObject(options) ? options.paths : undefined;
  if (!isObject(options) || !isObject(paths)) {
    return [];
  }
  const base = rebase(dir, options.baseUrl) ?? dir;
  return Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets: rebaseAll(base, Array.isArray(targets) ? targets : []),
  }));
};

const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Names the manifest depends on that are packages of the graph, as ids.
 * `workspace:` ranges always name one; a plain range counts when the name
 * matches too, so npm and yarn workspaces link the same way.
 */
const depsOf = (
  json: JsonObject,
  ownId: string,
  idOfName: ReadonlyMap<string, string>
): readonly string[] => {
  const deps = new Set<string>();
  for (const block of DEPENDENCY_BLOCKS) {
    const entries = json[block];
    for (const name of isObject(entries) ? Object.keys(entries) : []) {
      const id = idOfName.get(name);
      if (id !== undefined && id !== ownId) {
        deps.add(id);
      }
    }
  }
  return [...deps];
};

type Found = {
  readonly dir: string;
  readonly name: string;
  readonly json: JsonObject;
};

const byDir = (a: Found, b: Found): number => {
  if (a.dir === b.dir) {
    return 0;
  }
  return a.dir < b.dir ? -1 : 1;
};

/**
 * The packages the manifests describe, by `dir` in code-unit order. A
 * `package.json` without a name is not a package; a repeated name gets a
 * `~2` id, and dependencies on it point at the first by `dir`.
 */
const packagesOf = (manifests: readonly Manifest[]): readonly PackageNode[] => {
  const found: Found[] = [];
  const tsconfigs = new Map<string, unknown>();
  for (const file of manifests) {
    const { dir, base } = split(file.path);
    if (base === "tsconfig.json") {
      tsconfigs.set(dir, parseJsonc(file.path, file.source));
    } else if (base === "package.json") {
      const json = parseJsonc(file.path, file.source);
      if (isObject(json) && typeof json.name === "string" && json.name !== "") {
        found.push({ dir, name: json.name, json });
      }
    }
  }
  const sorted = found.toSorted(byDir);
  // Suffixes are checked against every id handed out, so a package that is
  // literally named `a~2` never shares an id with the second `a`.
  const used = new Set<string>();
  const ids = sorted.map((item) => {
    let id = item.name;
    for (let count = 2; used.has(id); count += 1) {
      id = `${item.name}~${count}`;
    }
    used.add(id);
    return id;
  });
  const idOfName = new Map<string, string>();
  sorted.forEach((item, index) => {
    const id = ids[index];
    if (id !== undefined && !idOfName.has(item.name)) {
      idOfName.set(item.name, id);
    }
  });
  return sorted.map((item, index): PackageNode => {
    const id = ids[index] ?? item.name;
    return {
      id,
      name: item.name,
      dir: item.dir,
      exports: exportsOf(item.dir, item.json),
      paths: pathsOf(item.dir, tsconfigs.get(item.dir)),
      deps: depsOf(item.json, id, idOfName),
    };
  });
};

export { isManifest, packagesOf, splitFiles };
