// Which room shows a call the world cannot follow (ambiguous, dynamic,
// external, unresolved): every such site lands in exactly one room, as an
// entry on that room's one marker. Decided as specs are built, so the
// budget counts a marker's wall and folding carries it along.

import type {
  BranchNode,
  FlowNode,
  LoopNode,
  SequenceNode,
  SwitchNode,
} from "./code-graph";
import { within } from "./flow-text";
import type { SiteIndex } from "./flow-text";

/** The open sites under a node that stays one room: a leaf or a collapsed composite. */
const markerSitesOf = (node: FlowNode, sites: SiteIndex): readonly string[] =>
  sites.open
    .filter((site) => within(site.span, node.span))
    .map((site) => site.id);

const innerSequences = (
  node: BranchNode | SwitchNode | LoopNode
): readonly SequenceNode[] => {
  switch (node.kind) {
    case "branch": {
      return [node.consequent, node.alternate];
    }
    case "switch": {
      return node.cases.map((item) => item.body);
    }
    case "loop":
    default: {
      return [node.body];
    }
  }
};

/**
 * The open sites of an expanded composite that no statement inside it
 * holds: its condition, discriminant, case tests or loop header. Not "outside
 * its sequences": a case body's span starts at `case`, so it covers the case
 * test, and a missing `else` is an empty alternate spanning the whole branch.
 */
const headerMarkerSites = (
  node: BranchNode | SwitchNode | LoopNode,
  sites: SiteIndex
): readonly string[] => {
  const steps = innerSequences(node).flatMap((sequence) => sequence.steps);
  return sites.open
    .filter(
      (site) =>
        within(site.span, node.span) &&
        !steps.some((step) => within(site.span, step.span))
    )
    .map((site) => site.id);
};

/** A room's markers, with the function's strays when it is the entry room. */
const withStrays = (
  markers: readonly string[],
  sites: SiteIndex,
  entry: boolean
): readonly string[] => {
  if (!entry || sites.strays.length === 0) {
    return markers;
  }
  const start = (id: string): number => sites.byId.get(id)?.span.start ?? 0;
  return [...sites.strays, ...markers].toSorted((a, b) => start(a) - start(b));
};

export { headerMarkerSites, markerSitesOf, withStrays };
