import type { BakeJob } from "./bake";
import type { Rgb } from "./lane-tint";
import type { Chart, LightmapFace, Solid } from "./lightmap-layout";

// Reads a bake job out of a worker message: a fresh copy holding only
// finite numbers, axes 0, 1 or 2, and charts of whole texels inside the
// atlas, so nothing the bake indexes by comes from the message unchecked.

const fail = (what: string): never => {
  throw new Error(`malformed bake job: ${what}`);
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : fail(`no ${key}`);

const list = (value: unknown, what: string): readonly unknown[] =>
  Array.isArray(value) ? value : fail(`${what} is not a list`);

const finite = (value: unknown, what: string): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fail(`${what} is not a number`);
};

const whole = (value: unknown, what: string, below: number): number => {
  const number = finite(value, what);
  return Number.isInteger(number) && number >= 0 && number < below
    ? number
    : fail(`${what} is out of range`);
};

const triple = (value: unknown, what: string): [number, number, number] => {
  const [x, y, z] = list(value, what);
  return [finite(x, what), finite(y, what), finite(z, what)];
};

const pair = (value: unknown, what: string): [number, number] => {
  const [x, y] = list(value, what);
  return [finite(x, what), finite(y, what)];
};

const axisOf = (value: unknown): LightmapFace["axis"] => {
  const axis = Number(value);
  if (axis === 0) {
    return 0;
  }
  if (axis === 1) {
    return 1;
  }
  return axis === 2 ? 2 : fail("axis is not 0, 1 or 2");
};

const chartOf = (
  value: unknown,
  width: number,
  height: number
): Chart | null => {
  if (value === null) {
    return null;
  }
  // A chart keeps a one-texel gutter inside the atlas on every side.
  const x = whole(field(value, "x"), "chart x", width);
  const y = whole(field(value, "y"), "chart y", height);
  const w = whole(field(value, "w"), "chart w", width - x);
  const h = whole(field(value, "h"), "chart h", height - y);
  return x > 0 && y > 0 && w > 0 && h > 0
    ? { x, y, w, h }
    : fail("chart outside the atlas");
};

const faceOf = (
  value: unknown,
  width: number,
  height: number,
  rooms: number
): LightmapFace => ({
  axis: axisOf(field(value, "axis")),
  sign: finite(field(value, "sign"), "sign") < 0 ? -1 : 1,
  at: finite(field(value, "at"), "at"),
  min: pair(field(value, "min"), "min"),
  max: pair(field(value, "max"), "max"),
  albedo: triple(field(value, "albedo"), "albedo") satisfies Rgb,
  chart: chartOf(field(value, "chart"), width, height),
  room: whole(field(value, "room"), "room", rooms),
});

const solidOf = (value: unknown): Solid => ({
  min: triple(field(value, "min"), "solid min"),
  max: triple(field(value, "max"), "solid max"),
});

/** A whole atlas side: positive and no larger than any layout makes. */
const MAX_SIDE = 4096;

/** The job in a worker message, or a throw if it is not one. */
const readBakeJob = (data: unknown): BakeJob => {
  const layout = field(data, "layout");
  const width = whole(field(layout, "width"), "width", MAX_SIDE + 1);
  const height = whole(field(layout, "height"), "height", MAX_SIDE + 1);
  if (width === 0 || height === 0) {
    fail("empty atlas");
  }
  const solids = list(field(layout, "solids"), "solids").map((room) =>
    list(room, "room solids").map(solidOf)
  );
  return {
    layout: {
      width,
      height,
      texel: finite(field(layout, "texel"), "texel"),
      faces: list(field(layout, "faces"), "faces").map((face) =>
        faceOf(face, width, height, solids.length)
      ),
      solids,
    },
    lights: list(field(data, "lights"), "lights").map((light) =>
      triple(light, "light")
    ),
  };
};

export { readBakeJob };
