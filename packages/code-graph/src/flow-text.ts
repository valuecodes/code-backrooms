// The words for a flow room: what the HUD says when the player stands in it.

import type { LaneLabel } from "@repo/types";

import type {
  BranchNode,
  CallSite,
  FlowNode,
  FlowStep,
  LoopNode,
  SequenceNode,
  SourceSpan,
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

/** One function's call sites, indexed once so measuring its rooms stays cheap. */
type SiteIndex = {
  readonly byId: ReadonlyMap<string, CallSite>;
  /** Sites the world cannot follow (any but `resolved`), in source order. */
  readonly open: readonly CallSite[];
  /**
   * Open sites in no statement of the body (default parameters, dropped
   * dead code): the entry room shows them.
   */
  readonly strays: readonly string[];
};

const within = (inner: SourceSpan, outer: SourceSpan): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

/** `flow`: the function's body, for its strays; without it there are none. */
const indexSites = (
  sites: readonly CallSite[],
  flow: SequenceNode | null = null
): SiteIndex => {
  const open = sites
    .filter((site) => site.resolution !== "resolved")
    .toSorted((a, b) => a.span.start - b.span.start);
  return {
    byId: new Map(sites.map((site) => [site.id, site])),
    open,
    strays:
      flow === null
        ? []
        : open
            .filter(
              (site) => !flow.steps.some((step) => within(site.span, step.span))
            )
            .map((site) => site.id),
  };
};

const resolvedSites = (
  ids: readonly string[],
  sites: SiteIndex
): readonly CallSite[] =>
  ids.flatMap((id) => {
    const site = sites.byId.get(id);
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
      const awaited = [...sites.byId.values()].find(
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

/** A loop's head: its header, or `do` for a do-while (tested at the end). */
const loopHeadText = (node: LoopNode): string =>
  node.loopKind === "do-while" ? "do" : node.header;

/** Where a loop asks again: `again?`, or a do-while's `while (…)`. */
const loopTestText = (node: LoopNode): string =>
  node.loopKind === "do-while" ? node.header : "again?";

/** Where control leaves a loop: `end for` or `end while`. */
const loopEndText = (node: LoopNode): string =>
  node.loopKind === "while" || node.loopKind === "do-while"
    ? "end while"
    : "end for";

/**
 * What a marker stands for: one entry per callee and resolution in source
 * order, `×n` when repeated, an ambiguous call's candidates by name
 * (`nameOf` a function id): `fetch(…) external, cb(…) ×2 dynamic,
 * x.render(…) ambiguous: A.render() | B.render()`.
 */
const markerText = (
  sites: readonly CallSite[],
  nameOf: (functionId: string) => string
): string => {
  const entries = new Map<string, { site: CallSite; count: number }>();
  for (const site of sites) {
    const key = JSON.stringify([site.calleeName, site.resolution]);
    const entry = entries.get(key);
    entries.set(
      key,
      entry === undefined
        ? { site, count: 1 }
        : { site: entry.site, count: entry.count + 1 }
    );
  }
  return [...entries.values()]
    .map(({ site, count }) => {
      const times = count > 1 ? ` ×${count}` : "";
      const candidates =
        site.candidateIds === undefined
          ? ""
          : `: ${site.candidateIds.map((id) => `${nameOf(id)}()`).join(" | ")}`;
      return `${callee(site)}${times} ${site.resolution}${candidates}`;
    })
    .join(", ");
};

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
  loopEndText,
  loopHeadText,
  loopTestText,
  markerText,
  mergeText,
  resolvedSites,
  siteIdsUnder,
  within,
};
export type { SiteIndex };
