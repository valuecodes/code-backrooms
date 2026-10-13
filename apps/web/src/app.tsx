import { lazy, Suspense, useState } from "react";

import { Landing } from "~/landing";
import {
  labelOfRequest,
  repoOfSearch,
  requestFromParams,
  showsLanding,
} from "~/source-request";
import { WorldLoading } from "~/world-loading";
import { initial, useWorldSetup } from "~/world-setup";

// The 3D world is its own chunk: the landing page paints before three.js
// has loaded, and a visitor who only reads it never fetches the world.
const WorldApp = lazy(() =>
  import("~/world-app").then((m) => ({ default: m.WorldApp }))
);

/**
 * The landing page for a bare URL; else the 3D world once its source has
 * its files (`?code=self` waits) and, for a zip or folder, is parsed.
 */
const App = () => {
  const [request, setRequest] = useState(() => requestFromParams(initial));
  const setup = useWorldSetup(request);
  if (showsLanding(request, globalThis.location.search)) {
    return (
      <Landing
        onLoad={setRequest}
        initialRepo={repoOfSearch(globalThis.location.search)}
      />
    );
  }
  const loading = (
    <WorldLoading
      label={labelOfRequest(request)}
      phase={request.kind === "local" ? "analysing" : "loading"}
    />
  );
  return setup === null ? (
    loading
  ) : (
    <Suspense fallback={loading}>
      <WorldApp setup={setup} />
    </Suspense>
  );
};

export { App };
