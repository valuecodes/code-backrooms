import { useEffect, useRef } from "react";

import type { SourceView } from "~/source-view";

type SourcePanelProps = {
  /** The room's code, or null where there is none (a corridor). */
  readonly view: SourceView | null;
};

/**
 * The code of the room the player stands in, docked right. The pointer is
 * locked while it shows, so it scrolls itself: to the room's marked code,
 * or the top when nothing is marked, and the mouse wheel scrolls it on.
 */
const SourcePanel = ({ view }: SourcePanelProps) => {
  const codeRef = useRef<HTMLPreElement>(null);
  const markRef = useRef<HTMLElement>(null);

  // Only the code scrolls (`scrollIntoView` would move every ancestor).
  useEffect(() => {
    const code = codeRef.current;
    const mark = markRef.current;
    if (code === null) {
      return;
    }
    if (mark === null) {
      code.scrollTop = 0;
      return;
    }
    const box = code.getBoundingClientRect();
    const marked = mark.getBoundingClientRect();
    // Centred, or from its top when it is taller than the panel.
    const margin = Math.max(0, (box.height - marked.height) / 2);
    code.scrollTop += marked.top - box.top - margin;
  }, [view]);

  // A locked pointer still sends wheel events, and nothing else uses them.
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      // Firefox may count in lines rather than pixels.
      const step = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      codeRef.current?.scrollBy({ top: event.deltaY * step });
    };
    globalThis.addEventListener("wheel", onWheel, { passive: true });
    return () => globalThis.removeEventListener("wheel", onWheel);
  }, []);

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
      <pre ref={codeRef} className="min-h-0 flex-1 overflow-hidden">
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
