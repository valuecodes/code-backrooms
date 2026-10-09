// From a world id back to the code: what a room or portal stands for.

import type {
  CallSite,
  CodeGraph,
  FlowNode,
  FunctionNode,
  ModuleNode,
} from "./code-graph";
import { findFlowNode } from "./flow";
import { planFlow } from "./flow-layout";
import type { FlowPlan } from "./flow-layout";
import { flowNodeText, indexSites } from "./flow-text";
import {
  flowNodeId,
  hubModuleId,
  isFunctionId,
  parseFlowNodeId,
  parsePortalId,
} from "./ids";
import type { FlowNodeRef } from "./ids";

type FunctionSubject = {
  readonly fn: FunctionNode;
  readonly module: ModuleNode;
};

type RoomSubject =
  | { readonly kind: "module"; readonly module: ModuleNode }
  | ({ readonly kind: "function" } & FunctionSubject)
  | ({
      readonly kind: "flow";
      readonly node: FlowNode;
      /** Outermost first. */
      readonly ancestors: readonly FlowNode[];
      /** The HUD's words for the room: `await fetch(…)`, `3 statements`. */
      readonly text: string;
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
  const label = planOf(graph, subject.fn).labels.get(roomId);
  if (ref.kind === "step" && ref.tag === "empty") {
    return {
      kind: "flow",
      ...subject,
      node: subject.fn.flow,
      ancestors: [],
      text: label ?? "empty body",
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
  };
};

/**
 * What a room stands for: a flow room of a function, a function, or a
 * module hub; null for corridors and ids not from this graph. Flow ids also
 * contain `::`, so they are tried first.
 */
const roomSubject = (graph: CodeGraph, roomId: string): RoomSubject | null => {
  if (parseFlowNodeId(roomId) !== null) {
    return flowSubject(graph, roomId);
  }
  if (isFunctionId(roomId)) {
    const subject = functionSubject(graph, roomId);
    return subject === null ? null : { kind: "function", ...subject };
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
  | { readonly kind: "return"; readonly fn: FunctionNode };

/** What a portal stands for, or null for ids not from this graph. */
const portalSubject = (
  graph: CodeGraph,
  portalId: string
): PortalSubject | null => {
  const ref = parsePortalId(portalId);
  if (ref === null) {
    return null;
  }
  if (ref.kind === "return") {
    const functionId = parseFlowNodeId(ref.roomId)?.functionId ?? ref.roomId;
    const fn = functionSubject(graph, functionId)?.fn;
    return fn === undefined ? null : { kind: "return", fn };
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

export { portalSubject, roomSubject };
export type { PortalSubject, RoomSubject };
