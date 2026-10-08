import type { WorldData } from "./types";

/**
 * Two rooms sharing the edge x = 5. Door openings are derived from the overlap
 * of that edge (z in [-2, 4]), so both sides line up without extra data.
 */
const worldData: WorldData = {
  startRoomId: "lobby",
  rooms: [
    {
      id: "lobby",
      position: [0, 0, 0],
      width: 10,
      depth: 8,
      doors: [{ wall: "east", targetRoomId: "annex" }],
    },
    {
      id: "annex",
      position: [9, 0, 1],
      width: 8,
      depth: 6,
      doors: [{ wall: "west", targetRoomId: "lobby" }],
    },
  ],
};

export { worldData };
