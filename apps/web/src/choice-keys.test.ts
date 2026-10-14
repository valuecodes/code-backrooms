import { describe, expect, it } from "vitest";

import { choiceDigit } from "./choice-keys";

describe("choiceDigit", () => {
  it("reads 1 to 9 from the number row and the keypad", () => {
    expect(choiceDigit("Digit1")).toBe(1);
    expect(choiceDigit("Digit9")).toBe(9);
    expect(choiceDigit("Numpad2")).toBe(2);
  });

  it("ignores 0 and every other key", () => {
    expect(choiceDigit("Digit0")).toBeNull();
    expect(choiceDigit("Numpad0")).toBeNull();
    expect(choiceDigit("KeyE")).toBeNull();
    expect(choiceDigit("Digit10")).toBeNull();
  });
});
