import type { SourceFile } from "@repo/parser";

import type { ExampleName } from "~/example-files";
import type { WorldParams } from "~/params";

// What the 3D app builds its world from: nothing yet (the landing page, or a
// random or preset world), a bundled example named by the URL, or a zip,
// folder or GitHub repository the user brought. Their files live in memory
// only, so a reload returns to the landing page (with `?repo=` filled in for
// a GitHub repository).

type SourceRequest =
  | { readonly kind: "none" }
  | { readonly kind: "example"; readonly name: ExampleName }
  | {
      readonly kind: "local";
      /** The zip's or folder's name, shown in the HUD. */
      readonly label: string;
      readonly files: readonly SourceFile[];
      /** Files over the size cap, left out before anything was read. */
      readonly skipped: number;
    };

/** The URL's source: an example by `?code`, else nothing. */
const requestFromParams = (params: WorldParams): SourceRequest =>
  params.code === null
    ? { kind: "none" }
    : { kind: "example", name: params.code };

/** Any of these in the URL opens a world directly, valid or not. */
const WORLD_KEYS: readonly string[] = [
  "seed",
  "rooms",
  "graph",
  "code",
  "eager",
  "view",
];

/**
 * The landing page shows only for a bare URL: `?rooms=20` or `?seed=5` still
 * open a random world, and `?code=bogus` falls back to one as before.
 */
const showsLanding = (request: SourceRequest, search: string): boolean => {
  if (request.kind !== "none") {
    return false;
  }
  const params = new URLSearchParams(search);
  return !WORLD_KEYS.some((key) => params.has(key));
};

/**
 * `?repo=`, a GitHub repository to fill in on the landing page, or "". It
 * never opens a world by itself: the fetch waits for the visitor's check.
 */
const repoOfSearch = (search: string): string =>
  new URLSearchParams(search).get("repo") ?? "";

/**
 * The `?repo=` query that `repoOfSearch` reads back as `path`. Escaped, since
 * a query reads `+` as a space; `/` stays readable, a query never splits on it.
 */
const searchOfRepo = (path: string): string =>
  `?repo=${encodeURIComponent(path).replaceAll("%2F", "/")}`;

/** The name the HUD and loading screen show, null for a random world. */
const labelOfRequest = (request: SourceRequest): string | null => {
  if (request.kind === "none") {
    return null;
  }
  return request.kind === "example" ? request.name : request.label;
};

export {
  labelOfRequest,
  repoOfSearch,
  requestFromParams,
  searchOfRepo,
  showsLanding,
};
export type { SourceRequest };
