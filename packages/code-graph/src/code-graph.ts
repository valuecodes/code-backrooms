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

type ModuleNode = {
  /** The normalised path doubles as the id: "src/demo.ts". */
  readonly id: string;
  readonly path: string;
  readonly language: Language;
  readonly lineCount: number;
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
  // Control flow (branches, loops, returns) is added here in a later milestone.
};

/**
 * resolved: a function in the graph; external: a known runtime global such as
 * `console.log`; unresolved: anything the analysis cannot follow (imports,
 * `obj.method()`, callbacks, shadowed names).
 */
type CallResolution = "resolved" | "unresolved" | "external";

type CallKind = "call" | "optional-call" | "new";

type CallSite = {
  /** `${callerId}@${span.start}`: offsets are unique within a module. */
  readonly id: string;
  /** A FunctionNode id, or the ModuleNode id for top-level calls. */
  readonly callerId: string;
  /** As written: "getUser", "this.load", "console.log", "Svc" for `new Svc()`. */
  readonly calleeName: string;
  readonly calleeId: string | null;
  readonly resolution: CallResolution;
  readonly kind: CallKind;
  /** The call is the direct operand of an `await`. */
  readonly awaited: boolean;
  readonly span: SourceSpan;
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
  CallEdge,
  CallKind,
  CallResolution,
  CallSite,
  CodeGraph,
  ContainmentEdge,
  FunctionKind,
  FunctionNode,
  GraphEdge,
  Language,
  ModuleNode,
  SourceSpan,
};
