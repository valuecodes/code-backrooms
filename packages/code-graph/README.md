# @repo/code-graph

Language-independent CodeGraph types and the CodeGraph → WorldGraph spatial grammar.

```ts
import type { CodeGraph } from "@repo/code-graph";
import { roomSubject, toWorldGraph } from "@repo/code-graph/world-graph";
import { generateWorld } from "@repo/world-generator";

const graph: CodeGraph = ...; // from @repo/parser
const world = generateWorld({ seed: 1, graph: toWorldGraph(graph) });
roomSubject(graph, world.layout.startRoomId); // { kind: "module", module }
```

`.` holds only types: modules, functions (with spans, kinds, qualified names and
stable ids), call sites with a resolution status, and call/containment edges.
`./ids` builds the ids (`demo.ts`, `demo.ts::UserService.load`, `~2` on repeats).

`./world-graph` is the grammar for this milestone: one room per function, one
hub room per module that opens onto the module's root functions, and calls as
doors or portals. Per module, a breadth-first walk of the call graph from the
roots makes each function's first discovered call a physical door (`kind:
"call"` on the connection, at most five out of one room); every other resolved
call, recursion and extra callers of a shared function included, becomes a
`call` portal in the caller's room, and every function room gets a `return`
portal that leads back to the module hub when nothing is on the navigation
stack. The physical graph is therefore a tree and always lays out. Functions
a directed walk from the roots cannot reach (mutual recursion with no outside
caller) are attached to the hub in source order. A hub has at most five
doors, links to the neighbouring hubs included, so a module whose roots need
more chains further hubs (`demo.ts`, `demo.ts#2`, ...). Room footprints come
from the function's length and grow with their doors and portals, following
the same perimeter heuristic as the random generator; whether they really fit
is decided by the layout. `portalSubject` maps a portal id back to its call
site or function, the way `roomSubject` does for rooms.
