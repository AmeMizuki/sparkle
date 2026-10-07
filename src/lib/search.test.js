import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch } from "./search.js";
test("search supports name typos, sources, dates and combined terms without unrelated matches", () => {
  const image = {
    name: "Watercolor garden",
    date: "2026-10-05T10:30:00Z",
    source: "ComfyUI",
  };
  assert.equal(matchesSearch(image, "watercolr ComfyUI"), true);
  assert.equal(matchesSearch(image, "2026-10-05"), true);
  assert.equal(matchesSearch(image, "garden 2025"), false);
  assert.equal(matchesSearch({ ...image, name: "山水靈感" }, "山水"), true);
  assert.equal(matchesSearch(image, "gaxden"), true);
  assert.equal(matchesSearch(image, "gardxx"), false);
  assert.equal(matchesSearch({ ...image, artist: "Claude Monet" }, "Monet"), false);
});
