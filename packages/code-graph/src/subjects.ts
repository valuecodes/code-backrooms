// From a world id back to the code: what a room or portal stands for.

import type {
  CallSite,
  CodeGraph,
  FlowNode,
  FunctionNode,
  ModuleNode,
  SourceSpan,
} from "./code-graph";
import { repositoryName } from "./entrance";
import { entryModules } from "./entrypoints";
import { findFlowNode } from "./flow";
import { planFlow } from "./flow-layout";
import type { FlowPlan } from "./flow-layout";
import { flowNodeText, indexSites } from "./flow-text";
import {
  flowNodeId,
  hubModuleId,
  isEntranceHub,
  isFunctionId,
  isRelativeSpecifier,
  parseFlowNodeId,
  parsePortalId,
} from "./ids";
import type { FlowNodeRef } from "./ids";

type FunctionSubject = {
  readonly fn: FunctionNode;
  readonly module: ModuleNode;
};

type RoomSubject =
  | {
      readonly kind: "entrance";
      /** The repository's name, on the entrance's walls and in the HUD. */
      readonly name: string;
      /** The modules its portals lead to, in portal order. */
      readonly modules: readonly ModuleNode[];
    }
  | { readonly kind: "module"; readonly module: ModuleNode }
  | ({ readonly kind: "function" } & FunctionSubject)
  | ({
      readonly kind: "flow";
      readonly node: FlowNode;
      /** Outermost first. */
      readonly ancestors: readonly FlowNode[];
      /** The HUD's words for the room: `await fetch(…)`, `3 statements`. */
      readonly text: string;
      /**
       * The room's code: its node's, a tagged room's composite's, or for a
       * room folded from several, from the first node to the last.
       */
      readonly span: SourceSpan;
    } & FunctionSubject);

const functionSubject = (
  graph: CodeGraph,
  functionId: string
): FunctionSubject | null => {
  const fn = graph.functions.find((candidate) => candidate.id === functionId);
  const module =
    fn === undefined
      ? undefined
      : graph.modules.find((candidate) => candidate.id === fn.moduleId);
  return fn === undefined || module === undefined ? null : { fn, module };
};

const sitesOf = (graph: CodeGraph, fnId: string): readonly CallSite[] =>
  graph.callSites.filter((site) => site.callerId === fnId);

/** The template is pure, so one plan per function node is enough. */
const plans = new WeakMap<FunctionNode, FlowPlan>();

const planOf = (graph: CodeGraph, fn: FunctionNode): FlowPlan => {
  const cached = plans.get(fn);
  if (cached !== undefined) {
    return cached;
  }
  const plan = planFlow(fn, sitesOf(graph, fn.id));
  plans.set(fn, plan);
  return plan;
};

/** Rooms a composite adds, tagged on its own id. */
const COMPOSITE_TAGS: ReadonlySet<string> = new Set([
  "merge",
  "default",
  "again",
  "back",
  "end",
]);

/**
 * The flow node a room stands for. A fork's merge room, a switch's
 * synthesised default lane and a loop's test, back and end rooms carry a
 * tag on the composite's own id, so they resolve to the composite, with the
 * composite among their ancestors.
 */
const nodeOf = (fn: FunctionNode, roomId: string, ref: FlowNodeRef) => {
  const tagged =
    (ref.kind === "branch" || ref.kind === "switch" || ref.kind === "loop") &&
    ref.tag !== undefined &&
    COMPOSITE_TAGS.has(ref.tag);
  if (!tagged) {
    return findFlowNode(fn.flow, roomId);
  }
  const found = findFlowNode(
    fn.flow,
    flowNodeId(ref.functionId, ref.offset, ref.kind)
  );
  // The room lies inside the composite, so the composite is its ancestor too.
  return found === null
    ? null
    : { node: found.node, ancestors: [...found.ancestors, found.node] };
};

/** From the start of `first` to the end of `last`. */
const joinSpans = (first: SourceSpan, last: SourceSpan): SourceSpan => ({
  start: first.start,
  startLine: first.startLine,
  startColumn: first.startColumn,
  end: last.end,
  endLine: last.endLine,
  endColumn: last.endColumn,
});

/** A room's span: its node's, through the last node folded into it. */
const roomSpan = (
  fn: FunctionNode,
  plan: FlowPlan,
  roomId: string,
  node: FlowNode
): SourceSpan => {
  const lastId = plan.folds.get(roomId);
  const last = lastId === undefined ? null : findFlowNode(fn.flow, lastId);
  return last === null ? node.span : joinSpans(node.span, last.node.span);
};

/**
 * A flow room: a node of the function's flow, or the empty body's one room.
 * The text is the room's label from the template (deterministic, so it is
 * rebuilt here), which for a room folded into budget sums what it holds;
 * such a room keeps the id of the first node folded into it.
 */
const flowSubject = (graph: CodeGraph, roomId: string): RoomSubject | null => {
  const ref = parseFlowNodeId(roomId);
  const subject = ref === null ? null : functionSubject(graph, ref.functionId);
  if (ref === null || subject === null) {
    return null;
  }
  const plan = planOf(graph, subject.fn);
  const label = plan.labels.get(roomId);
  if (ref.kind === "step" && ref.tag === "empty") {
    return {
      kind: "flow",
      ...subject,
      node: subject.fn.flow,
      ancestors: [],
      text: label ?? "empty body",
      span: subject.fn.flow.span,
    };
  }
  const found = nodeOf(subject.fn, roomId, ref);
  if (found === null) {
    return null;
  }
  return {
    kind: "flow",
    ...subject,
    node: found.node,
    ancestors: found.ancestors,
    text:
      label ??
      (found.node.kind === "sequence"
        ? ""
        : flowNodeText(found.node, indexSites(sitesOf(graph, subject.fn.id)))),
    span: roomSpan(subject.fn, plan, roomId, found.node),
  };
};

/**
 * What a room stands for: a flow room of a function, a function, a module
 * hub or the repository entrance; null for corridors and ids not from this
 * graph. Flow ids also contain `::`, so they are tried first.
 */
const roomSubject = (graph: CodeGraph, roomId: string): RoomSubject | null => {
  if (parseFlowNodeId(roomId) !== null) {
    return flowSubject(graph, roomId);
  }
  if (isFunctionId(roomId)) {
    const subject = functionSubject(graph, roomId);
    return subject === null ? null : { kind: "function", ...subject };
  }
  if (isEntranceHub(roomId)) {
    return {
      kind: "entrance",
      name: repositoryName(graph),
      modules: entryModules(graph),
    };
  }
  const moduleId = hubModuleId(roomId);
  const module = graph.modules.find((candidate) => candidate.id === moduleId);
  return module === undefined ? null : { kind: "module", module };
};

type PortalSubject =
  | {
      readonly kind: "call";
      readonly site: CallSite;
      readonly caller: FunctionNode;
      readonly callee: FunctionNode;
    }
  | { readonly kind: "return"; readonly fn: FunctionNode }
  | {
      readonly kind: "jump";
      readonly fn: FunctionNode;
      /** The room hosting the portal: a `break`, a `continue`, a collapsed room. */
      readonly roomId: string;
      /** The room it leads to: a loop's test or end room, a switch's merge. */
      readonly targetRoomId: string;
    }
  | {
      readonly kind: "marker";
      readonly fn: FunctionNode;
      /** The room whose wall holds it. */
      readonly roomId: string;
      /** The calls in that room the world cannot follow, in source order. */
      readonly sites: readonly CallSite[];
    }
  | {
      readonly kind: "module";
      /** The module whose hub holds it; null for the entrance. */
      readonly from: ModuleNode | null;
      /** The module it leads to: one this one imports. */
      readonly module: ModuleNode;
    };

/** What a portal stands for, or null for ids not from this graph. */
const portalSubject = (
  graph: CodeGraph,
  portalId: string
): PortalSubject | null => {
  const ref = parsePortalId(portalId);
  if (ref === null) {
    return null;
  }
  if (ref.kind === "module") {
    const from = isEntranceHub(ref.from)
      ? null
      : graph.modules.find(
          (candidate) => candidate.id === hubModuleId(ref.from)
        );
    const module = graph.modules.find((candidate) => candidate.id === ref.to);
    return from === undefined || module === undefined
      ? null
      : { kind: "module", from, module };
  }
  if (ref.kind === "return") {
    const functionId = parseFlowNodeId(ref.roomId)?.functionId ?? ref.roomId;
    const fn = functionSubject(graph, functionId)?.fn;
    return fn === undefined ? null : { kind: "return", fn };
  }
  if (ref.kind === "marker") {
    const functionId = parseFlowNodeId(ref.roomId)?.functionId;
    const fn =
      functionId === undefined
        ? undefined
        : functionSubject(graph, functionId)?.fn;
    const ids =
      fn === undefined ? undefined : planOf(graph, fn).markers.get(ref.roomId);
    if (fn === undefined || ids === undefined) {
      return null;
    }
    const byId = new Map(graph.callSites.map((site) => [site.id, site]));
    return {
      kind: "marker",
      fn,
      roomId: ref.roomId,
      sites: ids.flatMap((id) => {
        const site = byId.get(id);
        return site === undefined ? [] : [site];
      }),
    };
  }
  if (ref.kind === "jump") {
    const functionId = parseFlowNodeId(ref.roomId)?.functionId;
    const fn =
      functionId === undefined
        ? undefined
        : functionSubject(graph, functionId)?.fn;
    const targetRoomId =
      fn === undefined ? undefined : planOf(graph, fn).jumps.get(ref.roomId);
    return fn === undefined || targetRoomId === undefined
      ? null
      : { kind: "jump", fn, roomId: ref.roomId, targetRoomId };
  }
  const site = graph.callSites.find(
    (candidate) => candidate.id === ref.callSiteId
  );
  const caller =
    site === undefined ? undefined : functionSubject(graph, site.callerId)?.fn;
  const callee =
    site?.calleeId === null || site?.calleeId === undefined
      ? undefined
      : functionSubject(graph, site.calleeId)?.fn;
  return site === undefined || caller === undefined || callee === undefined
    ? null
    : { kind: "call", site, caller, callee };
};

/**
 * The package a call goes into: the specifier of the import it is made
 * through (`"node:util"`), when that import is a package rather than a file
 * of the graph. Null for every other call.
 */
const packageOf = (graph: CodeGraph, site: CallSite): string | null => {
  const { via } = site;
  if (via === undefined) {
    return null;
  }
  const separator = site.callerId.indexOf("::");
  const moduleId =
    separator === -1 ? site.callerId : site.callerId.slice(0, separator);
  const record = graph.modules
    .find((module) => module.id === moduleId)
    ?.imports.find((item) => item.localName === via.localName);
  return record === undefined ||
    record.moduleId !== null ||
    isRelativeSpecifier(record.specifier)
    ? null
    : record.specifier;
};

export { packageOf, portalSubject, roomSubject };
export type { PortalSubject, RoomSubject };
