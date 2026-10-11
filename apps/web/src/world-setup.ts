import { areaLinksOf } from "@repo/code-graph/area-links";

import { initialSeed, parseWorldParams } from "~/params";
import type { WorldOptions } from "~/use-area-world";
import { areaLabelOf, codeGraphOf, sourceSeedOf } from "~/world-from-code";

// What the URL asks for, worked out once for the 3D app and the map page
// alike, whichever of them the page loads.

const initial = parseWorldParams(globalThis.location.search);

// Parsed once: a syntax error in a bundled example does not depend on the
// seed, and it is shown in the HUD rather than thrown through the renderer.
const code = initial.code === null ? null : codeGraphOf(initial.code);
const codeGraph = code?.codeGraph ?? null;

const worldOptions: WorldOptions = {
  codeGraph,
  codeError: code?.error ?? null,
  eager: initial.eager,
  rooms: initial.rooms,
  preset: initial.preset,
};

// A code world without `?seed` takes its source's own seed, so the same
// program reloads into the same world; `?seed` and N override it.
const startSeed = initialSeed(
  initial,
  initial.code === null ? null : sourceSeedOf(initial.code)
);

// The world map's links and labels, made once like the code graph, so the
// map is rebuilt only when the world grows.
const areaLinks = codeGraph === null ? [] : areaLinksOf(codeGraph);
const labelOfArea = (areaId: string): string => areaLabelOf(codeGraph, areaId);

export {
  areaLinks,
  code,
  codeGraph,
  initial,
  labelOfArea,
  startSeed,
  worldOptions,
};
