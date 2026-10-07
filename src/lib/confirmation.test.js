import test from "node:test";
import assert from "node:assert/strict";
import { confirmationCharacter } from "./confirmation.js";

test("confirmation accepts individual typed alphanumerics, not paste, autofill, composition or synthetic input", () => {
  const typed = { isTrusted: true, inputType: "insertText", isComposing: false, data: "a" };
  assert.equal(confirmationCharacter(typed), "A");
  assert.equal(confirmationCharacter({ ...typed, data: "7" }), "7");
  for (const change of [
    { isTrusted: false },
    { inputType: "insertFromPaste" },
    { inputType: "insertFromDrop" },
    { inputType: "insertReplacementText" },
    { isComposing: true },
    { data: "ABC123" },
    { data: "a\n" },
    { data: "山" },
    { data: "!" },
    { data: null },
  ]) assert.equal(confirmationCharacter({ ...typed, ...change }), "");
});
