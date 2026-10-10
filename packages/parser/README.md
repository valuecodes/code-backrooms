# @repo/parser

TypeScript and JavaScript source → `CodeGraph`, via `@babel/parser`. Pure JS, so it
runs the same in the browser and under vitest.

```ts
import { buildCodeGraph, parseModule } from "@repo/parser";

const graph = buildCodeGraph([{ path: "src/demo.ts", source }]);
graph.functions; // one FunctionNode per named function, in source order
graph.callSites; // every call: resolved | ambiguous | dynamic | external | unresolved
graph.edges; // containment edges plus one call edge per (caller, callee)
```

Rooms come from named functions: declarations, `const f = () => {}` and function
expressions, class methods (`Class.method`, `Class.#private`, `Class.constructor`,
getters and setters), class field arrows, nested named functions
(`outer.inner`) and `export default`. Calls inside anonymous callbacks, IIFEs
and object-literal methods are attributed to the enclosing named function.

Resolution is lexical, by name, within one file, after TypeScript-only
wrappers (`cb!`, `f as F`, `f<T>`) are stripped from the callee. A bare
identifier resolves to the nearest named function. Block scopes fold into
their function, so a name declared as a function in several branches is
**ambiguous**: `candidateIds` lists every one in source order, and none is
followed (no call edge). Overload signatures have no
body and are not functions, so they never add candidates. A parameter of that name on the way
out, the parameters of anonymous callbacks included, makes the call
**dynamic**. Any other binding of the name (a variable, import or class) shadows
it, and so does a function expression's own name; the call is then unresolved.
`this.x()` resolves against the class of the enclosing method (through arrows,
not through nested `function`s), `Class.x()` against that class's static
methods, `new Class()` to its explicit constructor. Known runtime globals
(`console.log`, `fetch`, `new Map()`) are external. A member call on a receiver
the analysis cannot type (`obj.x()`, a dynamic `this`, `this.x()` missing on
its own class) is ambiguous when two or more classes of the file declare an
instance member `x`. With one or none it stays unresolved, since one candidate
would still be a guess. Computed callees (`obj[k]()`), call results
(`f()()`), `(a || b)()` and the like are dynamic. Imports, `super.x()` and
IIFEs are unresolved; cross-file resolution is a later milestone. A call
through an import binding (`helper()`, `new Svc()`, `ns.run()`, `Svc.make()`)
stays unresolved but carries `via: { localName, member, isNew }` for the
linker; an inner binding of the same name shadows it and carries none, and
deeper chains (`ns.a.b()`) carry none either. A call that
starts where an inner one does (`f()()`) is told apart by its end:
`main@12-20`.

Each module records its imports and exports (`ModuleNode.imports`,
`ModuleNode.exports`). An import record is one binding: `localName`,
`importedName` (`"default"`, `"*"` for a namespace, else the name), the
`specifier` as written and `moduleId` (null until cross-file linking). A
side-effect import (`import "./setup"`, `import {} from "./x"`) is one record
with both names null. An export record is `exportedName` with either a
`localName` (declarations, destructured variables included, and `export {
a as b }`) or, for `export … from`, a `specifier` and `importedName` (`"*"`
for `export *` and `export * as ns`). `export default` names its target: a
named function or class by its name, an anonymous one, an arrow or a
function expression by `"default"`, an identifier by itself, any other
expression by null. Type-only imports and exports, `import x = require()`
and `export =` are not recorded. `FunctionNode.exported` is true for a
function declared with `export`, or for a top-level one whose name a local
export record names.

Each function also carries its body as control flow (`FunctionNode.flow`, a
`SequenceNode`), built after the calls are resolved so every statement can
name the call sites inside it. Plain statements fold into one `step`; a
statement holding a resolved call (callbacks included) is a `call`; one
containing an `await` is an `await`; `return` and `throw` are `return`
nodes, as is an expression-bodied arrow; `if` is a `branch` with `then`/`else`
lanes (a missing `else` is an empty lane, `else if` a branch inside the
alternate); `switch` keeps its cases with their labels, merges empty cases
into the next body, drops a trailing `break` and flags `fallsThrough`; the
five loop statements are `loop` nodes with their header text; `try` is a
`try` node whose block, handler and finalizer are sequences; `break` and
`continue` name the loop or switch they leave. Calls in parameter defaults
open the flow as one `call`. Statements after a terminal one are dropped as
dead code. Nested named functions, classes and type declarations are not
part of the enclosing flow.

Flow limitations: a `break` out of a labelled block folds into a step;
`return await x()` is a return, not a checkpoint; an `await` inside a
condition or loop header is not a checkpoint; condition and header text is
cut at 60 characters.

Not represented yet: object-literal methods and class expressions (their calls
count, their `this` is unresolved), `declare` overloads, decorators, computed
keys, and block-level shadowing (a binding anywhere in a function shadows
throughout it).
