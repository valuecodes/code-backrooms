// Stable, human-readable ids. The same source always yields the same ids, so
// layouts, tests and URLs can refer to them.

const FUNCTION_SEPARATOR = "::";

/** Forward slashes, no leading `./`, no doubled separators: "src/demo.ts". */
const moduleId = (path: string): string => {
  let normalised = path.replaceAll("\\", "/").replaceAll(/\/{2,}/g, "/");
  while (normalised.startsWith("./")) {
    normalised = normalised.slice(2);
  }
  return normalised;
};

const functionId = (module: string, qualifiedName: string): string =>
  `${module}${FUNCTION_SEPARATOR}${qualifiedName}`;

const callSiteId = (callerId: string, offset: number): string =>
  `${callerId}@${offset}`;

/** Module ids are paths and never contain `::`; function ids always do. */
const isFunctionId = (id: string): boolean => id.includes(FUNCTION_SEPARATOR);

/**
 * Keeps qualified names unique within a module: the first `foo` stays `foo`,
 * the next become `foo~2`, `foo~3`, in the order they are asked for.
 */
const uniqueNames = (): ((qualifiedName: string) => string) => {
  const seen = new Map<string, number>();
  return (qualifiedName) => {
    const count = (seen.get(qualifiedName) ?? 0) + 1;
    seen.set(qualifiedName, count);
    return count === 1 ? qualifiedName : `${qualifiedName}~${count}`;
  };
};

export { callSiteId, functionId, isFunctionId, moduleId, uniqueNames };
