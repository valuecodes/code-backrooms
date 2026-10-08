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
door per resolved call (recursion dropped, repeats merged), and one hub room per
module that opens onto the module's root functions, so every room is reachable
and the first hub is the start. A hub has at most five doors, links to the
neighbouring hubs included, so a module whose roots need more chains further
hubs (`demo.ts`, `demo.ts#2`, ...) rather than asking one hub for more doors
than its walls can take. Room footprints come from the function's length and
grow with its number of doors, following the same perimeter heuristic as the
random generator; whether the doors really fit is decided by the layout.
