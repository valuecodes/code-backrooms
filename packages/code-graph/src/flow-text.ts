// The words for a flow room: what the HUD says when the player stands in it.

import type { LaneLabel } from "@repo/types";

import type {
  BranchNode,
  CallSite,
  FlowNode,
  FlowStep,
  SwitchNode,
} from "./code-graph";
import { countStatements, walkFlow } from "./flow";

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const statementsText = (count: number): string => plural(count, "statement");

const callsText = (count: number): string =>
  count === 0 ? "" : ` · ${plural(count, "call")}`;

/** `12 statements · 3 calls`: a run of rooms folded into one. */
const foldedText = (statements: number, calls: number): string =>
  `${statementsText(statements)}${callsText(calls)}`;

/** Every call site id named anywhere under the node. */
const siteIdsUnder = (node: FlowNode): readonly string[] => {
  const ids: string[] = [];
  walkFlow(node, (current) => {
    if ("callSiteIds" in current) {
      ids.push(...current.callSiteIds);
    }
  });
  return ids;
};

/** Sites by id, built once per function so lookups stay cheap. */
type SiteIndex = ReadonlyMap<string, CallSite>;

const indexSites = (sites: readonly CallSite[]): SiteIndex =>
  new Map(sites.map((site) => [site.id, site]));

const resolvedSites = (
  ids: readonly string[],
  sites: SiteIndex
): readonly CallSite[] =>
  ids.flatMap((id) => {
    const site = sites.get(id);
    return site?.resolution === "resolved" ? [site] : [];
  });

const callee = (site: CallSite): string => `${site.calleeName}(…)`;

/** ` · 4 statements · 2 calls` for a composite's own statements and calls. */
const summary = (node: FlowStep, sites: SiteIndex): string =>
  ` · ${foldedText(
    countStatements(node) - 1,
    resolvedSites(siteIdsUnder(node), sites).length
  )}`;

/**
 * One line per room: `3 statements`, `getUser(…)`, `await fetch(…)`,
 * `return loadSession(…)`, `if (user) · 2 statements · 2 calls`.
 */
const flowNodeText = (node: FlowStep, sites: SiteIndex): string => {
  switch (node.kind) {
    case "step": {
      return statementsText(node.statements);
    }
    case "call": {
      const names = resolvedSites(node.callSiteIds, sites).map(callee);
      return [...new Set(names)].join(", ");
    }
    case "await": {
      const awaited = [...sites.values()].find(
        (site) =>
          site.span.start >= node.span.start && site.span.end <= node.span.end
      );
      return awaited === undefined ? "await" : `await ${callee(awaited)}`;
    }
    case "return": {
      const word = node.throws ? "throw" : "return";
      const first = resolvedSites(node.callSiteIds, sites)[0];
      return first === undefined ? word : `${word} ${callee(first)}`;
    }
    case "branch": {
      return `if (${node.condition})${summary(node, sites)}`;
    }
    case "switch": {
      return `switch (${node.discriminant})${summary(node, sites)}`;
    }
    case "loop": {
      const head =
        node.loopKind === "do-while" ? `do … ${node.header}` : node.header;
      return `${head}${summary(node, sites)}`;
    }
    case "try": {
      return `try${summary(node, sites)}`;
    }
    case "break":
    case "continue":
    default: {
      return node.kind;
    }
  }
};

/** The head room of an expanded composite: `if (user)`, `switch (status)`. */
const forkText = (node: BranchNode | SwitchNode): string =>
  node.kind === "branch"
    ? `if (${node.condition})`
    : `switch (${node.discriminant})`;

/** The room where the lanes of a composite rejoin. */
const mergeText = (node: BranchNode | SwitchNode): string =>
  node.kind === "branch" ? "end if" : "end switch";

/** A lane's own words: `true`, `false`, `case "x", case "y"`, `default`. */
const laneText = (lane: LaneLabel): string => lane.text ?? lane.kind;

/** The one room of a lane with nothing in it. */
const emptyLaneText = (lane: LaneLabel): string => `${laneText(lane)} · empty`;

export {
  emptyLaneText,
  flowNodeText,
  foldedText,
  forkText,
  indexSites,
  laneText,
  mergeText,
  resolvedSites,
  siteIdsUnder,
};
export type { SiteIndex };
