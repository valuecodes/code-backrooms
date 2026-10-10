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
statements, a `call`, an `await`, a `return`, a `jump` for `break` and
`continue`; a try is one `collapsed` room for now). A branch or switch is a fork: a `fork` / `switch` head room
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
`./subjects` resolve them. A `break` nested inside a case jumps to the merge
room (which then exists even when every lane ends). A case that falls
through does not run into the merge room: its last room has a side door
into the first room of the next lane, declared from it with the next lane's
label (`→ case "d"`), and that first room is deepened until the two share
enough wall for a door. The side walls holding a fallthrough door get no
call portals; a one-room lane with such a door on both sides puts its
portals on its south wall and is widened to fit them. Empty cases are
merged into the next case's labels by the parser, so they share its lane.
A switch with more than `FLOW_MAX_CASES` cases stays collapsed.

A loop is a ring: a `loop-head` room across the column (its header, `for
(const x of xs)`, or `do` for a do-while, the header's calls hanging off it),
the body as a lane of its own (lane `{ kind: "loop", text: "body" }`) down
the west side beside a `loop-back` corridor one lane wide and as deep as the
body (lane `back`, label `repeat`), a `loop-test` room across below both
(`again?`, or a do-while's `while (…)` with the header's calls) and a
`loop-end` room (`end for`, `end while`). The test has two doors: `repeat`
into the corridor, whose top door leads back into the head, and `exit` into
the end room. A ring is as wide as its body plus the corridor. Ids: the head
is the loop node, the test, corridor and end `<loop id>:again`, `:back` and
`:end`, an empty body its sequence (`body · empty`). A loop opens when its
body runs out of its end or jumps to the loop; one whose body only ever
returns stays collapsed. Forks and loops share one quota of 16
per function, opened in source order. Lane doors are declared from the room
they lead out of, so the world marks that side `forward` and only a door
walked with the flow names its lane.

Jumps are portals within the cluster. A `jump` room (`break`, `continue`)
has a `jump` portal on its south wall, `jump:<room id>`, leading to a room
of the same cluster: `continue` to the loop's `again?` test, `break` to the
loop's end room or the switch's merge room; the stack is left alone. A
collapsed room that ends by jumping out of itself, always to the same room
and never returning, gets that jump portal instead of a return portal; one
that ends in more than one way (a `break` and a `continue`, a jump and a
return) gets the loops and switches it leaves collapsed around it, since one
portal could not show every way out.
`FlowPlan.jumps` maps each jumping room to its target. A collapsed room
that runs on but holds a jump out (kept collapsed, or folded into budget)
gets the loop or switch that jump leaves collapsed around it too, so no
jump hides in a room while its target is open and every room keeps a way
in. Early returns inside a collapsed room that runs on stay hidden, as
before.
`try` stays one collapsed room showing its source: exception edges are
beyond the MVP.

Calls the world cannot follow (ambiguous, dynamic, external, unresolved) get
a closed **marker**: one framed, boarded panel per room, `marker:<room id>`,
hung after the room's call portals as one more slot on its side walls. A room
boxed in by fallthrough doors puts it on its south wall. It is never a portal
to a guess, not even an ambiguous call's first candidate. Choosing between
candidates is left to a later chooser. Every such site lands in exactly one
room, decided as the specs are built so the budget counts the marker's wall
and folding carries it. A leaf or a collapsed composite takes the sites in
its span. An expanded composite's head takes those that no statement inside
it holds (condition, discriminant, case tests, loop header; a do-while's go
to its test room). Sites in no statement of the body at all (a default
parameter, dropped dead code) go to the entry room. `FlowPlan.markers` maps
each room to its sites. A marker alone makes a room 3 m deep.

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
other collapsed room that ends the flow (`try { return } finally { … }`), and of
the last room when the body falls off its end. Interiors are folded into a
budget of 32 m wide, 96 m deep and 64 rooms: too wide, the deepest fork or
loop collapses into one room; too deep or too many rooms, neighbouring rooms fold
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
elsewhere, and tries again: a program that parses always becomes a world.
`generateCodeWorld(graph, seed, { variation })` (variation on by default) also
lets the seed vary proportions without changing what is connected: each
function's column is 0, 0.5 or 1 m wider, added after budget folding so its
rooms stay the same, each hub starts 1, 1.25 or 1.5 times wider than deep
(`toWorldGraph(graph, portalOnly, seed)`; a null seed keeps both plain), and
the layout varies corridor widths. Which calls are doors is settled on the
plain world first and kept for the varied one; a varied layout that cannot
realise exactly that plan gives way to the plain world. Inside a column a door that only leads on
(to the next room, into a merge, a loop's test or back round to its head) is a
passage (`opening: "passage"`), as wide as the rooms allow; a door into a lane
stays a door. Functions a
directed walk from the roots cannot reach (mutual recursion with no outside
caller) are attached to the hub in source order. A hub has at most five doors,
links to the neighbouring hubs included, so a module whose roots need more
chains further hubs (`demo.ts`, `demo.ts#2`, ...). Portals sit on flow rooms
(`from`), lead to units (`to`), and are listed calls first, then returns.

`./subjects` maps world ids back to the code: `roomSubject` gives a module, a
function, or a flow room (`{ kind: "flow", fn, module, node, ancestors, text,
span }`, `text` being the HUD's words such as `await fetch(…)` or `if (user) ·
2 statements · 2 calls`, and `span` the room's code: a tagged room's composite,
and for a room the budget folded from several, its first node to its last);
`portalSubject` gives a call site with both functions,
or the function a return portal belongs to.

`./cfg` derives a function's control-flow graph from its flow tree, as a test
oracle and a debugging aid (`toDot(cfg)` gives Graphviz source); the layout
never reads it. `cfgOf(fn)` makes one block per statement or composite head,
an `empty` block for an empty lane, case or loop body, synthetic `entry` and
`exit` blocks, and per composite the blocks the layout's tagged rooms stand for
(`:merge`, `:default`, `:again`, `:end`), with the same ids. Edges are typed
`next | true | false | case | default | fallthrough | loop-back | break |
continue | return | throw`. A loop's head opens into its body (`true`, or
`next` for a do-while) and, unless it is a do-while, straight to its end
(`false`: zero iterations); its `:again` block leads back to the head
(`loop-back`) or out to the end. A `try` stays one opaque block (exception
edges are post-MVP) with its ways out: returns, jumps out, and `next` unless it
ends; a finalizer that ends overrides the rest.

`./cfg-checks` holds two checks in the `checkLayout` style. `cfgFailures(fn,
cfg)` asserts the semantic invariants: one entry and one exit, no reachable
dead end, returns and throws only into the exit, every `break` and `continue`
into a composite that encloses it, fallthrough kept. `cfgLayoutFailures(fn,
cfg, cluster)` asserts the cluster walks the same graph. Each block lies in the
room with its id, else in the room of the earlier sibling it was folded into,
else in the room of the collapsed composite around it. Every door, jump portal
and return portal must stand for a flow edge (the two doors through a loop's
back corridor for its `loop-back` edge), and every edge from a reachable block
must lie inside one room, have a door or a jump portal, or leave a room with a
return portal for the exit. Two exceptions are deliberate: a collapsed room
that runs on shows one way out, so an early return hidden in it has no portal;
and the ring walks every loop at least once, so a loop's zero-iteration edge
has no door.
