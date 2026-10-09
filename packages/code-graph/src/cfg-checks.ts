// Checks over a function's derived CFG, in the style of `checkLayout`: each
// returns a list of failures, empty when everything holds. `cfgFailures`
// asserts what any control-flow graph of the flow tree must satisfy;
// `cfgLayoutFailures` that the function's cluster walks the same graph:
// every door and portal stands for a flow edge, and every reachable flow
// edge has a door or portal, or lies inside one room.

import type { RoomCluster } from "@repo/types";

import type { Cfg, CfgEdge } from "./cfg";
import type { FlowNode, FunctionNode, SequenceNode } from "./code-graph";
import { walkFlow } from "./flow";
import { emptyBodySpec } from "./flow-measure";
import { taggedFlowNodeId } from "./ids";

const outOf = (cfg: Cfg): ReadonlyMap<string, readonly CfgEdge[]> => {
  const out = new Map<string, CfgEdge[]>();
  for (const edge of cfg.edges) {
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  }
  return out;
};

/** The blocks reachable from the entry. */
const reachable = (cfg: Cfg): ReadonlySet<string> => {
  const out = outOf(cfg);
  const seen = new Set<string>([cfg.entry]);
  const queue = [cfg.entry];
  for (let current = queue.shift(); current !== undefined;) {
    for (const edge of out.get(current) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    current = queue.shift();
  }
  return seen;
};

/** The first block of a case or lane body: its first step, or itself when empty. */
const firstOf = (body: SequenceNode): string => body.steps[0]?.id ?? body.id;

/** Whether `jump`'s edge lands on a room an enclosing composite owns for it. */
const landsOnAncestor = (
  kind: "break" | "continue",
  to: string,
  ancestors: readonly FlowNode[]
): boolean =>
  ancestors.some((ancestor) => {
    if (ancestor.kind === "loop") {
      return (
        to === taggedFlowNodeId(ancestor.id, kind === "break" ? "end" : "again")
      );
    }
    return (
      kind === "break" &&
      ancestor.kind === "switch" &&
      to === taggedFlowNodeId(ancestor.id, "merge")
    );
  });

/**
 * What every CFG of the flow tree must satisfy: one entry and one exit;
 * every reachable block but the exit has a way on; returns and throws lead
 * only to the exit; a `break` leaves an enclosing loop or switch, a
 * `continue` restarts an enclosing loop; a case that falls through runs
 * into the next case, not the merge.
 */
const cfgFailures = (fn: FunctionNode, cfg: Cfg): string[] => {
  const failures: string[] = [];
  const ids = new Set(cfg.blocks.map((block) => block.id));
  const out = outOf(cfg);
  for (const kind of ["entry", "exit"] as const) {
    const count = cfg.blocks.filter((block) => block.kind === kind).length;
    if (count !== 1) {
      failures.push(`${count} ${kind} blocks`);
    }
  }
  for (const edge of cfg.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      failures.push(`edge ${edge.from} -> ${edge.to} leaves the blocks`);
    }
    if (edge.to === cfg.entry) {
      failures.push(`edge ${edge.from} -> ${edge.to} enters the entry`);
    }
  }
  if ((out.get(cfg.exit) ?? []).length > 0) {
    failures.push("the exit has a successor");
  }
  for (const id of reachable(cfg)) {
    if (id !== cfg.exit && (out.get(id) ?? []).length === 0) {
      failures.push(`${id} is a dead end`);
    }
  }
  walkFlow(fn.flow, (node, ancestors) => {
    // Nodes inside an opaque `try` (and sequences) have no blocks.
    if (!ids.has(node.id)) {
      return;
    }
    const edges = out.get(node.id) ?? [];
    if (node.kind === "return") {
      const kind = node.throws ? "throw" : "return";
      if (
        edges.length !== 1 ||
        edges[0]?.to !== cfg.exit ||
        edges[0].kind !== kind
      ) {
        failures.push(`${node.id} does not ${kind} into the exit alone`);
      }
    }
    if (node.kind === "break" || node.kind === "continue") {
      const [edge, ...rest] = edges;
      if (
        edge === undefined ||
        rest.length > 0 ||
        edge.kind !== node.kind ||
        !landsOnAncestor(node.kind, edge.to, ancestors)
      ) {
        failures.push(
          `${node.id} does not ${node.kind} an enclosing composite`
        );
      }
    }
    if (node.kind === "switch") {
      const merge = taggedFlowNodeId(node.id, "merge");
      node.cases.forEach((item, index) => {
        const next = node.cases[index + 1];
        if (!item.fallsThrough || next === undefined) {
          return;
        }
        const into = cfg.edges.filter(
          (edge) =>
            edge.kind === "fallthrough" && edge.to === firstOf(next.body)
        );
        if (into.length === 0) {
          failures.push(`${item.id} does not fall through`);
        }
        for (const edge of into) {
          if ((out.get(edge.from) ?? []).some((other) => other.to === merge)) {
            failures.push(`${edge.from} falls through and rejoins`);
          }
        }
      });
    }
  });
  return failures;
};

/**
 * Each block's room. A block with a room of its own id is in it; any other
 * lies in the closest earlier sibling's room (folding keeps the first
 * room's id), or else in the room of the composite around it (a collapsed
 * composite swallows its children and its merge or end). Entry and exit lie
 * in none.
 */
const roomsOfBlocks = (
  fn: FunctionNode,
  rooms: ReadonlySet<string>
): ReadonlyMap<string, string> => {
  const placed = new Map<string, string>();
  const put = (id: string, inherited: string | null): string | null => {
    const room = rooms.has(id) ? id : inherited;
    if (room !== null) {
      placed.set(id, room);
    }
    return room;
  };
  const visit = (body: SequenceNode, inherited: string | null) => {
    if (body.steps.length === 0) {
      put(body.id, inherited);
      return;
    }
    let current = inherited;
    for (const step of body.steps) {
      const own = put(step.id, current);
      current = own;
      const tag = (name: string) => put(taggedFlowNodeId(step.id, name), own);
      switch (step.kind) {
        case "branch": {
          visit(step.consequent, own);
          visit(step.alternate, own);
          current = tag("merge");
          break;
        }
        case "switch": {
          for (const item of step.cases) {
            visit(item.body, own);
          }
          tag("default");
          current = tag("merge");
          break;
        }
        case "loop": {
          visit(step.body, own);
          tag("again");
          current = tag("end");
          break;
        }
        case "step":
        case "call":
        case "await":
        case "return":
        case "break":
        case "continue":
        case "try":
        default: {
          break;
        }
      }
    }
  };
  if (fn.flow.steps.length === 0) {
    put(emptyBodySpec(fn).id, null);
  } else {
    visit(fn.flow, null);
  }
  return placed;
};

/** The loop whose ring a `loop-back` room belongs to: `X:back` names loop X. */
const BACK_TAG = "back";

/**
 * Whether the cluster walks the same graph as the CFG. Forward: every door
 * stands for a flow edge between the blocks of its rooms (the two doors
 * through a loop's back corridor for its `loop-back` edge), every jump
 * portal for a `break` or `continue` edge, every return portal for an edge
 * into the exit. Reverse, for edges from reachable blocks: the entry leads
 * into the cluster's entry room; an edge into the exit leaves a room with a
 * return portal, or a collapsed room that also runs on (a room shows one
 * way out, so its hidden early return is the one allowed exception); every
 * other edge lies inside one room or has a door, a jump portal or the back
 * corridor. A loop tested first may run zero times, which the ring cannot
 * walk, so its head's `false` edge to the end needs no door.
 */
const cfgLayoutFailures = (
  fn: FunctionNode,
  cfg: Cfg,
  cluster: RoomCluster
): string[] => {
  const failures: string[] = [];
  const roles = new Map(cluster.rooms.map((room) => [room.id, room.role]));
  const roomOf = roomsOfBlocks(fn, new Set(roles.keys()));
  const kinds = new Map(cfg.blocks.map((block) => [block.id, block.kind]));
  const doors = new Set(cluster.doors.map((door) => `${door.from}>${door.to}`));
  const hasDoor = (from: string | undefined, to: string | undefined) =>
    from !== undefined && to !== undefined && doors.has(`${from}>${to}`);
  const leaving = new Set(cluster.doors.map((door) => door.from));
  const returns = new Set(
    cluster.portals
      .filter((portal) => portal.kind === "return")
      .map((portal) => portal.roomId)
  );
  const jumps = new Set(
    cluster.portals
      .filter((portal) => portal.kind === "jump")
      .map((portal) => `${portal.roomId}>${portal.target ?? ""}`)
  );
  const backOf = (edge: CfgEdge) => taggedFlowNodeId(edge.to, BACK_TAG);
  const backEdges = cfg.edges.filter((edge) => edge.kind === "loop-back");
  const walked = (edge: CfgEdge): boolean => {
    const from = roomOf.get(edge.from);
    const to = roomOf.get(edge.to);
    switch (edge.kind) {
      case "loop-back": {
        return (
          from === to ||
          (hasDoor(from, backOf(edge)) && hasDoor(backOf(edge), to))
        );
      }
      case "break":
      case "continue": {
        return from === to || jumps.has(`${from ?? ""}>${to ?? ""}`);
      }
      case "next":
      case "true":
      case "false":
      case "case":
      case "default":
      case "fallthrough":
      case "return":
      case "throw":
      default: {
        return from === to || hasDoor(from, to);
      }
    }
  };

  for (const block of cfg.blocks) {
    if (
      block.id !== cfg.entry &&
      block.id !== cfg.exit &&
      !roomOf.has(block.id)
    ) {
      failures.push(`block ${block.id} lies in no room`);
    }
  }
  for (const door of cluster.doors) {
    const back = [door.from, door.to].find(
      (id) => roles.get(id) === "loop-back"
    );
    const found =
      back === undefined
        ? cfg.edges.some(
            (edge) =>
              roomOf.get(edge.from) === door.from &&
              roomOf.get(edge.to) === door.to
          )
        : backEdges.some(
            (edge) =>
              backOf(edge) === back &&
              (door.to === back
                ? roomOf.get(edge.from) === door.from
                : roomOf.get(edge.to) === door.to)
          );
    if (!found) {
      failures.push(`door ${door.from} -> ${door.to} has no flow edge`);
    }
  }
  for (const portal of cluster.portals) {
    const found =
      portal.kind === "jump"
        ? cfg.edges.some(
            (edge) =>
              (edge.kind === "break" || edge.kind === "continue") &&
              roomOf.get(edge.from) === portal.roomId &&
              roomOf.get(edge.to) === portal.target
          )
        : portal.kind !== "return" ||
          cfg.edges.some(
            (edge) =>
              edge.to === cfg.exit && roomOf.get(edge.from) === portal.roomId
          );
    if (!found) {
      failures.push(`${portal.kind} portal ${portal.id} has no flow edge`);
    }
  }

  const live = reachable(cfg);
  for (const edge of cfg.edges) {
    if (!live.has(edge.from)) {
      continue;
    }
    const from = roomOf.get(edge.from);
    let ok: boolean;
    if (edge.from === cfg.entry) {
      ok = roomOf.get(edge.to) === cluster.entryRoomId;
    } else if (edge.to === cfg.exit) {
      ok =
        from !== undefined &&
        (returns.has(from) ||
          (roles.get(from) === "collapsed" && leaving.has(from)));
    } else {
      ok =
        walked(edge) ||
        (edge.kind === "false" && kinds.get(edge.from) === "loop");
    }
    if (!ok) {
      failures.push(
        `${edge.kind} edge ${edge.from} -> ${edge.to} cannot be walked`
      );
    }
  }
  return failures;
};

export { cfgFailures, cfgLayoutFailures };
