import { useEffect, useRef } from "react";

import type { SourceView } from "~/source-view";

type SourcePanelProps = {
  /** The room's code, or null where there is none (a corridor). */
  readonly view: SourceView | null;
};

/**
 * The code of the room the player stands in, docked right. The pointer is
 * locked while it shows, so it cannot be scrolled: it keeps the room's
 * marked code in view itself.
 */
const SourcePanel = ({ view }: SourcePanelProps) => {
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [view]);

  if (view === null) {
    return (
      <p className="pointer-events-none absolute top-3 right-4 bg-black/55 px-3 py-2 font-mono text-xs text-amber-100/50">
        no code here
      </p>
    );
  }
  const first = view.code.find((line) => line.marked !== "");
  return (
    <div className="pointer-events-none absolute top-3 right-4 bottom-14 flex w-[min(40rem,45vw)] flex-col gap-1 bg-black/55 px-3 py-2 font-mono text-xs text-amber-100/70">
      <p className="text-amber-100/90">
        {view.fn === null ? view.path : `${view.path} · ${view.fn}`}
      </p>
      <p className="text-amber-100/50">
        {view.region === null
          ? `lines ${view.lines}`
          : `${view.region} · lines ${view.lines}`}
      </p>
      <pre className="min-h-0 flex-1 overflow-hidden">
        {view.code.map((line) => (
          <div key={line.number} className="flex gap-3">
            <span className="w-8 shrink-0 text-right text-amber-100/30 select-none">
              {line.number}
            </span>
            <span>
              {line.before}
              {line.marked !== "" && (
                <mark
                  ref={line === first ? markRef : undefined}
                  className="bg-amber-300/25 text-amber-50"
                >
                  {line.marked}
                </mark>
              )}
              {line.after}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
};

export { SourcePanel };
