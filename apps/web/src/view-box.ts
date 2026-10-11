import type { Point, Rect } from "@repo/types";

import { labelFontSize } from "~/world-map-model";

// What part of the world map is on screen, in world metres (screen y is world
// z), and how wheel and drag move it. Kept free of the DOM so the maths is
// tested; `use-view-box` only feeds it events.

type ViewBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Where the svg sits on screen, as `getBoundingClientRect` gives it. */
type ScreenRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type ScreenPoint = { readonly x: number; readonly y: number };

/** Detail level of the map: everything, or areas without rooms and labels. */
type DetailLevel = "full" | "overview";

/** The narrowest view in metres: a few rooms across. */
const MIN_VIEW_WIDTH = 40;
/** Wider than this, room rects and area labels are too small to read. */
const DETAIL_WIDTH = 600;
/** Zone names are drawn at least this fraction of the view's width tall. */
const ZONE_NAMES_ACROSS = 90;
/** Monospace advance as a fraction of the font size, plus the insets. */
const CHAR_WIDTH = 0.62;
const NAME_INSETS = 0.6;
/** A name's baseline sits one size down; descenders take a quarter more. */
const LINE_HEIGHT = 1.25;
/** How much one pixel of wheel travel zooms, and the most one event may. */
const ZOOM_PER_PIXEL = 0.0015;
const MAX_WHEEL_PIXELS = 300;
/** Pixels per wheel unit by `WheelEvent.deltaMode`: pixels, lines, pages. */
const WHEEL_UNIT_PIXELS: readonly number[] = [1, 16, 400];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The whole world with a label's height of margin: the map's home view. */
const fitViewBox = (bounds: Rect): ViewBox => {
  const pad = labelFontSize(bounds);
  return {
    x: bounds.minX - pad,
    y: bounds.minZ - pad,
    width: Math.max(bounds.maxX - bounds.minX + pad * 2, 1),
    height: Math.max(bounds.maxZ - bounds.minZ + pad * 2, 1),
  };
};

/**
 * `box` made valid against `fit`: no narrower than `MIN_VIEW_WIDTH`, no wider
 * than `fit`, with `fit`'s aspect, and its edges inside `fit`. A view saved
 * while the map page generates stays valid as `fit` grows or shrinks.
 */
const clampView = (box: ViewBox, fit: ViewBox): ViewBox => {
  const width = clamp(
    box.width,
    Math.min(MIN_VIEW_WIDTH, fit.width),
    fit.width
  );
  const height = (width * fit.height) / fit.width;
  const x = box.x + box.width / 2 - width / 2;
  const y = box.y + box.height / 2 - height / 2;
  return {
    x: clamp(x, fit.x, fit.x + fit.width - width),
    y: clamp(y, fit.y, fit.y + fit.height - height),
    width,
    height,
  };
};

/**
 * World metres per screen pixel: `preserveAspectRatio="xMidYMid meet"`
 * scales by the tighter of the two axes.
 */
const viewScale = (box: ViewBox, rect: ScreenRect): number =>
  Math.max(
    box.width / Math.max(rect.width, 1),
    box.height / Math.max(rect.height, 1)
  );

/** The world point under a screen point, letterboxing included. */
const clientToViewBox = (
  box: ViewBox,
  rect: ScreenRect,
  client: ScreenPoint
): Point => {
  const scale = viewScale(box, rect);
  return {
    x:
      box.x -
      (rect.width * scale - box.width) / 2 +
      (client.x - rect.left) * scale,
    z:
      box.y -
      (rect.height * scale - box.height) / 2 +
      (client.y - rect.top) * scale,
  };
};

/** `box` scaled by `factor` (> 1 zooms out), keeping `point` where it is. */
const zoomAbout = (
  box: ViewBox,
  factor: number,
  point: Point,
  fit: ViewBox
): ViewBox =>
  clampView(
    {
      x: point.x - (point.x - box.x) * factor,
      y: point.z - (point.z - box.y) * factor,
      width: box.width * factor,
      height: box.height * factor,
    },
    fit
  );

/** `box` moved by world metres, its edges kept inside `fit`. */
const panBy = (box: ViewBox, dx: number, dy: number, fit: ViewBox): ViewBox =>
  clampView({ ...box, x: box.x + dx, y: box.y + dy }, fit);

/**
 * The zoom factor of one wheel event: scrolling down zooms out. Lines and
 * pages are turned into pixels; one event zooms by at most a fixed step, and
 * the same distance back undoes it exactly.
 */
const wheelFactor = (deltaY: number, deltaMode: number): number => {
  const unit = WHEEL_UNIT_PIXELS[deltaMode] ?? 1;
  const pixels = clamp(deltaY * unit, -MAX_WHEEL_PIXELS, MAX_WHEEL_PIXELS);
  return Math.exp(pixels * ZOOM_PER_PIXEL);
};

/** Rooms and area labels show only once the view is narrow enough. */
const detailLevel = (width: number): DetailLevel =>
  width > DETAIL_WIDTH ? "overview" : "full";

/**
 * A zone name's height in metres: a fixed share of the view, so names stay
 * readable when zoomed out, but never wider or taller than the zone's band
 * and never below `base`.
 */
const zoneLabelSize = (
  viewWidth: number,
  base: number,
  band: { readonly width: number; readonly height: number },
  text: string
): number => {
  const fitsAcross = band.width / (text.length * CHAR_WIDTH + NAME_INSETS);
  const fitsDown = band.height / LINE_HEIGHT;
  return Math.max(
    base,
    Math.min(viewWidth / ZONE_NAMES_ACROSS, fitsAcross, fitsDown)
  );
};

export {
  clampView,
  clientToViewBox,
  detailLevel,
  fitViewBox,
  panBy,
  viewScale,
  wheelFactor,
  zoneLabelSize,
  zoomAbout,
};
export type { ViewBox };
