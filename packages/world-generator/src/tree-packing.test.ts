import type { Point, Rect } from "@repo/types";
import { describe, expect, it } from "vitest";

import { AREA_GAP, GRID } from "./config";
import { rectGap } from "./fit";
import { createRng, nextInt } from "./random";
import { MAX_RINGS, packTree, placeNext, RING_STEP } from "./tree-packing";
import type { PlacedSlot, TreeSlot } from "./tree-packing";

const square = (size: number): Rect => ({
  minX: -size / 2,
  maxX: size / 2,
  minZ: -size / 2,
  maxZ: size / 2,
});

const centreOf = (rect: Rect): Point => ({
  x: (rect.minX + rect.maxX) / 2,
  z: (rect.minZ + rect.maxZ) / 2,
});

/** Random off-grid rects, each parented on a random earlier one. */
const randomTree = (
  seed: number,
  count: number
): { slots: TreeSlot[]; parents: Map<string, string> } => {
  const rng = createRng(seed);
  const parents = new Map<string, string>();
  const slots = Array.from({ length: count }, (_, index): TreeSlot => {
    const width = nextInt(rng, 16, 640) / 4;
    const depth = nextInt(rng, 16, 400) / 4;
    const minX = -nextInt(rng, 0, Math.floor(width));
    const minZ = -nextInt(rng, 0, Math.floor(depth));
    if (index > 0) {
      parents.set(`a${index}`, `a${nextInt(rng, 0, index - 1)}`);
    }
    return {
      id: `a${index}`,
      rect: { minX, maxX: minX + width, minZ, maxZ: minZ + depth },
    };
  });
  return { slots, parents };
};

const placedOf = (
  slots: readonly TreeSlot[],
  parents: ReadonlyMap<string, string>
): PlacedSlot[] => {
  const placed: PlacedSlot[] = [];
  for (const slot of slots) {
    placed.push(placeNext(placed, slot, parents));
  }
  return placed;
};

const trees = [1, 2, 3, 4, 5, 6].map((seed) => randomTree(seed, 40));

describe("packTree", () => {
  it("keeps the first area at the origin and is prefix-stable", () => {
    for (const { slots, parents } of trees) {
      const offsets = packTree(slots, parents);
      expect(offsets[0]).toEqual({ x: 0, z: 0 });
      for (let n = 0; n <= slots.length; n += 1) {
        expect(packTree(slots.slice(0, n), parents)).toEqual(
          offsets.slice(0, n)
        );
      }
    }
  });

  it("keeps every pair AREA_GAP apart, on the grid", () => {
    for (const [index, { slots, parents }] of trees.entries()) {
      const placed = placedOf(slots, parents);
      for (const [i, a] of placed.entries()) {
        expect(Math.abs((a.offset.x / GRID) % 1)).toBeLessThan(1e-9);
        expect(Math.abs((a.offset.z / GRID) % 1)).toBeLessThan(1e-9);
        for (const b of placed.slice(i + 1)) {
          expect(
            rectGap(a.rect, b.rect),
            `tree ${index}: ${a.id} and ${b.id}`
          ).toBeGreaterThanOrEqual(AREA_GAP - 1e-9);
        }
      }
    }
  });

  it("puts nearly every area beside its parent, within the rings", () => {
    const reach = AREA_GAP + (MAX_RINGS - 1) * RING_STEP;
    for (const [index, { slots, parents }] of trees.entries()) {
      const placed = placedOf(slots, parents);
      const byId = new Map(placed.map((slot) => [slot.id, slot]));
      const far = placed.slice(1).filter((slot) => {
        const parent = byId.get(parents.get(slot.id) ?? "");
        expect(slot.anchor).toBe(parent?.id);
        return rectGap(slot.rect, parent?.rect ?? slot.rect) > reach + GRID;
      });
      // A crowded parent sends the odd area out past its rings.
      expect(far.length, `tree ${index}`).toBeLessThanOrEqual(4);
    }
  });

  it("fans the entry's children out round it, a branch each way", () => {
    // Branches go by id, whatever order the areas come in.
    const children = ["d", "a", "c", "b"];
    const parents = new Map(
      children.map((id): [string, string] => [id, "entry"])
    );
    const placed = placedOf(
      ["entry", ...children].map((id) => ({ id, rect: square(20) })),
      parents
    );
    placed.slice(1).forEach((slot) => {
      const { x, z } = centreOf(slot.rect);
      const angle = (2 * Math.PI * children.toSorted().indexOf(slot.id)) / 4;
      expect(
        x * Math.cos(angle) + z * Math.sin(angle),
        `branch ${slot.id}`
      ).toBeGreaterThan(0);
    });
  });

  it("grows a branch outward, away from the area before", () => {
    const parents = new Map([
      ["a", "entry"],
      ["b", "a"],
      ["c", "b"],
    ]);
    const placed = placedOf(
      ["entry", "a", "b", "c"].map((id) => ({ id, rect: square(20) })),
      parents
    );
    const distances = placed.map(({ rect }) =>
      Math.hypot(...Object.values(centreOf(rect)))
    );
    expect(distances).toEqual([...distances].toSorted((x, y) => x - y));
    expect(new Set(distances).size).toBe(4);
  });

  it("anchors on the nearest placed ancestor, else on the entry", () => {
    const parents = new Map([
      ["a", "entry"],
      ["b", "a"],
      ["c", "b"],
    ]);
    const slot = (id: string) => ({ id, rect: square(10) });
    expect(placedOf([slot("entry"), slot("c")], parents)[1]?.anchor).toBe(
      "entry"
    );
    expect(
      placedOf([slot("entry"), slot("a"), slot("c")], parents)[2]?.anchor
    ).toBe("a");
  });

  it("anchors on the entry when the parents form a cycle", () => {
    const parents = new Map([
      ["x", "y"],
      ["y", "x"],
    ]);
    const placed = placedOf(
      [
        { id: "entry", rect: square(10) },
        { id: "x", rect: square(10) },
      ],
      parents
    );
    expect(placed[1]?.anchor).toBe("entry");
  });

  it("goes out along its heading when no ring has room, still apart", () => {
    // A frame round the entry that every ring overlaps.
    const frame: PlacedSlot[] = [
      { minX: -1200, maxX: -45, minZ: -1200, maxZ: 1200 },
      { minX: 45, maxX: 1200, minZ: -1200, maxZ: 1200 },
      { minX: -45, maxX: 45, minZ: -1200, maxZ: -45 },
      { minX: -45, maxX: 45, minZ: 45, maxZ: 1200 },
    ].map((rect, index) => ({
      id: `frame${index}`,
      rect,
      offset: { x: 0, z: 0 },
      anchor: "entry",
    }));
    const entry: PlacedSlot = {
      id: "entry",
      rect: square(10),
      offset: { x: 0, z: 0 },
      anchor: null,
    };
    const placed = [entry, ...frame];
    const next = placeNext(
      placed,
      { id: "a", rect: square(30) },
      new Map([["a", "entry"]])
    );
    for (const other of placed) {
      expect(
        rectGap(next.rect, other.rect),
        `from ${other.id}`
      ).toBeGreaterThanOrEqual(AREA_GAP - 1e-9);
    }
    expect(next.anchor).toBe("entry");
  });
});
