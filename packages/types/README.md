# @repo/types

Shared world types: graph, layout and built geometry, no three.js.

Three layers, in the order the generator produces them:

- **Graph** — `WorldGraph`: rooms with dimensions and undirected connections.
- **Layout** — `WorldLayout`: rooms (and corridor rooms) with positions and
  doors declared on both sides of each shared edge.
- **Built** — `BuiltWorld`: wall boxes, lintels, door frames and colliders.

```ts
import type { WorldGraph } from "@repo/types";
```
