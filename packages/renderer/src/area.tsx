import type { BuiltArea } from "@repo/types";
import { memo } from "react";

import { DoorFrames } from "./door-frames";
import { Portals } from "./portals";
import { Room } from "./room";

type AreaProps = {
  readonly area: BuiltArea;
  /** Ids of its portals into an area not generated yet. */
  readonly pending: readonly string[];
};

/** One area: its rooms, its door frames as one mesh and its portals. */
const AreaView = ({ area, pending }: AreaProps) => (
  <>
    {area.built.rooms.map((built) => (
      <Room key={built.room.id} built={built} />
    ))}
    <DoorFrames doorways={area.built.doorways} />
    <Portals portals={area.built.portals} pending={pending} />
  </>
);

const samePending = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Re-rendered only when its portals' looks change: a world that grows
 * mounts the new area and leaves the others alone.
 */
const Area = memo(
  AreaView,
  (previous, next) =>
    previous.area === next.area && samePending(previous.pending, next.pending)
);

export { Area };
