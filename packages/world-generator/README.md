# @repo/world-generator

Graph → layout → walls, doors, corridors and colliders, seeded and three-free.

```ts
import { generateWorld } from "@repo/world-generator";

const { built } = generateWorld({ seed: 12345, roomCount: 15 });
```

Subpaths: `./graph` (`generateGraph`, `validateGraph`), `./layout`
(`generateLayout`), `./geometry` (`buildWorld`), `./collision`, `./locate`
(`roomRects`, `roomAt`: which room a point is in), `./navigation` (the
exploration stack), `./interaction` (what the player can step into or is
facing), `./random`, `./config`, `./presets` (hand-written graphs: `lobby`,
`linear`, `branching`, `hub`, `cycle`).

Supported graphs: unique ids, dimensions on the 0.5 m grid and at least 2 m,
undirected connections without duplicates, one connected component. Rooms
with many connections need long walls; a room that cannot be placed after
several attempts throws, and a cycle-closing connection that cannot be
realised is listed in `layout.unresolved`, never dropped.

Portals (`graph.portals`) are directed teleports drawn as a door frame with
a dark plane on a wall of their `from` room; the wall stays solid. The
layout places each on free wall space after the doors (a portal that fits
nowhere is listed in `layout.unplacedPortals`), and `buildWorld` gives it a
frame, a trigger strip in front of it, an arrival point inside its target
and a return point just inside itself. `createNavigator` turns room changes
and portal entries into a stack of frames and teleports: a `call` door or
portal pushes, a `return` portal pops (or lands at `to`, the hub, when the
stack is empty), entering a hub clears, and `jump` only teleports.
