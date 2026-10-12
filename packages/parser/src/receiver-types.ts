// The classes the discovery pass records for receivers: a variable's
// (`const svc: Svc`, `let svc = new Svc()`) in its scope, and a class's
// instance fields (`svc: Svc`, `constructor(private svc: Svc)`) in its table.

import {
  isAssignmentPattern,
  isClassMethod,
  isClassPrivateProperty,
  isClassProperty,
  isIdentifier,
  isTSParameterProperty,
} from "@babel/types";
import type { ClassBody, Node } from "@babel/types";

import { bindingNames, declareType, receiverOf } from "./scope";
import type { ClassTable, ReceiverType, Scope } from "./scope";
import { writesMember } from "./writes";
import type { Writes } from "./writes";

/**
 * The class of a variable, before its names join the scope's bindings: one
 * already bound in the (folded) scope must agree with it. A destructured
 * name has no class.
 */
const declareTypes = (
  writes: Writes,
  scope: Scope,
  id: Node,
  init: Node | null | undefined
): void => {
  const bound = (name: string) =>
    scope.bindings.has(name) ||
    scope.locals.has(name) ||
    scope.classes.has(name);
  if (isIdentifier(id)) {
    declareType(
      scope.types,
      bound(id.name),
      id.name,
      receiverOf(id.typeAnnotation, init, writes.names.has(id.name), false)
    );
    return;
  }
  const names = new Set<string>();
  bindingNames(id, names);
  for (const name of names) {
    declareType(scope.types, bound(name), name, null);
  }
};

/** Records one instance field, typed or not; a redeclaration must agree. */
const recordField = (
  table: ClassTable,
  name: string,
  type: ReceiverType | null
): void => {
  if (table.fields.has(name)) {
    declareType(table.fields, true, name, type);
  } else {
    table.fields.set(name, type);
  }
};

/**
 * The instance fields a member declares: a property that does not hold a
 * function (`svc: Svc`, `#svc = new Svc()`), or the constructor's parameter
 * properties (`constructor(private svc: Svc)`). Anyone holding the instance
 * may replace a field, so a field's class is never exact.
 */
const recordFields = (
  writes: Writes,
  table: ClassTable,
  member: ClassBody["body"][number]
): void => {
  if (isClassProperty(member) || isClassPrivateProperty(member)) {
    if (member.static) {
      return;
    }
    let fieldName: string | null = null;
    if (isClassPrivateProperty(member)) {
      fieldName = `#${member.key.id.name}`;
    } else if (!member.computed && isIdentifier(member.key)) {
      fieldName = member.key.name;
    }
    if (fieldName !== null) {
      recordField(
        table,
        fieldName,
        receiverOf(
          member.typeAnnotation,
          member.value,
          writesMember(writes, fieldName),
          true
        )
      );
    }
    return;
  }
  if (!isClassMethod(member) || member.kind !== "constructor") {
    return;
  }
  for (const param of member.params) {
    if (!isTSParameterProperty(param)) {
      continue;
    }
    const binding = param.parameter;
    const [id, init] = isAssignmentPattern(binding)
      ? [binding.left, binding.right]
      : [binding, null];
    if (isIdentifier(id)) {
      recordField(
        table,
        id.name,
        receiverOf(id.typeAnnotation, init, writesMember(writes, id.name), true)
      );
    }
  }
};

export { declareTypes, recordFields };
