import type { BuiltArea, Point, Rect, RoomData, RoomKind } from "@repo/types";

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

/**
 * The area under a point, by its rooms' footprint. `preferredId` is checked
 * first, as in `roomAt`; areas lie AREA_GAP apart, so at most one other can
 * match. Null between areas.
 */
const areaAt = (
  areas: readonly BuiltArea[],
  point: Point,
  preferredId: string | null
): BuiltArea | null => {
  if (preferredId !== null) {
    const preferred = areas.find((area) => area.id === preferredId);
    if (preferred !== undefined && containsPoint(preferred.bounds, point)) {
      return preferred;
    }
  }
  return areas.find((area) => containsPoint(area.bounds, point)) ?? null;
};

export { areaAt, containsPoint, roomAt, roomRects };
export type { RoomRect };
