// Stable, human-readable ids. The same source always yields the same ids, so
// layouts, tests and URLs can refer to them.

import type { FlowNode } from "./code-graph";

const FUNCTION_SEPARATOR = "::";

/** Forward slashes, no leading `./`, no doubled separators: "src/demo.ts". */
const moduleId = (path: string): string => {
  let normalised = path.replaceAll("\\", "/").replaceAll(/\/{2,}/g, "/");
  while (normalised.startsWith("./")) {
    normalised = normalised.slice(2);
  }
  return normalised;
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

const CALL_PORTAL_PREFIX = "portal:";
const RETURN_PORTAL_PREFIX = "return:";

/** A call portal is named by the call site it stands for: `portal:demo.ts::main@42`. */
const callPortalId = (callSiteId: string): string =>
  `${CALL_PORTAL_PREFIX}${callSiteId}`;

/** A function's return portal: `return:demo.ts::main`. */
const returnPortalId = (functionId: string): string =>
  `${RETURN_PORTAL_PREFIX}${functionId}`;

type PortalRef =
  | { readonly kind: "call"; readonly callSiteId: string }
  | { readonly kind: "return"; readonly functionId: string };

/** What a portal id names, or null for ids that are not portals of this grammar. */
const parsePortalId = (id: string): PortalRef | null => {
  if (id.startsWith(CALL_PORTAL_PREFIX)) {
    return { kind: "call", callSiteId: id.slice(CALL_PORTAL_PREFIX.length) };
  }
  if (id.startsWith(RETURN_PORTAL_PREFIX)) {
    return {
      kind: "return",
      functionId: id.slice(RETURN_PORTAL_PREFIX.length),
    };
  }
  return null;
};

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
  isFunctionId,
  moduleId,
  parseFlowNodeId,
  parsePortalId,
  returnPortalId,
  uniqueNames,
};
export type { FlowIdKind, FlowNodeRef, PortalRef };
