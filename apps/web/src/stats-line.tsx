import type { RenderSample } from "@repo/renderer/stats";
import { useSyncExternalStore } from "react";

import type { Feed } from "~/feed";
import { statsText } from "~/stats-text";

type StatsLineProps = {
  /** Filled from the render loop about twice a second. */
  readonly feed: Feed<RenderSample>;
  /** Areas generated so far. */
  readonly areas: number;
};

/** The renderer's numbers, bottom right; only this line re-renders per sample. */
const StatsLine = ({ feed, areas }: StatsLineProps) => {
  const sample = useSyncExternalStore(feed.subscribe, feed.get);
  return (
    <p className="pointer-events-none absolute right-4 bottom-3 font-mono text-xs text-amber-100/50">
      {statsText(sample, areas)}
    </p>
  );
};

export { StatsLine };
