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
flag), `loop` (body sequence) and `try` (block, handler and finalizer
sequences). Flow node ids are
`<function>@<offset>:<kind>[:<tag>]`; a sequence takes its owner's offset (the
function for `:sequence:body`, the `if` for `:sequence:then` / `:else`, the
loop for `:sequence:loop`, the case for `:sequence:case`), every other node its
own, so ids are unique per function and `parseFlowNodeId` maps them back.
`./flow` walks and judges them: `walkFlow`, `isTerminal` (control never runs
past the node) and `countStatements`.

`./flow-layout` turns a function into a `RoomCluster` in two steps.
`planFlow` measures the body into a tree of rooms and folds it into budget;
`layoutFlow` places the tree as a column, flow running along +Z, a door
between neighbours. Plain flow nodes are one room each (a `step` of folded
statements, a `call`, an `await`, a `return`; a loop or try is one `collapsed`
room for now). A branch or switch is a fork: a `fork` / `switch` head room
across the column (its label `if (user)` / `switch (status)`, the calls of
the condition hanging off it), one lane per way through laid side by side
below it (the true lane west of the false one, cases in source order, a
switch without `default` getting an empty one so control that matches no
case still has a way on), and a `merge` room (`end if`, `end switch`) across
the column again, entered from every lane whose body does not end. A lane is
a column of its own (nested forks nest), at least `FLOW_LANE_WIDTH` 3 m wide
and as wide as its body needs; a fork is as wide as its lanes together and a
column as wide as its widest fork (4 m at least), slack shared between lanes
on the grid. Lanes are stretched to the deepest one so the rooms tile the
rectangle. An empty lane is one `lane` room named by its lane (`false ·
empty`), and every room in a lane carries the innermost lane it lies in for
the renderer's tints. Doors from a head carry the lane they open onto. Ids:
a head is its node, a merge `<node id>:merge`, an empty lane its sequence,
a synthesised default `<switch id>:default`, so `parseFlowNodeId` and
`./subjects` resolve them. A switch with more than `FLOW_MAX_CASES` cases,
or with a `break` nested inside a case (no jump portals yet), stays
collapsed.

Calls hang off side walls. A room whose wall lies on the cluster boundary
offers a port there: with both walls free the first callee gets a port on
the wall used least recently and the second the other wall (a lone callee
is offered both); with one free wall the first callee gets it; every other
callee gets a portal pre-placed on a side wall, so a lane in the middle of a
switch reaches its callees by portals only. A port must end `max(previous
callee's width, this callee's width) + 2 m` past the previous port on its
wall (callee clusters keep 2 m from each other), which is why `layoutFlow`
takes `widthOf` and `./world-graph` plans every function before placing
any. Return portals sit on the south wall of every `return` room, of every
collapsed room that ends the flow (`try { return } finally { … }`), and of
the last room when the body falls off its end. Interiors are folded into a
budget of 32 m wide, 96 m deep and 64 rooms: too wide, the deepest fork
collapses into one room; too deep or too many rooms, neighbouring rooms fold
into `collapsed` ones first. Depths come from the room's role and
statements, at least 3 m wherever a call needs wall for a door or a portal,
4 m for the entry room.

`./world-graph` is the grammar: one cluster per function, one hub room per
module that opens onto the module's root functions, and calls as doors or
portals. Per module, a breadth-first walk of the call graph from the roots
gives each function one physical door (`kind: "call"` on the connection)
through a port of the caller that first reaches it in that walk; every other
reserved port, recursion and extra callers of a shared function included,
becomes a `call` portal at the port's centre, and the column's `return` portal
leads back to the module hub when nothing is on the navigation stack. The
physical graph of units is therefore a tree. A call inside a lane offers one
wall only and that side may be taken, so `generateCodeWorld(graph, seed)`
lays the world out and, when the layout reports a call door it cannot place
(`LayoutError`), marks that edge portal-only (`toWorldGraph(graph,
portalOnly)`), which turns the call into a portal and attaches the callee
elsewhere, and tries again: a program that parses always becomes a world. Functions a
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
