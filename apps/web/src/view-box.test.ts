import { describe, expect, it } from "vitest";

import {
  clampView,
  clientToViewBox,
  detailLevel,
  fitViewBox,
  panBy,
  wheelFactor,
  zoneLabelSize,
  zoomAbout,
} from "./view-box";
import type { ViewBox } from "./view-box";

/** The `?code=self` world's size: eight zone strips side by side. */
const SELF: ViewBox = { x: -15, y: -21, width: 4422, height: 1198.5 };
/** A screen exactly the view's aspect, a metre a pixel. */
const screen = { left: 10, top: 20, width: 4422, height: 1198.5 };

const inside = (box: ViewBox, fit: ViewBox) => {
  expect(box.x).toBeGreaterThanOrEqual(fit.x - 1e-9);
  expect(box.y).toBeGreaterThanOrEqual(fit.y - 1e-9);
  expect(box.x + box.width).toBeLessThanOrEqual(fit.x + fit.width + 1e-9);
  expect(box.y + box.height).toBeLessThanOrEqual(fit.y + fit.height + 1e-9);
};

describe("fitViewBox", () => {
  it("pads the bounds by a label's height on every side", () => {
    // 700 m wide: labels are 700 / 140 = 5 m.
    expect(fitViewBox({ minX: 0, maxX: 700, minZ: 10, maxZ: 110 })).toEqual({
      x: -5,
      y: 5,
      width: 710,
      height: 110,
    });
  });

  it("is never empty", () => {
    const box = fitViewBox({ minX: 3, maxX: 3, minZ: 4, maxZ: 4 });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe("clientToViewBox", () => {
  it("maps screen pixels to metres", () => {
    expect(clientToViewBox(SELF, screen, { x: 10, y: 20 })).toEqual({
      x: -15,
      z: -21,
    });
    expect(clientToViewBox(SELF, screen, { x: 110, y: 70 })).toEqual({
      x: 85,
      z: 29,
    });
  });

  it("accounts for the letterbox of a taller screen", () => {
    const box: ViewBox = { x: 0, y: 0, width: 100, height: 50 };
    // 100 px wide, 100 px tall: the 50 m tall view is centred, 25 px down.
    const tall = { left: 0, top: 0, width: 100, height: 100 };
    expect(clientToViewBox(box, tall, { x: 50, y: 25 })).toEqual({
      x: 50,
      z: 0,
    });
    expect(clientToViewBox(box, tall, { x: 0, y: 75 })).toEqual({
      x: 0,
      z: 50,
    });
  });
});

describe("zoomAbout", () => {
  it("keeps the world point under the cursor where it is", () => {
    const cursor = { x: 1500, y: 400 };
    const before = clientToViewBox(SELF, screen, cursor);
    const zoomed = zoomAbout(SELF, 0.25, before, SELF);
    expect(zoomed.width).toBeCloseTo(SELF.width / 4);
    const after = clientToViewBox(zoomed, screen, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
  });

  it("stops at the narrowest view and at the whole world", () => {
    const point = { x: 2000, z: 500 };
    expect(zoomAbout(SELF, 1e-6, point, SELF).width).toBe(40);
    expect(zoomAbout(SELF, 4, point, SELF)).toEqual(SELF);
  });
});

describe("panBy", () => {
  it("moves the view but keeps its edges inside the world", () => {
    const zoomed = zoomAbout(SELF, 0.1, { x: 2000, z: 500 }, SELF);
    const moved = panBy(zoomed, 100, -50, SELF);
    expect(moved.x).toBeCloseTo(zoomed.x + 100);
    expect(moved.y).toBeCloseTo(zoomed.y - 50);
    for (const [dx, dy] of [
      [1e6, 0],
      [-1e6, 0],
      [0, 1e6],
      [0, -1e6],
    ] as const) {
      inside(panBy(zoomed, dx, dy, SELF), SELF);
    }
  });
});

describe("clampView", () => {
  it("gives the whole world for a view wider than a shrunk world", () => {
    const smaller: ViewBox = { x: 0, y: 0, width: 400, height: 100 };
    expect(clampView(SELF, smaller)).toEqual(smaller);
  });

  it("pulls a view left outside a moved world back inside, keeping its size", () => {
    const view: ViewBox = { x: -500, y: -500, width: 200, height: 100 };
    const fit: ViewBox = { x: 0, y: 0, width: 1000, height: 500 };
    expect(clampView(view, fit)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("takes the world's aspect when the world changes shape", () => {
    const view: ViewBox = { x: 100, y: 100, width: 200, height: 100 };
    const fit: ViewBox = { x: 0, y: 0, width: 1000, height: 1000 };
    const box = clampView(view, fit);
    expect(box.width).toBe(200);
    expect(box.height).toBe(200);
    inside(box, fit);
  });

  it("lets a world narrower than the narrowest view fill the screen", () => {
    const tiny: ViewBox = { x: 0, y: 0, width: 10, height: 5 };
    expect(clampView(tiny, tiny)).toEqual(tiny);
  });
});

describe("wheelFactor", () => {
  it("zooms out scrolling down and in scrolling up, symmetrically", () => {
    expect(wheelFactor(100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(-100, 0)).toBeLessThan(1);
    expect(wheelFactor(100, 0) * wheelFactor(-100, 0)).toBeCloseTo(1);
  });

  it("turns lines and pages into pixels and caps one event", () => {
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0));
    expect(wheelFactor(1, 2)).toBeCloseTo(wheelFactor(300, 0));
    expect(wheelFactor(1e6, 0)).toBeCloseTo(wheelFactor(300, 0));
  });
});

describe("detailLevel", () => {
  it("hides rooms and labels only for wide views", () => {
    expect(detailLevel(600)).toBe("full");
    expect(detailLevel(601)).toBe("overview");
    expect(detailLevel(SELF.width)).toBe("overview");
  });
});

describe("zoneLabelSize", () => {
  it("never shrinks below the base size", () => {
    expect(zoneLabelSize(100, 8, 500, "web 25/25")).toBe(8);
    expect(zoneLabelSize(SELF.width, 8, 20, "a very long zone name")).toBe(8);
  });

  it("grows with the view while the name fits its band", () => {
    expect(zoneLabelSize(SELF.width, 8, 500, "web 25/25")).toBeCloseTo(
      SELF.width / 90
    );
    expect(zoneLabelSize(1800, 8, 500, "web 25/25")).toBe(20);
  });

  it("keeps a long name inside its zone's strip zoomed out", () => {
    const text = "@repo/world-generator 18/18";
    const band = 515.5;
    const size = zoneLabelSize(SELF.width, 8, band, text);
    expect(size).toBeLessThan(SELF.width / 90);
    // Monospace advance ≈ 0.6 em, plus the 0.3 em inset.
    expect(size * (text.length * 0.6 + 0.3)).toBeLessThanOrEqual(band);
  });
});
