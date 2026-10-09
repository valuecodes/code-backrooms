# @repo/world-generator

Graph → layout → walls, doors, corridors and colliders, seeded and three-free.

```ts
import { generateWorld } from "@repo/world-generator";

const { built } = generateWorld({ seed: 12345, roomCount: 15 });
```

Subpaths: `./graph` (`generateGraph`, `validateGraph`), `./layout`
(`generateLayout`), `./layout-checks` (`checkLayout`: every invariant, as a
list of failures for tests), `./geometry` (`buildWorld`), `./collision`,
`./locate` (`roomRects`, `roomAt`: which room a point is in), `./navigation`
(the exploration stack), `./interaction` (what the player can step into or is
facing), `./random`, `./config`, `./presets` (hand-written graphs: `lobby`,
`linear`, `branching`, `hub`, `cycle`).

Supported graphs: unique ids, dimensions on the 0.5 m grid and at least 2 m,
undirected connections without duplicates, one connected component. Rooms
with many connections need long walls; a room that cannot be placed after
several attempts throws a `LayoutError` naming the `connection` it could not
place, and a cycle-closing connection that cannot be realised is listed in
`layout.unresolved`, never dropped.

A graph room may carry a `cluster`: its interior laid out in advance as
rooms in a local frame (x in `[0, width]`, z in `[0, depth]`, the entry room
across the top, its north wall the entry port), with doors between them,
ports on the boundary (stretches of wall another unit may attach to, each
reserved for one unit) and portals already positioned. The layout places the
cluster as one unit: it is rotated so the entry faces the wall of the anchor
it hangs off (a flow running +Z as drawn becomes −Z off a north wall, +X off
an east wall), every room is emitted with `cluster`, `role`, `label`, the
`lane` it lies in and, on the entry room, `entry`, and other units attach
only through its ports, one door per port. A door's `lane` reaches its
opening, lintel and doorway, a room's `lane` its wall segments, and the
door target `nearestTarget` reports carries the lane when the player walks
with the flow (the door's side marked `forward`, the room it was declared
from), so a renderer can tint lanes and a HUD can name the lane on the way
in and the room on the way back. Plain graphs are laid out exactly as before: a plain room
simply offers each of its walls as a port.

Portals (`graph.portals`) are directed teleports drawn as a door frame with
a dark plane on a wall of their `from` room; the wall stays solid. The
layout places each on free wall space after the doors (a portal that fits
nowhere is listed in `layout.unplacedPortals`), and `buildWorld` gives it a
frame, a trigger strip in front of it, an arrival point inside its target
and a return point just inside itself. `createNavigator` turns room changes
and portal entries into a stack of frames and teleports: a `call` door or
portal pushes, a `return` portal pops (or lands at `to`, the hub, when the
stack is empty), entering a hub clears, and `jump` only teleports. A `jump`
portal leads to a room of the same cluster (`validateGraph` and
`validateCluster` check it, and count it as a way into that room); it lands
in the room's centre facing the way on: its return portal, else its last
doorway.
