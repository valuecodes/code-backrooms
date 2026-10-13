// Who calls a function and whom it calls, from the graph's call edges, plus
// the functions an ambiguous call of it may reach. For the source panel's
// lists; the world itself still follows resolved calls only.

import type { CodeGraph, FunctionNode } from "./code-graph";

/** One function on the other end of a call; `recursive` when it is the same one. */
type CallLink = {
  readonly fn: FunctionNode;
  readonly recursive: boolean;
};

type CallIndex = {
  /** The functions calling this one, by qualified name. */
  readonly callersOf: (fnId: string) => readonly CallLink[];
  /** The functions this one calls, by qualified name. */
  readonly calleesOf: (fnId: string) => readonly CallLink[];
  /**
   * One group per distinct set of candidates of this function's ambiguous
   * calls, each by qualified name, the groups by their first member.
   */
  readonly maybeCalleesOf: (
    fnId: string
  ) => readonly (readonly FunctionNode[])[];
};

const NONE: readonly never[] = [];

const byName = (a: FunctionNode, b: FunctionNode): number =>
  a.qualifiedName === b.qualifiedName
    ? a.id.localeCompare(b.id)
    : a.qualifiedName.localeCompare(b.qualifiedName);

/** Member by member, then the shorter first. */
const byMembers = (
  a: readonly FunctionNode[],
  b: readonly FunctionNode[]
): number => {
  for (const [index, fn] of a.entries()) {
    const other = b[index];
    if (other === undefined) {
      return 1;
    }
    const order = byName(fn, other);
    if (order !== 0) {
      return order;
    }
  }
  return a.length - b.length;
};

const pushTo = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
};

/** One index per graph. */
const known = new WeakMap<CodeGraph, CallIndex>();

const callIndexOf = (graph: CodeGraph): CallIndex => {
  const found = known.get(graph);
  if (found !== undefined) {
    return found;
  }
  const functions = new Map(graph.functions.map((fn) => [fn.id, fn]));
  const callers = new Map<string, CallLink[]>();
  const callees = new Map<string, CallLink[]>();
  for (const edge of graph.edges) {
    const source = functions.get(edge.source);
    const target = functions.get(edge.target);
    if (edge.type !== "call" || source === undefined || target === undefined) {
      continue;
    }
    const recursive = source === target;
    pushTo(callers, target.id, { fn: source, recursive });
    pushTo(callees, source.id, { fn: target, recursive });
  }
  const maybe = new Map<string, Map<string, readonly FunctionNode[]>>();
  for (const site of graph.callSites) {
    if (site.resolution !== "ambiguous" || !functions.has(site.callerId)) {
      continue;
    }
    const group = (site.candidateIds ?? [])
      .flatMap((id) => {
        const fn = functions.get(id);
        return fn === undefined ? [] : [fn];
      })
      .toSorted(byName);
    const unique = group.filter((fn, index) => group[index - 1] !== fn);
    if (unique.length < 2) {
      continue;
    }
    const groups =
      maybe.get(site.callerId) ?? new Map<string, readonly FunctionNode[]>();
    groups.set(unique.map((fn) => fn.id).join("\n"), unique);
    maybe.set(site.callerId, groups);
  }
  const sorted = (links: readonly CallLink[]) =>
    links.toSorted((a, b) => byName(a.fn, b.fn));
  for (const [id, links] of callers) {
    callers.set(id, sorted(links));
  }
  for (const [id, links] of callees) {
    callees.set(id, sorted(links));
  }
  const index: CallIndex = {
    callersOf: (fnId) => callers.get(fnId) ?? NONE,
    calleesOf: (fnId) => callees.get(fnId) ?? NONE,
    maybeCalleesOf: (fnId) => {
      const groups = maybe.get(fnId);
      return groups === undefined
        ? NONE
        : [...groups.values()].toSorted(byMembers);
    },
  };
  known.set(graph, index);
  return index;
};

export { callIndexOf };
export type { CallIndex, CallLink };
