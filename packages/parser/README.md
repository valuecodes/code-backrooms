# @repo/parser

TypeScript and JavaScript source → `CodeGraph`, via `@babel/parser`. Pure JS, so it
runs the same in the browser and under vitest.

```ts
import { buildCodeGraph, parseModule } from "@repo/parser";

const graph = buildCodeGraph([{ path: "src/demo.ts", source }]);
graph.functions; // one FunctionNode per named function, in source order
graph.callSites; // every call, with resolution: resolved | external | unresolved
graph.edges; // containment edges plus one call edge per (caller, callee)
```

Rooms come from named functions: declarations, `const f = () => {}` and function
expressions, class methods (`Class.method`, `Class.#private`, `Class.constructor`,
getters and setters), class field arrows, nested named functions
(`outer.inner`) and `export default`. Calls inside anonymous callbacks, IIFEs
and object-literal methods are attributed to the enclosing named function.

Resolution is lexical, by name, within one file. A bare identifier resolves to
the nearest named function; any other binding of that name on the way out (a
parameter, variable, import or class, including the parameters of anonymous
callbacks and a function expression's own name) shadows it and the call is
unresolved. `this.x()` resolves against the class of the enclosing method
(through arrows, not through nested `function`s), `Class.x()` against that
class's static methods, `new Class()` to its explicit constructor. Known runtime
globals (`console.log`, `fetch`, `new Map()`) are external. Imports,
`obj.method()`, `super.x()` and computed callees are unresolved; cross-file
resolution is a later milestone.

Not represented yet: object-literal methods and class expressions (their calls
count, their `this` is unresolved), `declare` overloads, decorators, computed
keys, and block-level shadowing (a binding anywhere in a function shadows
throughout it).
