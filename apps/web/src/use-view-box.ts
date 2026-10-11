import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { ViewBox } from "~/view-box";
import {
  clampView,
  clientToViewBox,
  panBy,
  viewScale,
  wheelFactor,
  zoomAbout,
} from "~/view-box";

type Drag = { readonly pointer: number; x: number; y: number };

type ViewBoxControls = {
  /** What the map shows: `fit` until the user zooms. */
  readonly viewBox: ViewBox;
  /** For the map's `<svg>`: wheel zooms, drag pans, double-click resets. */
  readonly ref: (svg: SVGSVGElement | null) => (() => void) | undefined;
  /** Runs `read` with the map showing `fit`, then restores the zoom. */
  readonly atFit: <T>(read: () => T) => T;
};

/**
 * Wheel zoom about the cursor, drag pan and double-click reset for a map
 * whose home view is `fit`. Until the user zooms the view follows `fit`, so
 * the map page keeps fitting while areas arrive; after that a zoomed view
 * is clamped to the current `fit` on every render.
 */
const useViewBox = (fit: ViewBox): ViewBoxControls => {
  const [zoomed, setZoomed] = useState<ViewBox | null>(null);
  const viewBox = zoomed === null ? fit : clampView(zoomed, fit);
  // Listeners attach once per svg; they read the latest values from here.
  // Each handler also writes `shown`, so a burst of wheel events builds on
  // the previous one before React renders it.
  const shown = useRef(viewBox);
  const home = useRef(fit);
  const saved = useRef(zoomed);
  useLayoutEffect(() => {
    shown.current = viewBox;
    home.current = fit;
    saved.current = zoomed;
  });

  const show = useCallback((next: ViewBox | null) => {
    shown.current = next ?? home.current;
    setZoomed(next);
  }, []);

  const ref = useCallback(
    (svg: SVGSVGElement | null) => {
      if (svg === null) {
        return undefined;
      }
      let drag: Drag | null = null;
      const onWheel = (event: WheelEvent) => {
        // The page must not scroll: the listener is registered non-passive.
        event.preventDefault();
        const box = shown.current;
        const point = clientToViewBox(box, svg.getBoundingClientRect(), {
          x: event.clientX,
          y: event.clientY,
        });
        const next = zoomAbout(
          box,
          wheelFactor(event.deltaY, event.deltaMode),
          point,
          home.current
        );
        // Zoomed all the way out: follow `fit` again.
        show(next.width >= home.current.width ? null : next);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) {
          return;
        }
        svg.setPointerCapture(event.pointerId);
        drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
      };
      const onPointerMove = (event: PointerEvent) => {
        if (drag?.pointer !== event.pointerId) {
          return;
        }
        const box = shown.current;
        const scale = viewScale(box, svg.getBoundingClientRect());
        const dx = (drag.x - event.clientX) * scale;
        const dy = (drag.y - event.clientY) * scale;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (dx !== 0 || dy !== 0) {
          show(panBy(box, dx, dy, home.current));
        }
      };
      const onPointerEnd = (event: PointerEvent) => {
        if (drag?.pointer === event.pointerId) {
          drag = null;
        }
      };
      const onDoubleClick = () => show(null);
      svg.addEventListener("wheel", onWheel, { passive: false });
      svg.addEventListener("pointerdown", onPointerDown);
      svg.addEventListener("pointermove", onPointerMove);
      svg.addEventListener("pointerup", onPointerEnd);
      svg.addEventListener("pointercancel", onPointerEnd);
      svg.addEventListener("dblclick", onDoubleClick);
      return () => {
        svg.removeEventListener("wheel", onWheel);
        svg.removeEventListener("pointerdown", onPointerDown);
        svg.removeEventListener("pointermove", onPointerMove);
        svg.removeEventListener("pointerup", onPointerEnd);
        svg.removeEventListener("pointercancel", onPointerEnd);
        svg.removeEventListener("dblclick", onDoubleClick);
      };
    },
    [show]
  );

  // Within one task the browser paints neither change, so nothing flickers.
  const atFit = useCallback(<T>(read: () => T): T => {
    const keep = saved.current;
    flushSync(() => setZoomed(null));
    try {
      return read();
    } finally {
      flushSync(() => setZoomed(keep));
    }
  }, []);

  return { viewBox, ref, atFit };
};

export { useViewBox };
