import type { Point, Rect, RoomData, RoomKind } from "@repo/types";

import { roomBounds } from "./geometry";

type RoomRect = {
  readonly id: string;
  readonly kind: RoomKind;
  readonly rect: Rect;
};

/** Footprints of every room, computed once per world. */
const roomRects = (rooms: readonly RoomData[]): readonly RoomRect[] =>
  rooms.map((room) => ({
    id: room.id,
    kind: room.kind,
    rect: roomBounds(room),
  }));

const containsPoint = (rect: Rect, point: Point): boolean =>
  point.x >= rect.minX &&
  point.x <= rect.maxX &&
  point.z >= rect.minZ &&
  point.z <= rect.maxZ;

/**
 * The room under a point. `preferredId` is checked first, so a player who
 * has not left their room costs one comparison; on a shared edge the first
 * room in `rects` order wins, which keeps the answer stable frame to frame.
 */
const roomAt = (
  rects: readonly RoomRect[],
  point: Point,
  preferredId: string | null
): RoomRect | null => {
  if (preferredId !== null) {
    const preferred = rects.find((room) => room.id === preferredId);
    if (preferred !== undefined && containsPoint(preferred.rect, point)) {
      return preferred;
    }
  }
  return rects.find((room) => containsPoint(room.rect, point)) ?? null;
};

export { containsPoint, roomAt, roomRects };
export type { RoomRect };
