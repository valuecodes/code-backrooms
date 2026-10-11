// JSON with comments and trailing commas, the dialect `tsconfig.json` files
// are written in. Two passes blank out what plain JSON rejects, then
// `JSON.parse` does the rest. Blanking keeps every other character where it
// was, so error positions still point into the original text.

/** The end of the string literal opening at `start` (the index after its closing quote). */
const stringEnd = (text: string, start: number): number => {
  let index = start + 1;
  while (index < text.length && text.charAt(index) !== '"') {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }
  return index + 1;
};

const blank = (text: string): string => text.replaceAll(/[^\n]/g, " ");

/** `text` with `//` and `/* *\/` comments outside strings replaced by spaces. */
const withoutComments = (text: string): string => {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    let stop = index + 1;
    if (char === '"') {
      stop = stringEnd(text, index);
    } else if (char === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      stop = end === -1 ? text.length : end;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      stop = end === -1 ? text.length : end + 2;
    }
    const piece = text.slice(index, stop);
    out += char === "/" && stop - index > 1 ? blank(piece) : piece;
    index = stop;
  }
  return out;
};

/** `text` (comments already gone) without commas that close nothing but `}` or `]`. */
const withoutTrailingCommas = (text: string): string => {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '"') {
      const stop = stringEnd(text, index);
      out += text.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === ",") {
      let ahead = index + 1;
      while (ahead < text.length && /\s/.test(text.charAt(ahead))) {
        ahead += 1;
      }
      const closer = text.charAt(ahead);
      out += closer === "}" || closer === "]" ? " " : char;
    } else {
      out += char;
    }
    index += 1;
  }
  return out;
};

/** Parses JSONC; a syntax error names the file, as a source syntax error does. */
const parseJsonc = (path: string, text: string): unknown => {
  try {
    return JSON.parse(withoutTrailingCommas(withoutComments(text)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${message}`, { cause: error });
  }
};

export { parseJsonc };
