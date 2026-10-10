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
`linear`, `branching`, `hub`, `cycle`), `./areas` (`assembleAreas`,
`mergeAreas`), `./area-checks` (`checkAreas`).

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

A door is 1.2 m wide. A cluster door marked `opening: "passage"` opens as wide
as the shared edge allows (the overlap less 0.35 m at each end, floored to the
0.5 m grid, between 1.2 and 4 m); both sides carry the mark, so their openings
agree, and `checkLayout` spaces openings and portals by their edges. With
`variation` (on by default in `generateWorld` and `generateLayout`) a tree
corridor is 2 or 3 m wide, the order drawn from the seed, both widths always
tried so a port too short for a wide corridor still takes a narrow one;
corridors that close a loop stay 2 m. Without it every corridor is 2 m and the
random draws, so the layouts, are those of a plain graph before widths varied.
`hashString` (`@repo/world-generator/random`) is the 32-bit FNV-1a the other
packages use for seeds and per-room nuances.

Portals (`graph.portals`) are directed teleports drawn as a door frame with
a dark plane on a wall of their `from` room; the wall stays solid. The
layout places each on free wall space after the doors (a portal that fits
nowhere is listed in `layout.unplacedPortals`), and `buildWorld` gives it a
frame, a trigger strip in front of it, an arrival point inside its target
and a return point just inside itself. `createNavigator` turns room changes
and portal entries into a stack of frames and teleports: a `call` door or
portal pushes, a `return` portal pops (or lands at `to`, the hub, when the
stack is empty), entering a hub clears, and `jump` only teleports. A
`marker` is a closed frame that is never entered (no trigger fires, stepping
in stays put) but is still prompted. It stands on a cluster room, which must
place it, give it no target and lead it to itself (`to === from`); a graph
portal and its cluster portal must agree on being one. A `jump`
portal leads to a room of the same cluster (`validateGraph` and
`validateCluster` check it, and count it as a way into that room); it lands
in the room's centre facing the way on: its return portal, else its last
doorway.

Areas are worlds generated one at a time (one per module of a code world)
and then set apart. Each is laid out round the origin with its own corridor
ids (`generateWorld({ corridorPrefix })`, `corridor-` by default) and may
lead elsewhere: `graph.external` lists units of other areas that its `call`
and `module` portals may name (a `module` portal stands on a hub and leads
to another hub; entering it empties the stack like entering a hub).
`buildWorld(layout, external)` leaves such a portal's `arrival` null and
lists every unit's landing in `built.entries`. `assembleAreas(seed, entry,
parts)` packs the areas on shelves, the entry first at the origin, each
other one 32 m beyond the last (past the fog) and rows 512 m wide, moves
their layouts there and builds them again. `mergeAreas` joins them into one
world for the renderer and `createNavigator`, cross-area arrivals resolved
through `areaOf` and the target's `entries`; its graph has one component per
area, so `checkLayout` does not apply to it. `checkAreas` does: every area's
own `checkLayout`, ids unique across areas, areas 32 m apart, each start
room at its offset, cross-area portals landing in their unit, and every area
reachable from the entry over placed portals.
