import type { WorldGraph } from "@repo/types";

/** The original two hand-placed rooms. */
const lobby: WorldGraph = {
  rooms: [
    { id: "lobby", width: 10, depth: 8 },
    { id: "annex", width: 8, depth: 6 },
  ],
  connections: [{ from: "lobby", to: "annex" }],
};

/** A chain of mixed sizes: every room has at most two doors. */
const linear: WorldGraph = {
  rooms: [
    { id: "a", width: 6, depth: 5 },
    { id: "b", width: 8, depth: 10 },
    { id: "c", width: 12, depth: 6 },
    { id: "d", width: 5, depth: 5 },
    { id: "e", width: 10, depth: 8 },
    { id: "f", width: 7, depth: 9 },
  ],
  connections: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "d", to: "e" },
    { from: "e", to: "f" },
  ],
};

/** An if/else: entry, a branch room, and one room per outcome. */
const branching: WorldGraph = {
  rooms: [
    { id: "entry", width: 8, depth: 8 },
    { id: "branch", width: 10, depth: 10 },
    { id: "true", width: 6, depth: 6 },
    { id: "false", width: 6, depth: 6 },
  ],
  connections: [
    { from: "entry", to: "branch" },
    { from: "branch", to: "true" },
    { from: "branch", to: "false" },
  ],
};

/** A switch: one large hub with six exits of mixed sizes. */
const hub: WorldGraph = {
  rooms: [
    { id: "hub", width: 16, depth: 12 },
    { id: "s1", width: 5, depth: 5 },
    { id: "s2", width: 6, depth: 8 },
    { id: "s3", width: 8, depth: 6 },
    { id: "s4", width: 10, depth: 10 },
    { id: "s5", width: 5, depth: 7 },
    { id: "s6", width: 12, depth: 8 },
  ],
  connections: [
    { from: "hub", to: "s1" },
    { from: "hub", to: "s2" },
    { from: "hub", to: "s3" },
    { from: "hub", to: "s4" },
    { from: "hub", to: "s5" },
    { from: "hub", to: "s6" },
  ],
};

/** A loop of four rooms: the last connection has to close a cycle. */
const cycle: WorldGraph = {
  rooms: [
    { id: "a", width: 8, depth: 8 },
    { id: "b", width: 6, depth: 6 },
    { id: "c", width: 8, depth: 6 },
    { id: "d", width: 6, depth: 8 },
  ],
  connections: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "d", to: "a" },
  ],
};

const presets = { lobby, linear, branching, hub, cycle } as const;

type PresetName = keyof typeof presets;

const isPresetName = (name: string): name is PresetName =>
  Object.hasOwn(presets, name);

export { isPresetName, presets };
export type { PresetName };
