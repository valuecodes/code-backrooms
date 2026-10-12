// What a module writes after declaring it: a binding whose class is only
// inferred from the `new` it starts with (`let svc = new Svc()`) may come to
// hold anything once it is assigned, so the discovery pass drops that class.
// By name, module-wide, which is coarse but never misses a write.

import {
  isArrayPattern,
  isAssignmentExpression,
  isAssignmentPattern,
  isForInStatement,
  isForOfStatement,
  isIdentifier,
  isMemberExpression,
  isObjectPattern,
  isObjectProperty,
  isOptionalMemberExpression,
  isPrivateName,
  isRestElement,
  isUpdateExpression,
  isVariableDeclaration,
} from "@babel/types";
import type { Node } from "@babel/types";

import { unwrap } from "./scope";
import { childrenOf } from "./walk";

type Writes = {
  /** Identifiers assigned, updated or used as a `for…in`/`for…of` target. */
  readonly names: ReadonlySet<string>;
  /** Properties written through any object (`a.svc = …`), `#x` for private. */
  readonly members: ReadonlySet<string>;
};

const addTargets = (
  raw: Node,
  names: Set<string>,
  members: Set<string>
): void => {
  const target = unwrap(raw);
  if (isIdentifier(target)) {
    names.add(target.name);
  } else if (
    (isMemberExpression(target) || isOptionalMemberExpression(target)) &&
    !target.computed
  ) {
    const { property } = target;
    if (isIdentifier(property)) {
      members.add(property.name);
    } else if (isPrivateName(property)) {
      members.add(`#${property.id.name}`);
    }
  } else if (isObjectPattern(target)) {
    for (const property of target.properties) {
      addTargets(
        isObjectProperty(property) ? property.value : property,
        names,
        members
      );
    }
  } else if (isArrayPattern(target)) {
    for (const element of target.elements) {
      if (element !== null) {
        addTargets(element, names, members);
      }
    }
  } else if (isRestElement(target)) {
    addTargets(target.argument, names, members);
  } else if (isAssignmentPattern(target)) {
    addTargets(target.left, names, members);
  }
};

/** Every write in the program, walked without recursion. */
const writesOf = (program: Node): Writes => {
  const names = new Set<string>();
  const members = new Set<string>();
  const stack: Node[] = [program];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isAssignmentExpression(node)) {
      addTargets(node.left, names, members);
    } else if (isUpdateExpression(node)) {
      addTargets(node.argument, names, members);
    } else if (
      (isForInStatement(node) || isForOfStatement(node)) &&
      !isVariableDeclaration(node.left)
    ) {
      addTargets(node.left, names, members);
    }
    stack.push(...childrenOf(node));
  }
  return { names, members };
};

export { writesOf };
export type { Writes };
