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

const CALL_PORTAL_PREFIX = "portal:";
const RETURN_PORTAL_PREFIX = "return:";

/** A call portal is named by the call site it stands for: `portal:demo.ts::main@42`. */
const callPortalId = (callSiteId: string): string =>
  `${CALL_PORTAL_PREFIX}${callSiteId}`;

/** A function's return portal: `return:demo.ts::main`. */
const returnPortalId = (functionId: string): string =>
  `${RETURN_PORTAL_PREFIX}${functionId}`;

type PortalRef =
  | { readonly kind: "call"; readonly callSiteId: string }
  | { readonly kind: "return"; readonly functionId: string };

/** What a portal id names, or null for ids that are not portals of this grammar. */
const parsePortalId = (id: string): PortalRef | null => {
  if (id.startsWith(CALL_PORTAL_PREFIX)) {
    return { kind: "call", callSiteId: id.slice(CALL_PORTAL_PREFIX.length) };
  }
  if (id.startsWith(RETURN_PORTAL_PREFIX)) {
    return {
      kind: "return",
      functionId: id.slice(RETURN_PORTAL_PREFIX.length),
    };
  }
  return null;
};

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

export {
  callPortalId,
  callSiteId,
  functionId,
  isFunctionId,
  moduleId,
  parsePortalId,
  returnPortalId,
  uniqueNames,
};
export type { PortalRef };
