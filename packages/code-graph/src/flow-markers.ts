// Which room shows a call the world cannot follow (ambiguous, dynamic,
// external, unresolved): every such site lands in exactly one room, as an
// entry on that room's one marker, or for an ambiguous call with few enough
// candidates as a choice portal of its own. Decided as specs are built, so
// the budget counts their wall and folding carries them along.

import { CHOICE_MAX } from "@repo/world-generator/config";

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

/** An ambiguous call the player picks a callee for, at a choice portal. */
type FlowChoice = {
  readonly siteId: string;
  /** The functions it may call, in source order. */
  readonly candidates: readonly string[];
};

/** One choice per set of candidates: a room calling `x.render()` twice gets one. */
const distinctChoices = (
  choices: readonly FlowChoice[]
): readonly FlowChoice[] => {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = JSON.stringify(choice.candidates);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * A room's open sites split in two: ambiguous calls with 2 to CHOICE_MAX
 * candidates become choices, everything else stays on the marker.
 */
const splitChoices = (
  ids: readonly string[],
  sites: SiteIndex
): {
  readonly markers: readonly string[];
  readonly choices: readonly FlowChoice[];
} => {
  const markers: string[] = [];
  const choices: FlowChoice[] = [];
  for (const id of ids) {
    const site = sites.byId.get(id);
    const candidates = site?.candidateIds ?? [];
    if (
      site?.resolution === "ambiguous" &&
      candidates.length >= 2 &&
      candidates.length <= CHOICE_MAX
    ) {
      choices.push({ siteId: id, candidates });
    } else {
      markers.push(id);
    }
  }
  return { markers, choices: distinctChoices(choices) };
};

/** The portals a room needs besides its callees': one per choice, one marker. */
const extraSlots = (
  markers: readonly string[],
  choices: readonly FlowChoice[]
): number => choices.length + (markers.length > 0 ? 1 : 0);

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

export {
  distinctChoices,
  extraSlots,
  headerMarkerSites,
  markerSitesOf,
  splitChoices,
  withStrays,
};
export type { FlowChoice };
