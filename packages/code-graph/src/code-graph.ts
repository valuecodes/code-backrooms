// The language-independent picture of a codebase: modules, functions and the
// calls between them. Plain data, JSON-serialisable, no parser or three.js
// types anywhere. The renderer never sees anything more specific than this.

/** Character offsets, 1-based lines and 0-based columns, as parsers report them. */
type SourceSpan = {
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
};

type Language = "typescript" | "javascript";

/**
 * One binding an `import` declaration introduces, or for a declaration with
 * no bindings (`import "./polyfill"`) one record with both names null: the
 * module still depends on it. Type-only imports are not recorded.
 */
type ImportRecord = {
  /** `x` in `import { a as x }`, `ns` in `import * as ns`, `d` in `import d`. */
  readonly localName: string | null;
  /** `a` for a named import, `"*"` for a namespace, `"default"` for a default. */
  readonly importedName: string | null;
  /** As written: `"./a"`, `"lodash"`, `"node:fs"`. */
  readonly specifier: string;
  /** The imported module, once linked; null for packages and before linking. */
  readonly moduleId: string | null;
  readonly span: SourceSpan;
};

/**
 * One name a module exports. A local export has a `localName` and no
 * `specifier`; a re-export (`export … from`) has a `specifier` and no
 * `localName`. Type-only exports are not recorded.
 */
type ExportRecord = {
  /** The public name: `"default"` for a default export, `"*"` for `export *`. */
  readonly exportedName: string;
  /** The local binding; null for re-exports and a default expression. */
  readonly localName: string | null;
  /** `"./b"` for `export … from "./b"`, else null. */
  readonly specifier: string | null;
  /** For re-exports: `x` in `export { x as y } from`, `"*"` for a star. */
  readonly importedName: string | null;
};

type ModuleNode = {
  /** The normalised path doubles as the id: "src/demo.ts". */
  readonly id: string;
  readonly path: string;
  readonly language: Language;
  readonly lineCount: number;
  /** Import bindings in source order. */
  readonly imports: readonly ImportRecord[];
  /** Exported names in source order. */
  readonly exports: readonly ExportRecord[];
};

type FunctionKind =
  /** `function foo() {}` */
  | "declaration"
  /** `const foo = function () {}` */
  | "expression"
  /** `const foo = () => {}`, including class field arrows */
  | "arrow"
  | "method"
  | "constructor"
  | "getter"
  | "setter";

// ---------------------------------------------------------------------------
// Control flow inside a function: a tree of statements and composites, one
// node per thing the world may give a room. Ids are `${functionId}@${offset}:
// ${kind}[:${tag}]`; a sequence takes its owner's offset (the function, the
// `if`, the loop or the case), every other node its own.

/** Every flow node names where it came from. */
type FlowNodeBase = {
  readonly id: string;
  readonly span: SourceSpan;
};

/** Plain statements folded together: nothing to walk into. */
type StepNode = FlowNodeBase & {
  readonly kind: "step";
  readonly statements: number;
};

/** A statement holding at least one resolved call (callbacks included). */
type CallNode = FlowNodeBase & {
  readonly kind: "call";
  readonly callSiteIds: readonly string[];
};

/** A statement containing an `await`: a checkpoint. Wins over `call`. */
type AwaitNode = FlowNodeBase & {
  readonly kind: "await";
  readonly callSiteIds: readonly string[];
};

/** `return` or, with `throws`, `throw`. `return await x()` is a return. */
type ReturnNode = FlowNodeBase & {
  readonly kind: "return";
  readonly throws: boolean;
  readonly callSiteIds: readonly string[];
};

/** `break`: `targetId` is the enclosing loop or switch it leaves. */
type BreakNode = FlowNodeBase & {
  readonly kind: "break";
  readonly targetId: string;
};

/** `continue`: `targetId` is the loop it restarts. */
type ContinueNode = FlowNodeBase & {
  readonly kind: "continue";
  readonly targetId: string;
};

/**
 * `if`/`else`. `callSiteIds` are the calls in the condition only. A missing
 * `else` is an empty alternate; `else if` is a branch inside the alternate.
 */
type BranchNode = FlowNodeBase & {
  readonly kind: "branch";
  readonly condition: string;
  readonly callSiteIds: readonly string[];
  readonly consequent: SequenceNode;
  readonly alternate: SequenceNode;
};

/**
 * One arm of a switch. `labels` read `case "x"` or `default`; empty cases are
 * merged into the next one that has a body. `fallsThrough`: the body runs on
 * into the next case (no trailing `break`, not terminal, not the last case).
 */
type SwitchCase = FlowNodeBase & {
  readonly labels: readonly string[];
  readonly body: SequenceNode;
  readonly fallsThrough: boolean;
};

type SwitchNode = FlowNodeBase & {
  readonly kind: "switch";
  readonly discriminant: string;
  readonly callSiteIds: readonly string[];
  readonly cases: readonly SwitchCase[];
};

type LoopKind = "while" | "do-while" | "for" | "for-of" | "for-in";

/**
 * Any loop. `header` is the source before the body (`while (running)`,
 * `for (const x of xs)`), for do-while the `while (…)` after it;
 * `callSiteIds` are the calls in the header.
 */
type LoopNode = FlowNodeBase & {
  readonly kind: "loop";
  readonly loopKind: LoopKind;
  readonly header: string;
  readonly callSiteIds: readonly string[];
  readonly body: SequenceNode;
};

/**
 * `try`/`catch`/`finally`. The block and the handler are two ways through
 * (control leaves by one or the other); the finalizer runs after both.
 */
type TryNode = FlowNodeBase & {
  readonly kind: "try";
  readonly block: SequenceNode;
  readonly handler: SequenceNode | null;
  readonly finalizer: SequenceNode | null;
};

type FlowStep =
  | StepNode
  | CallNode
  | AwaitNode
  | ReturnNode
  | BreakNode
  | ContinueNode
  | BranchNode
  | SwitchNode
  | LoopNode
  | TryNode;

/** Statements in execution order; dead code after a terminal step is dropped. */
type SequenceNode = FlowNodeBase & {
  readonly kind: "sequence";
  readonly steps: readonly FlowStep[];
};

type FlowNode = FlowStep | SequenceNode;

type FunctionNode = {
  /** `${moduleId}::${qualifiedName}`, suffixed `~2`, `~3` on repeats. */
  readonly id: string;
  readonly moduleId: string;
  /** Display name: "getUser". */
  readonly name: string;
  /** Dotted path from module scope: "main.helper", "UserService.load". */
  readonly qualifiedName: string;
  readonly kind: FunctionKind;
  readonly span: SourceSpan;
  readonly exported: boolean;
  readonly async: boolean;
  readonly isStatic: boolean;
  /** The enclosing named function, for nested functions. */
  readonly parentId: string | null;
  readonly className: string | null;
  /** The body as control flow; an expression-bodied arrow is one `return`. */
  readonly flow: SequenceNode;
};

/**
 * resolved: one function in the graph; ambiguous: the name may refer to
 * several functions in the graph (`candidateIds`), so no one is followed;
 * dynamic: the callee is computed at run time (a parameter or callback,
 * `obj[key]()`, `f()()`); external: a known runtime global such as
 * `console.log`; unresolved: anything else the analysis cannot follow
 * (imports, variables, `obj.method()` on an unknown receiver, `super`). A
 * call through an import stays unresolved within its file and carries `via`.
 */
type CallResolution =
  "resolved" | "ambiguous" | "dynamic" | "unresolved" | "external";

type CallKind = "call" | "optional-call" | "new";

/**
 * How a call reaches an import binding of its module: `helper()` and
 * `new Svc()` name it directly (`member` null), `ns.run()` and `Svc.make()`
 * through one member access, `new ns.Svc()` too. Deeper chains (`ns.a.b()`) carry none.
 */
type ImportVia = {
  /** The import binding's local name. */
  readonly localName: string;
  readonly member: string | null;
  readonly isNew: boolean;
};

type CallSite = {
  /**
   * `${callerId}@${span.start}`; a call enclosing another that starts at the
   * same offset (`f()()`) adds its end: `${callerId}@${start}-${end}`.
   */
  readonly id: string;
  /** A FunctionNode id, or the ModuleNode id for top-level calls. */
  readonly callerId: string;
  /** As written: "getUser", "this.load", "console.log", "Svc" for `new Svc()`. */
  readonly calleeName: string;
  /** Set for `resolved` only: an ambiguous call is never followed. */
  readonly calleeId: string | null;
  readonly resolution: CallResolution;
  /** For `ambiguous`: every function it may call, at least two, in source order. */
  readonly candidateIds?: readonly string[];
  readonly kind: CallKind;
  /** The call is the direct operand of an `await`. */
  readonly awaited: boolean;
  readonly span: SourceSpan;
  /** Set when the callee is an import binding (see ImportVia). */
  readonly via?: ImportVia;
};

/**
 * One per (caller, callee) pair of resolved function-to-function calls, in
 * first-occurrence order. `source === target` is recursion.
 */
type CallEdge = {
  readonly type: "call";
  readonly source: string;
  readonly target: string;
  readonly callSiteIds: readonly string[];
};

/** Module → top-level function, or named function → nested named function. */
type ContainmentEdge = {
  readonly type: "containment";
  readonly source: string;
  readonly target: string;
};

type GraphEdge = CallEdge | ContainmentEdge;

type CodeGraph = {
  readonly modules: readonly ModuleNode[];
  readonly functions: readonly FunctionNode[];
  readonly callSites: readonly CallSite[];
  readonly edges: readonly GraphEdge[];
};

export type {
  AwaitNode,
  BranchNode,
  BreakNode,
  CallEdge,
  CallKind,
  CallNode,
  CallResolution,
  CallSite,
  CodeGraph,
  ContainmentEdge,
  ContinueNode,
  ExportRecord,
  FlowNode,
  FlowStep,
  FunctionKind,
  FunctionNode,
  GraphEdge,
  ImportRecord,
  ImportVia,
  Language,
  LoopKind,
  LoopNode,
  ModuleNode,
  ReturnNode,
  SequenceNode,
  SourceSpan,
  StepNode,
  SwitchCase,
  SwitchNode,
  TryNode,
};
