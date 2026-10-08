import { Ceiling } from "~/game/components/ceiling";
import { Door } from "~/game/components/door";
import { Floor } from "~/game/components/floor";
import { Wall } from "~/game/components/wall";
import type { BuiltRoom } from "~/game/types";

type RoomProps = {
  readonly built: BuiltRoom;
};

/** Renders one room entirely from its derived geometry. */
const Room = ({ built }: RoomProps) => (
  <group>
    <Floor room={built.room} />
    <Ceiling room={built.room} />
    {built.segments.map((segment) => {
      const key = segment.center.join(",");
      return segment.kind === "wall" ? (
        <Wall key={key} segment={segment} />
      ) : (
        <Door key={key} segment={segment} />
      );
    })}
  </group>
);

export { Room };
