// Call pass: every call, `new` and optional call inside each function (and at
// module level), resolved by name against the discovered lexical scopes
// (`./resolve`).

import {
  isAwaitExpression,
  isCallExpression,
  isNewExpression,
  isOptionalCallExpression,
} from "@babel/types";
import type { Node } from "@babel/types";
import type { CallEdge, CallKind, CallSite } from "@repo/code-graph";
import { callSiteId } from "@repo/code-graph/ids";

import type { Discovered } from "./functions";
import { resolveCallee } from "./resolve";
import type { Dispatch } from "./resolve";
import type { Scope } from "./scope";
import { spanOf } from "./span";
import { childrenOf, guardDepth } from "./walk";

type CallCollector = {
  readonly discovered: Discovered;
  readonly sites: CallSite[];
  readonly dispatch: Map<CallSite, Dispatch>;
};

const callOf = (node: Node): { kind: CallKind; callee: Node } | null => {
  if (isCallExpression(node)) {
    return { kind: "call", callee: node.callee };
  }
  if (isOptionalCallExpression(node)) {
    return { kind: "optional-call", callee: node.callee };
  }
  return isNewExpression(node) ? { kind: "new", callee: node.callee } : null;
};

/**
 * Visits one function's subtree, stopping at nodes owned by other named
 * functions and switching scope at anonymous ones. `awaited` is true only
 * for the direct operand of an `await`.
 */
const visitCalls = (
  collector: CallCollector,
  callerId: string,
  outer: Scope,
  root: Node,
  node: Node,
  awaited: boolean,
  depth = 0
): void => {
  if (node !== root && collector.discovered.byNode.has(node)) {
    return;
  }
  guardDepth(depth);
  const scope = collector.discovered.scopeAt.get(node) ?? outer;
  if (isAwaitExpression(node)) {
    visitCalls(
      collector,
      callerId,
      scope,
      root,
      node.argument,
      true,
      depth + 1
    );
    return;
  }
  const call = callOf(node);
  if (call !== null) {
    const { calleeName, target, resolution, candidates, via, dispatch } =
      resolveCallee(call.kind, call.callee, scope, collector.discovered);
    const span = spanOf(node);
    const site: CallSite = {
      id: callSiteId(callerId, span.start),
      callerId,
      calleeName,
      calleeId: target?.id ?? null,
      resolution,
      ...(candidates === undefined
        ? {}
        : { candidateIds: candidates.map((fn) => fn.id) }),
      kind: call.kind,
      awaited,
      span,
      ...(via === undefined ? {} : { via }),
    };
    collector.sites.push(site);
    if (dispatch !== undefined) {
      collector.dispatch.set(site, dispatch);
    }
  }
  for (const child of childrenOf(node)) {
    visitCalls(collector, callerId, scope, root, child, false, depth + 1);
  }
};

/**
 * A chain (`f()()`, `a.b().c()`) starts several calls at one offset: the
 * innermost keeps the plain id, each enclosing one is told apart by its
 * end, `main@12-20`. `sites` are sorted by start, then end.
 */
const uniqueIds = (sites: readonly CallSite[]): readonly CallSite[] => {
  const seen = new Set<string>();
  return sites.map((site) => {
    if (!seen.has(site.id)) {
      seen.add(site.id);
      return site;
    }
    return { ...site, id: `${site.id}-${site.span.end}` };
  });
};

type CallPass = {
  readonly callSites: readonly CallSite[];
  readonly edges: readonly CallEdge[];
  /** By call site id: calls on typed receivers the linker checks for overrides. */
  readonly dispatch: ReadonlyMap<string, Dispatch>;
};

const collectCalls = (
  moduleId: string,
  program: Node,
  discovered: Discovered
): CallPass => {
  const collector: CallCollector = {
    discovered,
    sites: [],
    dispatch: new Map(),
  };
  visitCalls(
    collector,
    moduleId,
    discovered.moduleScope,
    program,
    program,
    false
  );
  for (const fn of discovered.functions) {
    const node = discovered.nodeOf.get(fn);
    const scope = discovered.scopeOf.get(fn);
    if (node !== undefined && scope !== undefined) {
      visitCalls(collector, fn.id, scope, node, node, false);
    }
  }
  const sorted = collector.sites.toSorted(
    (a, b) => a.span.start - b.span.start || a.span.end - b.span.end
  );
  const callSites = uniqueIds(sorted);
  const dispatch = new Map<string, Dispatch>();
  sorted.forEach((site, position) => {
    const found = collector.dispatch.get(site);
    const unique = callSites[position];
    if (found !== undefined && unique !== undefined) {
      dispatch.set(unique.id, found);
    }
  });
  const edges = new Map<string, CallEdge>();
  for (const site of callSites) {
    if (site.calleeId === null || site.callerId === moduleId) {
      continue;
    }
    const key = `${site.callerId}->${site.calleeId}`;
    const existing = edges.get(key);
    edges.set(key, {
      type: "call",
      source: site.callerId,
      target: site.calleeId,
      callSiteIds: [...(existing?.callSiteIds ?? []), site.id],
    });
  }
  return { callSites, edges: [...edges.values()], dispatch };
};

export { collectCalls };
