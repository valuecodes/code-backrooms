// The keys that pick a candidate at a choice portal: 1 to 9, on the number
// row or the keypad, by physical key so the layout does not matter.

const DIGIT_KEY = /^(?:Digit|Numpad)([1-9])$/u;

/** The candidate number a key picks, 1 to 9, or null for any other key. */
const choiceDigit = (code: string): number | null => {
  const match = DIGIT_KEY.exec(code);
  return match === null ? null : Number(match[1]);
};

export { choiceDigit };
