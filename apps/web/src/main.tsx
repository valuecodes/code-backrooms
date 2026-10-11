import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { parseWorldParams } from "./params";

import "./globals.css";

// Each page is its own chunk: `?view=map` never fetches three.js.
const App = lazy(() => import("./app").then((m) => ({ default: m.App })));
const WorldMapPage = lazy(() =>
  import("./world-map-page").then((m) => ({ default: m.WorldMapPage }))
);

const { view } = parseWorldParams(globalThis.location.search);

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <Suspense fallback={<div className="h-dvh w-screen bg-black" />}>
        {view === "map" ? <WorldMapPage /> : <App />}
      </Suspense>
    </StrictMode>
  );
} else {
  const message = "Root element with id 'root' not found";
  console.error(message);
  throw new Error(message);
}
