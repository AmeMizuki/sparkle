import test from "node:test";
import assert from "node:assert/strict";
import { createId, deleteAllImages } from "./db.js";

test("deleting the entire library rejects missing, malformed, and mismatched confirmation codes before accessing storage", async () => {
  for (const [code, input] of [
    ["", ""],
    [undefined, undefined],
    [123456, 123456],
    ["ABC12", "ABC12"],
    ["ABC12!", "ABC12!"],
    ["ABC123", ""],
    ["ABC123", "abc123"],
    ["ABC123", "ABC124"],
    ["ABC123", " ABC123"],
  ]) {
    await assert.rejects(deleteAllImages(code, input), RangeError);
  }
});

test("IDs remain valid UUIDv4 values when randomUUID is unavailable", (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  t.after(() => {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else delete crypto.randomUUID;
  });
  let byte = 0xff;
  t.mock.method(crypto, "getRandomValues", (bytes) => bytes.fill(byte));
  assert.equal(createId(), "ffffffff-ffff-4fff-bfff-ffffffffffff");
  byte = 0;
  assert.equal(createId(), "00000000-0000-4000-8000-000000000000");
});
