import { describe, expect, it } from "vitest";

import type { BakeJob } from "./bake";
import { readBakeJob } from "./bake-job";
import { layoutArea } from "./lightmap-layout";
import { areaOf, testRoom } from "./test-rooms";

const layout = layoutArea(
  areaOf(
    testRoom("a", 0, 0, 4, 4, ["east"]),
    testRoom("b", 4, 0, 4, 4, ["west"])
  )
);

const JOB: BakeJob = {
  layout: {
    width: layout.width,
    height: layout.height,
    texel: layout.texel,
    faces: layout.faces,
    solids: layout.solids,
  },
  lights: [[0, 2.4, 0]],
};

/** The job with its first face's fields replaced. */
const withFace = (patch: Record<string, unknown>): unknown => ({
  ...JOB,
  layout: {
    ...JOB.layout,
    faces: [{ ...JOB.layout.faces[0], ...patch }, ...JOB.layout.faces.slice(1)],
  },
});

describe("readBakeJob", () => {
  it("reads back a job the page builds, unchanged", () => {
    expect(readBakeJob(structuredClone(JOB))).toEqual(JOB);
  });

  it.each([
    ["an axis that is not 0, 1 or 2", withFace({ axis: "__proto__" })],
    [
      "a chart past the atlas",
      withFace({ chart: { x: 1, y: 1, w: 1e6, h: 1 } }),
    ],
    [
      "a chart on the atlas edge",
      withFace({ chart: { x: 0, y: 1, w: 1, h: 1 } }),
    ],
    ["a fractional chart", withFace({ chart: { x: 1.5, y: 1, w: 1, h: 1 } })],
    ["a room that does not exist", withFace({ room: 99 })],
    ["a coordinate that is not a number", withFace({ at: "far" })],
    ["no layout", { lights: [] }],
    ["not an object", "bake"],
  ])("rejects %s", (_, data) => {
    expect(() => readBakeJob(data)).toThrow(/malformed bake job/);
  });
});
