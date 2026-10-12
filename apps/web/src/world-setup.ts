import type { CodeGraph } from "@repo/code-graph";
import { areaLinksOf } from "@repo/code-graph/area-links";
import type { AreaLink } from "@repo/code-graph/area-links";
import { useEffect, useMemo, useState } from "react";

import { initialSeed, parseWorldParams } from "~/params";
import { labelOfRequest } from "~/source-request";
import type { SourceRequest } from "~/source-request";
import type { WorldOptions } from "~/use-area-world";
import { useSourceFiles } from "~/use-source-files";
import type { LoadedSource } from "~/use-source-files";
import { areaLabelOf, codeGraphOf, sourceSeedOf } from "~/world-from-code";
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
 * The source parsed, its load failure, or null when none was asked for. A
 * repository the user brought leaves out files that do not parse; bundled
 * examples stay strict, so a syntax error in one shows in the HUD.
 */
const codeOf = (loaded: LoadedSource, tolerant: boolean): CodeResult | null => {
  if (loaded.state === "failed") {
    return { codeGraph: null, error: loaded.error };
  }
  return loaded.files === null ? null : codeGraphOf(loaded.files, { tolerant });
};

/**
 * The world of `request` once its files are known. Parsed once: a syntax
 * error, or an example that failed to load, does not depend on the seed,
 * and it is shown like any generation error rather than thrown through the
 * renderer.
 */
const worldSetup = (
  request: SourceRequest,
  loaded: LoadedSource
): WorldSetup => {
  const sourceFiles = loaded.state === "loaded" ? loaded.files : null;
  const local = request.kind === "local";
  const code = codeOf(loaded, local);
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
    startSeed: initialSeed(
      initial,
      sourceFiles === null ? null : sourceSeedOf(sourceFiles)
    ),
    // The world map's links and labels, made once like the code graph, so
    // the map is rebuilt only when the world grows.
    areaLinks: codeGraph === null ? [] : areaLinksOf(codeGraph),
    labelOfArea: (areaId) => areaLabelOf(codeGraph, areaId),
  };
};

/**
 * True once `request` has been on screen for a frame. Parsing a repository
 * blocks the tab, so the loading screen paints first; a request with nothing
 * that slow is ready at once.
 */
const usePainted = (request: SourceRequest): boolean => {
  const [painted, setPainted] = useState<SourceRequest | null>(null);
  useEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (request.kind === "local") {
      // The frame callback runs before that frame paints; the timer after it.
      frame = requestAnimationFrame(() => {
        timer = setTimeout(() => setPainted(request), 0);
      });
    }
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [request]);
  return request.kind !== "local" || painted === request;
};

/** The world setup of `request`, null while its files load or wait to parse. */
const useWorldSetup = (request: SourceRequest): WorldSetup | null => {
  const loaded = useSourceFiles(request);
  const painted = usePainted(request);
  return useMemo(
    () =>
      loaded.state === "loading" || !painted
        ? null
        : worldSetup(request, loaded),
    [request, loaded, painted]
  );
};

export { initial, noticesOf, useWorldSetup, worldSetup };
export type { WorldSetup };
