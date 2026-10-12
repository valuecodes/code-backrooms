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
  isStringLiteral,
  isUpdateExpression,
  isVariableDeclaration,
} from "@babel/types";
import type { Node } from "@babel/types";

import { unwrap } from "./scope";
import { childrenOf } from "./walk";

type Writes = {
  /** Identifiers assigned, updated or used as a `for…in`/`for…of` target. */
  readonly names: ReadonlySet<string>;
  /**
   * Properties written through any object (`a.svc = …`, `a["svc"] = …`),
   * `#x` for private.
   */
  readonly members: ReadonlySet<string>;
  /** A write through a computed key (`a[key] = …`) may reach any property. */
  readonly anyMember: boolean;
};

type Collector = {
  readonly names: Set<string>;
  readonly members: Set<string>;
  anyMember: boolean;
};

const addTargets = (raw: Node, out: Collector): void => {
  const target = unwrap(raw);
  if (isIdentifier(target)) {
    out.names.add(target.name);
  } else if (isMemberExpression(target) || isOptionalMemberExpression(target)) {
    const { property } = target;
    if (target.computed) {
      if (isStringLiteral(property)) {
        out.members.add(property.value);
      } else {
        out.anyMember = true;
      }
    } else if (isIdentifier(property)) {
      out.members.add(property.name);
    } else if (isPrivateName(property)) {
      out.members.add(`#${property.id.name}`);
    }
  } else if (isObjectPattern(target)) {
    for (const property of target.properties) {
      addTargets(isObjectProperty(property) ? property.value : property, out);
    }
  } else if (isArrayPattern(target)) {
    for (const element of target.elements) {
      if (element !== null) {
        addTargets(element, out);
      }
    }
  } else if (isRestElement(target)) {
    addTargets(target.argument, out);
  } else if (isAssignmentPattern(target)) {
    addTargets(target.left, out);
  }
};

/** Every write in the program, walked without recursion. */
const writesOf = (program: Node): Writes => {
  const out: Collector = {
    names: new Set(),
    members: new Set(),
    anyMember: false,
  };
  const stack: Node[] = [program];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isAssignmentExpression(node)) {
      addTargets(node.left, out);
    } else if (isUpdateExpression(node)) {
      addTargets(node.argument, out);
    } else if (
      (isForInStatement(node) || isForOfStatement(node)) &&
      !isVariableDeclaration(node.left)
    ) {
      addTargets(node.left, out);
    }
    stack.push(...childrenOf(node));
  }
  return out;
};

/** Whether the module may write property `name` of some object. */
const writesMember = (writes: Writes, name: string): boolean =>
  writes.anyMember || writes.members.has(name);

export { writesMember, writesOf };
export type { Writes };
