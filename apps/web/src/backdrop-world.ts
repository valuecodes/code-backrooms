import type { AreaWorld } from "@repo/types";

import { analyse } from "~/analyse";
import { bundledFiles } from "~/example-files";
import { storeFor } from "~/use-area-world";

// The world behind the landing page: the bundled `demo` example's entrance,
// generated the way `?code=demo` generates it, so it looks like the real
// thing. Only the first area is built; the camera never leaves it.

/**
 * The demo's first area, or null when it cannot be built: the landing page
 * then shows no backdrop rather than an error.
 */
const backdropWorld = (): AreaWorld | null => {
  const files = bundledFiles("demo");
  if (files === null) {
    return null;
  }
  const { code, sourceSeed } = analyse(files, { tolerant: false });
  if (code.codeGraph === null || sourceSeed === null) {
    return null;
  }
  const { store } = storeFor(sourceSeed, {
    codeGraph: code.codeGraph,
    codeError: code.error,
    eager: false,
    rooms: 0,
    preset: null,
  });
  return store?.snapshot().world ?? null;
};

export { backdropWorld };
