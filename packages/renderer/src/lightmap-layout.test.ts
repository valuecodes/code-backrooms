import { PlaneGeometry } from "three";
import { describe, expect, it } from "vitest";

import {
  layoutArea,
  MAX_TEXELS,
  TEXEL,
  writeLightmapUv,
} from "./lightmap-layout";
import type { Chart } from "./lightmap-layout";
import { mergeBoxes } from "./merge";
import { areaOf, testRoom } from "./test-rooms";

/** A chart with its gutter, as packed. */
const padded = ({ x, y, w, h }: Chart) => ({
  x0: x - 1,
  y0: y - 1,
  x1: x + w + 1,
  y1: y + h + 1,
});

const charts = (layout: ReturnType<typeof layoutArea>): Chart[] =>
  layout.faces.flatMap(({ chart }) => (chart === null ? [] : [chart]));

const TWO_ROOMS = areaOf(
  testRoom("a", 0, 0, 4, 4, ["east"]),
  testRoom("b", 4, 0, 4, 6, ["west"])
);

describe("layoutArea", () => {
  it("packs charts without overlap, inside the atlas", () => {
    const layout = layoutArea(TWO_ROOMS);
    const boxes = charts(layout).map(padded);
    for (const [i, a] of boxes.entries()) {
      expect(a.x0).toBeGreaterThanOrEqual(0);
      expect(a.y0).toBeGreaterThanOrEqual(0);
      expect(a.x1).toBeLessThanOrEqual(layout.width);
      expect(a.y1).toBeLessThanOrEqual(layout.height);
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
        expect(apart).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    expect(layoutArea(TWO_ROOMS)).toEqual(layoutArea(TWO_ROOMS));
  });

  it("gives a room its floor, ceiling and six faces a wall segment", () => {
    const layout = layoutArea(TWO_ROOMS);
    const [a] = TWO_ROOMS.built.rooms;
    expect(layout.rooms[0]).toHaveLength(2 + 6 * (a?.segments.length ?? 0));
    expect(layout.rooms[0]?.[0]).toMatchObject({ axis: 1, sign: 1, at: 0 });
    expect(layout.rooms[0]?.[1]).toMatchObject({ axis: 1, sign: -1 });
  });

  it("charts a lintel's underside but not a wall's top or bottom", () => {
    const layout = layoutArea(TWO_ROOMS);
    const segments = TWO_ROOMS.built.rooms[0]?.segments ?? [];
    segments.forEach((segment, index) => {
      // +y is the third face of a box, −y the fourth.
      const top = layout.rooms[0]?.[2 + index * 6 + 2];
      const bottom = layout.rooms[0]?.[2 + index * 6 + 3];
      expect(top?.chart).toBeNull();
      expect(bottom?.chart !== null).toBe(segment.kind === "lintel");
    });
  });

  it("doubles the texel when the atlas would exceed MAX_TEXELS", () => {
    const huge = layoutArea(areaOf(testRoom("h", 0, 0, 200, 200)));
    expect(huge.texel).toBeGreaterThan(TEXEL);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_TEXELS);
    expect(layoutArea(TWO_ROOMS).texel).toBe(TEXEL);
  });

  it("fits a long narrow corridor's floor in the atlas width", () => {
    const layout = layoutArea(areaOf(testRoom("c", 0, 0, 120, 2)));
    const floor = layout.rooms[0]?.[0]?.chart;
    expect(floor).not.toBeNull();
    expect((floor?.x ?? 0) + (floor?.w ?? 0)).toBeLessThan(layout.width);
  });
});

describe("writeLightmapUv", () => {
  it("maps every vertex of a visible face inside its chart", () => {
    const layout = layoutArea(TWO_ROOMS);
    const room = TWO_ROOMS.built.rooms[0];
    const faces = layout.rooms[0] ?? [];
    const walls = mergeBoxes(room?.segments ?? [], 1);
    expect(walls).not.toBeNull();
    if (walls === null) {
      return;
    }
    writeLightmapUv(walls, faces.slice(2), layout, 4);
    const uv1 = walls.getAttribute("uv1");
    for (let i = 0; i < uv1.count; i += 1) {
      const chart = faces[2 + Math.floor(i / 4)]?.chart;
      if (chart === null || chart === undefined) {
        continue;
      }
      // uv1 is stored as float32.
      const x = uv1.getX(i) * layout.width;
      const y = uv1.getY(i) * layout.height;
      expect(x).toBeGreaterThanOrEqual(chart.x - 1e-4);
      expect(x).toBeLessThanOrEqual(chart.x + chart.w + 1e-4);
      expect(y).toBeGreaterThanOrEqual(chart.y - 1e-4);
      expect(y).toBeLessThanOrEqual(chart.y + chart.h + 1e-4);
    }
  });

  it("spans the whole chart for a floor in world space", () => {
    const layout = layoutArea(TWO_ROOMS);
    const floorFace = layout.rooms[0]?.[0];
    const chart = floorFace?.chart;
    const plane = new PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
    writeLightmapUv(
      plane,
      floorFace === undefined ? [] : [floorFace],
      layout,
      4
    );
    const uv1 = plane.getAttribute("uv1");
    const xs = Array.from({ length: 4 }, (_, i) => uv1.getX(i) * layout.width);
    const ys = Array.from({ length: 4 }, (_, i) => uv1.getY(i) * layout.height);
    expect(Math.min(...xs)).toBeCloseTo(chart?.x ?? -1);
    expect(Math.max(...xs)).toBeCloseTo((chart?.x ?? 0) + (chart?.w ?? 0));
    expect(Math.min(...ys)).toBeCloseTo(chart?.y ?? -1);
    expect(Math.max(...ys)).toBeCloseTo((chart?.y ?? 0) + (chart?.h ?? 0));
  });
});
