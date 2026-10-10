// Stable, human-readable ids. The same source always yields the same ids, so
// layouts, tests and URLs can refer to them.

import type { FlowNode } from "./code-graph";

const FUNCTION_SEPARATOR = "::";

/**
 * Forward slashes, no `.` segments or doubled separators, `x/..` collapsed:
 * `./src//a/../demo.ts` → `src/demo.ts`. A `..` with nothing left to
 * collapse stays, so a path that climbs out of the root is still visible.
 */
const normalisePath = (path: string): string => {
  const segments: string[] = [];
  const absolute = path.startsWith("/") || path.startsWith("\\");
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    const last = segments.at(-1);
    if (segment === ".." && last !== undefined && last !== "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
};

/** The normalised path doubles as the module id: "src/demo.ts". */
const moduleId = (path: string): string => normalisePath(path);

/** `./a`, `../b`, `.` and `..`: the specifiers that name a file of this repository. */
const isRelativeSpecifier = (specifier: string): boolean =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../");

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** TypeScript lets `./a.js` name `a.ts`: each JS extension and its TS twin. */
const TS_TWINS: readonly (readonly [string, string])[] = [
  [".js", ".ts"],
  [".js", ".tsx"],
  [".jsx", ".tsx"],
  [".mjs", ".mts"],
  [".cjs", ".cts"],
];

/** Where a relative specifier may point, most specific first. */
const candidatePaths = (path: string): readonly string[] => [
  path,
  ...SOURCE_EXTENSIONS.map((extension) => `${path}${extension}`),
  ...TS_TWINS.flatMap(([js, ts]) =>
    path.endsWith(js) ? [`${path.slice(0, -js.length)}${ts}`] : []
  ),
  ...SOURCE_EXTENSIONS.map((extension) => `${path}/index${extension}`),
];

/**
 * The module a specifier imports, among `moduleIds`, or null: packages
 * (`lodash`, `node:fs`, `@repo/x`), absolute paths, paths that climb out of
 * the root and files that are not in the set. Tries the exact path, then
 * each source extension, then a `.js` swapped for its TypeScript twin, then
 * `<path>/index.<ext>`; the first hit wins.
 */
const resolveSpecifier = (
  fromModuleId: string,
  specifier: string,
  moduleIds: ReadonlySet<string>
): string | null => {
  if (!isRelativeSpecifier(specifier)) {
    return null;
  }
  const slash = fromModuleId.lastIndexOf("/");
  const directory = slash === -1 ? "" : fromModuleId.slice(0, slash + 1);
  const path = normalisePath(`${directory}${specifier}`);
  if (path === "" || path === ".." || path.startsWith("../")) {
    return null;
  }
  return candidatePaths(path).find((id) => moduleIds.has(id)) ?? null;
};

const functionId = (module: string, qualifiedName: string): string =>
  `${module}${FUNCTION_SEPARATOR}${qualifiedName}`;

const callSiteId = (callerId: string, offset: number): string =>
  `${callerId}@${offset}`;

/** Module ids are paths and never contain `::`; function ids always do. */
const isFunctionId = (id: string): boolean => id.includes(FUNCTION_SEPARATOR);

/** The kinds a flow node id may carry: every FlowNode kind plus a switch case. */
type FlowIdKind = FlowNode["kind"] | "case";

const FLOW_ID_KINDS: ReadonlySet<string> = new Set<FlowIdKind>([
  "step",
  "call",
  "await",
  "return",
  "break",
  "continue",
  "branch",
  "switch",
  "loop",
  "try",
  "sequence",
  "case",
]);

/**
 * A flow node inside a function: `demo.ts::main@57:branch`,
 * `demo.ts::main@57:sequence:else`. Unlike a call-site id the tail after the
 * last `@` always carries a `:kind`, so the two never collide.
 */
const flowNodeId = (
  functionId: string,
  offset: number,
  kind: FlowIdKind,
  tag?: string
): string =>
  `${functionId}@${offset}:${kind}${tag === undefined ? "" : `:${tag}`}`;

type FlowNodeRef = {
  readonly functionId: string;
  readonly offset: number;
  readonly kind: FlowIdKind;
  readonly tag?: string;
};

const FLOW_ID_TAIL = /^(\d+):([a-z-]+)(?::([a-z]+))?$/;

/**
 * What a flow node id names, or null for anything else. Splits on the last
 * `@` (qualified names never contain one; module paths may) and demands the
 * `<offset>:<kind>` tail, so call-site, hub and portal ids all return null.
 */
const parseFlowNodeId = (id: string): FlowNodeRef | null => {
  const at = id.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  const match = FLOW_ID_TAIL.exec(id.slice(at + 1));
  const kind = match?.[2];
  if (match === null || kind === undefined || !FLOW_ID_KINDS.has(kind)) {
    return null;
  }
  const tag = match[3];
  return {
    functionId: id.slice(0, at),
    offset: Number(match[1]),
    kind: kind as FlowIdKind,
    ...(tag === undefined ? {} : { tag }),
  };
};

/**
 * The id of a room a composite adds, tagged on the composite's own id: a
 * merge, a synthesised default, a loop's test, back corridor and end.
 */
const taggedFlowNodeId = (id: string, tag: string): string => {
  const ref = parseFlowNodeId(id);
  return ref === null
    ? `${id}:${tag}`
    : flowNodeId(ref.functionId, ref.offset, ref.kind, tag);
};

const CALL_PORTAL_PREFIX = "portal:";
const RETURN_PORTAL_PREFIX = "return:";
const JUMP_PORTAL_PREFIX = "jump:";
const MARKER_PORTAL_PREFIX = "marker:";
const MODULE_PORTAL_PREFIX = "module:";

/** A call portal is named by the call site it stands for: `portal:demo.ts::main@42`. */
const callPortalId = (callSiteId: string): string =>
  `${CALL_PORTAL_PREFIX}${callSiteId}`;

/**
 * A return portal is named by the room that hosts it: a function's last
 * flow room, `return:demo.ts::main@57:return`.
 */
const returnPortalId = (roomId: string): string =>
  `${RETURN_PORTAL_PREFIX}${roomId}`;

/**
 * A jump portal is named by the `break` or `continue` room (or collapsed
 * room ending in one) that hosts it: `jump:demo.ts::main@80:continue`.
 */
const jumpPortalId = (roomId: string): string =>
  `${JUMP_PORTAL_PREFIX}${roomId}`;

/**
 * A room's one marker, standing for every call in it the world cannot
 * follow: `marker:demo.ts::main@12:step`.
 */
const markerPortalId = (roomId: string): string =>
  `${MARKER_PORTAL_PREFIX}${roomId}`;

/**
 * A module portal is named by the hub it stands on and the module it leads
 * to: `module:src/index.ts>src/server.ts`. Read back at the first `>`, so
 * a hub id with a `>` in it would not round-trip.
 */
const modulePortalId = (fromHub: string, toModule: string): string =>
  `${MODULE_PORTAL_PREFIX}${fromHub}>${toModule}`;

type PortalRef =
  | { readonly kind: "call"; readonly callSiteId: string }
  | { readonly kind: "return"; readonly roomId: string }
  | { readonly kind: "jump"; readonly roomId: string }
  | { readonly kind: "marker"; readonly roomId: string }
  | { readonly kind: "module"; readonly from: string; readonly to: string };

/** What a portal id names, or null for ids that are not portals of this grammar. */
const parsePortalId = (id: string): PortalRef | null => {
  if (id.startsWith(CALL_PORTAL_PREFIX)) {
    return { kind: "call", callSiteId: id.slice(CALL_PORTAL_PREFIX.length) };
  }
  if (id.startsWith(RETURN_PORTAL_PREFIX)) {
    return { kind: "return", roomId: id.slice(RETURN_PORTAL_PREFIX.length) };
  }
  if (id.startsWith(JUMP_PORTAL_PREFIX)) {
    return { kind: "jump", roomId: id.slice(JUMP_PORTAL_PREFIX.length) };
  }
  if (id.startsWith(MARKER_PORTAL_PREFIX)) {
    return { kind: "marker", roomId: id.slice(MARKER_PORTAL_PREFIX.length) };
  }
  if (id.startsWith(MODULE_PORTAL_PREFIX)) {
    const rest = id.slice(MODULE_PORTAL_PREFIX.length);
    const split = rest.indexOf(">");
    return split === -1
      ? null
      : {
          kind: "module",
          from: rest.slice(0, split),
          to: rest.slice(split + 1),
        };
  }
  return null;
};

/** The module a hub id belongs to: `demo.ts#2` → `demo.ts`. */
const hubModuleId = (roomId: string): string => roomId.replace(/#\d+$/, "");

/**
 * Keeps qualified names unique within a module: the first `foo` stays `foo`,
 * the next become `foo~2`, `foo~3`, in the order they are asked for.
 */
const uniqueNames = (): ((qualifiedName: string) => string) => {
  const seen = new Map<string, number>();
  return (qualifiedName) => {
    const count = (seen.get(qualifiedName) ?? 0) + 1;
    seen.set(qualifiedName, count);
    return count === 1 ? qualifiedName : `${qualifiedName}~${count}`;
  };
};

export {
  callPortalId,
  callSiteId,
  flowNodeId,
  functionId,
  hubModuleId,
  isFunctionId,
  isRelativeSpecifier,
  jumpPortalId,
  markerPortalId,
  moduleId,
  modulePortalId,
  normalisePath,
  parseFlowNodeId,
  parsePortalId,
  resolveSpecifier,
  returnPortalId,
  taggedFlowNodeId,
  uniqueNames,
};
export type { FlowIdKind, FlowNodeRef, PortalRef };
