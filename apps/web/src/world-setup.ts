import type { CodeGraph } from "@repo/code-graph";
import type { AreaLink } from "@repo/code-graph/area-links";
import { useEffect, useMemo, useState } from "react";

import { analyse, analysisFailed } from "~/analyse";
import type { Analysis } from "~/analyse";
import { createAnalysisWorker, startAnalysis } from "~/analyse-client";
import { initialSeed, parseWorldParams } from "~/params";
import { labelOfRequest } from "~/source-request";
import type { SourceRequest } from "~/source-request";
import type { WorldOptions } from "~/use-area-world";
import { useSourceFiles } from "~/use-source-files";
import type { LoadedSource } from "~/use-source-files";
import { areaLabelOf } from "~/world-from-code";
import type { CodeResult } from "~/world-from-code";

// What the URL asks for, worked out once for the 3D app and the map page
// alike, whichever of them the page loads; the 3D app may swap in a zip or
// folder the user brought instead.

const initial = parseWorldParams(globalThis.location.search);

/** Everything a page needs to generate and describe its world. */
type WorldSetup = {
  /** The parsed source, or null for a random or preset world. */
  readonly code: CodeResult | null;
  readonly codeGraph: CodeGraph | null;
  /** The example's, zip's or folder's name; null for a random world. */
  readonly label: string | null;
  /** Files the user brought: in memory only, so the URL cannot name them. */
  readonly local: boolean;
  /** Files left out of a local world, for the HUD. */
  readonly notices: readonly string[];
  readonly worldOptions: WorldOptions;
  readonly startSeed: number;
  readonly areaLinks: readonly AreaLink[];
  readonly labelOfArea: (areaId: string) => string;
};

/** How many unparsed paths a notice names. */
const NAMED_PATHS = 3;

const files = (count: number): string =>
  count === 1 ? "1 file" : `${count} files`;

/** The HUD's lines for files a local world left out. */
const noticesOf = (
  tooLarge: number,
  unparsed: readonly string[]
): readonly string[] => {
  const notices: string[] = [];
  if (tooLarge > 0) {
    notices.push(`${files(tooLarge)} over 256 KB skipped`);
  }
  if (unparsed.length > 0) {
    const named = unparsed.slice(0, NAMED_PATHS).join(", ");
    const more = unparsed.length > NAMED_PATHS ? "…" : "";
    notices.push(`${files(unparsed.length)} did not parse: ${named}${more}`);
  }
  return notices;
};

/**
 * A bundled example parsed on the spot, its load failure, or null when none
 * was asked for. Examples stay strict, so a syntax error in one shows in
 * the HUD; a repository the user brought is analysed tolerantly in a worker
 * instead (`useAnalysis`).
 */
const exampleAnalysis = (loaded: LoadedSource): Analysis | null => {
  if (loaded.state === "failed") {
    return analysisFailed(loaded.error);
  }
  return loaded.files === null
    ? null
    : analyse(loaded.files, { tolerant: false });
};

/**
 * The world of `request` once its files are analysed (null: no code). Parsed
 * once: a syntax error, or an example that failed to load, does not depend
 * on the seed, and it is shown like any generation error rather than thrown
 * through the renderer.
 */
const worldSetup = (
  request: SourceRequest,
  analysis: Analysis | null
): WorldSetup => {
  const local = request.kind === "local";
  const code = analysis?.code ?? null;
  const codeGraph = code?.codeGraph ?? null;
  return {
    code,
    codeGraph,
    label: labelOfRequest(request),
    local,
    notices:
      request.kind === "local"
        ? noticesOf(request.skipped, code?.error === null ? code.skipped : [])
        : [],
    worldOptions: {
      codeGraph,
      codeError: code?.error ?? null,
      eager: initial.eager,
      rooms: initial.rooms,
      preset: initial.preset,
    },
    // A code world without `?seed` takes its source's own seed, so the same
    // program reloads into the same world; `?seed` and N override it.
    startSeed: initialSeed(initial, analysis?.sourceSeed ?? null),
    // The world map's links and labels, made once like the code graph, so
    // the map is rebuilt only when the world grows.
    areaLinks: analysis?.areaLinks ?? [],
    labelOfArea: (areaId) => areaLabelOf(codeGraph, areaId),
  };
};

/**
 * A local request's analysis from the worker, null until it arrives (and
 * for any other request). A new request or an unmount terminates the
 * worker, so a late answer never lands on the wrong world.
 */
const useAnalysis = (request: SourceRequest): Analysis | null => {
  const [result, setResult] = useState<{
    readonly request: SourceRequest;
    readonly analysis: Analysis;
  } | null>(null);
  useEffect(() => {
    if (request.kind !== "local") {
      return () => undefined;
    }
    return startAnalysis(request.files, createAnalysisWorker, (analysis) =>
      setResult({ request, analysis })
    );
  }, [request]);
  return result?.request === request ? result.analysis : null;
};

/** The world setup of `request`, null while its files load or are analysed. */
const useWorldSetup = (request: SourceRequest): WorldSetup | null => {
  const loaded = useSourceFiles(request);
  const localAnalysis = useAnalysis(request);
  return useMemo(() => {
    if (request.kind === "local") {
      return localAnalysis === null ? null : worldSetup(request, localAnalysis);
    }
    return loaded.state === "loading"
      ? null
      : worldSetup(request, exampleAnalysis(loaded));
  }, [request, loaded, localAnalysis]);
};

export { exampleAnalysis, initial, noticesOf, useWorldSetup, worldSetup };
export type { WorldSetup };
