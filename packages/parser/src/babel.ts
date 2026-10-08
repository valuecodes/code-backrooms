import { parse } from "@babel/parser";
import type { ParserOptions } from "@babel/parser";
import type { File } from "@babel/types";
import type { Language } from "@repo/code-graph";

type Plugins = NonNullable<ParserOptions["plugins"]>;

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
};

const TYPESCRIPT = new Set(["ts", "tsx", "mts", "cts"]);
/** `.ts` never gets JSX: `<T>expr` casts would become ambiguous and fail. */
const JSX = new Set(["tsx", "jsx", "js", "mjs", "cjs"]);

const languageOf = (path: string): Language =>
  TYPESCRIPT.has(extensionOf(path)) ? "typescript" : "javascript";

const pluginsFor = (path: string): Plugins => {
  const extension = extensionOf(path);
  const plugins: Plugins = [];
  if (TYPESCRIPT.has(extension)) {
    plugins.push("typescript");
  }
  if (JSX.has(extension)) {
    plugins.push("jsx");
  }
  return plugins;
};

/**
 * One parse, no comments attached (they are never read) and no error
 * recovery: a syntax error is reported with the file in front of Babel's own
 * `(line:column)` message.
 */
const parseSource = (path: string, source: string): File => {
  try {
    return parse(source, {
      sourceType: "module",
      sourceFilename: path,
      plugins: pluginsFor(path),
      attachComment: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${message}`, { cause: error });
  }
};

export { languageOf, parseSource };
