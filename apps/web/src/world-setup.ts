import type { CodeGraph } from "@repo/code-graph";
import { areaLinksOf } from "@repo/code-graph/area-links";
import type { AreaLink } from "@repo/code-graph/area-links";
import { useMemo } from "react";

import { initialSeed, parseWorldParams } from "~/params";
import type { WorldOptions } from "~/use-area-world";
import { useExampleFiles } from "~/use-example-files";
import type { LoadedExample } from "~/use-example-files";
import { areaLabelOf, codeGraphOf, sourceSeedOf } from "~/world-from-code";
import type { CodeResult } from "~/world-from-code";

// What the URL asks for, worked out once for the 3D app and the map page
// alike, whichever of them the page loads.

const initial = parseWorldParams(globalThis.location.search);

/** Everything a page needs to generate and describe the URL's world. */
type WorldSetup = {
  /** The parsed example, or null for a random or preset world. */
  readonly code: CodeResult | null;
  readonly codeGraph: CodeGraph | null;
  readonly worldOptions: WorldOptions;
  readonly startSeed: number;
  readonly areaLinks: readonly AreaLink[];
  readonly labelOfArea: (areaId: string) => string;
};

/** The example parsed, its load failure, or null when none was asked for. */
const codeOf = (example: LoadedExample): CodeResult | null => {
  if (example.state === "failed") {
    return { codeGraph: null, error: example.error };
  }
  return example.files === null ? null : codeGraphOf(example.files);
};

/**
 * The world of the URL's example once its files are known. Parsed once: a
 * syntax error, or an example that failed to load, does not depend on the
 * seed, and it is shown like any generation error rather than thrown
 * through the renderer.
 */
const worldSetup = (example: LoadedExample): WorldSetup => {
  const files = example.state === "loaded" ? example.files : null;
  const code = codeOf(example);
  const codeGraph = code?.codeGraph ?? null;
  return {
    code,
    codeGraph,
    worldOptions: {
      codeGraph,
      codeError: code?.error ?? null,
      eager: initial.eager,
      rooms: initial.rooms,
      preset: initial.preset,
    },
    // A code world without `?seed` takes its source's own seed, so the same
    // program reloads into the same world; `?seed` and N override it.
    startSeed: initialSeed(
      initial,
      files === null ? null : sourceSeedOf(files)
    ),
    // The world map's links and labels, made once like the code graph, so
    // the map is rebuilt only when the world grows.
    areaLinks: codeGraph === null ? [] : areaLinksOf(codeGraph),
    labelOfArea: (areaId) => areaLabelOf(codeGraph, areaId),
  };
};

/** The URL's world setup, null while its example is still loading. */
const useWorldSetup = (): WorldSetup | null => {
  const example = useExampleFiles(initial.code);
  return useMemo(
    () => (example.state === "loading" ? null : worldSetup(example)),
    [example]
  );
};

export { initial, useWorldSetup, worldSetup };
export type { WorldSetup };
