# @repo/code-graph

Language-independent CodeGraph types and the CodeGraph → WorldGraph spatial grammar.

```ts
import type { CodeGraph } from "@repo/code-graph";
import { roomSubject } from "@repo/code-graph/subjects";
import { toWorldGraph } from "@repo/code-graph/world-graph";
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

`./flow-layout` turns a function into a `RoomCluster`: a 4 m-wide column of
rooms, one per top-level flow node (a `step` of folded statements, a `call`,
an `await`, a `return`; a branch, switch or loop is one `collapsed` room for
now), stacked along +Z with a door between neighbours and a `return` portal on
the last room's south wall. The entry room's north wall is the entry port. A
room's first callee gets a port on the side wall used least recently, its
second the other wall; further callees get a portal each, pre-placed below
the port. A port must end 6 m past the previous port on its wall (a callee
cluster is 4 m wide and keeps 2 m from its neighbour), so rooms grow when a
side is busy. Interiors are folded into a budget of 96 m and 64 rooms by
merging neighbouring rooms into `collapsed` ones. Depths come from the room's
role and statements, at least 3 m wherever a call needs wall for a door or a
portal, 4 m for the entry room.

`./world-graph` is the grammar: one cluster per function, one hub room per
module that opens onto the module's root functions, and calls as doors or
portals. Per module, a breadth-first walk of the call graph from the roots
gives each function one physical door (`kind: "call"` on the connection)
through a port of the caller that first reaches it in that walk; every other
reserved port, recursion and extra callers of a shared function included,
becomes a `call` portal at the port's centre, and the column's `return` portal
leads back to the module hub when nothing is on the navigation stack. The
physical graph of units is therefore a tree and always lays out. Functions a
directed walk from the roots cannot reach (mutual recursion with no outside
caller) are attached to the hub in source order. A hub has at most five doors,
links to the neighbouring hubs included, so a module whose roots need more
chains further hubs (`demo.ts`, `demo.ts#2`, ...). Portals sit on flow rooms
(`from`), lead to units (`to`), and are listed calls first, then returns.

`./subjects` maps world ids back to the code: `roomSubject` gives a module, a
function, or a flow room (`{ kind: "flow", fn, module, node, ancestors, text }`,
`text` being the HUD's words such as `await fetch(…)` or `if (user) · 2
statements · 2 calls`); `portalSubject` gives a call site with both functions,
or the function a return portal belongs to.
