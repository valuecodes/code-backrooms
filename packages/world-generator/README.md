# @repo/world-generator

Graph → layout → walls, doors, corridors and colliders, seeded and three-free.

```ts
import { generateWorld } from "@repo/world-generator";

const { built } = generateWorld({ seed: 12345, roomCount: 15 });
```

Subpaths: `./graph` (`generateGraph`, `validateGraph`), `./layout`
(`generateLayout`), `./geometry` (`buildWorld`), `./collision`, `./random`,
`./config`, `./presets` (hand-written graphs: `lobby`, `linear`, `branching`,
`hub`, `cycle`).

Supported graphs: unique ids, dimensions on the 0.5 m grid and at least 2 m,
undirected connections without duplicates, one connected component. Rooms
with many connections need long walls; a room that cannot be placed after
several attempts throws, and a cycle-closing connection that cannot be
realised is listed in `layout.unresolved`, never dropped.
