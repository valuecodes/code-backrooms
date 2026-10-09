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

`.` holds only types: modules, functions (with spans, kinds, qualified names,
stable ids and their control flow), call sites with a resolution status, and
call/containment edges. `./ids` builds the ids (`demo.ts`,
`demo.ts::UserService.load`, `~2` on repeats).

A function's `flow` is a `SequenceNode` of steps: `step` (folded plain
statements), `call`, `await`, `return`, `break`, `continue`, and the composites
`branch` (two lane sequences), `switch` (cases with labels and a `fallsThrough`
flag) and `loop` (body sequence). Flow node ids are
`<function>@<offset>:<kind>[:<tag>]`; a sequence takes its owner's offset (the
function for `:sequence:body`, the `if` for `:sequence:then` / `:else`, the
loop for `:sequence:loop`, the case for `:sequence:case`), every other node its
own, so ids are unique per function and `parseFlowNodeId` maps them back.
`./flow` walks and judges them: `walkFlow`, `isTerminal` (control never runs
past the node) and `countStatements`.

`./world-graph` is the grammar for this milestone: one room per function, one
hub room per module that opens onto the module's root functions, and calls as
doors or portals. Per module, a breadth-first walk of the call graph from the
roots gives each function one physical door (`kind: "call"` on the
connection) from the caller that first reaches it in that walk, with at most
five doors out of any room, so a caller past its cap leaves a callee for a
later caller's door; every other resolved call, recursion and extra callers
of a shared function included, becomes a `call` portal in the caller's room,
and every function room gets a `return`
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
